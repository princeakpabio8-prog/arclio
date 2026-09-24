/**
 * useScribeSession.ts
 *
 * Mobile-only speech-to-text hook using ElevenLabs Scribe v2 Realtime.
 *
 * Architecture:
 *  - Server issues a single-use signed WebSocket URL via POST /api/voice/scribe-token.
 *    The ELEVENLABS_API_KEY never reaches the browser.
 *  - The browser opens the WebSocket, streams raw PCM audio from the microphone,
 *    and receives partial + committed transcripts.
 *  - After a committed transcript: immediately close the WebSocket, stop the
 *    microphone, deliver the transcript to the caller, return to IDLE.
 *  - Every tap creates a completely fresh session. Stale sessions are aborted.
 *
 * Lifecycle:
 *   IDLE → start() → LISTENING → committed transcript → IDLE  (success)
 *                              → error / cancel / timeout → IDLE
 *
 * Watchdog: if no committed transcript arrives within WATCHDOG_MS of the
 * WebSocket opening, the session is torn down and an error is surfaced.
 *
 * Exports the same UseMicSessionReturn shape as useMicSession so it can be
 * consumed transparently by AgentInput and AlexaSimulator.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import type { UseMicSessionOptions, UseMicSessionReturn } from "./useMicSession.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** ms after WebSocket opens with no committed transcript before treating as hung. */
const WATCHDOG_MS = 12_000;

/** Audio sample rate sent to Scribe (16 kHz is optimal for speech). */
const SAMPLE_RATE = 16_000;

/** PCM chunk duration in ms — balance between latency and overhead. */
const CHUNK_MS = 100;

// ─── Scribe WebSocket message shapes ─────────────────────────────────────────

interface ScribeTranscriptMsg {
  type: "transcript";
  transcript_event: {
    type: "partial" | "final" | "committed";
    text: string;
  };
}

interface ScribeErrorMsg {
  type: "error";
  message?: string;
}

