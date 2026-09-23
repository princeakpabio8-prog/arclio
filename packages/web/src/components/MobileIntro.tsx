import { useRef, useState } from "react";

const HERO_VIDEO = "/videos/ElevenLabs_video_creatify-aurora_2026-09-23T02_01_22.mp4";

interface Props {
  onGetStarted: () => void;
}

/**
 * First-visit introduction screen — shown on ALL viewports (desktop + mobile).
 *
 * Desktop: two-column layout (brand/tagline/CTA left, video right)
 * Mobile:  single column, vertically stacked
 *
 * Audio behaviour (iOS/mobile-safe):
 * - Video autoplays muted (browser policy compliance)
 * - "Hear Arclio" taps directly call video.muted = false + video.play()
 *   in the same synchronous gesture handler — the ONLY reliable pattern on iOS Safari
 * - Replay also restores audio if the user had previously enabled it
 * - No loop — stops at final frame
 * - Respects prefers-reduced-motion
 */
export function MobileIntro({ onGetStarted }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * "Hear Arclio" — called directly inside the click handler.
   * Mutating .muted and calling .play() SYNCHRONOUSLY inside a gesture
   * is the only reliable pattern on iOS Safari.
   * We do NOT use useEffect for audio.
   */
  function handleHearArclio() {
    const v = videoRef.current;
    if (!v) return;

    // If video has ended, restart from the beginning
    if (v.ended || v.currentTime >= v.duration - 0.1) {
      v.currentTime = 0;
      setEnded(false);
    }

    // Unlock audio synchronously inside the gesture handler (iOS requirement)
    v.muted = false;
    setAudioEnabled(true);

    v.play().catch(() => {
      // Autoplay with audio was blocked — fall back to muted
      v.muted = true;
      setAudioEnabled(false);
      v.play().catch(() => {/* silent */});
    });
  }

  function handleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    setAudioEnabled(false);
  }

  function handleReplay() {
    const v = videoRef.current;
    if (!v) return;

    v.currentTime = 0;
    setEnded(false);

    if (audioEnabled) {
      // Restore audio — synchronous inside gesture handler (iOS requirement)
      v.muted = false;
      v.play().catch(() => {
        v.muted = true;
        setAudioEnabled(false);
        v.play().catch(() => {/* silent */});
      });
    } else {
      v.muted = true;
      v.play().catch(() => {/* silent */});
    }
  }

  const videoSection = prefersReducedMotion ? (
    <div className="ai-video-rm-placeholder" aria-label="Motion reduced — video paused">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
      <p>Arclio</p>
    </div>
  ) : (
    <video
      ref={videoRef}
      className="ai-video"
      src={HERO_VIDEO}
      autoPlay
      muted
      playsInline
      preload="auto"
      onEnded={() => setEnded(true)}
      aria-hidden="true"
    />
  );

  const controlsSection = !prefersReducedMotion && (
    <div className="ai-controls" role="group" aria-label="Video controls">
      {ended && (
        <button
          className="ai-ctrl-btn"
          onClick={handleReplay}
          type="button"
          aria-label="Replay video"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 .49-4.68" />
          </svg>
          Replay
        </button>
      )}
      {!audioEnabled ? (
        <button
          className="ai-ctrl-btn ai-ctrl-btn--audio"
          onClick={handleHearArclio}
          type="button"
          aria-label="Enable audio — hear Arclio"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
          Hear Arclio
        </button>
      ) : (
        <button
          className="ai-ctrl-btn ai-ctrl-btn--audio ai-ctrl-btn--on"
          onClick={handleMute}
          type="button"
          aria-label="Mute audio"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
          Playing
        </button>
      )}
    </div>
  );

  return (
    <div className="arclio-intro" role="main" aria-label="Welcome to Arclio">
      {/*
       * Two-column grid on desktop (.ai-inner), single column on mobile.
       * CSS handles the responsive switch via media query.
       */}
      <div className="ai-inner">
        {/* Left column: brand, headline, tagline, controls, CTA */}
        <div className="ai-left">
          {/* Brand wordmark */}
          <div className="ai-brand" aria-label="Arclio">
            <div className="ai-brand-logo" aria-hidden="true">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <span className="ai-brand-name">Arclio</span>
          </div>

          {/* Desktop headline (hidden on mobile) */}
          <h1 className="ai-headline">
            Tell Arclio<br />
            what you need.<br />
            <strong>It handles<br />the busywork.</strong>
          </h1>

          {/* Controls — on desktop they live in the left column */}
          <div className="ai-controls-desktop">
            {controlsSection}
          </div>

          {/* Tagline — visible on both (desktop: below headline; mobile: below video) */}
          <p className="ai-tagline ai-tagline--desktop">
            The intelligent operations layer for your business.
          </p>

          {/* CTA — on desktop this is in the left column */}
          <button
            className="ai-cta ai-cta--desktop"
            onClick={onGetStarted}
            type="button"
          >
            Get Started
          </button>
        </div>

        {/* Right column: video */}
        <div className="ai-right">
          <div className="ai-video-frame" aria-label="Arclio product video">
            {videoSection}
          </div>

          {/* Controls + tagline + CTA — on mobile they live below the video */}
          <div className="ai-below-video">
            {controlsSection}
            <p className="ai-tagline ai-tagline--mobile">
              Tell Arclio what you need.<br />
              It handles the busywork.
            </p>
            <button
              className="ai-cta ai-cta--mobile"
              onClick={onGetStarted}
              type="button"
            >
              Get Started
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
