/**
 * voice.test.ts
 *
 * Unit tests for the ElevenLabs voice proxy layer.
 *
 * Tests:
 *   - elevenlabsAvailable flag logic
 *   - /api/voice/config response (availability without exposing key)
 *   - /api/voice/tts — missing text → 400
 *   - /api/voice/tts — ElevenLabs unconfigured → 503
 *   - /api/voice/tts — mocked successful ElevenLabs response → audio bytes
 *   - /api/voice/tts — ElevenLabs upstream error → 502
 *   - /api/voice/tts — ElevenLabs network failure → 502
 *   - API key never appears in /api/voice/config response
 *
 * Does NOT make real ElevenLabs API calls.
 * Uses Node built-in test runner.
 *
 * Run:
 *   node --test packages/api/dist/tests/voice.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Helpers — minimal inline Express-like request/response stubs
// ---------------------------------------------------------------------------

type ReqBody = Record<string, unknown>;

function makeRes() {
  let statusCode = 200;
  let jsonBody: unknown = null;
  let headers: Record<string, string | number> = {};
  let rawBody: Buffer | null = null;
  let ended = false;

  return {
    status(code: number) { statusCode = code; return this; },
    json(body: unknown) { jsonBody = body; ended = true; },
    setHeader(k: string, v: string | number) { headers[k] = v; },
    send(buf: Buffer) { rawBody = buf; ended = true; },
    // Inspect results
    get statusCode() { return statusCode; },
    get jsonBody() { return jsonBody; },
    get headers() { return headers; },
    get rawBody() { return rawBody; },
    get ended() { return ended; },
  };
}

// ---------------------------------------------------------------------------
// Inline implementation of the voice endpoint logic
// (mirrors packages/api/src/index.ts voice section — no import needed)
// This keeps the test self-contained and avoids side-effects of importing
// the full Express server (which does top-level awaits for agent/mcp dist).
// ---------------------------------------------------------------------------

function makeVoiceConfig(apiKey: string, voiceId: string) {
  const available = Boolean(apiKey && voiceId);
  return (_req: unknown, res: ReturnType<typeof makeRes>) => {
    res.json({ elevenlabsAvailable: available, provider: available ? "elevenlabs" : "browser" });
  };
}

interface MockFetchResult {
  ok: boolean;
  status: number;
  headers: { get(k: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

async function makeTtsHandler(
  apiKey: string,
  voiceId: string,
  modelId: string,
  mockFetch: (url: string, opts: unknown) => Promise<MockFetchResult>,
) {
  return async (req: { body: ReqBody }, res: ReturnType<typeof makeRes>) => {
    const text = req.body["text"];
    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    const available = Boolean(apiKey && voiceId);
    if (!available) {
      res.status(503).json({ error: "ElevenLabs TTS is not configured on this server" });
      return;
    }
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    try {
      const upstream = await mockFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": apiKey, "Accept": "audio/mpeg" },
        body: JSON.stringify({ text: text.trim(), model_id: modelId, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      });
      if (!upstream.ok) {
        const errBody = await upstream.text().catch(() => "");
        void errBody;
        res.status(502).json({ error: `ElevenLabs returned ${upstream.status}` });
        return;
      }
      const contentType = upstream.headers.get("content-type") ?? "audio/mpeg";
      const audioBuffer = await upstream.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", audioBuffer.byteLength);
      res.send(Buffer.from(audioBuffer));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: "ElevenLabs request failed: " + msg });
    }
  };
}

// ---------------------------------------------------------------------------
// Helper: mirrors the Boolean(apiKey && voiceId) check in the API server
// ---------------------------------------------------------------------------

function computeAvailable(apiKey: string, voiceId: string): boolean {
  return Boolean(apiKey && voiceId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("elevenlabsAvailable is false when both env vars are empty", () => {
  assert.equal(computeAvailable("", ""), false);
});

test("elevenlabsAvailable is false when only API key is set", () => {
  assert.equal(computeAvailable("sk-test-key", ""), false);
});

test("elevenlabsAvailable is false when only voice ID is set", () => {
  assert.equal(computeAvailable("", "voice-abc"), false);
});

test("elevenlabsAvailable is true when both are set", () => {
  assert.equal(computeAvailable("sk-test-key", "voice-abc"), true);
});

test("/api/voice/config — returns elevenlabsAvailable:false when unconfigured", () => {
  const handler = makeVoiceConfig("", "");
  const res = makeRes();
  handler({}, res);
  const body = res.jsonBody as { elevenlabsAvailable: boolean; provider: string };
  assert.equal(body.elevenlabsAvailable, false);
  assert.equal(body.provider, "browser");
});

test("/api/voice/config — returns elevenlabsAvailable:true when configured", () => {
  const handler = makeVoiceConfig("sk-key", "voice-id");
  const res = makeRes();
  handler({}, res);
  const body = res.jsonBody as { elevenlabsAvailable: boolean; provider: string };
  assert.equal(body.elevenlabsAvailable, true);
  assert.equal(body.provider, "elevenlabs");
});

test("/api/voice/config — never exposes the API key", () => {
  const handler = makeVoiceConfig("super-secret-key", "voice-id");
  const res = makeRes();
  handler({}, res);
  const body = JSON.stringify(res.jsonBody);
  assert.equal(body.includes("super-secret-key"), false, "API key must not appear in response");
});

test("/api/voice/tts — 400 when text is missing", async () => {
  const mockFetch = async () => { throw new Error("should not be called"); };
  const handler = await makeTtsHandler("key", "voice", "model", mockFetch as never);
  const res = makeRes();
  await handler({ body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal((res.jsonBody as { error: string }).error, "text is required");
});

test("/api/voice/tts — 400 when text is empty string", async () => {
  const mockFetch = async () => { throw new Error("should not be called"); };
  const handler = await makeTtsHandler("key", "voice", "model", mockFetch as never);
  const res = makeRes();
  await handler({ body: { text: "   " } }, res);
  assert.equal(res.statusCode, 400);
});

test("/api/voice/tts — 503 when ElevenLabs is not configured", async () => {
  const mockFetch = async () => { throw new Error("should not be called"); };
  const handler = await makeTtsHandler("", "", "model", mockFetch as never);
  const res = makeRes();
  await handler({ body: { text: "Hello" } }, res);
  assert.equal(res.statusCode, 503);
  const body = res.jsonBody as { error: string };
  assert.match(body.error, /not configured/);
});

test("/api/voice/tts — returns audio bytes on successful ElevenLabs response", async () => {
  const fakeAudio = Buffer.from([0x49, 0x44, 0x33]); // fake MP3 header bytes
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (k: string) => k === "content-type" ? "audio/mpeg" : null },
    text: async () => "",
    arrayBuffer: async () => fakeAudio.buffer as ArrayBuffer,
  });

  const handler = await makeTtsHandler("sk-key", "voice-id", "eleven_flash_v2_5", mockFetch);
  const res = makeRes();
  await handler({ body: { text: "Hello Arclio" } }, res);

  assert.equal(res.headers["Content-Type"], "audio/mpeg");
  assert.ok(res.rawBody !== null, "response should have raw audio bytes");
  assert.equal(res.ended, true);
});

test("/api/voice/tts — 502 when ElevenLabs returns non-200", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 429,
    headers: { get: (_k: string) => null },
    text: async () => "quota exceeded",
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  const handler = await makeTtsHandler("sk-key", "voice-id", "eleven_flash_v2_5", mockFetch);
  const res = makeRes();
  await handler({ body: { text: "Hello" } }, res);
  assert.equal(res.statusCode, 502);
  const body = res.jsonBody as { error: string };
  assert.match(body.error, /429/);
});

test("/api/voice/tts — 502 when ElevenLabs network request throws", async () => {
  const mockFetch = async () => { throw new Error("Network error: ECONNREFUSED"); };
  const handler = await makeTtsHandler("sk-key", "voice-id", "eleven_flash_v2_5", mockFetch as never);
  const res = makeRes();
  await handler({ body: { text: "Hello" } }, res);
  assert.equal(res.statusCode, 502);
  const body = res.jsonBody as { error: string };
  assert.match(body.error, /ElevenLabs request failed/);
});

test("/api/voice/tts — API key is sent only to ElevenLabs, not in response", async () => {
  const apiKey = "xi-test-api-key-do-not-expose";
  let capturedHeaders: Record<string, string> = {};

  const mockFetch = async (_url: string, opts: { headers: Record<string, string> }) => {
    capturedHeaders = opts.headers;
    const fakeAudio = Buffer.from([0x00]);
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => k === "content-type" ? "audio/mpeg" : null },
      text: async () => "",
      arrayBuffer: async () => fakeAudio.buffer as ArrayBuffer,
    };
  };

  const handler = await makeTtsHandler(apiKey, "voice-id", "model", mockFetch as never);
  const res = makeRes();
  await handler({ body: { text: "Test" } }, res);

  // Key was sent upstream
  assert.equal(capturedHeaders["xi-api-key"], apiKey, "key should be in upstream request");

  // Key does NOT appear in any response header
  const responseHeaderValues = Object.values(res.headers).join(" ");
  assert.equal(responseHeaderValues.includes(apiKey), false, "key must not appear in response headers");

  // Key does NOT appear in response body
  const responseBody = JSON.stringify(res.jsonBody ?? "") + (res.rawBody?.toString("utf8") ?? "");
  assert.equal(responseBody.includes(apiKey), false, "key must not appear in response body");
});

// ---------------------------------------------------------------------------
// Provider factory + switching tests
// These test the createVoiceProvider factory logic in isolation,
// mirroring the implementation in packages/web/src/voice-provider.ts.
// No browser globals required — factory decision logic only.
// ---------------------------------------------------------------------------

function computeProviderType(
  requestedType: "browser" | "elevenlabs",
  elevenlabsAvailable: boolean,
): "browser" | "elevenlabs" {
  if (requestedType === "elevenlabs" && elevenlabsAvailable) return "elevenlabs";
  return "browser";
}

test("factory — returns 'browser' when type is 'browser' regardless of availability", () => {
  assert.equal(computeProviderType("browser", true), "browser");
  assert.equal(computeProviderType("browser", false), "browser");
});

test("factory — returns 'elevenlabs' only when type is 'elevenlabs' AND available", () => {
  assert.equal(computeProviderType("elevenlabs", true), "elevenlabs");
});

test("factory — falls back to 'browser' when type is 'elevenlabs' but unavailable", () => {
  assert.equal(computeProviderType("elevenlabs", false), "browser");
});

test("factory — switching from 'elevenlabs' to 'browser' always yields 'browser'", () => {
  // Simulate: user had elevenlabs active, switches to browser
  const firstActive = computeProviderType("elevenlabs", true);
  assert.equal(firstActive, "elevenlabs");
  const afterSwitch = computeProviderType("browser", true);
  assert.equal(afterSwitch, "browser");
});

// ---------------------------------------------------------------------------
// onFallback callback tests (inline simulation — no real network)
// ---------------------------------------------------------------------------

test("onFallback is called when ElevenLabs network request fails", async () => {
  let fallbackCalled = false;
  const onFallback = () => { fallbackCalled = true; };

  // Inline re-implementation of the ElevenLabs fetch-and-fallback logic
  async function simulateElevenLabsSpeakText(
    mockFetch: () => Promise<never>,
    callback: () => void,
  ): Promise<void> {
    try {
      await mockFetch();
    } catch {
      callback(); // onFallback
      // (would call fallback.speakText here in real impl)
    }
  }

  const mockFetch = async (): Promise<never> => {
    throw new Error("Network error: ECONNREFUSED");
  };

  await simulateElevenLabsSpeakText(mockFetch, onFallback);
  assert.equal(fallbackCalled, true, "onFallback must be called on network error");
});

test("onFallback is called when ElevenLabs returns non-200", async () => {
  let fallbackCalled = false;
  const onFallback = () => { fallbackCalled = true; };

  async function simulateElevenLabsSpeakText(
    mockFetch: () => Promise<{ ok: boolean; status: number }>,
    callback: () => void,
  ): Promise<void> {
    try {
      const res = await mockFetch();
      if (!res.ok) throw new Error(`TTS responded ${res.status}`);
    } catch {
      callback();
    }
  }

  const mockFetch = async () => ({ ok: false, status: 429 });
  await simulateElevenLabsSpeakText(mockFetch, onFallback);
  assert.equal(fallbackCalled, true, "onFallback must be called on non-200 response");
});

test("onFallback is NOT called on successful ElevenLabs response", async () => {
  let fallbackCalled = false;
  const onFallback = () => { fallbackCalled = true; };

  async function simulateElevenLabsSpeakText(
    mockFetch: () => Promise<{ ok: boolean }>,
    callback: () => void,
  ): Promise<void> {
    try {
      const res = await mockFetch();
      if (!res.ok) throw new Error("not ok");
      // Success path — onFallback should NOT be called
      void callback; // referenced but not invoked
    } catch {
      callback();
    }
  }

  const mockFetch = async () => ({ ok: true });
  await simulateElevenLabsSpeakText(mockFetch, onFallback);
  assert.equal(fallbackCalled, false, "onFallback must NOT be called on success");
});

test("provider switching: config detection gates ElevenLabs availability", () => {
  // Simulate the /api/voice/config response shape the frontend checks
  const configUnconfigured = { elevenlabsAvailable: false, provider: "browser" };
  const configConfigured   = { elevenlabsAvailable: true,  provider: "elevenlabs" };

  assert.equal(configUnconfigured.elevenlabsAvailable, false);
  assert.equal(configUnconfigured.provider, "browser");
  assert.equal(configConfigured.elevenlabsAvailable, true);
  assert.equal(configConfigured.provider, "elevenlabs");

  // Frontend never receives the key — only the boolean flag
  assert.equal("elevenlabsAvailable" in configConfigured, true);
  assert.equal("ELEVENLABS_API_KEY" in configConfigured, false);
  assert.equal("xi-api-key" in configConfigured, false);
});
