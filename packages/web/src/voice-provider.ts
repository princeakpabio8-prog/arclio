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

  speakText(text: string, onEnd: () => void): void {
    if (!BrowserVoiceProvider.isAvailable()) { onEnd(); return; }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend   = () => onEnd();
    utterance.onerror = () => onEnd();
    window.speechSynthesis.speak(utterance);
  }

  stopSpeaking(): void {
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
 */
export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly type = "elevenlabs" as const;

  private readonly fallback = new BrowserVoiceProvider();
  private currentAudio: HTMLAudioElement | null = null;
  private readonly onFallback: (() => void) | undefined;

  constructor(onFallback?: () => void) {
    this.onFallback = onFallback;
  }

  speakText(text: string, onEnd: () => void): void {
    const voiceText = text.length > MAX_ELEVENLABS_CHARS
      ? text.slice(0, MAX_ELEVENLABS_CHARS - 1) + "…"
      : text;

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
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.currentAudio = audio;

        audio.onended = () => {
          URL.revokeObjectURL(url);
          this.currentAudio = null;
          onEnd();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          this.currentAudio = null;
          // Degrade to browser TTS on playback error
          this.onFallback?.();
          this.fallback.speakText(voiceText, onEnd);
        };
        audio.play().catch(() => {
          URL.revokeObjectURL(url);
          this.currentAudio = null;
          this.onFallback?.();
          this.fallback.speakText(voiceText, onEnd);
        });
      })
      .catch(() => {
        // Network error or ElevenLabs failure — use browser TTS silently
        this.onFallback?.();
        this.fallback.speakText(voiceText, onEnd);
      });
  }

  stopSpeaking(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
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
