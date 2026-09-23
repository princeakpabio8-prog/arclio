import { useState } from "react";
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
import { MobileIntro } from "./components/MobileIntro.js";
import type { AgentResponse } from "./types.js";

const INTRO_SEEN_KEY = "arclio_intro_seen_v1";

type Page = "home" | "calendar" | "procurement" | "deliveries" | "security" | "reports" | "settings" | "alexa";

function hasSeenIntro(): boolean {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    // Private-browsing or storage unavailable — just skip silently
  }
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

  // Show intro on first visit — all viewports (desktop and mobile)
  const [showIntro, setShowIntro] = useState<boolean>(() => {
    return !hasSeenIntro();
  });

  function handleGetStarted() {
    markIntroSeen();
    setShowIntro(false);
  }

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

  // If the intro should be shown, render only the intro (full-screen)
  if (showIntro) {
    return <MobileIntro onGetStarted={handleGetStarted} />;
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
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
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
              {/* Hero header — text only, no video (intro was the welcome experience) */}
              <div className="home-hero">
                <div className="home-hero-content">
                  <div className="hero-greeting">{getGreeting()}, Prince</div>
                  <div className="hero-date">
                    {new Date().toLocaleDateString("en-US", {
                      weekday: "long", year: "numeric", month: "long", day: "numeric",
                    })}
                  </div>
                  {/* hero-sub hidden on mobile via CSS — already communicated by intro */}
                  <div className="hero-sub hero-sub--desktop">
                    <strong>Ask Arclio.</strong> Approve. Done.
                  </div>
                </div>
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
