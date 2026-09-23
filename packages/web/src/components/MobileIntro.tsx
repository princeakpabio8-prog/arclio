import { useRef, useState, useEffect } from "react";

const HERO_VIDEO = "/videos/ElevenLabs_video_creatify-aurora_2026-09-23T02_01_22.mp4";

interface Props {
  onGetStarted: () => void;
}

/**
 * First-visit mobile introduction.
 *
 * - Shows a full portrait video prominently
 * - Autoplays muted (respects browser policy)
 * - Plays ONCE then stops — no loop
 * - Replay button appears after video ends
 * - "Hear Arclio" button for intentional audio
 * - Respects prefers-reduced-motion
 * - "Get started" calls onGetStarted
 */
export function MobileIntro({ onGetStarted }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(true);
  const [hasAudio, setHasAudio] = useState(false);

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Detect audio track after metadata loads
  function handleMetadata() {
    const v = videoRef.current;
    if (!v) return;
    const tracks = (v as HTMLVideoElement & { audioTracks?: { length: number } }).audioTracks;
    setHasAudio(!tracks || tracks.length > 0);
  }

  // Sync muted state to DOM (React's muted prop is inert after mount)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    if (!muted) {
      v.play().catch(() => setMuted(true));
    }
  }, [muted]);

  function handleReplay() {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    setEnded(false);
    v.play().catch(() => {/* blocked — ok */});
  }

  function handleHearArclio() {
    setMuted(false);
  }

  return (
    <div className="mobile-intro" role="main" aria-label="Welcome to Arclio">
      {/* Brand wordmark */}
      <div className="mi-brand" aria-label="Arclio">
        <div className="mi-brand-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        </div>
        <span className="mi-brand-name">Arclio</span>
      </div>

      {/* Portrait video — the hero of this screen */}
      <div className="mi-video-frame" aria-label="Arclio product video">
        {prefersReducedMotion ? (
          <div className="mi-video-rm-placeholder" aria-label="Motion reduced — video paused">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="mi-video"
            src={HERO_VIDEO}
            autoPlay
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={handleMetadata}
            onEnded={() => setEnded(true)}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Controls row beneath the video */}
      {!prefersReducedMotion && (
        <div className="mi-controls" role="group" aria-label="Video controls">
          {ended ? (
            <button
              className="mi-ctrl-btn"
              onClick={handleReplay}
              type="button"
              aria-label="Replay video"
            >
              {/* Replay icon */}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 .49-4.68" />
              </svg>
              Replay
            </button>
          ) : null}

          {hasAudio && muted && (
            <button
              className="mi-ctrl-btn mi-ctrl-btn--audio"
              onClick={handleHearArclio}
              type="button"
              aria-label="Enable audio"
            >
              {/* Speaker-off icon */}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
              Hear Arclio
            </button>
          )}

          {hasAudio && !muted && (
            <button
              className="mi-ctrl-btn mi-ctrl-btn--audio mi-ctrl-btn--on"
              onClick={() => setMuted(true)}
              type="button"
              aria-label="Mute audio"
            >
              {/* Speaker-on icon */}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
              Mute
            </button>
          )}
        </div>
      )}

      {/* Tagline */}
      <p className="mi-tagline">
        Tell Arclio what you need.<br />
        It handles the busywork.
      </p>

      {/* CTA */}
      <button
        className="mi-cta"
        onClick={onGetStarted}
        type="button"
      >
        Get started
      </button>
    </div>
  );
}
