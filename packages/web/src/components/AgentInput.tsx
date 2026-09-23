import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import type { AgentResponse } from "../types.js";
import { api } from "../api.js";
import {
  createVoiceProvider,
  BrowserVoiceProvider,
  type VoiceProvider,
} from "../voice-provider.js";

interface Props {
  onResponse: (r: AgentResponse & { query: string }) => void;
  onLoading?: () => void;
  onError?: (err: Error) => void;
}

/** Speech recognition factory — same pattern as AlexaSimulator */
type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  return (
    (window as Window & { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).SpeechRecognition ??
    (window as Window & { webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).webkitSpeechRecognition ??
    null
  );
}

/**
 * Suggestion chips shown below the input on first load.
 * All five primary intents are represented so new users immediately
 * understand what they can ask — on every screen size.
 */
const SUGGESTIONS = [
  "Give me my business briefing.",
  "What needs my attention?",
  "Is anything waiting on me?",
  "What should I follow up on today?",
  "Handle the Acme delivery.",
];

type MicState = "idle" | "listening" | "processing" | "speaking";

/** Milliseconds to wait after onstart before treating recognition as hung. */
const MIC_WATCHDOG_MS = 8_000;

export function AgentInput({ onResponse, onLoading, onError }: Props) {
  const [query, setQuery]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [micState, setMicState]   = useState<MicState>("idle");
  const inputRef        = useRef<HTMLInputElement>(null);
  const recognitionRef  = useRef<SpeechRecognitionInstance | null>(null);
  const micWatchdogRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceRef        = useRef<VoiceProvider>(new BrowserVoiceProvider());

  const speechSupported = !!getSpeechRecognition();

  // Bootstrap voice provider — probe ElevenLabs availability
  useEffect(() => {
    fetch("/api/voice/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { elevenlabsAvailable?: boolean } | null) => {
        if (data?.elevenlabsAvailable) {
          voiceRef.current = createVoiceProvider("elevenlabs", true);
        }
      })
      .catch(() => {/* stay with browser TTS */});
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    clearMicWatchdog();
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    voiceRef.current.stopSpeaking();
  }, []);

  function clearMicWatchdog() {
    if (micWatchdogRef.current !== null) {
      clearTimeout(micWatchdogRef.current);
      micWatchdogRef.current = null;
    }
  }

  /** Abort any existing recognition instance and clear its handlers. */
  function abortRecognition() {
    clearMicWatchdog();
    const prev = recognitionRef.current;
    if (prev) {
      prev.onresult = null;
      prev.onerror  = null;
      prev.onend    = null;
      try { prev.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
  }

  async function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading || micState === "processing") return;

    // Stop any ongoing speech
    voiceRef.current.stopSpeaking();

    // iOS audio unlock — must be synchronous before first await
    voiceRef.current.primeForPlayback?.();

    setLoading(true);
    setMicState("processing");
    setError(null);
    onLoading?.();

    try {
      const response = await api.agent(trimmed);
      onResponse({ ...response, query: trimmed });
      setQuery("");

      // Speak the response
      setMicState("speaking");
      const speakText = response.answer.length > 490
        ? response.answer.slice(0, 489) + "…"
        : response.answer;
      voiceRef.current.speakText(speakText, () => setMicState("idle"));
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e.message);
      onError?.(e);
      setMicState("idle");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(query); }
  }

  function startListening() {
    const SR = getSpeechRecognition();
    if (!SR || micState !== "idle") return;

    voiceRef.current.stopSpeaking();

    // iOS audio unlock before async gesture chain
    voiceRef.current.primeForPlayback?.();

    // Always discard any previous (potentially stale/hung) instance first.
    abortRecognition();

    setMicState("listening");

    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.continuous     = false;
    recognition.interimResults = false;
    recognition.lang           = "en-US";

    // onstart: recognition session opened — start the watchdog.
    // On iOS WebKit after video playback the session can open but then
    // silently hang without ever producing onresult/onerror/onend.
    // The watchdog detects this and resets to idle with a user message.
    (recognition as SpeechRecognitionInstance & { onstart?: (() => void) | null }).onstart = () => {
      clearMicWatchdog();
      micWatchdogRef.current = setTimeout(() => {
        // Recognition started but nothing came back — treat as failure.
        abortRecognition();
        setMicState("idle");
        setError("Voice input isn't available right now. Try again.");
      }, MIC_WATCHDOG_MS);
    };

    recognition.onresult = (event) => {
      clearMicWatchdog();
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) {
        setQuery(transcript);
        submit(transcript);
      } else {
        setMicState("idle");
      }
    };

    recognition.onerror = (event) => {
      clearMicWatchdog();
      // Surface actionable messages for permission-denied or no-speech.
      const code = (event as { error?: string }).error ?? "";
      if (code === "not-allowed" || code === "service-not-allowed") {
        setError("Microphone access was denied. Please allow it in Settings.");
      } else if (code !== "no-speech" && code !== "aborted") {
        setError("Voice input isn't available right now. Try again.");
      }
      setMicState("idle");
    };

    recognition.onend = () => {
      clearMicWatchdog();
      setMicState((prev) => (prev === "listening" ? "idle" : prev));
    };

    try { recognition.start(); }
    catch {
      abortRecognition();
      setMicState("idle");
      setError("Voice input isn't available right now. Try again.");
    }
  }

  function stopListening() {
    abortRecognition();
    if (micState === "listening") setMicState("idle");
  }

  const isBusy  = loading || micState === "processing" || micState === "speaking";
  const isListening = micState === "listening";

  // Mic button aria label
  const micLabel = isListening ? "Stop listening" : "Speak to Arclio";

  return (
    <div className="command-section">
      {/* ── Main input bar ── */}
      <div className="command-wrap">
        <span className="command-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>

        <input
          ref={inputRef}
          className="command-input"
          placeholder="Ask Arclio anything…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          disabled={isBusy}
          // No autoFocus — on mobile the keyboard must not open automatically
        />

        {/* Microphone button — shown only if speech is supported */}
        {speechSupported && (
          <button
            className={`command-mic${isListening ? " command-mic--listening" : ""}`}
            onClick={isListening ? stopListening : startListening}
            disabled={isBusy && !isListening}
            aria-label={micLabel}
            type="button"
          >
            {isListening ? (
              /* Animated stop indicator */
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              /* Microphone */
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
        )}

        {/* Send button */}
        <button
          className="command-send"
          onClick={() => submit(query)}
          disabled={isBusy || !query.trim()}
          aria-label="Send"
          type="button"
        >
          {micState === "speaking" ? (
            /* Speaking indicator */
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>

      {/* Listening indicator */}
      {isListening && (
        <div className="command-listening" role="status" aria-live="polite">
          <span className="command-listening-dot" aria-hidden="true" />
          <span className="command-listening-dot" aria-hidden="true" />
          <span className="command-listening-dot" aria-hidden="true" />
          Listening…
        </div>
      )}

      {/* Suggestions */}
      <div className="command-suggestions">
        <span className="command-suggestions-label">Try asking:</span>
        <div className="command-suggestions-chips">
          {SUGGESTIONS.map((text) => (
            <button
              key={text}
              className="suggestion-chip"
              onClick={() => submit(text)}
              disabled={isBusy}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "currentColor", fill: "none", strokeWidth: 2, flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
