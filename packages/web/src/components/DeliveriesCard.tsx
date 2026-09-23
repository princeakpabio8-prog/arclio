import { useEffect, useState } from "react";
import type { Delivery } from "../types.js";
import { api } from "../api.js";

function Shimmer() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {[80, 60, 70].map((w, i) => (
        <div key={i} className="shimmer" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

function statusLabel(status: Delivery["status"]): string {
  switch (status) {
    case "in_transit":  return "In transit";
    case "pending":     return "Pending";
    case "received":    return "Received";
    case "delivered":   return "Delivered";
  }
}

export function DeliveriesCard({ refreshKey }: { refreshKey: number }) {
  const [data, setData]       = useState<{ deliveries: Delivery[] } | null>(null);
  const [error, setError]     = useState(false);
  const [syncTime, setSyncTime] = useState<Date | null>(null);

  useEffect(() => {
    setData(null);
    setError(false);
    api.deliveries()
      .then((d) => { setData(d); setSyncTime(new Date()); })
      .catch(() => setError(true));
  }, [refreshKey]);

  const active = data?.deliveries.filter(
    (d) => d.status === "pending" || d.status === "in_transit",
  ) ?? [];
  const all = data?.deliveries ?? [];

  const syncLabel = syncTime
    ? syncTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    : null;

  return (
    <div className="card">
      <div className="card-header">
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
            <div className="card-title">Deliveries</div>
            <div className="card-subtitle">
              {syncLabel ? `Checked ${syncLabel}` : "Expected & in transit"}
            </div>
          </div>
        </div>
        {data && (
          <span className={`badge ${active.length > 0 ? "badge-amber" : "badge-green"}`}>
            {active.length > 0 ? `${active.length} active` : "All received"}
          </span>
        )}
      </div>

      {error ? (
        <div className="error-text">Could not load deliveries</div>
      ) : !data ? (
        <Shimmer />
      ) : (
        <div className="delivery-list">
          {all.length === 0 && (
            <div className="empty-state">No deliveries on record today.</div>
          )}
          {all.map((d) => (
            <div key={d.id} className="delivery-row">
              <div className="delivery-body">
                <div className="delivery-vendor">{d.vendor}</div>
                <div className="delivery-meta">
                  {d.expectedTimeWindow}
                  {d.receivedAt && (
                    <> · Received {new Date(d.receivedAt).toLocaleTimeString("en-US", {
                      hour: "numeric", minute: "2-digit", hour12: true,
                    })}</>
                  )}
                </div>
              </div>
              <span className={`delivery-chip chip-${d.status}`}>
                {statusLabel(d.status)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="card-demo-label">Demo workspace</div>
    </div>
  );
}
