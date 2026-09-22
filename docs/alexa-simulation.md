# Alexa+ Simulation — Arclio

## Purpose

This document describes the Alexa+ Simulation experience built for the **Amazon Developer Hackathon** as part of the Arclio project.

The simulator demonstrates how Arclio can be used conversationally through an Alexa+-style interface. It is **not** official Alexa+ integration — it is a polished simulation of the conversational pattern that Arclio enables, running entirely on the existing Arclio agent pipeline.

---

## What It Is

A dedicated simulator page inside the Arclio web application (`/simulator` route, accessible from the sidebar under **Alexa+ Simulator**) that:

- Presents a premium, minimal voice-assistant experience consistent with the Arclio visual language
- Accepts voice input via the browser's Web Speech API (where available) or text input
- Sends queries to the existing Arclio agent pipeline (`POST /api/agent`)
- Visualises the orchestration stages (Understanding → Planning → Checking → Executing → Verifying → Done)
- Displays contextual tool/action cards showing which Arclio systems were involved
- Reads responses aloud via the browser's Speech Synthesis API (where available)
- Degrades gracefully to pure text interaction when browser speech APIs are unavailable

---

## Architecture

```
User (voice or text)
       ↓
Alexa+ Simulator UI (React — packages/web)
       ↓
Existing Arclio API  POST /api/agent  (packages/api, port 3002)
       ↓
Arclio Agent Pipeline  (packages/agent)
  Reason  →  Plan  →  Execute  →  Verify
       ↓
Amazon Bedrock / Claude  (or StubProvider for offline dev)
       ↓
Arclio MCP Tools  (packages/mcp-server, port 3001)
  get_today_calendar
  get_pending_deliveries
  get_security_events
  mark_delivery_received
  notify_procurement
       ↓
Verified, composed conversational response
       ↓
Simulator UI renders response + tool cards + TTS
```

The simulator adds **no new backend code**. It is purely a frontend integration layer that calls the same `/api/agent` endpoint used by the main Command Center.

---

## User Flow

### Entering the simulator

1. Open Arclio at `http://localhost:5173`
2. Click **Alexa+ Simulator** in the sidebar (under the "Hackathon" section)
3. The simulator page loads with a clear **"Alexa+ Simulation"** badge indicating this is a simulated experience

### Starting a conversation

**Option A — Voice (requires browser support)**
- Click the microphone button (gold circle) to begin listening
- Speak your query
- The button turns red while listening; tap again to stop early
- Processing and response happen automatically

**Option B — Text**
- Type a command into the text input field
- Press Enter or click the send button

**Option C — Demo mode (click-to-run)**
- Click any of the suggested prompts below the input
- The complete Arclio orchestration flow runs immediately
- Ideal for hackathon demonstrations — no voice recognition dependency

### During a request

The Arclio response bubble shows a live activity indicator stepping through:

```
Understanding your request
Planning actions
Checking connected systems
Executing
Verifying
Done
```

### After a response

- The full conversational answer is displayed
- Contextual tool cards show which systems were involved (Procurement, Calendar, Security, Notifications)
- For action-type queries (e.g. marking a delivery received), a green **"Action confirmed and verified"** banner appears
- A verification badge (✓ Verified / ⚠ Partial / ✗ Failed) reflects the agent's verification outcome
- The tool steps used by the agent are listed as compact chips
- If TTS is available, the response is spoken aloud

---

## Target Demo Flows

### Flow 1 — Office Briefing

**Query:** "What's happening at the office today?"

**Arclio tools invoked:**
- `get_today_calendar` — retrieves today's meetings
- `get_pending_deliveries` — checks active deliveries
- `get_security_events` — reviews security log

**Result:** A single composed briefing covering all three operational domains, with Calendar, Procurement, and Security tool cards.

---

### Flow 2 — Delivery Status Check

**Query:** "Is the Acme delivery here yet?"

**Arclio tools invoked:**
- `get_pending_deliveries` (vendor: Acme) — checks delivery status
- `get_security_events` (type: delivery_arrival) — cross-references security log

**Result:** A correlated answer confirming whether the delivery has arrived, with Procurement and Security cards.

---

### Flow 3 — Mark Delivery Received

**Query:** "Mark the Acme delivery as received and notify procurement."

**Arclio tools invoked:**
1. `get_pending_deliveries` — resolves the delivery ID
2. `mark_delivery_received` — updates delivery status with timestamp
3. `notify_procurement` — sends internal procurement notification

**Result:** Confirmation that the delivery was marked received and procurement was notified. The "Action confirmed and verified" banner appears. Procurement and Notification tool cards are shown.

---

## Relationship Between Simulator and Arclio Agent

The simulator is a **presentation layer** only. Every query flows through the full production Arclio pipeline:

| Component | Role |
|---|---|
| Simulator UI | Conversational interface — voice input, response display, TTS |
| `/api/agent` | Existing HTTP bridge — unchanged |
| Arclio Agent | Reason → Plan → Execute → Verify — unchanged |
| Bedrock / Claude | LLM provider — unchanged |
| MCP tools | Tool execution — unchanged |

The simulator does not bypass, mock, or short-circuit any part of the Arclio stack. When the MCP server and API server are running, all three demo flows execute real operations against the live data.

---

## How This Maps to the Alexa+ Track

The hackathon track requires demonstrating how Arclio integrates with Alexa+. This simulator achieves that by:

1. **Matching the conversational pattern** — user speaks a natural-language command, Arclio reasons and acts, the result is spoken back. This is exactly the flow that would occur with a real Alexa+ integration.

