/**
 * voice-provider.ts
 *
 * Client-side voice provider abstraction for the Alexa+ Simulator.
 *
 * Two implementations:
 *   BrowserVoiceProvider  — uses window.SpeechSynthesis (zero-cost, always available)
 *   ElevenLabsVoiceProvider — proxies through /api/voice/tts (high-quality, optional)
 *
 * The simulator calls speakText(text, onEnd) and stopSpeaking() without knowing
 * which provider is active.  On any ElevenLabs error the implementation
 * automatically falls back to BrowserVoiceProvider so the demo never breaks.
 */

export type VoiceProviderType = "browser" | "elevenlabs";

// ---------------------------------------------------------------------------
// Abstract interface
// ---------------------------------------------------------------------------

export interface VoiceProvider {
  readonly type: VoiceProviderType;
  /** Speak text.  Calls onEnd() when finished (including after errors). */
  speakText(text: string, onEnd: () => void): void;
  /** Cancel any in-progress speech immediately. */
  stopSpeaking(): void;
  /**
   * Optional: call this synchronously inside a user gesture (e.g. button tap)
   * BEFORE the async work begins.  Implementations that need gesture-gated
   * audio (iOS Safari) will pre-create and unlock the Audio element here so
   * that the subsequent speakText() — which may be called after an await —
   * can reuse the already-unlocked element.
   */
  primeForPlayback?(): void;
}

// ---------------------------------------------------------------------------
// BrowserVoiceProvider
// ---------------------------------------------------------------------------

export class BrowserVoiceProvider implements VoiceProvider {
  readonly type = "browser" as const;

  /** True when window.speechSynthesis exists. */
  static isAvailable(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  private safetyTimer: ReturnType<typeof setTimeout> | null = null;

  speakText(text: string, onEnd: () => void): void {
    if (!BrowserVoiceProvider.isAvailable()) { onEnd(); return; }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    let called = false;
    const done = () => {
      if (called) return;
      called = true;
      if (this.safetyTimer) { clearTimeout(this.safetyTimer); this.safetyTimer = null; }
      onEnd();
    };

    utterance.onend   = done;
    utterance.onerror = done;

    // Safety net for browsers that never fire onend (e.g. iOS Safari edge cases).
    // Estimate ~150 wpm; minimum 3 s, max 60 s.
    const words = text.split(/\s+/).length;
    const estimatedMs = Math.min(Math.max(Math.ceil((words / 150) * 60_000), 3_000), 60_000);
    this.safetyTimer = setTimeout(done, estimatedMs);

    window.speechSynthesis.speak(utterance);
  }

  stopSpeaking(): void {
    if (this.safetyTimer) { clearTimeout(this.safetyTimer); this.safetyTimer = null; }
    if (BrowserVoiceProvider.isAvailable()) window.speechSynthesis.cancel();
  }
}

// ---------------------------------------------------------------------------
// ElevenLabsVoiceProvider
// ---------------------------------------------------------------------------

/** Maximum text length sent to ElevenLabs (API limit: 5000 chars). */
const MAX_ELEVENLABS_CHARS = 500;

/**
 * Proxies TTS through the Arclio API server so the ElevenLabs API key
 * never leaves the server.  Falls back to BrowserVoiceProvider on any error.
 *
 * onFallback() is called (once per utterance) whenever a fallback to browser
 * TTS occurs, so the UI can surface a subtle indicator to the user.
 *
 * iOS/Mobile audio unlock strategy:
 * speakText() MUST be called directly from a user gesture (tap/submit) handler.
 * We create and "tap-unlock" the Audio element synchronously at call time,
 * then swap in the blob URL once the fetch resolves.
 * This keeps the audio element in the user-gesture call stack on iOS Safari.
 */
export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly type = "elevenlabs" as const;

  private readonly fallback = new BrowserVoiceProvider();
  private currentAudio: HTMLAudioElement | null = null;
  private readonly onFallback: (() => void) | undefined;
  private safetyTimer: ReturnType<typeof setTimeout> | null = null;
  private currentCallId = 0;
  // Pre-primed audio element created synchronously inside a user gesture.
  private primedAudio: HTMLAudioElement | null = null;

