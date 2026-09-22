/**
 * Procurement page — premium delivery management view
 */

import { useEffect, useState } from "react";
import type { Delivery, ProcurementNotification } from "../types.js";
import { api } from "../api.js";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function Shimmer() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {[75, 55, 68, 50].map((w, i) => (
        <div key={i} className="shimmer" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export function ProcurementPage() {
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [notifications, setNotifications] = useState<ProcurementNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setDeliveries(null);
    setError(null);
    Promise.all([api.deliveries(), api.notifications()])
      .then(([d, n]) => {
        setDeliveries(d.deliveries);
        setNotifications(n.notifications);
      })
      .catch((e: Error) => setError(e.message));
  }, [refreshKey]);

  const pending   = deliveries?.filter((d) => d.status === "pending").length ?? 0;
  const inTransit = deliveries?.filter((d) => d.status === "in_transit").length ?? 0;
  const received  = deliveries?.filter((d) => d.status === "received" || d.status === "delivered").length ?? 0;

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Procurement</div>
          <div className="page-subtitle">Delivery tracking, purchase orders, and notifications</div>
        </div>
        <button className="action-btn" onClick={() => setRefreshKey((k) => k + 1)}>
          <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round" }}>
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        {[
          { label: "Pending", value: deliveries ? pending    : "—", color: "var(--blue)",  badge: "badge-blue" },
          { label: "In Transit", value: deliveries ? inTransit : "—", color: "var(--amber)", badge: "badge-amber" },
          { label: "Received", value: deliveries ? received  : "—", color: "var(--green)", badge: "badge-green" },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-tile">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Delivery table */}
      <div className="card" style={{ gap: 0, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border-light)" }}>
          <div className="card-identity">
            <div className="card-icon">
              <svg viewBox="0 0 24 24">
                <rect x="1" y="3" width="15" height="13" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
            </div>
            <div>
              <div className="card-title">All Deliveries</div>
              <div className="card-subtitle">
                {deliveries ? `${deliveries.length} total` : "Loading…"}
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="error-text" style={{ padding: "16px 24px" }}>{error}</div>
        ) : !deliveries ? (
          <div style={{ padding: "16px 24px" }}><Shimmer /></div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {["Vendor", "Description", "PO Number", "Tracking", "Expected", "Received At", "Received By", "Status"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deliveries.length === 0 && (
                  <tr><td colSpan={8} className="td-muted" style={{ padding: "16px 18px" }}>No deliveries on record.</td></tr>
                )}
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="td-vendor">{d.vendor}</td>
                    <td style={{ maxWidth: 220 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
                        {d.description}
                      </div>
                    </td>
                    <td className="td-mono">{d.poNumber}</td>
                    <td className="td-mono">{d.trackingNumber}</td>
                    <td className="td-muted">{d.expectedTimeWindow}</td>
                    <td className="td-muted">{fmtDate(d.receivedAt)}</td>
                    <td className="td-muted">{d.receivedBy ?? "—"}</td>
                    <td>
                      <span className={`delivery-chip chip-${d.status}`}>
                        {d.status.replace("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notification log */}
      <div className="card">
        <div className="card-header">
          <div className="card-identity">
            <div className="card-icon">
              <svg viewBox="0 0 24 24">
                <path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3z" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div>
              <div className="card-title">Procurement Notifications</div>
              <div className="card-subtitle">Sent by Arclio agent</div>
            </div>
          </div>
          {notifications && (
            <span className="badge badge-neutral">{notifications.length} total</span>
          )}
        </div>

        {!notifications ? (
          <Shimmer />
        ) : notifications.length === 0 ? (
          <div className="empty-state">
            No notifications sent yet. Ask Arclio to "mark a delivery as received and notify procurement."
          </div>
        ) : (
          <div className="timeline">
            {[...notifications].reverse().map((n) => (
              <div key={n.id} className="timeline-item">
                <div className="timeline-icon type-notify">
                  <svg viewBox="0 0 24 24">
                    <path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3z" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </div>
                <div className="timeline-body">
                  <div className="timeline-summary" style={{ fontWeight: 500 }}>{n.subject}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>{n.body}</div>
                  <div className="timeline-meta" style={{ marginTop: 4 }}>
                    <span className="timeline-time">{fmtDate(n.sentAt)}</span>
                    <span className="timeline-type-tag">To: {n.recipients.join(", ")}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
