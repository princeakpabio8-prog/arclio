import { useEffect, useState } from "react";

interface HealthData {
  status: string;
  service: string;
  version: string;
  mcpUrl: string;
}

export function ApiStatusBanner() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [failing, setFailing] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function check() {
      fetch("/health")
        .then((r) => r.json() as Promise<HealthData>)
        .then((h) => {
          setHealth(h);
          setFailing(h.status !== "ok");
          setVisible(h.status !== "ok");
        })
        .catch(() => {
          setHealth(null);
          setFailing(true);
          setVisible(true);
        });
    }

    check();
    const id = setInterval(check, 8000);
    return () => clearInterval(id);
  }, []);

  if (!visible || !failing) return null;

  return (
    <div className={`api-banner ${health ? "warning" : "error"}`}>
      <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "currentColor", fill: "none", strokeWidth: 2, flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      {health
        ? `API degraded — ${health.status}`
        : "API server not reachable — start with: npm run dev:api"
      }
    </div>
  );
}
