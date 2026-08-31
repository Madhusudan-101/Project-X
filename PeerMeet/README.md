# PeerMeet — P2P Video Calls with an AI Mock-Interview Mode

A real-time, peer-to-peer video & audio meeting app for exactly **two participants**, built with React, WebRTC (Simple Peer), and Socket.IO — extended with an optional, fully **disclosed** AI-assisted mock interview mode: Gemini generates and evaluates interview questions live, Deepgram provides a live transcript, and each candidate gets a feedback report at the end of their turn.

> 🔒 **No audio/video ever passes through the server.** Media flows directly peer-to-peer via WebRTC. Socket.IO is used only for signaling and for the interview/transcription features described below.

---

## What PeerMeet does

PeerMeet is two things layered on top of the same call:

1. **A plain 2-person video call** — create a room, share the link, talk. Screen sharing, mute/camera toggle, connection status, and reconnect handling all work the same whether or not the interview mode is used.
2. **An optional AI-assisted mock interview**, turned on by the meeting creator once both people have joined. One participant is the *interviewer*, the other the *candidate*; Gemini suggests the next question and evaluates each answer **for the interviewer only** — the candidate never sees the AI panel, only a disclosure banner stating AI assistance is active. Roles can be swapped mid-session so both people get interviewed. Each candidate receives their own feedback report (scores, strengths/weaknesses, topic coverage, a Hire/Maybe/Reject-style recommendation) after their turn, exportable as a PDF via the browser's print dialog.

This is a **practice/mock interview tool**, not a hiring platform — the AI's own prompts say so explicitly, and the report should be read as practice feedback, not a real hiring verdict.

---

## Features

| Feature | Description |
|---|---|
| 🎥 HD Video | Up to 1280×720 camera feed, peer-to-peer via WebRTC |
| 🎙️ Audio | Echo cancellation & noise suppression |
| 🔇 Mute / 📷 Camera toggle | Without stopping the underlying stream |
| 🖥️ Screen Sharing | Swaps the outgoing video track without renegotiating the connection |
| ⏱️ Meeting Timer | Elapsed time once connected |
| 🔁 Reconnect handling | A stable per-participant ID (not the ephemeral socket ID) lets a network blip or page refresh reclaim the same room slot and interview role |
| 🛑 Room Limit | Max 2 participants, enforced server-side; duplicate-tab detection prevents a copied session from silently stealing a slot |
| 🧠 AI Mock Interview | Domain, difficulty, candidate experience, duration, and who-starts-first are all configurable; Gemini generates the next question and evaluates each answer against it |
| 📊 Interviewer Copilot | Live coverage-by-topic breakdown, suggested follow-up questions, and a running strengths/weaknesses summary — interviewer-only |
| 🔀 Role Switching | Swap interviewer/candidate mid-session; a report is generated for the outgoing candidate at the swap |
| 📝 Feedback Reports | Per-candidate scores (overall/technical/communication/confidence/problem-solving), topic coverage, question timeline, and suggestions |
| 📄 PDF Export | Print-to-PDF via the browser's own print dialog — no extra client-side PDF library |
| 🗣️ Live Transcription | Deepgram-powered live captions, shared with both participants and replayed on reconnect |
| 📡 TURN/STUN | Metered.live-issued short-lived TURN credentials (fetched server-side) plus Google's public STUN, for NAT traversal |
| 🚨 Error Handling | Camera/mic denial, device-not-found, peer disconnect, and ICE failure all surface a clear, recoverable UI state instead of a blank screen |

---

## Architecture

