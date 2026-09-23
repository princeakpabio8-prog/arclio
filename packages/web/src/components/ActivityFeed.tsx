import { useEffect, useState } from "react";
import type { ActivityItem, AgentResponse } from "../types.js";
import { api } from "../api.js";

interface Props {
  latestResponse: (AgentResponse & { query: string }) | null;
  refreshKey: number;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function iconType(type: string): "agent" | "delivery" | "alert" | "notify" | "default" {
  if (type === "agent_action")   return "agent";
  if (type === "delivery_arrival" || type === "delivery_departed") return "delivery";
  if (type === "security_alert") return "alert";
  if (type === "notification")   return "notify";
  return "default";
}

function typeTag(type: string): string {
  const map: Record<string, string> = {
    agent_action:       "Agent",
    delivery_arrival:   "Delivery",
    delivery_departed:  "Delivery",
    security_alert:     "Security",
    notification:       "Notification",
  };
  return map[type] ?? type;
}

function TimelineIcon({ kind }: { kind: ReturnType<typeof iconType> }) {
  if (kind === "agent") return (
    <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
  );
  if (kind === "delivery") return (
    <svg viewBox="0 0 24 24">
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
  if (kind === "alert") return (
    <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
  );
  if (kind === "notify") return (
    <svg viewBox="0 0 24 24">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /></svg>
  );
}

export function ActivityFeed({ latestResponse, refreshKey }: Props) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.activity()
      .then((d) => { setItems(d.activity); setLoading(false); })
      .catch(() => setLoading(false));
  }, [refreshKey]);

  const displayItems: Array<ActivityItem | { id: string; synthetic: true; summary: string; timestamp: string; type: string }> = [];

  if (latestResponse && (
    latestResponse.intent === "mark_received" ||
    latestResponse.intent === "office_briefing" ||
    latestResponse.intent === "delivery_status"
  )) {
    displayItems.push({
      id: "live-response",
      synthetic: true,
      summary: `Arclio: ${latestResponse.query}`,
      timestamp: new Date().toISOString(),
      type: "agent_action",
    });
  }

  displayItems.push(...items);

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-identity">
          <div className="card-icon">
            <svg viewBox="0 0 24 24">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div>
            <div className="card-title">Activity Timeline</div>
              <div className="card-subtitle">Live operational events</div>
          </div>
        </div>
        {!loading && (
          <span className="badge badge-neutral">{displayItems.length} events</span>
        )}
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="shimmer" style={{ width: "80%" }} />
          <div className="shimmer" style={{ width: "60%" }} />
          <div className="shimmer" style={{ width: "72%" }} />
        </div>
      ) : displayItems.length === 0 ? (
        <div className="empty-state">
          No activity recorded yet. Ask Arclio something and events will appear here.
        </div>
      ) : (
        <div className="timeline">
          {displayItems.map((item, i) => {
            const kind = iconType(item.type);
            return (
              <div
                key={item.id}
                className="timeline-item"
                style={{ animationDelay: `${i * 0.04}s` }}
              >
                <div className={`timeline-icon type-${kind}`}>
                  <TimelineIcon kind={kind} />
                </div>
                <div className="timeline-body">
                  <div className="timeline-summary">{item.summary}</div>
                  <div className="timeline-meta">
                    <span className="timeline-time">{fmtTime(item.timestamp)}</span>
                    <span className="timeline-type-tag">{typeTag(item.type)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card-demo-label">Demo workspace</div>
    </div>
  );
}
