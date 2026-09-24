/**
 * useScribeSession.ts
 *
 * Mobile-only speech-to-text hook using ElevenLabs Scribe v2 Realtime.
 *
 * Uses the official @elevenlabs/react `useScribe` hook so that:
 *  - The correct WebSocket URL is resolved internally by the SDK
 *  - AudioContext sampleRate constraints are handled correctly for iOS Safari
 *  - AudioWorklet is used instead of the deprecated ScriptProcessorNode
 *  - VAD (Voice Activity Detection) commits transcripts automatically
 *
 * Token flow:
 *  - POST /api/voice/scribe-token → server exchanges ELEVENLABS_API_KEY for
 *    a single-use token (sutkn_...) using /v1/single-use-token/realtime_scribe
 *  - The raw token reaches the browser; ELEVENLABS_API_KEY never does
 *  - The token is passed to Scribe.connect() which resolves the WS URL
 *
 * Lifecycle (one tap = one session):
 *   IDLE → start() → fetch token → connect useScribe → LISTENING
 *        → committed transcript → disconnect → IDLE  (success)
 *        → error / cancel / timeout → disconnect → IDLE
 *
 * Exports the same UseMicSessionReturn shape as useMicSession so
 * AgentInput and AlexaSimulator need no changes.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import type { UseMicSessionOptions, UseMicSessionReturn } from "./useMicSession.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** ms after connect() with no committed transcript before treating as hung. */
const WATCHDOG_MS = 15_000;

/** Scribe model for realtime STT. */
const SCRIBE_MODEL = "scribe_v2_realtime";

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useScribeSession({
  onTranscript,
  onSilence,
}: UseMicSessionOptions): UseMicSessionReturn {
  const [isListening, setIsListening] = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Session ID — incremented on every start(). Stale callbacks are ignored.
  const sessionRef   = useRef(0);
  const watchdogRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable callback refs so callers can swap functions without remounting.
  const onTranscriptRef = useRef(onTranscript);
  const onSilenceRef    = useRef(onSilence);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onSilenceRef.current    = onSilence;    }, [onSilence]);

  // ── useScribe (official SDK hook) ─────────────────────────────────────────
  // Callbacks are defined as stable refs below; the hook is mounted once and
  // reused across taps (connect/disconnect per tap).

  // Capture the session ID at callback-creation time inside connect() so that
  // stale events from a superseded session are ignored.
  const activeSessionRef = useRef(0);

  const scribe = useScribe({
    onCommittedTranscript: useCallback((msg: { text: string }) => {
      const mySession = activeSessionRef.current;
      if (sessionRef.current !== mySession) return;
      const transcript = msg.text.trim();
      // Committed transcript → stop watchdog, disconnect, deliver.
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      // Disconnect immediately — one tap, one result.
      scribe.disconnect();
      setIsListening(false);
      if (transcript) {
        onTranscriptRef.current(transcript);
      } else {
        onSilenceRef.current?.();
      }
    // scribe.disconnect is stable per useScribe internals (useCallback with [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),

    onError: useCallback((err: Error | Event) => {
      const mySession = activeSessionRef.current;
      if (sessionRef.current !== mySession) return;
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      console.error("[scribe] error:", err instanceof Error ? err.message : String(err));
      setIsListening(false);
      setError("Voice input isn't available right now. Tap the mic to try again.");
    }, []),

    onDisconnect: useCallback(() => {
      // Safety net: if the session ended unexpectedly (network drop, etc.)
      // and we're still showing isListening, return to idle.
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      setIsListening((prev) => (prev ? false : prev));
    }, []),
  });

  // Unmount cleanup.
  useEffect(() => () => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    scribe.disconnect();
  // scribe.disconnect is stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Public API ──────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    // Disconnect any previous session.
    scribe.disconnect();

    const mySession = ++sessionRef.current;
    activeSessionRef.current = mySession;

    setIsListening(true);
    setError(null);

    // Clear any stale watchdog.
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }

    // ── 1. Fetch single-use token from server ─────────────────────────────
    let token: string;
    try {
      const tokenRes = await fetch("/api/voice/scribe-token", { method: "POST" });
      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Token request failed (${tokenRes.status})`);
      }
      const tokenData = await tokenRes.json() as { token?: string };
      if (!tokenData.token) throw new Error("Server returned no Scribe token");
      token = tokenData.token;
    } catch (err) {
      if (sessionRef.current !== mySession) return;
      scribe.disconnect();
      setIsListening(false);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes("not configured")
        ? "Scribe STT is not configured."
        : "Voice input isn't available right now. Tap the mic to try again.");
      return;
    }

    if (sessionRef.current !== mySession) return;

    // ── 2. Watchdog: abort if no committed transcript within WATCHDOG_MS ──
    watchdogRef.current = setTimeout(() => {
      if (sessionRef.current !== mySession) return;
      scribe.disconnect();
      setIsListening(false);
      setError("Voice input isn't available right now. Tap the mic to try again.");
    }, WATCHDOG_MS);

    // ── 3. Connect via official SDK ───────────────────────────────────────
    // The SDK handles: correct WebSocket URL, iOS AudioContext sampleRate,
    // AudioWorklet-based capture, and VAD-based commit.
    try {
      await scribe.connect({
        token,
        modelId: SCRIBE_MODEL,
        commitStrategy: CommitStrategy.VAD,
        microphone: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      if (sessionRef.current !== mySession) return;
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      setIsListening(false);
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError("Microphone access was denied. Please allow it in Settings.");
      } else {
        setError("Voice input isn't available right now. Tap the mic to try again.");
      }
    }
  // scribe.connect and scribe.disconnect are stable per the SDK hook
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(() => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    scribe.disconnect();
    setIsListening(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isListening, error, start, stop };
}