```
┌──────────────────┐        Socket.IO (signaling +        ┌──────────────────┐
│  Client (React)   │◄──────  interview/transcription  ───►│  Server (Node/    │
│  Vite + Tailwind   │        events, JSON over WS)         │  Express/Socket.IO)│
└─────────┬─────────┘                                       └─────────┬─────────┘
          │                                                            │
          │  WebRTC (SDP/ICE exchanged via the Socket.IO signal        │
          │  above; media itself never touches the server)             │
          ▼                                                            ▼
┌──────────────────┐                                       ┌──────────────────────┐
│   Other browser    │◄═══════ Direct P2P media (DTLS-SRTP) ═══►│  External services:  │
│  (peer's camera/mic)│                                       │  Gemini · Deepgram ·  │
└──────────────────┘                                       │  Metered TURN API     │
                                                              └──────────────────────┘
```

- **Signaling**: Socket.IO carries room create/join, SDP offer/answer, and ICE candidates only — the server never inspects call content, just relays it (`server/src/index.js`).
- **Room/interview state**: kept **in-memory** in the Node process (`server/src/roomManager.js`) — no database. A participant is identified by a stable, client-generated `participantId` (not the ephemeral `socket.id`), which is what lets a reconnect or page refresh reclaim the same room slot and interview role.
- **AI**: `server/src/interviewAssistant.js` calls Gemini (`@google/genai`) server-side only — the API key never reaches the client. Question generation and answer evaluation are separate, JSON-only prompts; responses are parsed and defensively sanitized before use.
- **Transcription**: `server/src/deepgramTranscription.js` opens one Deepgram live-transcription connection per participant, fed by short audio chunks recorded client-side (`MediaRecorder`) and streamed over the socket. Transcripts are broadcast to both participants and buffered per-interview-phase to feed the AI analysis.
- **TURN/STUN**: the server fetches short-lived TURN credentials from Metered's API (cached a few hours) and hands the full ICE server list to the client over the authenticated socket — TURN credentials are never hardcoded in client source.

---

## Installation

**Prerequisites**: Node.js ≥ 18, npm ≥ 9.

```bash
git clone <this-repo-url>
cd PeerMeet
```

### Server

```bash
cd server
cp .env.example .env
# edit .env and add your API keys — see "Environment Variables" below
npm install
npm run dev
```

Server runs on **http://localhost:5001** (see `PORT` below).

### Client

```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Client runs on **http://localhost:5173**.

---

## Environment Variables

Both `.env.example` files use the same local-development defaults shown below — copy them to `.env` and fill in real API keys. **Never commit `.env`** (it's gitignored); `.env.example` should only ever contain placeholders.

### Server (`server/.env`)

| Variable | Required? | Purpose |
|---|---|---|
| `PORT` | No (defaults to `5001`) | Port the signaling server listens on |
| `CLIENT_URL` | Yes in production | Allowed CORS origin(s) for the frontend — comma-separated if serving more than one (e.g. staging + prod) |
| `DEEPGRAM_API_KEY` | For live transcription | From your [Deepgram](https://deepgram.com) dashboard. Without it, transcription is cleanly disabled — the rest of the app still works |
| `GEMINI_API_KEY` | For the AI interview assistant | From [Google AI Studio](https://aistudio.google.com). Without it, interview mode still runs but every AI call falls back to a minimal, clearly-labeled placeholder instead of a real question/evaluation |
| `GEMINI_MODEL` | No (defaults to `gemini-3.6-flash`) | Override only if you've confirmed a different model works for your key — Google periodically retires older Gemini model names |
| `METERED_API_KEY` | For TURN in production | From your [Metered.live](https://metered.ca) dashboard — the server fetches fresh, short-lived TURN credentials on demand. Without it, calls fall back to STUN-only, which cannot traverse all NAT types (see Known Limitations) |
| `METERED_DOMAIN` | No | Your Metered subdomain, if different from the default |
| `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` | No | Legacy static TURN fallback, only used if `METERED_API_KEY` is unset or the Metered API call fails |

### Client (`client/.env`)

| Variable | Required? | Purpose |
|---|---|---|
| `VITE_SERVER_URL` | Yes (defaults to `http://localhost:5001`) | Base URL of the signaling server |

---

