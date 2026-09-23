import { useEffect, useState } from "react";
import type { CalendarEvent } from "../types.js";
import { api } from "../api.js";

function fmt(t: string) {
  const [h, m] = t.split(":").map(Number);
  const p = h! >= 12 ? "PM" : "AM";
  return `${h! % 12 || 12}:${String(m).padStart(2, "0")} ${p}`;
}

function Shimmer() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {[70, 55, 80, 50].map((w, i) => (
        <div key={i} className="shimmer" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export function CalendarCard() {
  const [data, setData] = useState<{ date: string; events: CalendarEvent[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.calendar().then(setData).catch(() => setError(true));
  }, []);

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-identity">
          <div className="card-icon">
            <svg viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div>
            <div className="card-title">Today's Schedule</div>
            <div className="card-subtitle">{data?.date ?? "Loading…"}</div>
          </div>
        </div>
        {data && (
          <span className="badge badge-neutral">{data.events.length} events</span>
        )}
      </div>

      {error ? (
        <div className="error-text">Could not load calendar</div>
      ) : !data ? (
        <Shimmer />
      ) : data.events.length === 0 ? (
        <div className="empty-state">No meetings scheduled for today.</div>
      ) : (
        <div className="event-list">
          {data.events.map((e) => (
            <div key={e.id} className="event-row">
              <div className="event-time-col">{fmt(e.start)}</div>
              <div className="event-dot" />
              <div className="event-body">
                <div className="event-title">{e.title}</div>
                {e.location && <div className="event-location">{e.location}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card-demo-label">Demo workspace</div>
    </div>
  );
}
