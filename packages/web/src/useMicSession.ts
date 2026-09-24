/**
 * useMicSession
 *
 * Shared speech-recognition lifecycle hook used by AgentInput and
 * AlexaSimulator. Implements the mobile-reliability requirements:
 *
 *  - Every tap creates a completely fresh SpeechRecognition instance.
 *  - A session ID (integer) is minted at start(); any callback that
 *    arrives after stop/abort/timeout of that session is a no-op.
 *  - Recognition is fully torn down after onresult, onerror, onend,
 *    and watchdog timeout — never left running during processing or TTS.
 *  - Watchdog: if onstart fires but nothing arrives within WATCHDOG_MS,
 *    abort and surface an error message.
 *  - No overlapping sessions: start() always aborts the previous
 *    instance (if any) before creating a new one.
 *  - Callers receive: isListening state, start(), stop(), and error.
 */

import { useState, useRef, useCallback, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:  ((e: { results: SpeechRecognitionResultList }) => void) | null;
  onerror:   ((e: { error?: string }) => void) | null;
  onend:     (() => void) | null;
  onstart?:  (() => void) | null;
  start():   void;
  stop():    void;
  abort():   void;
};

export interface UseMicSessionOptions {
  /** Called with the final transcript when speech is recognised. */
  onTranscript: (transcript: string) => void;
  /**
   * Called when recognition ends with no transcript (silence / no-speech).
   * The mic returns to idle automatically; callers don't need to handle this.
   */
  onSilence?: () => void;
}

export interface UseMicSessionReturn {
  /** True while the microphone is actively listening. */
  isListening: boolean;
  /**
   * User-facing error string, or null.
   * Cleared automatically on the next start() call.
   */
  error: string | null;
  /**
   * Begin a new recognition session.
   * Safe to call even if a previous session is still running — it will be
   * torn down first.
   * Must be called from a synchronous user-gesture handler.
   */
  start: () => void;
  /** Stop the current session and return to idle. */
  stop: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** ms after onstart with no result/error/end before treating as hung. */
const WATCHDOG_MS = 8_000;

// ─── Factory ──────────────────────────────────────────────────────────────────

function getSR(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance })
      .SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance })
      .webkitSpeechRecognition ??
    null
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMicSession({
  onTranscript,
  onSilence,
}: UseMicSessionOptions): UseMicSessionReturn {
  const [isListening, setIsListening] = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Current live recognition instance.
  const recRef      = useRef<SpeechRecognitionInstance | null>(null);
  // Watchdog timer handle.
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Session ID — incremented each time start() is called.
  // All callbacks capture the session ID at closure-creation time and
  // compare against the current value before doing anything.
  const sessionRef  = useRef(0);

  // Stable callback refs so callers can pass new functions without
  // triggering hook re-creation.
  const onTranscriptRef = useRef(onTranscript);
  const onSilenceRef    = useRef(onSilence);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onSilenceRef.current    = onSilence;    }, [onSilence]);

  // ── Internal helpers ────────────────────────────────────────────────────────

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  /**
   * Tear down the current recognition instance completely.
   * All handlers are nulled first so no late callbacks fire after abort().
   * Does NOT update React state — callers handle that.
   */
  const teardown = useCallback(() => {
    clearWatchdog();
    const rec = recRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onerror  = null;
      rec.onend    = null;
      if (rec.onstart !== undefined) rec.onstart = null;
      try { rec.abort(); } catch { /* already ended */ }
      recRef.current = null;
    }
  }, [clearWatchdog]);

  // Unmount cleanup.
  useEffect(() => () => {
    teardown();
  }, [teardown]);

  // ── Public API ──────────────────────────────────────────────────────────────

  const start = useCallback(() => {
    const SR = getSR();
    if (!SR) return; // browser doesn't support speech recognition

    // Always tear down any previous instance first — this is what guarantees
    // every session is completely fresh and stale callbacks are dead.
    teardown();

    // Mint a new session ID. All closures below capture `mySession`.
    const mySession = ++sessionRef.current;

    setIsListening(true);
    setError(null);

    const rec = new SR();
    recRef.current = rec;

    rec.continuous     = false;
    rec.interimResults = false;
    rec.lang           = "en-US";

    // ── onstart: recognition engine opened ─────────────────────────────────
    // Start the watchdog. On mobile (iOS/Android) the engine sometimes opens
    // but then hangs with no result, error, or end event. The watchdog
    // detects this after WATCHDOG_MS and returns the UI to idle.
    rec.onstart = () => {
      if (sessionRef.current !== mySession) return;
      clearWatchdog();
      watchdogRef.current = setTimeout(() => {
        if (sessionRef.current !== mySession) return;
        teardown();
        setIsListening(false);
        setError("Voice input isn't available right now. Tap the mic to try again.");
      }, WATCHDOG_MS);
    };

    // ── onresult: speech recognised ────────────────────────────────────────
    rec.onresult = (event) => {
      if (sessionRef.current !== mySession) return;
      clearWatchdog();
      const transcript = event.results[0]?.[0]?.transcript ?? "";

      // Tear down immediately — recognition must not run during processing.
      teardown();
      setIsListening(false);

      if (transcript.trim()) {
        onTranscriptRef.current(transcript.trim());
      } else {
        onSilenceRef.current?.();
      }
    };

    // ── onerror ────────────────────────────────────────────────────────────
    rec.onerror = (event) => {
      if (sessionRef.current !== mySession) return;
      clearWatchdog();
      teardown();
      setIsListening(false);

      const code = event.error ?? "";
      if (code === "not-allowed" || code === "service-not-allowed") {
        setError("Microphone access was denied. Please allow it in Settings.");
      } else if (code === "no-speech" || code === "aborted") {
        // Silent — user just didn't speak or we cancelled; no error shown.
      } else {
        setError("Voice input isn't available right now. Tap the mic to try again.");
      }
    };

    // ── onend: engine closed ───────────────────────────────────────────────
    // This fires after every session end (including after onerror and after
    // abort). It is the last event to arrive. We use it only as a safety
    // net to ensure we never stay stuck in "listening" state.
    rec.onend = () => {
      if (sessionRef.current !== mySession) return;
      clearWatchdog();
      recRef.current = null; // already ended — just null the ref
      // Only revert to idle if we're still visually in listening state
      // (onresult may have already moved us to processing).
      setIsListening((prev) => (prev ? false : prev));
    };

    try {
      rec.start();
    } catch {
      teardown();
      setIsListening(false);
      setError("Voice input isn't available right now. Tap the mic to try again.");
    }
  }, [teardown, clearWatchdog]);

  const stop = useCallback(() => {
    teardown();
    setIsListening(false);
  }, [teardown]);

  return { isListening, error, start, stop };
}