2. **Using the same MCP layer** — Arclio's MCP server is the actual integration point for Alexa+. The simulator drives it via the existing agent, demonstrating the same tool execution and verification that Alexa+ would trigger as an MCP client.

3. **Showing the orchestration visually** — the activity indicator makes the Arclio agent pipeline legible to an audience, which is a key differentiator over a plain chatbot.

4. **Honest labelling** — the simulator clearly displays an "Alexa+ Simulation" badge and the "About this simulation" section explains the architecture.

---

## Connecting to Real Alexa+ (When Amazon Access is Granted)

When Amazon grants Alexa+ MCP client access, connecting to the real runtime requires only:

1. **Register the MCP server** with Alexa+ as an MCP endpoint (`http://<host>:3001/mcp`)
2. **Define tool descriptions** that match the existing MCP tool names — `get_pending_deliveries`, `mark_delivery_received`, `notify_procurement`, `get_today_calendar`, `get_security_events`
3. **Handle Alexa+ MCP client sessions** — the existing Streamable HTTP transport already supports multi-session MCP protocol (initialize → tools/call → delete)

No changes to the agent, MCP server, or tool implementations are required. The same tools the simulator exercises today are the tools Alexa+ would call directly.

```
Real Alexa+ path (future):
User (voice) → Alexa+ → Arclio MCP server → tools → authorized actions
                              ↑
                   (same server as today, port 3001)
```

---

## Voice Support

| Feature | Support |
|---|---|
| Speech-to-text input | Chrome, Edge (SpeechRecognition API); Firefox: no; Safari: partial |
| Browser TTS | All modern browsers (SpeechSynthesis API) — zero-cost default |
| ElevenLabs TTS | Optional — requires `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` |
| Text input fallback | Always available — no browser or server requirements |

The simulator always shows a status indicator in the header:
- **"Voice ready"** — `SpeechRecognition` available
- **"Browser TTS"** — using browser SpeechSynthesis
- **"ElevenLabs voice"** — using ElevenLabs TTS proxy
- **"Text mode"** — voice input not available; text input works normally

---

## Optional ElevenLabs Voice Layer

Arclio's Alexa+ Simulator supports ElevenLabs as an optional high-quality TTS provider. The API key never leaves the server.

### Why it is optional

Browser `SpeechSynthesis` is free, available in all modern browsers, and requires no configuration. It is the default and will always work for the demo.

ElevenLabs provides more natural, conversational speech quality but requires an account and API key. Adding it should not be a prerequisite for running the demo.

### Architecture

```
Browser → POST /api/voice/tts → packages/api (Express)
                                      │
                                      ├─ ELEVENLABS_API_KEY (env, server-side only)
                                      ↓
                              api.elevenlabs.io/v1/text-to-speech/:voice_id
                                      │
                              ← audio/mpeg bytes ←
                                      │
                              res.send(audioBuffer) → browser Audio()
```

The browser never sees the API key. The key is read from environment variables at API server startup and used only in the outbound fetch to ElevenLabs.

### Fallback behaviour

If ElevenLabs is not configured, the `/api/voice/config` endpoint returns `{ elevenlabsAvailable: false }`. The simulator shows only "Browser" voice (no toggle). If ElevenLabs is configured but a request fails (network error, quota exceeded, bad status), `ElevenLabsVoiceProvider` catches the error silently and falls back to `BrowserVoiceProvider` so the demo continues without interruption.

### Enabling ElevenLabs locally

```bash
# 1. Copy the example env file
cp .env.example .env

# 2. Fill in your credentials (never commit this file)
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_VOICE_ID=<voice ID from ElevenLabs dashboard>
ELEVENLABS_MODEL_ID=eleven_flash_v2_5   # low-latency conversational model

# 3. Start the stack
npm run dev

# 4. Open the simulator
# → A "Voice" toggle (Browser / ElevenLabs) will appear above the prompts
```

### Provider independence

Arclio does not depend on ElevenLabs. The voice provider abstraction (`VoiceProvider` interface in `packages/web/src/voice-provider.ts`) means any TTS service can be swapped in by implementing two methods: `speakText(text, onEnd)` and `stopSpeaking()`. The simulator component does not know or care which provider is active.

---

## Files

| File | Description |
|---|---|
| `packages/web/src/components/AlexaSimulator.tsx` | Simulator page component (updated with voice provider) |
| `packages/web/src/voice-provider.ts` | Voice provider abstraction + BrowserVoiceProvider + ElevenLabsVoiceProvider |
| `packages/web/src/index.css` | Alexa simulator styles (`.alexa-*` namespace) |
| `packages/web/src/App.tsx` | Route added: `page === "alexa"` |
| `packages/web/src/components/Sidebar.tsx` | Nav item added: "Alexa+ Simulator" |
| `packages/api/src/index.ts` | Voice endpoints: `GET /api/voice/config`, `POST /api/voice/tts` |
| `packages/api/src/tests/voice.test.ts` | Voice layer unit tests (12 tests) |
| `.env.example` | Environment variable reference (no secrets) |
| `docs/alexa-simulation.md` | This document |

No files were modified in `packages/agent` or `packages/mcp-server`.

---

## Running the Simulator

```bash
# Start the full stack
npm run dev

# Then open:
http://localhost:5173
# → Click "Alexa+ Simulator" in the sidebar
```

Or navigate directly and click the sidebar item — the simulator is available as long as the web dev server is running, even if the API/MCP servers are offline (the simulator will display a graceful connectivity error message in that case).
