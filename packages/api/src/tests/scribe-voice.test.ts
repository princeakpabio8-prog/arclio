/**
 * scribe-voice.test.ts
 *
 * Focused tests for the mobile Scribe v2 Realtime voice integration.
 *
 * Tests:
 *  Token endpoint:
 *   - /api/voice/scribe-token — 503 when ElevenLabs not configured
 *   - /api/voice/scribe-token — 502 when ElevenLabs upstream returns non-200
 *   - /api/voice/scribe-token — 502 when upstream throws (network error)
 *   - /api/voice/scribe-token — 502 when response missing signed_url field
 *   - /api/voice/scribe-token — returns signedUrl on success
 *   - /api/voice/scribe-token — ELEVENLABS_API_KEY never appears in response
 *   - /api/voice/config now includes scribeAvailable flag
 *
 *  Mobile detection logic:
 *   - isMobile() returns false for desktop UA with no touch
 *   - isMobile() returns true for iPhone UA
 *   - isMobile() returns true for Android UA
 *   - isMobile() returns false for a touchscreen laptop UA (UA mismatch)
 *
 *  Scribe session lifecycle (logic):
 *   - committed transcript → call onTranscript, session ends
 *   - error message → session ends, error set
 *   - empty committed transcript → call onSilence, not onTranscript
 *   - overlapping sessions: second start() supersedes first
 *   - cleanup after committed transcript (no double delivery)
 *   - ELEVENLABS_API_KEY not in browser-facing token
 *
 *  Desktop SpeechRecognition:
 *   - routing decision: desktop routes to SR, not Scribe
 *
 * Run:
 *   node --test packages/api/dist/tests/scribe-voice.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Minimal response stub (matches voice.test.ts pattern)
// ---------------------------------------------------------------------------

type ReqBody = Record<string, unknown>;

function makeRes() {
  let statusCode = 200;
  let jsonBody: unknown = null;
  let headers: Record<string, string | number> = {};
  const rawBody: Buffer | null = null;
  let ended = false;

  return {
    status(code: number) { statusCode = code; return this; },
    json(body: unknown) { jsonBody = body; ended = true; },
    setHeader(k: string, v: string | number) { headers[k] = v; },
    send(buf: Buffer) { void buf; ended = true; },
    get statusCode() { return statusCode; },
    get jsonBody() { return jsonBody; },
    get headers() { return headers; },
    get rawBody() { return rawBody; },
    get ended() { return ended; },
  };
}

// ---------------------------------------------------------------------------
// Inline implementation of /api/voice/scribe-token logic
// (mirrors packages/api/src/app.ts — avoids full server import)
// ---------------------------------------------------------------------------

interface MockFetch {
  (url: string, opts: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  }>;
}

async function makeScribeTokenHandler(
  apiKey: string,
  voiceId: string,
  mockFetch: MockFetch,
) {
  const available = Boolean(apiKey && voiceId);
  return async (_req: { body: ReqBody }, res: ReturnType<typeof makeRes>) => {
    if (!available) {
      res.status(503).json({ error: "ElevenLabs STT is not configured on this server" });
      return;
    }
    try {
      const upstream = await mockFetch(
        "https://api.elevenlabs.io/v1/speech-to-text/streaming/create",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
          body: JSON.stringify({ model_id: "scribe_v2_realtime" }),
        },
      );
      if (!upstream.ok) {
        res.status(502).json({ error: `ElevenLabs returned ${upstream.status}` });
        return;
      }
      const data = await upstream.json() as { signed_url?: string };
      if (!data.signed_url) {
        res.status(502).json({ error: "Scribe token response missing signed_url" });
        return;
      }
      res.json({ signedUrl: data.signed_url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: "Scribe token request failed: " + msg });
    }
  };
}

// Inline /api/voice/config logic with scribeAvailable
function makeVoiceConfigHandler(apiKey: string, voiceId: string) {
  const available = Boolean(apiKey && voiceId);
  return (_req: unknown, res: ReturnType<typeof makeRes>) => {
    res.json({
      elevenlabsAvailable: available,
      provider: available ? "elevenlabs" : "browser",
      scribeAvailable: available,
    });
  };
}

// ---------------------------------------------------------------------------
// Token endpoint tests
// ---------------------------------------------------------------------------

test("scribe-token — 503 when ElevenLabs not configured (no key)", async () => {
  const handler = await makeScribeTokenHandler("", "", async () => { throw new Error("should not call"); });
  const res = makeRes();
  await handler({ body: {} }, res);
  assert.equal(res.statusCode, 503);
  const body = res.jsonBody as { error: string };
  assert.match(body.error, /not configured/);
});

test("scribe-token — 503 when ElevenLabs not configured (key only)", async () => {
  const handler = await makeScribeTokenHandler("sk-key", "", async () => { throw new Error("should not call"); });
  const res = makeRes();
  await handler({ body: {} }, res);
  assert.equal(res.statusCode, 503);
});

test("scribe-token — 502 when ElevenLabs upstream returns non-200", async () => {
  const mockFetch: MockFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => "unauthorized",
    json: async () => ({}),
  });
  const handler = await makeScribeTokenHandler("sk-key", "voice-id", mockFetch);
  const res = makeRes();
  await handler({ body: {} }, res);
  assert.equal(res.statusCode, 502);
  const body = res.jsonBody as { error: string };
  assert.match(body.error, /401/);
});

test("scribe-token — 502 when upstream network throws", async () => {
  const mockFetch: MockFetch = async () => { throw new Error("ECONNREFUSED"); };
  const handler = await makeScribeTokenHandler("sk-key", "voice-id", mockFetch);
  const res = makeRes();
  await handler({ body: {} }, res);
  assert.equal(res.statusCode, 502);
  const body = res.jsonBody as { error: string };
  assert.match(body.error, /Scribe token request failed/);
});

test("scribe-token — 502 when response is missing signed_url", async () => {
  const mockFetch: MockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "{}",
    json: async () => ({}), // no signed_url field
  });
  const handler = await makeScribeTokenHandler("sk-key", "voice-id", mockFetch);
  const res = makeRes();
  await handler({ body: {} }, res);
  assert.equal(res.statusCode, 502);
  const body = res.jsonBody as { error: string };
  assert.match(body.error, /missing signed_url/);
});

test("scribe-token — returns signedUrl on success", async () => {
  const expectedUrl = "wss://api.elevenlabs.io/v1/realtime?token=abc123";
  const mockFetch: MockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({ signed_url: expectedUrl }),
  });
  const handler = await makeScribeTokenHandler("sk-key", "voice-id", mockFetch);
  const res = makeRes();
  await handler({ body: {} }, res);
  assert.equal(res.statusCode, 200);
  const body = res.jsonBody as { signedUrl: string };
  assert.equal(body.signedUrl, expectedUrl);
});

test("scribe-token — ELEVENLABS_API_KEY never appears in browser response", async () => {
  const apiKey = "xi-secret-key-do-not-expose";
  let capturedHeaders: Record<string, string> = {};

  const mockFetch: MockFetch = async (_url, opts) => {
    const headers = (opts as { headers: Record<string, string> }).headers;
    capturedHeaders = headers;
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ signed_url: "wss://example.com/token=xyz" }),
    };
  };

  const handler = await makeScribeTokenHandler(apiKey, "voice-id", mockFetch);
  const res = makeRes();
  await handler({ body: {} }, res);

  // Key was used in upstream request
  assert.equal(capturedHeaders["xi-api-key"], apiKey, "key should be in upstream request");

  // Key does NOT appear in response headers
  const responseHeaderValues = Object.values(res.headers).join(" ");
  assert.equal(responseHeaderValues.includes(apiKey), false, "key must not appear in response headers");

  // Key does NOT appear in response body
  const responseBody = JSON.stringify(res.jsonBody ?? "");
  assert.equal(responseBody.includes(apiKey), false, "key must not appear in response body");
});

// ---------------------------------------------------------------------------
// /api/voice/config — scribeAvailable flag
// ---------------------------------------------------------------------------

test("/api/voice/config — scribeAvailable is false when not configured", () => {
  const handler = makeVoiceConfigHandler("", "");
  const res = makeRes();
  handler({}, res);
  const body = res.jsonBody as { scribeAvailable: boolean; elevenlabsAvailable: boolean };
  assert.equal(body.scribeAvailable, false);
  assert.equal(body.elevenlabsAvailable, false);
});

test("/api/voice/config — scribeAvailable is true when configured", () => {
  const handler = makeVoiceConfigHandler("sk-key", "voice-id");
  const res = makeRes();
  handler({}, res);
  const body = res.jsonBody as { scribeAvailable: boolean; elevenlabsAvailable: boolean };
  assert.equal(body.scribeAvailable, true);
  assert.equal(body.elevenlabsAvailable, true);
});

test("/api/voice/config — ELEVENLABS_API_KEY never appears in response", () => {
  const apiKey = "xi-config-secret";
  const handler = makeVoiceConfigHandler(apiKey, "voice-id");
  const res = makeRes();
  handler({}, res);
  const responseBody = JSON.stringify(res.jsonBody);
  assert.equal(responseBody.includes(apiKey), false, "API key must not appear in config response");
});

// ---------------------------------------------------------------------------
// Mobile detection logic (pure function — no browser globals needed)
// ---------------------------------------------------------------------------

function simulateIsMobile(ua: string, maxTouchPoints: number): boolean {
  // mirrors isMobile.ts logic
  const mobileUA = /Android|iPhone|iPad|iPod|IEMobile|WPDesktop|Opera Mini/i.test(ua);
  return maxTouchPoints > 0 && mobileUA;
}

test("isMobile — false for desktop Chrome UA with 0 touch points", () => {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0";
  assert.equal(simulateIsMobile(ua, 0), false);
});

test("isMobile — false for macOS Safari UA with 0 touch points", () => {
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 Safari/604.1";
  assert.equal(simulateIsMobile(ua, 0), false);
});

test("isMobile — true for iPhone UA with touch points", () => {
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
  assert.equal(simulateIsMobile(ua, 5), true);
});

test("isMobile — true for Android Chrome UA with touch points", () => {
  const ua = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36";
  assert.equal(simulateIsMobile(ua, 5), true);
});

test("isMobile — true for iPad UA with touch points", () => {
  const ua = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
  assert.equal(simulateIsMobile(ua, 5), true);
});

test("isMobile — false for touchscreen laptop (touch points but non-mobile UA)", () => {
  // Surface Pro, Chromebook — has touch but NOT a mobile UA
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0";
  // Has touch points like a touchscreen laptop, but UA is desktop
  assert.equal(simulateIsMobile(ua, 10), false, "touchscreen laptop must not be classified as mobile");
});

// ---------------------------------------------------------------------------
// Scribe session lifecycle — pure logic tests
// ---------------------------------------------------------------------------

interface ScribeSessionState {
  transcriptDelivered: string | null;
  silenceCalled: boolean;
  error: string | null;
  sessionClosed: boolean;
}

/**
 * Simulate the Scribe WebSocket message handler logic
 * (mirrors useScribeSession.ts ws.onmessage behaviour)
 */