  constructor(onFallback?: () => void) {
    this.onFallback = onFallback;
  }

  private clearSafety(): void {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
  }

  /**
   * Call this synchronously inside the user gesture (button tap / form submit)
   * BEFORE the async work that leads to speakText().
   *
   * Creates an Audio element and calls .play() while still inside the gesture
   * call stack.  iOS Safari grants audio permission at this point.
   * speakText() will reuse this element, satisfying the browser's gesture
   * requirement even though it is called later inside a promise chain.
   */
  primeForPlayback(): void {
    // Discard any previous primed element
    if (this.primedAudio) {
      this.primedAudio.src = "";
      this.primedAudio = null;
    }
    const audio = new Audio();
    audio.muted = false;
    audio.volume = 1;
    // .play() on an empty element will reject immediately — that's expected.
    // The act of calling play() is what grants iOS permission.
    audio.play().catch(() => {/* expected */});
    this.primedAudio = audio;
  }

  speakText(text: string, onEnd: () => void): void {
    const voiceText = text.length > MAX_ELEVENLABS_CHARS
      ? text.slice(0, MAX_ELEVENLABS_CHARS - 1) + "…"
      : text;

    // Stop any previous utterance first (this also increments currentCallId).
    this.stopSpeaking();

    // Capture call ID after stopSpeaking().
    const callId = this.currentCallId;

    // Use the pre-primed audio element if one exists (created synchronously
    // inside the user gesture via primeForPlayback()).  This is the key to
    // iOS Safari audio playback from async code.
    // If no primed element exists (e.g. browser doesn't need it), create one now.
    const audio = this.primedAudio ?? new Audio();
    this.primedAudio = null;
    this.currentAudio = audio;

    // Safety net — reset if nothing fires within 60 s.
    this.safetyTimer = setTimeout(() => {
      if (this.currentCallId !== callId) return;
      this.currentAudio = null;
      onEnd();
    }, 60_000);

    fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: voiceText }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`TTS responded ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (this.currentCallId !== callId) {
          // Superseded — discard blob
          URL.revokeObjectURL(URL.createObjectURL(blob));
          return;
        }

        const url = URL.createObjectURL(blob);

        // Load the blob into the already-unlocked audio element.
        audio.src = url;
        audio.load();

        audio.onended = () => {
          if (this.currentCallId !== callId) return;
          this.clearSafety();
          URL.revokeObjectURL(url);
          this.currentAudio = null;
          onEnd();
        };
        audio.onerror = () => {
          if (this.currentCallId !== callId) return;
          this.clearSafety();
          URL.revokeObjectURL(url);
          this.currentAudio = null;
          this.onFallback?.();
          this.fallback.speakText(voiceText, onEnd);
        };

        audio.play().catch(() => {
          if (this.currentCallId !== callId) return;
          this.clearSafety();
          URL.revokeObjectURL(url);
          this.currentAudio = null;
          this.onFallback?.();
          this.fallback.speakText(voiceText, onEnd);
        });
      })
      .catch(() => {
        if (this.currentCallId !== callId) return;
        this.clearSafety();
        this.currentAudio = null;
        this.onFallback?.();
        this.fallback.speakText(voiceText, onEnd);
      });
  }

  stopSpeaking(): void {
    this.clearSafety();
    // Invalidate any in-flight call
    this.currentCallId++;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
    }
    // Also discard any primed element
    if (this.primedAudio) {
      this.primedAudio.src = "";
      this.primedAudio = null;
    }
    this.fallback.stopSpeaking();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a voice provider.
 * elevenlabsAvailable should come from GET /api/voice/config
 * so the frontend knows whether the API key is configured server-side.
 * onFallback is called when ElevenLabsVoiceProvider falls back to browser TTS.
 */
export function createVoiceProvider(
  type: VoiceProviderType,
  elevenlabsAvailable: boolean,
  onFallback?: () => void,
): VoiceProvider {
  if (type === "elevenlabs" && elevenlabsAvailable) {
    return new ElevenLabsVoiceProvider(onFallback);
  }
  return new BrowserVoiceProvider();
}
