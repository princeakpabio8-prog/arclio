import { useEffect, useState } from "react";
import type { SecurityEvent } from "../types.js";
import { api } from "../api.js";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

const ALERT_TYPES = new Set(["access_denied", "door_alarm"]);

function Shimmer() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {[90, 70, 80, 60].map((w, i) => (
        <div key={i} className="shimmer" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export function SecurityCard() {
  const [data, setData] = useState<{ events: SecurityEvent[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.security().then(setData).catch(() => setError(true));
  }, []);

  const events = (data?.events ?? []).slice(0, 7);
  const alertCount = (data?.events ?? []).filter((e) => ALERT_TYPES.has(e.type)).length;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-identity">
          <div className="card-icon">
            <svg viewBox="0 0 24 24">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <div className="card-title">Security Activity</div>
            <div className="card-subtitle">Today's events</div>
          </div>
        </div>
        {data && (
          <span className={`badge ${alertCount > 0 ? "badge-red" : "badge-green"}`}>
            {alertCount > 0 ? `${alertCount} alert${alertCount > 1 ? "s" : ""}` : "All clear"}
          </span>
        )}
      </div>

      {error ? (
        <div className="error-text">Could not load security events</div>
      ) : !data ? (
        <Shimmer />
      ) : (
        <div className="security-list">
          {events.length === 0 && (
            <div className="empty-state">No security events today. Everything looks clear.</div>
          )}
          {events.map((e) => {
            const isAlert = ALERT_TYPES.has(e.type);
            return (
              <div key={e.id} className="security-row">
                <div className={`security-indicator sec-${e.type}`} />
                <div className="security-desc">
                  <div className={`security-desc-text${isAlert ? " is-alert" : ""}`}>
                    {e.description}
                  </div>
                  <div className="security-desc-loc">{e.location}</div>
                </div>
                <div className="security-time">{fmtTime(e.timestamp)}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card-demo-label">Demo workspace</div>
    </div>
  );
}
