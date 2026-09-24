/**
 * Shared types for the Arclio agent pipeline.
 *
 * Reason → Plan → Execute → Verify → Response
 */

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

export type ToolName =
  | "get_today_calendar"
  | "get_pending_deliveries"
  | "get_security_events"
  | "mark_delivery_received"
  | "notify_procurement"
  | "get_recent_emails"
  | "get_important_emails";

export interface ToolCall {
  tool: ToolName;
  /** Arguments to pass to the MCP tool */
  args: Record<string, unknown>;
  /** Human-readable reason this tool was included in the plan */
  reason: string;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface Plan {
  /** Original user input */
  userInput: string;
  /** Detected intent label */
  intent: string;
  /** Ordered list of tool calls to execute */
  steps: ToolCall[];
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ToolResult {
  tool: ToolName;
  args: Record<string, unknown>;
  /** Raw JSON string returned by the MCP tool */
  raw: string;
  /** Parsed JSON (if parseable) */
  parsed: unknown;
  /** True if the call succeeded at the transport level */
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type VerificationStatus = "passed" | "partial" | "failed";

export interface VerificationResult {
  status: VerificationStatus;
  /** Per-step findings */
  findings: Array<{
    tool: ToolName;
    ok: boolean;
    detail: string;
  }>;
}

// ---------------------------------------------------------------------------
// Agent response
// ---------------------------------------------------------------------------

export interface AgentResponse {
  userInput: string;
  intent: string;
  plan: Plan;
  results: ToolResult[];
  verification: VerificationResult;
  /** Final natural-language response to surface to the user */
  answer: string;
}