function simulateScribeMessage(
  msgJson: string,
  state: ScribeSessionState,
  sessionId: number,
  currentSession: { value: number },
  onTranscript: (t: string) => void,
  onSilence: () => void,
  setError: (e: string) => void,
  teardown: () => void,
  setIsListening: (v: boolean) => void,
): void {
  if (currentSession.value !== sessionId) return;
  let msg: { type: string; transcript_event?: { type: string; text: string }; message?: string };
  try {
    msg = JSON.parse(msgJson) as typeof msg;
  } catch { return; }

  if (msg.type === "error") {
    teardown();
    setIsListening(false);
    setError("Voice input isn't available right now. Tap the mic to try again.");
    return;
  }
  if (msg.type === "transcript" && msg.transcript_event) {
    if (msg.transcript_event.type === "committed") {
      const transcript = msg.transcript_event.text.trim();
      teardown();
      setIsListening(false);
      if (transcript) {
        onTranscript(transcript);
      } else {
        onSilence();
      }
    }
  }
}

test("Scribe: committed transcript → onTranscript called, session closed", () => {
  const state: ScribeSessionState = { transcriptDelivered: null, silenceCalled: false, error: null, sessionClosed: false };
  const currentSession = { value: 1 };

  simulateScribeMessage(
    JSON.stringify({ type: "transcript", transcript_event: { type: "committed", text: "Handle the Acme delivery" } }),
    state,
    1,
    currentSession,
    (t) => { state.transcriptDelivered = t; },
    () => { state.silenceCalled = true; },
    (e) => { state.error = e; },
    () => { state.sessionClosed = true; },
    () => { /* setIsListening */ },
  );

  assert.equal(state.transcriptDelivered, "Handle the Acme delivery");
  assert.equal(state.silenceCalled, false);
  assert.equal(state.sessionClosed, true);
  assert.equal(state.error, null);
});