## Running Locally

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
cd client && npm run dev
```

Open **http://localhost:5173** in two browser tabs/windows (or one normal + one incognito): create a meeting in one, join with its ID in the other. To try the AI interview mode, click "New Meeting", wait for the second participant to join, then fill out the setup modal that appears for the creator.

To build the client for production:

```bash
cd client
npm run build   # outputs static files to client/dist/
npm run preview # optional: serve the production build locally
```

---

## Production Deployment

PeerMeet has no infrastructure-as-code files (Dockerfile, platform config, etc.) checked in — deploy the server as any Node process and the client as any static file host, keeping these in mind:

- **HTTPS is required.** Browsers block `getUserMedia` (camera/mic) on plain HTTP for any origin other than `localhost`. Both the client and the server should be served over TLS in production.
- **Set `CLIENT_URL`** on the server to your real frontend origin(s) — CORS and the Socket.IO handshake both key off this. It accepts a comma-separated list if you run more than one frontend origin (e.g. a staging and a production domain).
- **Set `VITE_SERVER_URL`** on the client build to your real backend origin, and rebuild (`npm run build`) — Vite inlines env vars at build time, not runtime.
- **Provide real `GEMINI_API_KEY`, `DEEPGRAM_API_KEY`, and `METERED_API_KEY`** — the server logs a clear warning on startup (when `NODE_ENV=production`) listing exactly which of these are missing and which feature each one silently disables, so a misconfigured deploy is visible in the logs rather than silently broken.
- **Graceful shutdown**: the server handles `SIGTERM`/`SIGINT` — it stops accepting new connections, closes open Deepgram connections, and drains cleanly, which most PaaS platforms (Render, Railway, Fly, Docker) rely on during a redeploy.
- **Start command**: `npm start` (runs `node src/index.js`) for the server; the client is a static build served by whatever you host `client/dist/` with.

---

## Known Limitations

Being upfront about what this is (and isn't):

- **In-memory, single-instance state.** Rooms, interview state, and rate-limit counters live in the Node process's memory (`roomManager.js`) — there is no database. A server restart or redeploy ends every active meeting and interview. Running more than one server instance behind a load balancer will **not** work correctly today (two instances don't share room state) — this would need a shared store (e.g. Redis) added deliberately, which hasn't been done here.
- **Depends on three external services.** Gemini (AI), Deepgram (transcription), and Metered (TURN) are all optional individually — each degrades gracefully on its own (see the Environment Variables table) — but the full feature set requires all three to be configured and within their usage/rate limits.
- **TURN quota is finite.** Metered's free/low tiers have bandwidth and credential-issuance limits; under real NAT conditions (not same-network testing) a call without a working TURN allocation may fail to connect.
- **Lightweight abuse protection, not production-grade throttling.** The server rate-limits the handful of events that trigger a paid external call (AI question/evaluation, transcription start) per socket, generously scoped so a real interview is never affected — this is a basic safety net, not a substitute for real API-gateway-level rate limiting if this is exposed publicly at scale.
- **Practice tool, not a hiring system.** The AI's own prompts frame every report as mock-interview practice feedback, not a real hiring recommendation — treat it accordingly.
- **Exactly 2 participants per room**, by design — this isn't a multi-party conferencing tool.

---

## 🔐 Security Notes

- WebRTC DTLS-SRTP encrypts all media in transit; no media data touches the signaling server.
- TURN/Deepgram/Gemini credentials live only in server environment variables — never shipped to the client bundle.
- The AI panel is emitted **only** to the currently-active interviewer's socket, resolved server-side by role — the candidate's client is never a target of that data.
- Room IDs are randomly generated 12-character hex strings.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS v3 |
| Routing | React Router v6 |
| WebRTC | Simple Peer (wraps `RTCPeerConnection`) |
| Signaling | Socket.IO (client + server) |
| Backend | Node.js, Express |
| AI | Google Gemini (`@google/genai`) |
| Transcription | Deepgram (`@deepgram/sdk`) |
| TURN/STUN | Metered.live + Google public STUN |

---

## 📜 License

MIT
