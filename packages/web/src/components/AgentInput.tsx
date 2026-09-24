import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import type { AgentResponse } from "../types.js";
import { api } from "../api.js";
import {
  createVoiceProvider,
  BrowserVoiceProvider,
  type VoiceProvider,
} from "../voice-provider.js";
import { useMicSession } from "../useMicSession.js";
import { isMobile } from "../isMobile.js";

interface Props {
  onResponse: (r: AgentResponse & { query: string }) => void;
  onLoading?: () => void;
  onError?: (err: Error) => void;
}

const SUGGESTIONS = [
  "Give me my business briefing.",
  "What needs my attention?",
  "Is anything waiting on me?",
  "What should I follow up on today?",
  "Handle the Acme delivery.",
];

// ── TTS safety timeout for ElevenLabs (ms) ───────────────────────────────────
// If the audio onended event never fires, we fall back to idle after this long.
// 15 s is enough for any response length. BrowserVoiceProvider has its own
// internal safety timer; this covers ElevenLabs.
const TTS_SAFETY_MS = 15_000;

export function AgentInput({ onResponse, onLoading, onError }: Props) {
  const [query, setQuery]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  // isSpeaking is purely cosmetic — the send-button icon changes, and the
  // mic is blocked while TTS plays. It does NOT gate whether the response
  // is visible or whether the agent is considered "done".
  const [isSpeaking, setIsSpeaking] = useState(false);

  const inputRef    = useRef<HTMLInputElement>(null);
  const voiceRef    = useRef<VoiceProvider>(new BrowserVoiceProvider());
  const ttsSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bootstrap voice provider — probe ElevenLabs availability once on mount.
  useEffect(() => {
    fetch("/api/voice/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { elevenlabsAvailable?: boolean } | null) => {
        if (data?.elevenlabsAvailable) {
          voiceRef.current = createVoiceProvider("elevenlabs", true);
        }
      })
      .catch(() => { /* stay with browser TTS */ });
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => {
    if (ttsSafetyRef.current) clearTimeout(ttsSafetyRef.current);
    voiceRef.current.stopSpeaking();
  }, []);

  // ── TTS helpers ─────────────────────────────────────────────────────────────

  function stopTts() {
    if (ttsSafetyRef.current) { clearTimeout(ttsSafetyRef.current); ttsSafetyRef.current = null; }
    voiceRef.current.stopSpeaking();
    setIsSpeaking(false);
  }

  function speakResponse(text: string) {
    // Cap text length and strip to first 490 chars for ElevenLabs proxy limit.
    const speakText = text.length > 490 ? text.slice(0, 489) + "…" : text;

    setIsSpeaking(true);

    // Safety net: if TTS never calls back (ElevenLabs timeout, audio error,
    // browser synthesis stall), return to idle after TTS_SAFETY_MS.
    if (ttsSafetyRef.current) clearTimeout(ttsSafetyRef.current);
    ttsSafetyRef.current = setTimeout(() => {
      ttsSafetyRef.current = null;
      setIsSpeaking(false);
    }, TTS_SAFETY_MS);

    voiceRef.current.speakText(speakText, () => {
      if (ttsSafetyRef.current) { clearTimeout(ttsSafetyRef.current); ttsSafetyRef.current = null; }
      setIsSpeaking(false);
    });
  }

  // ── Agent submit ─────────────────────────────────────────────────────────────

  async function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    // Stop TTS if Arclio was still speaking from a previous response.
    stopTts();

    // Prime the speech engine synchronously inside the gesture (before await).
    // BrowserVoiceProvider.primeForPlayback() speaks a silent utterance here
    // to unlock speechSynthesis on iOS/Android. ElevenLabsVoiceProvider
    // creates a pre-unlocked Audio element. Both must happen before any await.
    voiceRef.current.primeForPlayback?.();

    setLoading(true);
    setError(null);
    onLoading?.();

    try {
      const response = await api.agent(trimmed);

      // ── Spec item 3: display response BEFORE starting TTS ─────────────────
      // onResponse updates the parent UI immediately. TTS is independent.
      onResponse({ ...response, query: trimmed });
      setQuery("");
      setLoading(false);
      inputRef.current?.focus();

      // Start TTS after UI is updated. If it fails or hangs, the response
      // is already visible and the safety timer returns us to idle.
      speakResponse(response.answer);
    } catch (err) {
      setLoading(false);
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e.message);
      onError?.(e);
      inputRef.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(query); }
  }

  // ── Mic session ──────────────────────────────────────────────────────────────

  const mic = useMicSession({
    onTranscript: (transcript) => {
      // transcript arrived → submit it. primeForPlayback is called inside
      // submit(); onTranscript is fired from a recognition event callback
      // which is NOT a user gesture on mobile, so the unlock utterance in
      // BrowserVoiceProvider.primeForPlayback() is the critical path here.
      setQuery(transcript);
      submit(transcript);
    },
  });

  // When the user taps the mic button: stop TTS, prime the speech engine,
  // then start recognition. Order matters:
  //   1. stopTts()                  — cancel any current audio
  //   2. primeForPlayback()         — unlock speechSynthesis in this gesture
  //   3. mic.start()                — create fresh recognition instance
  function handleMicTap() {
    if (mic.isListening) {
      mic.stop();
      return;
    }
    if (loading || isSpeaking) return;

    stopTts();
    voiceRef.current.primeForPlayback?.();
    mic.start();
  }

  // Surface recognition errors in the same error banner as agent errors.
  useEffect(() => {
    if (mic.error) setError(mic.error);
  }, [mic.error]);

  // ── Render ───────────────────────────────────────────────────────────────────

  // Show mic button if native SpeechRecognition is supported (desktop) OR
  // if we're on mobile (where Scribe v2 Realtime handles STT instead).
  const speechSupported = isMobile() || !!( typeof window !== "undefined" &&
    ((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ??
     (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition));

  const isBusy = loading || isSpeaking;

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
          disabled={loading || mic.isListening}
        />

        {/* Microphone button */}
        {speechSupported && (
          <button
            className={`command-mic${mic.isListening ? " command-mic--listening" : ""}`}
            onClick={handleMicTap}
            disabled={isBusy && !mic.isListening}
            aria-label={mic.isListening ? "Stop listening" : "Speak to Arclio"}
            type="button"
          >
            {mic.isListening ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
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
          {isSpeaking ? (
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
      {mic.isListening && (
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
              disabled={isBusy || mic.isListening}
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
