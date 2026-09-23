/**
 * Settings page — system configuration and version information
 */

import { useEffect, useState } from "react";

interface HealthData {
  status: string;
  service: string;
  version: string;
  mcpUrl: string;
}

function StatusDot({ ok }: { ok: boolean | null }) {
  return (
    <span style={{
      display: "inline-block",
      width: 7,
      height: 7,
      borderRadius: "50%",
      background: ok === null ? "var(--text-muted)" : ok ? "var(--green)" : "var(--red)",
      marginRight: 8,
      verticalAlign: "middle",
      flexShrink: 0,
    }} />
  );
}

function SettingsRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-key">{label}</div>
      <div className="settings-val">{value}</div>
    </div>
  );
}

export function SettingsPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/health")
      .then((r) => r.json() as Promise<HealthData>)
      .then((h) => { setHealth(h); setChecking(false); })
      .catch(() => { setHealthError(true); setChecking(false); });
  }, []);

  const apiUp = health?.status === "ok";
  const statusText = checking ? "Checking…" : healthError ? "Not reachable" : `${health!.service} v${health!.version}`;

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">System configuration, service status, and version information</div>
        </div>
      </div>

      {/* System status */}
      <div className="card">
        <div className="card-header">
          <div className="card-identity">
            <div className="card-icon">
              <svg viewBox="0 0 24 24">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <div>
              <div className="card-title">System Status</div>
              <div className="card-subtitle">Live service health</div>
            </div>
          </div>
          <span className={`badge ${!checking && apiUp ? "badge-green" : healthError ? "badge-red" : "badge-amber"}`}>
            {checking ? "Checking…" : apiUp ? "Operational" : "Degraded"}
          </span>
        </div>

        <div>
          <SettingsRow label="API Server" value={
            <><StatusDot ok={checking ? null : apiUp} />{statusText}</>
          } />
          <SettingsRow label="MCP Server" value={
            <><StatusDot ok={checking ? null : apiUp} />
            {health ? (
              <span>
                {apiUp ? "Reachable" : "Not confirmed"}{" — "}
                <span className="code-pill">{health.mcpUrl}</span>
              </span>
            ) : "—"}</>
          } />
          <SettingsRow label="Agent Pipeline" value={
            <><StatusDot ok={checking ? null : apiUp} />
            {apiUp ? "Stub LLM provider (deterministic)" : checking ? "—" : "Unavailable"}</>
          } />
        </div>
      </div>

      {/* Configuration */}
      <div className="card">
        <div className="card-header">
          <div className="card-identity">
            <div className="card-icon">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </div>
            <div>
              <div className="card-title">Configuration</div>
              <div className="card-subtitle">Environment and provider settings</div>
            </div>
          </div>
        </div>

        <div>
          <SettingsRow label="LLM Provider" value={
            <span>
              <span className="code-pill">stub</span>
              <span style={{ marginLeft: 10, fontSize: 12.5, color: "var(--text-muted)" }}>
                Set <span className="code-pill">ARCLIO_LLM_PROVIDER=bedrock</span> for AWS Bedrock
              </span>
            </span>
          } />
          <SettingsRow label="MCP Transport" value="Streamable HTTP (SSE)" />
          <SettingsRow label="MCP URL" value={<span className="code-pill">{health?.mcpUrl ?? "http://localhost:3001/mcp"}</span>} />
          <SettingsRow label="API Port" value={<span className="code-pill">3002</span>} />
          <SettingsRow label="Web Dev Port" value={<span className="code-pill">5173</span>} />
          <SettingsRow label="Bedrock Model" value={<span className="code-pill">us.anthropic.claude-sonnet-4-5</span>} />
          <SettingsRow label="Bedrock Region" value={
            <span><span className="code-pill">us-east-1</span><span style={{ marginLeft: 8, color: "var(--text-muted)", fontSize: 12.5 }}>override via ARCLIO_BEDROCK_REGION</span></span>
          } />
        </div>
      </div>

      {/* About */}
      <div className="card">
        <div className="card-header">
          <div className="card-identity">
            <div className="card-icon">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div>
              <div className="card-title">About Arclio</div>
              <div className="card-subtitle">Version and platform information</div>
            </div>
          </div>
          <span className="badge badge-neutral">v0.1.0</span>
        </div>

        <div>
          <SettingsRow label="Product" value="Arclio — AI orchestration for the real world" />
          <SettingsRow label="Tagline" value="Ask. Approve. Done." />
          <SettingsRow label="Version" value={<><span className="code-pill">0.1.0</span><span style={{ marginLeft: 8, color: "var(--text-muted)", fontSize: 12.5 }}>Hackathon MVP</span></>} />
          <SettingsRow label="Stack" value="TypeScript · Node.js 20+ · React 19 · Vite 8 · MCP SDK 1.30" />
          <SettingsRow label="Architecture" value="User → LLM Planner → Plan → MCP Executor → Verify → Response" />
          <SettingsRow label="Hackathon" value="Amazon Developer Hackathon — Alexa+ track" />
        </div>
      </div>

      {/* Environment variables */}
      <div className="card" style={{ background: "var(--ivory)" }}>
        <div className="card-title" style={{ marginBottom: 14 }}>Environment Variables</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            ["ARCLIO_LLM_PROVIDER",      "stub",                   "stub | bedrock"],
            ["ARCLIO_BEDROCK_MODEL_ID",  "amazon.nova-lite-v1:0",  "Any AWS Bedrock model ID"],
            ["ARCLIO_BEDROCK_REGION",    "us-east-1",              "AWS region for Bedrock Runtime"],
            ["MCP_BASE_URL",             "http://localhost:3001/mcp","MCP server endpoint"],
            ["API_PORT",                 "3002",                   "API server port"],
            ["PORT",                     "3001",                   "MCP server port"],
          ].map(([key, def, desc]) => (
            <div key={key} style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span className="code-pill" style={{ minWidth: 200, flexShrink: 0 }}>{key}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 12.5, minWidth: 120, flexShrink: 0 }}>
                default: <span className="code-pill">{def}</span>
              </span>
              <span style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
