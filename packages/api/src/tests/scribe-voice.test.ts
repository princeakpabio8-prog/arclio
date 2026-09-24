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
 *   - /api/voice/scribe-token — 502 when response missing token field
 *   - /api/voice/scribe-token — returns { token } on success
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
        "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
        },
      );
      if (!upstream.ok) {
        res.status(502).json({ error: `ElevenLabs returned ${upstream.status}` });
        return;
      }
      const data = await upstream.json() as { token?: string };
      if (!data.token) {
        res.status(502).json({ error: "Scribe token response missing token" });
        return;
      }
      // Return ONLY the raw token — the API key never leaves the server.
      // The @elevenlabs/client Scribe SDK resolves the WebSocket URL internally.
      res.json({ token: data.token });
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

test("scribe-token — 502 when response is missing token field", async () => {
  const mockFetch: MockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "{}",
    json: async () => ({}), // no token field
  });
  const handler = await makeScribeTokenHandler("sk-key", "voice-id", mockFetch);
  const res = makeRes();
  await handler({ body: {} }, res);
  assert.equal(res.statusCode, 502);
  const body = res.jsonBody as { error: string };
  assert.match(body.error, /missing token/);
});

test("scribe-token — returns { token } on success", async () => {
  const expectedToken = "sutkn_abc123def456";
  const mockFetch: MockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({ token: expectedToken }),
  });
  const handler = await makeScribeTokenHandler("sk-key", "voice-id", mockFetch);
  const res = makeRes();
  await handler({ body: {} }, res);
  assert.equal(res.statusCode, 200);
  const body = res.jsonBody as { token: string };
  // Returns the raw token — the SDK resolves the WebSocket URL internally
  assert.equal(body.token, expectedToken);
  // Does NOT contain a signedUrl field (that was the old incorrect approach)
  assert.equal("signedUrl" in (body as Record<string, unknown>), false,
    "response must not contain signedUrl — SDK uses raw token");
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
      json: async () => ({ token: "sutkn_safe-token-only" }),
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
  assert.equal(simulateIsMobile(ua, 10), false, "touchscreen laptop must not be classified as mobile");
});

// ---------------------------------------------------------------------------
// Scribe session lifecycle — pure logic tests
// (These test the session-ID guard and transcript delivery logic which is
// independent of the SDK; the SDK itself is tested by ElevenLabs.)
// ---------------------------------------------------------------------------

interface ScribeSessionState {
  transcriptDelivered: string | null;
  silenceCalled: boolean;
  error: string | null;
  sessionClosed: boolean;
}

/**
 * Simulate the committed-transcript delivery logic in useScribeSession.
 * This mirrors the onCommittedTranscript callback body.
 */
function simulateCommittedTranscript(
  text: string,
  sessionId: number,
  currentSession: { value: number },
  state: ScribeSessionState,
  onTranscript: (t: string) => void,
  onSilence: () => void,
  disconnect: () => void,
): void {
  if (currentSession.value !== sessionId) return;
  const transcript = text.trim();
  disconnect();
  state.sessionClosed = true;
  if (transcript) {
    onTranscript(transcript);
  } else {
    onSilence();
  }
}

/** Simulate the onError callback body. */
function simulateScribeError(
  sessionId: number,
  currentSession: { value: number },
  state: ScribeSessionState,
  setError: (e: string) => void,
): void {
  if (currentSession.value !== sessionId) return;
  state.sessionClosed = true;
  setError("Voice input isn't available right now. Tap the mic to try again.");
}

test("Scribe: committed transcript → onTranscript called, session closed", () => {
  const state: ScribeSessionState = { transcriptDelivered: null, silenceCalled: false, error: null, sessionClosed: false };
  const currentSession = { value: 1 };

  simulateCommittedTranscript(
    "Handle the Acme delivery",
    1,
    currentSession,
    state,
    (t) => { state.transcriptDelivered = t; },
    () => { state.silenceCalled = true; },
    () => { /* disconnect */ },
  );

  assert.equal(state.transcriptDelivered, "Handle the Acme delivery");
  assert.equal(state.silenceCalled, false);
  assert.equal(state.sessionClosed, true);
  assert.equal(state.error, null);
});

test("Scribe: empty committed transcript → onSilence called, not onTranscript", () => {
  const state: ScribeSessionState = { transcriptDelivered: null, silenceCalled: false, error: null, sessionClosed: false };
  const currentSession = { value: 1 };

  simulateCommittedTranscript(
    "   ",
    1,
    currentSession,
    state,
    (t) => { state.transcriptDelivered = t; },
    () => { state.silenceCalled = true; },
    () => { /* disconnect */ },
  );

  assert.equal(state.transcriptDelivered, null);
  assert.equal(state.silenceCalled, true);
  assert.equal(state.sessionClosed, true);
});

test("Scribe: error → session closed, error surfaced", () => {
  const state: ScribeSessionState = { transcriptDelivered: null, silenceCalled: false, error: null, sessionClosed: false };
  const currentSession = { value: 1 };

  simulateScribeError(
    1,
    currentSession,
    state,
    (e) => { state.error = e; },
  );

  assert.equal(state.sessionClosed, true);
  assert.ok(state.error !== null, "error should be set");
});

test("Scribe: stale session transcript → ignored (no overlapping session delivery)", () => {
  const state: ScribeSessionState = { transcriptDelivered: null, silenceCalled: false, error: null, sessionClosed: false };
  // Session was 1 but we're now on session 2 — simulate second tap starting
  const currentSession = { value: 2 };

  simulateCommittedTranscript(
    "stale text",
    1, // this message belongs to old session 1
    currentSession,
    state,
    (t) => { state.transcriptDelivered = t; },
    () => { state.silenceCalled = true; },
    () => { state.sessionClosed = true; },
  );

  assert.equal(state.transcriptDelivered, null, "stale session message must be ignored");
  assert.equal(state.sessionClosed, false);
});

test("Scribe: cleanup after committed transcript — second delivery is a no-op", () => {
  const deliveries: string[] = [];
  const closeCalls: number[] = [];
  const currentSession = { value: 1 };

  function deliver(text: string) {
    simulateCommittedTranscript(
      text,
      1,
      currentSession,
      { transcriptDelivered: null, silenceCalled: false, error: null, sessionClosed: false },
      (t) => { deliveries.push(t); },
      () => { /* silence */ },
      () => {
        closeCalls.push(1);
        // After disconnect the session counter is incremented — simulate that
        currentSession.value = 99;
      },
    );
  }

  deliver("first command");
  deliver("second command");

  assert.equal(deliveries.length, 1, "only one delivery should occur");
  assert.equal(deliveries[0], "first command");
  assert.equal(closeCalls.length, 1, "disconnect should only happen once");
});

// ---------------------------------------------------------------------------
// Routing decision — desktop uses SpeechRecognition
// ---------------------------------------------------------------------------

test("routing — desktop UA routes to SR (not Scribe)", () => {
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
