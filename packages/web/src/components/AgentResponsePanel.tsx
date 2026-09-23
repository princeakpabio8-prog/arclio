import { useState, useEffect } from "react";
import type { AgentResponse } from "../types.js";

interface Props {
  response: (AgentResponse & { query: string }) | null;
  loading: boolean;
}

type Stage = "thinking" | "planning" | "executing" | "verifying" | "complete";

const STAGES: Array<{ key: Stage; label: string }> = [
  { key: "thinking",  label: "Reasoning about your request" },
  { key: "planning",  label: "Creating execution plan" },
  { key: "executing", label: "Running MCP tools" },
  { key: "verifying", label: "Verifying results" },
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

export function AgentResponsePanel({ response, loading }: Props) {
  const [stage, setStage] = useState<Stage>("thinking");

  useEffect(() => {
    if (!loading) { setStage("complete"); return; }
    setStage("thinking");
    const t1 = setTimeout(() => setStage("planning"),  600);
    const t2 = setTimeout(() => setStage("executing"), 1300);
    const t3 = setTimeout(() => setStage("verifying"), 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [loading]);

  // Subtle empty-state hint — compact, muted, not a full card
  if (!loading && !response) {
    return (
      <div className="agent-panel-empty">
        What can I help you with today?
      </div>
    );
  }

  const stageIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="agent-panel">
      {/* Header */}
      <div className="agent-panel-header">
        <div className="agent-panel-label">
          <div className={`agent-panel-label-dot${loading ? " pulsing" : ""}`} />
          Arclio
        </div>
        {response && !loading && (
          <span className={`agent-panel-status ${response.verification}`}>
            {response.verification === "passed"  && "✓ Verified"}
            {response.verification === "partial" && "⚠ Partial"}
            {response.verification === "failed"  && "✗ Failed"}
          </span>
        )}
        {loading && (
          <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            {stage === "thinking"  && "Reasoning…"}
            {stage === "planning"  && "Planning…"}
            {stage === "executing" && "Executing…"}
            {stage === "verifying" && "Verifying…"}
          </span>
        )}
      </div>

      {/* Thinking state — staged progress */}
      {loading && (
        <div className="agent-thinking">
          {STAGES.map((s, i) => {
            const isDone   = i < stageIndex;
            const isActive = i === stageIndex;
            const isPending= i > stageIndex;
            return (
              <div
                key={s.key}
                className={`agent-stage${isDone ? " done" : isActive ? " active" : ""}`}
              >
                <div className={`stage-icon${isDone ? " done" : isActive ? " active" : " pending"}`}>
                  {isDone   && <CheckIcon />}
                  {isActive && <ClockIcon />}
                  {isPending && <CircleIcon />}
                </div>
                <span>{s.label}</span>
                {isActive && (
                  <div className="stage-dots">
                    <span /><span /><span />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Response body */}
      {response && !loading && (
        <div className="agent-panel-body">
          <div className="agent-query">
            <strong>You asked:</strong> {response.query}
          </div>
          <div className="agent-answer">{response.answer}</div>

          {/* Step breakdown */}
          {response.steps.length > 0 && (
            <div className="agent-step-list">
              {response.steps.map((step) => (
                <span key={step.tool} className={`agent-step-chip ${step.ok ? "ok" : "fail"}`}>
                  {step.ok ? (
                    <svg viewBox="0 0 24 24" style={{ width: 10, height: 10, stroke: "currentColor", fill: "none", strokeWidth: 3, strokeLinecap: "round" }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" style={{ width: 10, height: 10, stroke: "currentColor", fill: "none", strokeWidth: 3, strokeLinecap: "round" }}>
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                  {step.tool}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
