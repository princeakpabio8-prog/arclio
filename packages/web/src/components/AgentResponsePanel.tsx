import { useState, useEffect } from "react";
import type { AgentResponse } from "../types.js";
import {
  parseAgentAnswer,
  type ParsedBlock,
  type ProseBlock,
  type NumberedListBlock,
  type SectionsBlock,
  type ReceiptBlock,
  type SectionRow,
} from "../parse-agent-answer.js";

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

// ─── Stage progress icons ────────────────────────────────────────────────────

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

// ─── Section accent icons ────────────────────────────────────────────────────

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="rsp-section-svg">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8"  y1="2" x2="8"  y2="6" />
      <line x1="3"  y1="10" x2="21" y2="10" />
    </svg>
  );
}

function DeliveryIcon() {
  return (
    <svg viewBox="0 0 24 24" className="rsp-section-svg">
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5"  cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

function SecurityIcon() {
  return (
    <svg viewBox="0 0 24 24" className="rsp-section-svg">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function NotificationIcon() {
  return (
    <svg viewBox="0 0 24 24" className="rsp-section-svg">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="rsp-receipt-icon">
      <circle cx="12" cy="12" r="10" />
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

type SectionAccent = "calendar" | "delivery" | "security" | "notification" | "default";

function SectionIcon({ accent }: { accent: SectionAccent }) {
  switch (accent) {
    case "calendar":     return <CalendarIcon />;
    case "delivery":     return <DeliveryIcon />;
    case "security":     return <SecurityIcon />;
    case "notification": return <NotificationIcon />;
    default:             return (
      <svg viewBox="0 0 24 24" className="rsp-section-svg">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    );
  }
}

// ─── Block renderers ──────────────────────────────────────────────────────────

function ProseRenderer({ block }: { block: ProseBlock }) {
  return <p className="rsp-prose">{block.text}</p>;
}

function NumberedListRenderer({ block }: { block: NumberedListBlock }) {
  return (
    <div className="rsp-numlist">
      {block.heading && (
        <div className="rsp-numlist-heading">{block.heading}</div>
      )}
      <ol className="rsp-numlist-ol">
        {block.items.map((item, i) => (
          <li key={i} className="rsp-numlist-item">
            <span className="rsp-numlist-counter">{i + 1}</span>
            <span className="rsp-numlist-body">
              {item.label && (
                <span className="rsp-numlist-label">{item.label}</span>
              )}
              {item.label ? " — " : ""}
              {item.body}
            </span>
          </li>
        ))}
      </ol>
      {block.footer && (
        <div className="rsp-numlist-footer">{block.footer}</div>
      )}
    </div>
  );
}

function RowToneDot({ tone }: { tone: SectionRow["tone"] }) {
  return <span className={`rsp-row-dot rsp-row-dot--${tone}`} />;
}

function SectionsRenderer({ block }: { block: SectionsBlock }) {
  return (
    <div className="rsp-sections">
      {block.sections.map((section, si) => (
        <div key={si} className={`rsp-section rsp-section--${section.accent}`}>
          {section.title && (
            <div className="rsp-section-header">
              <span className={`rsp-section-icon rsp-section-icon--${section.accent}`}>
                <SectionIcon accent={section.accent} />
              </span>
              <span className="rsp-section-title">{section.title}</span>
            </div>
          )}
          {section.rows.length > 0 && (
            <ul className="rsp-section-rows">
              {section.rows.map((row, ri) => (
                <li key={ri} className="rsp-section-row">
                  <RowToneDot tone={row.tone} />
                  <span className="rsp-section-row-text">{row.text}</span>
                </li>
              ))}
            </ul>
          )}
          {section.footer && (
            <div className="rsp-section-footer">{section.footer}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function ReceiptRenderer({ block }: { block: ReceiptBlock }) {
  return (
    <div className="rsp-receipt">
      <div className="rsp-receipt-headline">
        <CheckCircleIcon />
        <span>{block.headline}</span>
      </div>
      {block.lines.length > 0 && (
        <ul className="rsp-receipt-lines">
          {block.lines.map((line, i) => (
            <li key={i} className={`rsp-receipt-line rsp-receipt-line--${line.tone}`}>
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BlockRenderer({ block }: { block: ParsedBlock }) {
  switch (block.kind) {
    case "prose":         return <ProseRenderer block={block} />;
    case "numbered-list": return <NumberedListRenderer block={block} />;
    case "sections":      return <SectionsRenderer block={block} />;
    case "receipt":       return <ReceiptRenderer block={block} />;
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

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

  // Subtle empty-state hint
  if (!loading && !response) {
    return (
      <div className="agent-panel-empty">
        What can I help you with today?
      </div>
    );
  }

  const stageIndex = STAGES.findIndex((s) => s.key === stage);
  const parsed = response && !loading ? parseAgentAnswer(response) : null;

  return (
    <div className="agent-panel">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="agent-panel-header">
        <div className="agent-panel-label">
          <div className={`agent-panel-label-dot${loading ? " pulsing" : ""}`} />
          Arclio
        </div>

        {parsed && (
          <span className={`agent-panel-status ${parsed.verification}`}>
            {parsed.verification === "passed"  && "✓ Verified"}
            {parsed.verification === "partial" && "⚠ Partial"}
            {parsed.verification === "failed"  && "✗ Failed"}
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

      {/* ── Loading: staged progress ────────────────────────────────────────── */}
      {loading && (
        <div className="agent-thinking">
          {STAGES.map((s, i) => {
            const isDone    = i < stageIndex;
            const isActive  = i === stageIndex;
            return (
              <div key={s.key} className={`agent-stage${isDone ? " done" : isActive ? " active" : ""}`}>
                <div className={`stage-icon${isDone ? " done" : isActive ? " active" : " pending"}`}>
                  {isDone   && <CheckIcon />}
                  {isActive && <ClockIcon />}
                  {!isDone && !isActive && <CircleIcon />}
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

      {/* ── Response body ───────────────────────────────────────────────────── */}
      {parsed && (
        <div className="agent-panel-body">
          {/* "You asked" pill */}
          <div className="agent-query">
            <strong>You asked:</strong> {parsed.query}
          </div>

          {/* Structured content block */}
          <div className="rsp-content">
            <BlockRenderer block={parsed.block} />
          </div>

          {/* Tool step chips */}
          {parsed.steps.length > 0 && (
            <div className="agent-step-list">
              {parsed.steps.map((step) => (
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