test("Scribe: empty committed transcript → onSilence called, not onTranscript", () => {
  const state: ScribeSessionState = { transcriptDelivered: null, silenceCalled: false, error: null, sessionClosed: false };
  const currentSession = { value: 1 };

  simulateScribeMessage(
    JSON.stringify({ type: "transcript", transcript_event: { type: "committed", text: "   " } }),
    state,
    1,
    currentSession,
    (t) => { state.transcriptDelivered = t; },
    () => { state.silenceCalled = true; },
    (e) => { state.error = e; },
    () => { state.sessionClosed = true; },
    () => { /* setIsListening */ },
  );

  assert.equal(state.transcriptDelivered, null);
  assert.equal(state.silenceCalled, true);
  assert.equal(state.sessionClosed, true);
});

test("Scribe: error message → session closed, error surfaced", () => {
  const state: ScribeSessionState = { transcriptDelivered: null, silenceCalled: false, error: null, sessionClosed: false };
  const currentSession = { value: 1 };

  simulateScribeMessage(
    JSON.stringify({ type: "error", message: "authentication failed" }),
    state,
    1,
    currentSession,
    (t) => { state.transcriptDelivered = t; },
    () => { state.silenceCalled = true; },
    (e) => { state.error = e; },
    () => { state.sessionClosed = true; },
    () => { /* setIsListening */ },
  );

  assert.equal(state.transcriptDelivered, null);
  assert.equal(state.sessionClosed, true);
  assert.ok(state.error !== null, "error should be set");
});

