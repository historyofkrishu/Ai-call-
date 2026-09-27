# Friend Call AI — Setup Guide

Ye AI assistant tumhari calls handle karega jab tum busy ho. Dost call karega,
AI Hindi mein baat karega, message note karega, aur call khatam hone par tumhe
SMS summary bhej dega.

## Kaise kaam karta hai

```
Dost tumhare Twilio number par call karta hai
        ↓
Twilio → tumhara server (/incoming-call)
        ↓
Twilio khud awaaz ko text banata hai (built-in speech recognition)
        ↓
Text Claude API ko jata hai → natural jawab milta hai
        ↓
Jawab ElevenLabs se real awaaz mein convert hota hai
        ↓
Dost ko jawab sunayi deta hai, conversation loop chalta rehta hai
        ↓
Call end → tumhe SMS mein pura summary milta hai
```

## Step 1 — Accounts banao (sabme free trial milta hai)

1. **Twilio** — twilio.com/try-twilio. Ek phone number kharido (~₹80-100/month, trial credit se free mil sakta hai)
2. **Anthropic Claude API** — console.anthropic.com par API key banao
3. **ElevenLabs** — elevenlabs.io par account banao, API key aur ek Voice ID lo (free tier available hai)

## Step 2 — Code download aur setup

1. Ye poora folder apne computer par rakho
2. Terminal mein folder ke andar jaake:
   ```
   npm install
   ```
3. `.env.example` ko copy karke `.env` banao, aur usme apni actual keys daal do:
   ```
   cp .env.example .env
   ```
4. `.env` file open karke saari keys fill karo (Anthropic, ElevenLabs, Twilio, apna number)

## Step 3 — Deploy karo (Railway sabse aasaan hai)

1. railway.app par account banao (GitHub se sign in karo)
2. "New Project" → "Deploy from GitHub repo" (pehle ye code GitHub par push karo)
   - Ya phir Railway CLI se seedha deploy: `railway up`
3. Deploy hone ke baad Railway tumhe ek public URL dega, jaise:
   `https://friend-call-ai-production.up.railway.app`
4. Is URL ko `.env` mein `BASE_URL` variable mein daal do, aur Railway ke
   dashboard mein "Variables" section mein saari `.env` wali keys bhi add karo
5. Redeploy karo taaki naya BASE_URL effect mein aaye

> Render.com bhi isi tarah kaam karta hai agar Railway pasand na aaye.

## Step 4 — Twilio number ko apne server se connect karo

1. Twilio Console → Phone Numbers → apna number kholo
2. "Voice Configuration" section mein:
   - **A call comes in** → Webhook → `https://your-app.up.railway.app/incoming-call` (HTTP POST)
   - **Call status changes** → `https://your-app.up.railway.app/call-status` (HTTP POST)
3. Save karo

## Step 5 — Apne Realme phone par call forwarding set karo

Taaki jab tum busy ho (ya na uthao), call automatically tumhare AI number par chali jaye:

1. Phone app kholo → **teen dots (menu) → Settings** (ya Call Settings)
2. **Supplementary Services / Call Forwarding** dhundo
3. In options ko set karo:
   - **"Jab busy ho"** → apna Twilio number daalo
   - **"Jab jawab na do"** (No Answer) → wahi Twilio number, timeout 10-15 sec rakho
   - Chaho to **"Jab phone off/unreachable ho"** bhi set kar sakte ho
4. Realme (Realme UI/ColorOS) mein ye option usually **Settings → Apps → Phone →
   Call Settings → Supplementary Services** mein milta hai (exact path phone
   software version ke hisaab se thoda alag ho sakta hai)

## Step 6 — Test karo

Kisi doosre number se apne Twilio number par call lagao — AI jawab dega,
tumhare naam ke saath baat karega. Call khatam hone par tumhe apne
`OWNER_PHONE_NUMBER` par SMS summary milega.

## Zaroori baatein

- **Transparency**: AI khud bata dega ki wo assistant hai agar dost pooche —
  ye achhi practice hai
- **Cost**: Twilio (~₹1-2/min calls + number rent), ElevenLabs aur Claude API
  ka usage-based charge — halke use mein mahine ka kharch bahut kam rahega
- **Customize karna ho** to `server.js` mein `SYSTEM_PROMPT` variable badal
  do — wahi AI ka persona/instructions control karta hai
- Agar ElevenLabs fail ho jaye kisi wajah se, code automatically Twilio ki
  built-in awaaz par fallback kar leta hai, call fail nahi hogi

## Troubleshooting

- Call connect na ho → Twilio webhook URL check karo (https honi chahiye, http nahi)
- AI ka jawab na aaye → Railway logs check karo (`railway logs`), API keys sahi hain ya nahi dekho
- Awaaz robotic lage → ElevenLabs voice_settings mein stability/similarity values adjust karo
