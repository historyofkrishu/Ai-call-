require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const {
  ANTHROPIC_API_KEY,
  ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  OWNER_PHONE_NUMBER,
  USER_NAME,
  BASE_URL,
  PORT
} = process.env;

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const AUDIO_DIR = path.join(__dirname, 'audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);

// In-memory store: conversation history per call
// { [CallSid]: { history: [...], callerNumber: '...' } }
const activeCalls = {};

const SYSTEM_PROMPT = `Tum ${USER_NAME || 'ek user'} ke personal AI call assistant ho.
${USER_NAME || 'User'} abhi busy hai isliye tum unki taraf se dost se baat kar rahe ho.
Tumhara kaam hai:
1. Dost se friendly, casual andaaz mein Hindi mein baat karo (jaise ek dost baat karta hai)
2. Pucho ki call kis baare mein hai / kya kaam hai
3. Unka message note karo taaki baad mein ${USER_NAME || 'user'} ko bata sako
4. Jaldi mein hi rakho — 1-2 short sentences mein jawab do, ye phone call hai
5. Agar dost pooche "tum AI ho?" to sach batao ki haan, ye ${USER_NAME || 'user'} ka AI assistant hai
6. Jab lage baat complete ho gayi hai, politely call end karne ki taraf le jao

Hamesha chhote, natural, bolne-jaise jawab do. Kabhi lambi list ya formatting mat use karo, ye voice call hai.`;

// ---------- Helper: Call Claude API ----------
async function getClaudeReply(history) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: history
    })
  });
  const data = await response.json();
  if (data.error) {
    console.error('Claude API error:', data.error);
    return 'Sorry, thoda technical issue ho raha hai. Main baad mein message pahuncha dunga.';
  }
  const textBlock = data.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : 'Achha, theek hai.';
}

// ---------- Helper: Call ElevenLabs TTS, save mp3, return filename ----------
async function generateSpeech(text) {
  const voiceId = ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error('ElevenLabs error:', err);
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const filename = `speech-${Date.now()}.mp3`;
  fs.writeFileSync(path.join(AUDIO_DIR, filename), buffer);
  return filename;
}

// ---------- Route: Incoming call ----------
app.post('/incoming-call', (req, res) => {
  const callSid = req.body.CallSid;
  const callerNumber = req.body.From;

  activeCalls[callSid] = {
    history: [],
    callerNumber
  };

  const twiml = new twilio.twiml.VoiceResponse();
  const gather = twiml.gather({
    input: 'speech',
    action: '/handle-speech',
    method: 'POST',
    speechTimeout: 'auto',
    language: 'hi-IN'
  });
  gather.say(
    { language: 'hi-IN' },
    `Namaste! ${USER_NAME || 'Main'} abhi busy hai, main unka AI assistant baat kar raha hoon. Kaise madad karu?`
  );

  // agar koi kuch na bole
  twiml.say({ language: 'hi-IN' }, 'Kuch sunayi nahi diya. Phir se call kar lena. Dhanyavaad!');
  twiml.hangup();

  res.type('text/xml').send(twiml.toString());
});

// ---------- Route: Handle speech result, loop conversation ----------
app.post('/handle-speech', async (req, res) => {
  const callSid = req.body.CallSid;
  const speechResult = req.body.SpeechResult;
  const call = activeCalls[callSid] || { history: [], callerNumber: req.body.From };

  const twiml = new twilio.twiml.VoiceResponse();

  if (!speechResult) {
    twiml.say({ language: 'hi-IN' }, 'Sorry, samajh nahi aaya. Dhanyavaad, phir baat karte hain!');
    twiml.hangup();
    await sendSummary(callSid, call);
    return res.type('text/xml').send(twiml.toString());
  }

  call.history.push({ role: 'user', content: speechResult });
  activeCalls[callSid] = call;

  let replyText;
  try {
    replyText = await getClaudeReply(call.history);
  } catch (e) {
    console.error(e);
    replyText = 'Sorry, thoda issue ho gaya. Main message note kar leta hoon.';
  }
  call.history.push({ role: 'assistant', content: replyText });

  // Try ElevenLabs for natural voice; fallback to Twilio's built-in voice if it fails
  let audioFile = null;
  try {
    audioFile = await generateSpeech(replyText);
  } catch (e) {
    console.error('TTS failed:', e);
  }

  const endPhrases = ['dhanyavaad', 'alvida', 'bye', 'baad mein baat karte'];
  const shouldEndCall = endPhrases.some((p) => replyText.toLowerCase().includes(p));

  const gather = twiml.gather({
    input: 'speech',
    action: '/handle-speech',
    method: 'POST',
    speechTimeout: 'auto',
    language: 'hi-IN'
  });

  if (audioFile) {
    gather.play(`${BASE_URL}/audio/${audioFile}`);
  } else {
    gather.say({ language: 'hi-IN' }, replyText);
  }

  if (shouldEndCall) {
    twiml.say({ language: 'hi-IN' }, 'Dhanyavaad, alvida!');
    twiml.hangup();
    await sendSummary(callSid, call);
  } else {
    // agar dobara kuch na bole to politely end karo
    twiml.say({ language: 'hi-IN' }, 'Theek hai, dhanyavaad! Alvida.');
    twiml.hangup();
  }

  res.type('text/xml').send(twiml.toString());
});

// ---------- Route: Call status callback (cleanup + summary safety net) ----------
app.post('/call-status', async (req, res) => {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;
  if (callStatus === 'completed' && activeCalls[callSid]) {
    await sendSummary(callSid, activeCalls[callSid]);
    delete activeCalls[callSid];
  }
  res.sendStatus(200);
});

// ---------- Helper: Send SMS summary of the call to the owner ----------
async function sendSummary(callSid, call) {
  if (!call || !call.history || call.history.length === 0) return;
  if (!OWNER_PHONE_NUMBER) return;

  const transcript = call.history
    .map((m) => `${m.role === 'user' ? 'Dost' : 'AI'}: ${m.content}`)
    .join('\n');

  const shortSummary =
    transcript.length > 500 ? transcript.slice(0, 500) + '...' : transcript;

  try {
    await twilioClient.messages.create({
      from: TWILIO_PHONE_NUMBER,
      to: OWNER_PHONE_NUMBER,
      body: `Call summary (${call.callerNumber || 'unknown number'}):\n${shortSummary}`
    });
  } catch (e) {
    console.error('SMS summary failed:', e);
  }
  delete activeCalls[callSid];
}

// ---------- Serve generated audio files ----------
app.use('/audio', express.static(AUDIO_DIR));

// ---------- Health check ----------
app.get('/', (req, res) => {
  res.send('Friend Call AI server chal raha hai ✅');
});

const port = PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
