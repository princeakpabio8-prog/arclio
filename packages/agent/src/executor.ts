/**
 * MCP tool executor
 *
 * Two execution paths — selected by MCP_BASE_URL env var:
 *
 *   HTTP (local dev)   MCP_BASE_URL=http://localhost:3001/mcp
 *     Connects to the standalone MCP server over Streamable HTTP / JSON-RPC.
 *
 *   Direct (production / Vercel)   MCP_BASE_URL not set
 *     Calls @arclio/mcp-server/direct functions in-process.
 *     No HTTP round-trip, no localhost dependency — Vercel bundles the
 *     workspace package at build time.
 *
 * Special runtime resolution:
 *   mark_delivery_received with deliveryId "__resolve__" will look up the
 *   actual delivery ID from a prior get_pending_deliveries result.
 */

import type { Plan, ToolCall, ToolResult, ToolName } from "./types.js";

const MCP_BASE_URL = process.env.MCP_BASE_URL; // undefined → use direct in-process path

// ---------------------------------------------------------------------------
// Low-level MCP JSON-RPC helpers
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

async function mcpPost(
  url: string,
  body: JsonRpcRequest,
  sessionId?: string,
): Promise<{ response: JsonRpcResponse; sessionId: string | null }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const returnedSessionId = res.headers.get("mcp-session-id");

  const contentType = res.headers.get("content-type") ?? "";

  // Streamable HTTP may return SSE for streaming responses; handle both
  let json: JsonRpcResponse;
  if (contentType.includes("text/event-stream")) {
    json = await parseSseResponse(res);
  } else {
    json = (await res.json()) as JsonRpcResponse;
  }

  return { response: json, sessionId: returnedSessionId };
}

/**
 * Read an SSE stream incrementally and return the first complete JSON-RPC
 * message found in a `data:` line.
 *
 * The MCP SDK keeps the SSE stream open indefinitely (with keep-alive frames),
 * so we MUST NOT use res.text() — that would block until the stream closes.
 * Instead we read chunks as they arrive, buffer partial lines, and return as
 * soon as we have one parseable JSON-RPC response.
 */
async function parseSseResponse(res: Response): Promise<JsonRpcResponse> {
  if (!res.body) {
    throw new Error("SSE response has no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process all complete lines in the buffer
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data && data !== "[DONE]") {
            try {
              const parsed = JSON.parse(data) as JsonRpcResponse;
              // Got a valid JSON-RPC message — stop reading the stream
              reader.cancel().catch(() => {});
              return parsed;
            } catch {
              // skip malformed data lines
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  throw new Error("No valid JSON-RPC message found in SSE stream.");
}

// ---------------------------------------------------------------------------
// MCP session bootstrap
// ---------------------------------------------------------------------------

interface McpSession {
  sessionId: string;
  nextId: () => number;
}

async function openSession(url: string): Promise<McpSession> {
  let counter = 1;
  const nextId = () => counter++;

  const initRequest: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: nextId(),
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "arclio-agent", version: "0.1.0" },
    },
  };

  const { response, sessionId } = await mcpPost(url, initRequest);

  if (response.error) {
    throw new Error(`MCP initialize failed: ${response.error.message}`);
  }
  if (!sessionId) {
    throw new Error("MCP server did not return a session ID.");
  }

  // Send initialized notification
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });

  return { sessionId, nextId };
}

async function closeSession(url: string, sessionId: string): Promise<void> {
  await fetch(url, {
    method: "DELETE",
    headers: { "mcp-session-id": sessionId },
  }).catch(() => {
    // Best-effort close — ignore errors
  });
}

// ---------------------------------------------------------------------------
// Execute a single tool call (HTTP path)
// ---------------------------------------------------------------------------

async function executeToolCall(
  url: string,
  session: McpSession,
  toolCall: ToolCall,
): Promise<ToolResult> {
  const { response } = await mcpPost(
    url,
    {
      jsonrpc: "2.0",
      id: session.nextId(),
      method: "tools/call",
      params: {
        name: toolCall.tool,
        arguments: toolCall.args,
      },
    },
    session.sessionId,
  );

  if (response.error) {
    return {
      tool: toolCall.tool,
      args: toolCall.args,
      raw: JSON.stringify(response.error),
      parsed: response.error,
      ok: false,
      error: response.error.message,
    };
  }

  // MCP tool results come back as { content: [{ type: "text", text: "..." }] }
  const result = response.result as {
    content?: Array<{ type: string; text?: string }>;
  };

  const rawText =
    result?.content?.find((c) => c.type === "text")?.text ?? "";

  let parsed: unknown = rawText;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // leave as string
  }

  return {
    tool: toolCall.tool,
    args: toolCall.args,
    raw: rawText,
    parsed,
    ok: true,
  };
}

