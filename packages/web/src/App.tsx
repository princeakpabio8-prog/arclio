import { useState, useRef, useEffect } from "react";
import heroPoster from "./assets/hero.png";
import { Sidebar } from "./components/Sidebar.js";
import { AgentInput } from "./components/AgentInput.js";
import { AgentResponsePanel } from "./components/AgentResponsePanel.js";
import { CalendarCard } from "./components/CalendarCard.js";
import { DeliveriesCard } from "./components/DeliveriesCard.js";
import { SecurityCard } from "./components/SecurityCard.js";
import { ActivityFeed } from "./components/ActivityFeed.js";
import { ApiStatusBanner } from "./components/ApiStatusBanner.js";
import { ProcurementPage } from "./components/ProcurementPage.js";
import { ReportsPage } from "./components/ReportsPage.js";
import { SettingsPage } from "./components/SettingsPage.js";
import { AlexaSimulator } from "./components/AlexaSimulator.js";
import type { AgentResponse } from "./types.js";

const HERO_VIDEO = "/videos/ElevenLabs_video_creatify-aurora_2026-09-23T02_01_22.mp4";

type Page = "home" | "calendar" | "procurement" | "deliveries" | "security" | "reports" | "settings" | "alexa";

// ---------------------------------------------------------------------------
// HeroVideo — video hero with muted autoplay and opt-in audio
// ---------------------------------------------------------------------------

function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [hasAudio, setHasAudio] = useState(false);

  // Detect reduced-motion preference once on mount
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Probe for an audio track after the video metadata loads
  function handleMetadata() {
    const v = videoRef.current;
    if (!v) return;
    // HTMLVideoElement.audioTracks is non-standard but widely supported;
    // fall back to always showing the control if unavailable
    const tracks = (v as HTMLVideoElement & { audioTracks?: { length: number } }).audioTracks;
    setHasAudio(!tracks || tracks.length > 0);
  }

  // Keep the video element's muted property in sync with state.
  // Setting .muted directly is required because React's `muted` prop does not
  // update after mount (known React limitation with <video>).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    if (!muted) {
      v.play().catch(() => {
        // Browser blocked unmuted play — re-mute silently
        setMuted(true);
      });
    }
  }, [muted]);

  function toggleAudio() {
    setMuted((m) => !m);
  }

  return (
    <div className="hero-video-wrap" aria-label="Arclio product video">
      {prefersReducedMotion ? (
        /* Respect reduced-motion — show the poster still instead */
        <img
          src={heroPoster}
          alt="Arclio — AI orchestration for the real world"
          className="hero-video-poster-fallback"
        />
      ) : (
        <video
          ref={videoRef}
          className="hero-video"
          src={HERO_VIDEO}
          poster={heroPoster}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedMetadata={handleMetadata}
          aria-hidden="true"
        />
      )}

      {/* "Hear Arclio" audio toggle — only shown when a video is playing */}
      {!prefersReducedMotion && hasAudio && (
        <button
          className={`hero-audio-btn${muted ? "" : " hero-audio-btn--on"}`}
          onClick={toggleAudio}
          aria-label={muted ? "Enable video audio" : "Mute video audio"}
          title={muted ? "Hear Arclio" : "Mute"}
          type="button"
        >
          {muted ? (
            /* Speaker-off icon */
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            /* Speaker-on icon */
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
          <span>{muted ? "Hear Arclio" : "Mute"}</span>
        </button>
      )}
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function CalendarPage() {
  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="page-title">Calendar</div>
          <div className="page-subtitle">Today's schedule and upcoming events</div>
        </div>
      </div>
      <CalendarCard />
    </div>
  );
}

function DeliveriesPage({ refreshKey }: { refreshKey: number }) {
  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="page-title">Deliveries</div>
          <div className="page-subtitle">Track all expected and in-transit deliveries</div>
        </div>
      </div>
      <DeliveriesCard refreshKey={refreshKey} />
    </div>
  );
}

function SecurityPage() {
  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="page-title">Security</div>
          <div className="page-subtitle">Building access, alerts, and security events</div>
        </div>
      </div>
      <SecurityCard />
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [agentResponse, setAgentResponse] = useState<(AgentResponse & { query: string }) | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  function handleAgentResponse(r: AgentResponse & { query: string }) {
    setAgentResponse(r);
    setAgentLoading(false);
    if (r.intent === "mark_received") setRefreshKey((k) => k + 1);
  }

  function handleSubmit() {
    setAgentLoading(true);
    setAgentResponse(null);
  }

  function handleAgentError() {
    setAgentLoading(false);
  }

  function handleNavigate(p: Page) {
    setPage(p);
    setMobileNavOpen(false);
  }

  return (
    <>
      <ApiStatusBanner />
      <div className="app-shell">
        {/* Mobile backdrop — tapping closes the nav drawer */}
        {mobileNavOpen && (
          <div
            className="mobile-nav-backdrop open"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}

        <Sidebar
          active={page}
          onNavigate={handleNavigate}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
        />

        <main className="main-content">
          {/* ── Mobile top bar (hidden on desktop via CSS) ── */}
          <div className="mobile-topbar">
            <button
              className="mobile-menu-btn"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-label="Open navigation menu"
              aria-expanded={mobileNavOpen}
            >
              <svg viewBox="0 0 24 24">
                {mobileNavOpen ? (
                  /* X icon when open */
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  /* Hamburger icon */
                  <>
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </>
                )}
              </svg>
            </button>
            <div className="mobile-topbar-brand">
              <div className="mobile-topbar-logo">
                <svg viewBox="0 0 24 24">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              Arclio
            </div>
          </div>

          {/* ── HOME / COMMAND CENTER ── */}
          {page === "home" && (
            <>
              {/* Hero header */}
              <div className="home-hero">
                <div className="home-hero-content">
                  <div className="hero-greeting">{getGreeting()}, Prince</div>
                  <div className="hero-date">
                    {new Date().toLocaleDateString("en-US", {
                      weekday: "long", year: "numeric", month: "long", day: "numeric",
                    })}
                  </div>
                  <div className="hero-sub">
                    <strong>Ask Arclio.</strong> Approve. Done.
                  </div>
                </div>
                <HeroVideo />
              </div>

              {/* Command input */}
              <AgentInput
                onLoading={handleSubmit}
                onResponse={handleAgentResponse}
                onError={handleAgentError}
              />

              {/* Agent response */}
              <AgentResponsePanel response={agentResponse} loading={agentLoading} />

              {/* Dashboard cards */}
              <div className="dashboard-section">
                <div className="section-header">
                  <span className="section-title">Live Operations</span>
                </div>
                <div className="dashboard-grid">
                  <CalendarCard />
                  <DeliveriesCard refreshKey={refreshKey} />
                  <SecurityCard />
                </div>
              </div>

              {/* Activity timeline */}
              <div className="dashboard-section" style={{ paddingBottom: 48 }}>
                <div className="section-header">
                  <span className="section-title">Activity Timeline</span>
                </div>
                <ActivityFeed latestResponse={agentResponse} refreshKey={refreshKey} />
              </div>
            </>
          )}

          {page === "calendar"    && <CalendarPage />}
          {page === "procurement" && <ProcurementPage />}
          {page === "deliveries"  && <DeliveriesPage refreshKey={refreshKey} />}
          {page === "security"    && <SecurityPage />}
          {page === "reports"     && <ReportsPage />}
          {page === "settings"    && <SettingsPage />}
          {page === "alexa"       && (
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <AlexaSimulator />
            </div>
          )}
        </main>
      </div>
    </>
  );
}
