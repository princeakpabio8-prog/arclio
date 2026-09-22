import { useState, useRef, type KeyboardEvent } from "react";
import type { AgentResponse } from "../types.js";
import { api } from "../api.js";

interface Props {
  onResponse: (r: AgentResponse & { query: string }) => void;
  onLoading?: () => void;
  onError?: (err: Error) => void;
}

const SUGGESTIONS = [
  { label: "What's happening at the office today?", icon: "📋" },
  { label: "Is the Acme delivery here yet?", icon: "📦" },
  { label: "Mark the Acme delivery as received and notify procurement", icon: "✓" },
];

export function AgentInput({ onResponse, onLoading, onError }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    onLoading?.();
    try {
      const response = await api.agent(trimmed);
      onResponse({ ...response, query: trimmed });
      setQuery("");
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e.message);
      onError?.(e);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(query); }
  }

  return (
    <div className="command-section">
      {/* Input */}
      <div className="command-wrap">
        <span className="command-icon">
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          ref={inputRef}
          className="command-input"
          placeholder="Ask Arclio anything…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          disabled={loading}
          autoFocus
        />
        <button
          className="command-send"
          onClick={() => submit(query)}
          disabled={loading || !query.trim()}
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      {/* Suggestions */}
      <div className="command-suggestions">
        {SUGGESTIONS.map(({ label, icon }) => (
          <button
            key={label}
            className="suggestion-chip"
            onClick={() => submit(label)}
            disabled={loading}
          >
            <span style={{ fontSize: 11, opacity: 0.6 }}>{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="error-banner">
          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "currentColor", fill: "none", strokeWidth: 2, flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