// ---------------------------------------------------------------------------
// Runtime resolution of "__resolve__" delivery IDs
// ---------------------------------------------------------------------------

function resolveDeliveryId(
  step: ToolCall,
  priorResults: ToolResult[],
): ToolCall {
  if (
    step.tool !== "mark_delivery_received" ||
    step.args["deliveryId"] !== "__resolve__"
  ) {
    return step;
  }

  const vendor = (step.args["vendor"] as string | undefined)?.toLowerCase();

  // Find the most recent get_pending_deliveries result
  const deliveriesResult = [...priorResults]
    .reverse()
    .find((r) => r.tool === "get_pending_deliveries" && r.ok);

  if (!deliveriesResult) {
    return { ...step, args: { ...step.args, deliveryId: "__unresolved__" } };
  }

  const data = deliveriesResult.parsed as {
    deliveries?: Array<{ id: string; vendor: string; status: string }>;
  };

  const candidates = (data?.deliveries ?? []).filter(
    (d) =>
      d.status !== "received" &&
      (!vendor || d.vendor.toLowerCase().includes(vendor)),
  );

  if (candidates.length === 0) {
    return { ...step, args: { ...step.args, deliveryId: "__unresolved__" } };
  }

  const { vendor: _v, ...restArgs } = step.args;
  return {
    ...step,
    args: {
      ...restArgs,
      deliveryId: candidates[0]!.id,
    },
  };
}

// ---------------------------------------------------------------------------
// Direct in-process tool dispatch (production / Vercel — no MCP_BASE_URL)
// ---------------------------------------------------------------------------

async function executeToolCallDirect(toolCall: ToolCall): Promise<ToolResult> {
  try {
    const direct = await import("@arclio/mcp-server/direct");
    const args = toolCall.args;
    let data: unknown;

    switch (toolCall.tool as ToolName) {
      case "get_today_calendar":
        data = direct.getTodayCalendar();
        break;

      case "get_pending_deliveries":
        data = direct.getPendingDeliveries({
          vendor: args["vendor"] as string | undefined,
          includeToday: args["includeToday"] as boolean | undefined,
        });
        break;

      case "get_security_events":
        data = direct.getSecurityEvents({
          type: args["type"] as Parameters<typeof direct.getSecurityEvents>[0]["type"],
          location: args["location"] as string | undefined,
          since: args["since"] as string | undefined,
        });
        break;

      case "mark_delivery_received":
        data = direct.markDeliveryReceived({
          deliveryId: args["deliveryId"] as string,
          receivedBy: args["receivedBy"] as string | undefined,
          notes: args["notes"] as string | undefined,
        });
        break;

      case "notify_procurement":
        data = direct.notifyProcurement({
          subject: args["subject"] as string,
          body: args["body"] as string,
          recipients: args["recipients"] as string[] | undefined,
        });
        break;

      default:
        throw new Error(`Unknown tool: ${toolCall.tool}`);
    }

    const raw = JSON.stringify(data);
    return { tool: toolCall.tool, args: toolCall.args, raw, parsed: data, ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { tool: toolCall.tool, args: toolCall.args, raw: error, parsed: null, ok: false, error };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function executePlan(plan: Plan): Promise<ToolResult[]> {
  if (plan.steps.length === 0) return [];

  // ── Direct path (production / Vercel — MCP_BASE_URL not set) ─────────────
  if (!MCP_BASE_URL) {
    const results: ToolResult[] = [];
    for (const step of plan.steps) {
      const resolvedStep = resolveDeliveryId(step, results);
      results.push(await executeToolCallDirect(resolvedStep));
    }
    return results;
  }

  // ── HTTP path (local dev — MCP_BASE_URL is set) ───────────────────────────
  const url = MCP_BASE_URL;
  const session = await openSession(url);
  const results: ToolResult[] = [];

  try {
    for (const step of plan.steps) {
      const resolvedStep = resolveDeliveryId(step, results);
      const result = await executeToolCall(url, session, resolvedStep);
      results.push(result);
    }
  } finally {
    await closeSession(url, session.sessionId);
  }

  return results;
}