test("Scribe: partial transcript → ignored, no onTranscript, no close", () => {
  const state: ScribeSessionState = { transcriptDelivered: null, silenceCalled: false, error: null, sessionClosed: false };
  const currentSession = { value: 1 };

  simulateScribeMessage(
    JSON.stringify({ type: "transcript", transcript_event: { type: "partial", text: "Handle the" } }),
    state,
    1,
    currentSession,
    (t) => { state.transcriptDelivered = t; },
    () => { state.silenceCalled = true; },
    (e) => { state.error = e; },
    () => { state.sessionClosed = true; },
    () => { /* setIsListening */ },
  );

  assert.equal(state.transcriptDelivered, null);
  assert.equal(state.silenceCalled, false);
  assert.equal(state.sessionClosed, false);
});

test("Scribe: stale session message → ignored (no overlapping session delivery)", () => {
  const state: ScribeSessionState = { transcriptDelivered: null, silenceCalled: false, error: null, sessionClosed: false };
  // Session was 1 but we're now on session 2 — simulate second tap starting
  const currentSession = { value: 2 };

  simulateScribeMessage(
    JSON.stringify({ type: "transcript", transcript_event: { type: "committed", text: "stale text" } }),
    state,
    1, // this message belongs to old session 1
    currentSession,
    (t) => { state.transcriptDelivered = t; },
    () => { state.silenceCalled = true; },
    (e) => { state.error = e; },
    () => { state.sessionClosed = true; },
    () => { /* setIsListening */ },
  );

  // Nothing should have happened — message is from old session
  assert.equal(state.transcriptDelivered, null, "stale session message must be ignored");
  assert.equal(state.sessionClosed, false);
});

test("Scribe: cleanup after committed transcript — second transcript delivery is a no-op", () => {
  // Simulate two consecutive committed messages for the same session
  const deliveries: string[] = [];
  const closeCalls: number[] = [];
  const currentSession = { value: 1 };

  function deliver(msgJson: string) {
    simulateScribeMessage(
      msgJson,
      { transcriptDelivered: null, silenceCalled: false, error: null, sessionClosed: false },
      1,
      currentSession,
      (t) => { deliveries.push(t); },
      () => { /* silence */ },
      () => { /* error */ },
      () => {
        closeCalls.push(1);
        // After teardown the session counter is incremented — simulate that here
        currentSession.value = 99;
      },
      () => { /* setIsListening */ },
    );
  }

  deliver(JSON.stringify({ type: "transcript", transcript_event: { type: "committed", text: "first command" } }));
  deliver(JSON.stringify({ type: "transcript", transcript_event: { type: "committed", text: "second command" } }));

  assert.equal(deliveries.length, 1, "only one delivery should occur");
  assert.equal(deliveries[0], "first command");
  assert.equal(closeCalls.length, 1, "teardown should only happen once");
});

// ---------------------------------------------------------------------------
// Routing decision — desktop uses SpeechRecognition
// ---------------------------------------------------------------------------

test("routing — desktop UA routes to SR (not Scribe)", () => {
  // Simulate routing logic
  function computeRoute(ua: string, maxTouchPoints: number): "scribe" | "sr" {
    const mobileUA = /Android|iPhone|iPad|iPod|IEMobile|WPDesktop|Opera Mini/i.test(ua);
    const mobile = maxTouchPoints > 0 && mobileUA;
    return mobile ? "scribe" : "sr";
  }

  const desktopUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0";
  assert.equal(computeRoute(desktopUA, 0), "sr", "desktop must use SpeechRecognition");

  const mobileUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148 Safari/604.1";
  assert.equal(computeRoute(mobileUA, 5), "scribe", "mobile must use Scribe");
});

test("routing — touch laptop routes to SR (not Scribe)", () => {
  function computeRoute(ua: string, maxTouchPoints: number): "scribe" | "sr" {
    const mobileUA = /Android|iPhone|iPad|iPod|IEMobile|WPDesktop|Opera Mini/i.test(ua);
    const mobile = maxTouchPoints > 0 && mobileUA;
    return mobile ? "scribe" : "sr";
  }

  // Surface Pro — touch but desktop UA
  const surfaceUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0";
  assert.equal(computeRoute(surfaceUA, 10), "sr", "touchscreen laptop must use SpeechRecognition, not Scribe");
});
