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
import type { AgentResponse } from "./types.js";

type Page = "home" | "calendar" | "procurement" | "deliveries" | "security" | "reports" | "settings";

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

  return (
    <>
      <ApiStatusBanner />
      <div className="app-shell">
        <Sidebar active={page} onNavigate={setPage} />

        <main className="main-content">
          {/* ── HOME / COMMAND CENTER ── */}
          {page === "home" && (
            <>
              {/* Hero header */}
              <div className="home-hero">
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
        </main>
      </div>
    </>
  );
}