type ScribeMsg = ScribeTranscriptMsg | ScribeErrorMsg | { type: string };

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useScribeSession({
  onTranscript,
  onSilence,
}: UseMicSessionOptions): UseMicSessionReturn {
  const [isListening, setIsListening] = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Session ID — incremented on every start(). Stale callbacks guard against it.
  const sessionRef   = useRef(0);
  const wsRef        = useRef<WebSocket | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const ctxRef       = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const watchdogRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Accumulated PCM buffer to send in chunks.
  const pcmBufferRef  = useRef<Float32Array[]>([]);

  // Stable callback refs.
  const onTranscriptRef = useRef(onTranscript);
  const onSilenceRef    = useRef(onSilence);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onSilenceRef.current    = onSilence;    }, [onSilence]);

  // ── Teardown ─────────────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    // Clear timers first.
    if (watchdogRef.current !== null) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    if (chunkTimerRef.current !== null) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }

    // Stop audio pipeline.
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {/* already closed */});
      ctxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Close WebSocket — null handlers first to prevent re-entrant teardown.
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      ws.onmessage = null;
      ws.onerror   = null;
      ws.onclose   = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, "session ended");
      }
    }

    pcmBufferRef.current = [];
  }, []);

  // Unmount cleanup.
  useEffect(() => () => { teardown(); }, [teardown]);

  // ── PCM encoder ───────────────────────────────────────────────────────────────

  /** Encode Float32Array as little-endian 16-bit PCM in an ArrayBuffer. */
  function encodePcm(samples: Float32Array): ArrayBuffer {
    const buf = new ArrayBuffer(samples.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    // Abort any previous session.
    teardown();
    const mySession = ++sessionRef.current;

    setIsListening(true);
    setError(null);

    // ── 1. Request mic ─────────────────────────────────────────────────────────
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
        },
      });
    } catch (err) {
      if (sessionRef.current !== mySession) return;
      teardown();
      setIsListening(false);
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError("Microphone access was denied. Please allow it in Settings.");
      } else {
        setError("Voice input isn't available right now. Tap the mic to try again.");
      }
      return;
    }

    if (sessionRef.current !== mySession) { stream.getTracks().forEach((t) => t.stop()); return; }
    streamRef.current = stream;

    // ── 2. Fetch signed WebSocket URL from server ──────────────────────────────
    let signedUrl: string;
    try {
      const tokenRes = await fetch("/api/voice/scribe-token", { method: "POST" });
      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Token request failed (${tokenRes.status})`);
      }
      const tokenData = await tokenRes.json() as { signedUrl?: string };
      if (!tokenData.signedUrl) throw new Error("Server returned no signed URL");
      signedUrl = tokenData.signedUrl;
    } catch (err) {
      if (sessionRef.current !== mySession) return;
      teardown();
      setIsListening(false);
      const msg = err instanceof Error ? err.message : String(err);
      // 503 = not configured → fall through to caller who may fall back to SR
      setError(msg.includes("not configured")
        ? "Scribe STT is not configured."
        : "Voice input isn't available right now. Tap the mic to try again.");
      return;
    }

    if (sessionRef.current !== mySession) return;

    // ── 3. Open WebSocket ──────────────────────────────────────────────────────
    let ws: WebSocket;
    try {
      ws = new WebSocket(signedUrl);
    } catch {
      if (sessionRef.current !== mySession) return;
      teardown();
      setIsListening(false);
      setError("Voice input isn't available right now. Tap the mic to try again.");
      return;
    }

    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    // Watchdog: abort if no committed transcript arrives within WATCHDOG_MS.
    watchdogRef.current = setTimeout(() => {
      if (sessionRef.current !== mySession) return;
      teardown();
      setIsListening(false);
      setError("Voice input isn't available right now. Tap the mic to try again.");
    }, WATCHDOG_MS);

    ws.onmessage = (evt: MessageEvent) => {
      if (sessionRef.current !== mySession) return;
      let msg: ScribeMsg;
      try {
        msg = JSON.parse(typeof evt.data === "string" ? evt.data : "") as ScribeMsg;
      } catch { return; }

      if (msg.type === "error") {
        const errMsg = (msg as ScribeErrorMsg).message ?? "Scribe error";
        console.error("[scribe] error:", errMsg);
        teardown();
        setIsListening(false);
        setError("Voice input isn't available right now. Tap the mic to try again.");
        return;
      }

      if (msg.type === "transcript") {
        const evt2 = (msg as ScribeTranscriptMsg).transcript_event;
        if (evt2.type === "committed") {
          // Committed transcript → tear down immediately, deliver to caller.
          const transcript = evt2.text.trim();
          teardown();
          setIsListening(false);
          if (transcript) {
            onTranscriptRef.current(transcript);
          } else {
            onSilenceRef.current?.();
          }
        }
        // partial transcripts are intentionally ignored (no streaming display needed)
      }
    };

    ws.onerror = () => {
      if (sessionRef.current !== mySession) return;
      teardown();
      setIsListening(false);
      setError("Voice input isn't available right now. Tap the mic to try again.");
    };

    ws.onclose = (e: CloseEvent) => {
      if (sessionRef.current !== mySession) return;
      // 1000 = normal close (we initiated it after commit). Anything else is unexpected.
      if (e.code !== 1000) {
        teardown();
        setIsListening(false);
        setIsListening((prev) => (prev ? false : prev));
      }
    };

    ws.onopen = () => {
      if (sessionRef.current !== mySession) return;

      // ── 4. Set up audio pipeline once WebSocket is open ────────────────────
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);

      // ScriptProcessorNode: buffer size 4096 (≈256 ms at 16 kHz) gives a
      // reasonable trade-off between latency and CPU overhead on mobile.
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (sessionRef.current !== mySession) return;
        if (ws.readyState !== WebSocket.OPEN) return;
        // Accumulate PCM chunks.
        const inputData = e.inputBuffer.getChannelData(0);
        pcmBufferRef.current.push(new Float32Array(inputData));
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      // Send accumulated PCM in batches every CHUNK_MS.
      chunkTimerRef.current = setInterval(() => {
        if (sessionRef.current !== mySession) return;
        if (ws.readyState !== WebSocket.OPEN) return;
        const chunks = pcmBufferRef.current.splice(0);
        if (chunks.length === 0) return;
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const merged = new Float32Array(total);
        let offset = 0;
        for (const c of chunks) { merged.set(c, offset); offset += c.length; }
        ws.send(encodePcm(merged));
      }, CHUNK_MS);
    };
  }, [teardown]);

  const stop = useCallback(() => {
    teardown();
    setIsListening(false);
  }, [teardown]);

  return { isListening, error, start, stop };
}
