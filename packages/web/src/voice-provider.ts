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

  static isAvailable(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  private safetyTimer: ReturnType<typeof setTimeout> | null = null;
  // Text queued by speakText() while we wait for the unlock utterance to
  // start (or if primeForPlayback was not called, immediately).
  private queuedText: string | null = null;
  private queuedOnEnd: (() => void) | null = null;
  // Generation counter — incremented on every stopSpeaking() so stale
  // async callbacks know not to proceed.
  private gen = 0;
  // True once the engine has been unlocked by a synchronous gesture speak().
  private unlocked = false;

  /**
   * primeForPlayback — MUST be called synchronously inside the user-gesture
   * handler (button click / chip click / Enter key), BEFORE any await.
   *
   * iOS Safari and many Android browsers require that speechSynthesis.speak()
   * is called while the call stack is still inside a user-gesture event
   * handler. Calling speak() after an await, even one microtask tick later,
   * is treated as a non-gesture call and is silently blocked.
   *
   * Strategy: speak a single silent space character (" ") immediately inside
   * the gesture. This is instantly cancelled by speakText(), but the act of
   * calling speak() here unlocks the synthesis engine for the session.
   * The real utterance queued in speakText() then plays without restriction.
   */
  primeForPlayback(): void {
    if (!BrowserVoiceProvider.isAvailable()) return;

    // Cancel anything already in progress.
    window.speechSynthesis.cancel();

    // Eagerly load the voice list (iOS loads it lazily on first getVoices()).
    window.speechSynthesis.getVoices();

    // Speak a silent utterance synchronously inside the gesture call stack.
    // This is the unlock step. The utterance contains a single space so it
    // completes near-instantly; speakText() will cancel it and queue the
    // real text. The onstart callback is where we know the engine is live.
    const unlock = new SpeechSynthesisUtterance(" ");
    unlock.volume = 0; // silent
    unlock.rate   = 10; // finish as fast as possible

    unlock.onstart = () => {
      // Engine is live. If speakText() already queued text, speak it now.
      this.unlocked = true;
      this.flushQueue();
    };
    unlock.onend = () => {
      this.unlocked = true;
      this.flushQueue();
    };
    unlock.onerror = () => {
      // Even on error the engine accepted the call — treat as unlocked.
      this.unlocked = true;
      this.flushQueue();
    };

    this.unlocked = false;
    window.speechSynthesis.speak(unlock);
  }

  speakText(text: string, onEnd: () => void): void {
    if (!BrowserVoiceProvider.isAvailable()) { onEnd(); return; }

    this.clearSafetyTimer();
    const myGen = ++this.gen;

    // Wrap onEnd so it's only ever called once and guards the generation.
    const done = () => {
      if (this.gen !== myGen) return;
      this.clearSafetyTimer();
      this.queuedText  = null;
      this.queuedOnEnd = null;
      onEnd();
    };

    // If the engine is already unlocked (primeForPlayback's silent utterance
    // has started), cancel it and speak immediately.
    if (this.unlocked) {
      window.speechSynthesis.cancel();
      this.doSpeak(text, done, myGen);
      return;
    }

    // Engine not yet unlocked — queue the text. primeForPlayback's onstart/
    // onend callbacks will call flushQueue() once the engine is live.
    // Also set a fallback: if primeForPlayback() was never called (e.g. the
    // user submitted via Enter key on a non-iOS browser that doesn't enforce
    // the gesture requirement), just speak directly after one tick.
    this.queuedText  = text;
    this.queuedOnEnd = done;

    setTimeout(() => {
      if (this.gen !== myGen) return; // superseded
      if (this.queuedText === text) {
        // Still waiting — flush regardless (non-iOS desktop path).
        this.unlocked = true;
        this.flushQueue();
      }
    }, 50);
  }

  private flushQueue(): void {
    if (!this.queuedText || !this.queuedOnEnd) return;
    const text  = this.queuedText;
    const onEnd = this.queuedOnEnd;
    const myGen = this.gen;
    this.queuedText  = null;
    this.queuedOnEnd = null;

    window.speechSynthesis.cancel();
    this.doSpeak(text, onEnd, myGen);
  }

  private doSpeak(text: string, done: () => void, myGen: number): void {
    // Wait for voices to be available (iOS loads them lazily).
    const startSpeaking = () => {
      if (this.gen !== myGen) return;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend   = done;
      utterance.onerror = done;

      // Safety timer: mobile browsers often never fire onend.
      // ~130 wpm, floor 2 s, cap 30 s.
      const words = text.trim().split(/\s+/).length;
      const ms = Math.min(Math.max(Math.ceil((words / 130) * 60_000), 2_000), 30_000);
      this.safetyTimer = setTimeout(() => {
        if (this.gen !== myGen) return;
        done();
      }, ms);

      window.speechSynthesis.speak(utterance);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      startSpeaking();
    } else {
      const handler = () => {
        window.speechSynthesis.removeEventListener("voiceschanged", handler);
        if (this.gen === myGen) startSpeaking();
      };
      window.speechSynthesis.addEventListener("voiceschanged", handler);
      // Fallback if voiceschanged never fires.
      setTimeout(() => {
        window.speechSynthesis.removeEventListener("voiceschanged", handler);
        if (this.gen === myGen) startSpeaking();
      }, 500);
    }
  }

  private clearSafetyTimer(): void {
    if (this.safetyTimer) { clearTimeout(this.safetyTimer); this.safetyTimer = null; }
  }

  stopSpeaking(): void {
    this.gen++;
    this.queuedText  = null;
    this.queuedOnEnd = null;
    // Do NOT reset this.unlocked here. The unlock state reflects whether
    // speechSynthesis.speak() was called in the current gesture session.
    // Cancelling playback does not revoke the engine unlock.
    // primeForPlayback() always resets unlocked=false before re-running.
    this.clearSafetyTimer();
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
