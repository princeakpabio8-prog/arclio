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
 *
 * ── Fix: stale-closure disconnect ────────────────────────────────────────────
 * The SDK's `useScribe()` returns a new `scribe` object on every render.
 * Callbacks passed to `useScribe({ onCommittedTranscript })` are closed over
 * at hook-creation time via useCallback(…, []). If those callbacks capture
 * `scribe.disconnect` directly they hold a stale reference that may call
 * `disconnect` on the wrong `connectionRef`.
 *
 * Fix: store `scribe.disconnect` in a stable ref (`disconnectRef`) that is
 * updated every render. All callbacks read from the ref, never from the
 * stale closure.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import type { UseMicSessionOptions, UseMicSessionReturn } from "./useMicSession.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** ms after connect() with no committed transcript before treating as hung. */
const WATCHDOG_MS = 10_000;

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

  // ── Stale-closure fix ─────────────────────────────────────────────────────
  // `useScribe()` returns a new object each render. Store `.disconnect` in a
  // ref that we overwrite every render so the useCallback closures (which
  // capture [] deps) always call the *current* disconnect, not a stale one.
  const disconnectRef = useRef<() => void>(() => { /* will be set before first use */ });

  // ── useScribe (official SDK hook) ─────────────────────────────────────────
  // Callbacks are defined with stable [] deps; they read mutable refs for all
  // values that change across renders/taps.

  // activeSessionRef: the session ID that was current when connect() was called.
  // Only events belonging to that session are processed.
  const activeSessionRef = useRef(0);

  const scribe = useScribe({
    onCommittedTranscript: useCallback((msg: { text: string }) => {
      const mySession = activeSessionRef.current;
      if (sessionRef.current !== mySession) return;
      const transcript = msg.text.trim();
      // Stop watchdog, then disconnect via the always-current ref.
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      // Bump the session counter so any subsequent disconnect-triggered
      // onDisconnect callback is treated as belonging to a dead session.
      sessionRef.current++;
      disconnectRef.current();
      setIsListening(false);
      if (transcript) {
        onTranscriptRef.current(transcript);
      } else {
        onSilenceRef.current?.();
      }
    }, []), // [] is correct — all mutable state is read via refs

    onError: useCallback((err: Error | Event) => {
      const mySession = activeSessionRef.current;
      if (sessionRef.current !== mySession) return;
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      console.error("[scribe] error:", err instanceof Error ? err.message : String(err));
      sessionRef.current++;
      disconnectRef.current();
      setIsListening(false);
      setError("Voice input isn't available right now. Tap the mic to try again.");
    }, []),

    onDisconnect: useCallback(() => {
      // Safety net: if the socket closed unexpectedly (network drop, server
      // hangup) and we are still showing "Listening…", return to idle.
      // We do NOT clear the watchdog here because a committed-transcript path
      // already cleared it before calling disconnect().
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      setIsListening((prev) => (prev ? false : prev));
    }, []),
  });

  // Keep the ref current every render — this is the fix for the stale closure.
  disconnectRef.current = scribe.disconnect;

  // Unmount cleanup.
  useEffect(() => () => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    disconnectRef.current();
  // disconnectRef.current is always current; no dep needed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Public API ──────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    // Disconnect any previous session using the current disconnect ref.
    disconnectRef.current();

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
      disconnectRef.current();
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
      sessionRef.current++;
      disconnectRef.current();
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
        languageCode: "en",
        microphone: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      if (sessionRef.current !== mySession) return;
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      sessionRef.current++;
      setIsListening(false);
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError("Microphone access was denied. Please allow it in Settings.");
      } else {
        setError("Voice input isn't available right now. Tap the mic to try again.");
      }
    }
  // scribe.connect is stable per the SDK (useCallback with option deps);
  // disconnectRef is a ref, not state — no dep needed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scribe.connect]);

  const stop = useCallback(() => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    sessionRef.current++;
    disconnectRef.current();
    setIsListening(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isListening, error, start, stop };
}
