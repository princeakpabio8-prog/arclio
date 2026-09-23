/**
 * Reports page — operational summary
 */

import { useEffect, useState } from "react";
import type { ActivityItem, SecurityEvent } from "../types.js";
import { api } from "../api.js";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit",
  });
}

function Shimmer() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {[70, 55, 65].map((w, i) => (
        <div key={i} className="shimmer" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  access_granted:    "Access Granted",
  access_denied:     "Access Denied",
  visitor_sign_in:   "Visitor Sign In",
  visitor_sign_out:  "Visitor Sign Out",
  door_alarm:        "Door Alarm",
  motion_detected:   "Motion Detected",
  delivery_arrival:  "Delivery Arrival",
  delivery_departed: "Delivery Departed",
};

export function ReportsPage() {
  const [dashboard, setDashboard] = useState<{
    calendarCount: number;
    pendingDeliveryCount: number;
    securityAlertCount: number;
    date: string;
  } | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [security, setSecurity] = useState<SecurityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.dashboard(), api.activity(), api.security()])
      .then(([d, a, s]) => {
        setDashboard(d);
        setActivity(a.activity);
        setSecurity(s.events);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Security event type breakdown
  const secBreakdown: Record<string, number> = {};
  for (const e of security ?? []) {
    secBreakdown[e.type] = (secBreakdown[e.type] ?? 0) + 1;
  }
  const secEntries = Object.entries(secBreakdown).sort((a, b) => b[1] - a[1]);
  const secTotal = security?.length ?? 0;

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-subtitle">
            Operational summary — {dashboard?.date ?? "today"}
          </div>
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}

      {/* Key metrics */}
      <div className="stat-grid">
        {[
          {
            label: "Meetings Today",
            value: dashboard?.calendarCount ?? "—",
            sub: "on the schedule",
            color: "var(--brass)",
          },
          {
            label: "Pending Deliveries",
            value: dashboard?.pendingDeliveryCount ?? "—",
            sub: "awaiting receipt",
            color: (dashboard?.pendingDeliveryCount ?? 0) > 0 ? "var(--amber)" : "var(--green)",
          },
          {
            label: "Security Alerts",
            value: dashboard?.securityAlertCount ?? "—",
            sub: "today",
            color: (dashboard?.securityAlertCount ?? 0) > 0 ? "var(--red)" : "var(--green)",
          },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="stat-tile">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color }}>{value}</div>
            <div className="stat-sub">{sub}</div>
          </div>
        ))}
      </div>

      {/* Two-column content — stacks to single column on mobile */}
      <div className="reports-two-col">
        {/* Recent agent activity */}
        <div className="card">
          <div className="card-header">
            <div className="card-identity">
              <div className="card-icon">
                <svg viewBox="0 0 24 24">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <div>
                <div className="card-title">Agent Activity</div>
                <div className="card-subtitle">Recent Arclio actions</div>
              </div>
            </div>
          </div>
          {!activity ? <Shimmer /> : activity.length === 0 ? (
            <div className="empty-state">No agent activity recorded yet.</div>
          ) : (
            <div className="timeline">
              {activity.slice(0, 6).map((item) => (
                <div key={item.id} className="timeline-item">
                  <div className="timeline-icon type-agent">
                    <svg viewBox="0 0 24 24">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                  </div>
                  <div className="timeline-body">
                    <div className="timeline-summary">{item.summary}</div>
                    <div className="timeline-meta">
                      <span className="timeline-time">{fmtTime(item.timestamp)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Security event breakdown */}
        <div className="card">
          <div className="card-header">
            <div className="card-identity">
              <div className="card-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <div className="card-title">Security Breakdown</div>
                <div className="card-subtitle">Events by type — today</div>
              </div>
            </div>
            {security && <span className="badge badge-neutral">{secTotal} total</span>}
          </div>

          {!security ? <Shimmer /> : secEntries.length === 0 ? (
            <div className="empty-state">No security events today.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {secEntries.map(([type, count]) => {
                const pct = Math.round((count / Math.max(secTotal, 1)) * 100);
                const isAlert = type === "access_denied" || type === "door_alarm";
                return (
                  <div key={type}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 12.5, color: isAlert ? "var(--red)" : "var(--text-secondary)", fontWeight: isAlert ? 500 : 400 }}>
                        {EVENT_LABELS[type] ?? type}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{count}</span>
                    </div>
                    <div className="progress-bar">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${pct}%`,
                          background: isAlert ? "var(--red)" : "var(--brass)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delivery completion */}
      {dashboard && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <div className="card-title" style={{ marginBottom: 4 }}>Delivery Status</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {dashboard.pendingDeliveryCount === 0
                  ? "All expected deliveries have been received — no outstanding items."
                  : `${dashboard.pendingDeliveryCount} delivery${dashboard.pendingDeliveryCount !== 1 ? "ies" : ""} pending or in transit.`
                }
              </div>
            </div>
            <div style={{
              fontSize: 26,
              fontWeight: 700,
              color: dashboard.pendingDeliveryCount === 0 ? "var(--green)" : "var(--amber)",
              minWidth: 64,
              textAlign: "right",
              letterSpacing: "-0.02em",
            }}>
              {dashboard.pendingDeliveryCount === 0 ? "Done" : `${dashboard.pendingDeliveryCount} left`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
