/**
 * Arclio API Server
 *
 * Thin HTTP bridge between the web UI and the Arclio agent pipeline.
 * Imports runAgent directly (same process) — no extra network hop.
 *
 * Data endpoints (/api/calendar, /api/deliveries, /api/security, /api/activity,
 * /api/dashboard) query the MCP server directly so they always reflect
 * live state — including mutations made by the agent (e.g. mark_delivery_received).
 *
 * Startup order:
 *   1. Verify agent dist exists (fails fast with a clear message if not built)
 *   2. Start Express
 *   3. On first /api/agent call, the agent initialises its provider singleton
 *
 * Endpoints:
 *   POST /api/agent          — run the agent with a user query
 *   GET  /api/dashboard      — combined snapshot for dashboard cards
 *   GET  /api/calendar       — today's calendar events
 *   GET  /api/deliveries     — all deliveries (live from MCP)
 *   GET  /api/security       — today's security events (live from MCP)
 *   GET  /api/activity       — recent Arclio actions (live from MCP)
 *   GET  /health             — health check
 */

import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { readNotifications } from "../../mcp-server/dist/data/notification-store.js";
// ---------------------------------------------------------------------------
// Pre-flight: confirm dependent packages are built
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
const agentDist = join(__dir, "../../agent/dist/agent.js");
const mcpDist   = join(__dir, "../../mcp-server/dist/data/mock-data.js");

if (!existsSync(agentDist)) {
  console.error(
    "[api] ERROR: agent dist not found at", agentDist,
    "\n       Run: npm run build --workspace=packages/agent",
  );
  process.exit(1);
}
if (!existsSync(mcpDist)) {
  console.error(
    "[api] ERROR: mcp-server dist not found at", mcpDist,
    "\n       Run: npm run build --workspace=packages/mcp-server",
  );
  process.exit(1);
}

// Dynamic imports AFTER pre-flight
const { runAgent } = await import("../../agent/dist/agent.js");

// ---------------------------------------------------------------------------
// MCP tool query helper
// Calls a single MCP tool and returns the parsed JSON result.
// Uses a fresh stateless session per call (lightweight — no side effects).
// ---------------------------------------------------------------------------

const MCP_URL = process.env.MCP_BASE_URL ?? "http://localhost:3001/mcp";

interface JsonRpcMsg { jsonrpc: "2.0"; id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown; }

async function sseFirstMessage(res: Response): Promise<JsonRpcMsg> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const d = line.slice(6).trim();
          if (d && d !== "[DONE]") {
            try { reader.cancel().catch(() => {}); return JSON.parse(d) as JsonRpcMsg; } catch { /* skip */ }
          }
        }
      }
    }
  } finally { reader.releaseLock(); }
  throw new Error("No JSON-RPC message in SSE stream");
}

async function mcpPost(body: JsonRpcMsg, sessionId?: string): Promise<{ msg: JsonRpcMsg; sessionId: string | null }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const returnedSession = res.headers.get("mcp-session-id");
  const ct = res.headers.get("content-type") ?? "";
  const msg = ct.includes("text/event-stream") ? await sseFirstMessage(res) : await res.json() as JsonRpcMsg;
  return { msg, sessionId: returnedSession };
}

async function callMcpTool(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
  // Initialize session
  let counter = 1;
  const { msg: initMsg, sessionId } = await mcpPost({
    jsonrpc: "2.0", id: counter++, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "arclio-api", version: "0.1.0" } },
  });
  if (!sessionId || (initMsg as { error?: unknown }).error) {
    throw new Error("MCP initialize failed");
  }

  // Send initialized notification (fire and forget)
  fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }).catch(() => {});

  // Call the tool
  const { msg: toolMsg } = await mcpPost({
    jsonrpc: "2.0", id: counter++, method: "tools/call",
    params: { name: tool, arguments: args },
  }, sessionId);

  // Close session
  fetch(MCP_URL, { method: "DELETE", headers: { "mcp-session-id": sessionId } }).catch(() => {});

  const result = (toolMsg as { result?: { content?: Array<{ type: string; text?: string }> } }).result;
  const text = result?.content?.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.API_PORT ?? "3002", 10);
const app = express();

app.use(cors({ origin: ["http://localhost:5173", "http://localhost:4173"] }));
app.use(express.json());

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "arclio-api", version: "0.1.0", mcpUrl: MCP_URL });
});

// ---------------------------------------------------------------------------
// POST /api/agent — run agent pipeline
// ---------------------------------------------------------------------------

app.post("/api/agent", async (req, res) => {
  const { query } = req.body as { query?: string };
  if (!query || typeof query !== "string" || !query.trim()) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  try {
    const response = await runAgent(query.trim());
    res.json({
      answer: response.answer,
      intent: response.intent,
      verification: response.verification.status,
      steps: response.results.map((r) => ({
        tool: r.tool,
        ok: r.ok,
        detail: r.error ?? null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isMcpDown =
      message.includes("ECONNREFUSED") ||
      message.includes("fetch failed") ||
      message.includes("connect");

    console.error("[api] agent error:", err);

    if (isMcpDown) {
      res.status(503).json({
        error:
          "The MCP server is not reachable. " +
          `Please start it with: npm run dev:server (expects ${MCP_URL})`,
      });
    } else {
      res.status(500).json({ error: "Agent pipeline error: " + message });
    }
  }
});

// ---------------------------------------------------------------------------
// Helper: wrap MCP tool calls with 503 on connection failure
// ---------------------------------------------------------------------------

async function withMcp<T>(
  res: express.Response,
  fn: () => Promise<T>,
): Promise<void> {
  try {
    const data = await fn();
    res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const down = msg.includes("ECONNREFUSED") || msg.includes("fetch failed");
    console.error("[api] MCP query error:", err);
    res.status(down ? 503 : 500).json({
      error: down
        ? `MCP server not reachable (${MCP_URL}). Start with: npm run dev:server`
        : "Data fetch error: " + msg,
    });
  }
}

// ---------------------------------------------------------------------------
// GET /api/calendar — live from MCP
// ---------------------------------------------------------------------------

app.get("/api/calendar", async (_req, res) => {
  await withMcp(res, async () => {
    const data = await callMcpTool("get_today_calendar") as {
      date: string;
      events: Array<{ id: string; title: string; time: string; location: string; organizer: string; attendeeCount: number }>;
    };
    // Expand time "HH:MM – HH:MM" back to start/end fields the UI expects
    return {
      date: data.date,
      events: data.events.map((e) => {
        const [start, end] = e.time.split(" – ");
        return {
          id: e.id,
          title: e.title,
          start: start?.trim() ?? "",
          end: end?.trim() ?? "",
          location: e.location ?? null,
          organizer: e.organizer,
          attendeeCount: e.attendeeCount,
        };
      }),
    };
  });
});

// ---------------------------------------------------------------------------
// GET /api/deliveries — live from MCP
// ---------------------------------------------------------------------------

app.get("/api/deliveries", async (_req, res) => {
  await withMcp(res, async () => {
    // Use includeToday:false to get all deliveries regardless of date
    const data = await callMcpTool("get_pending_deliveries", { includeToday: false }) as {
      count: number;
      deliveries: Array<{
        id: string; vendor: string; description: string;
        expectedDate: string; expectedTimeWindow: string;
        status: string; poNumber: string; trackingNumber: string;
      }>;
    };

    // Also import the static mock to get received deliveries (MCP tool only returns pending/in_transit)
    const { DELIVERIES } = await import("../../mcp-server/dist/data/mock-data.js");
    const received = DELIVERIES.filter((d) => d.status === "received" || d.status === "delivered");

    const all = [
      ...data.deliveries.map((d) => ({
        id: d.id, vendor: d.vendor, description: d.description,
        expectedDate: d.expectedDate, expectedTimeWindow: d.expectedTimeWindow,
        status: d.status, poNumber: d.poNumber, trackingNumber: d.trackingNumber,
        receivedAt: null, receivedBy: null,
      })),
      ...received.map((d) => ({
        id: d.id, vendor: d.vendor, description: d.description,
        expectedDate: d.expectedDate, expectedTimeWindow: d.expectedTimeWindow,
        status: d.status, poNumber: d.poNumber, trackingNumber: d.trackingNumber,
        receivedAt: d.receivedAt ?? null, receivedBy: d.receivedBy ?? null,
      })),
    ];

    return { deliveries: all };
  });
});

// ---------------------------------------------------------------------------
// GET /api/security — live from MCP
// ---------------------------------------------------------------------------

app.get("/api/security", async (_req, res) => {
  await withMcp(res, async () => {
    const data = await callMcpTool("get_security_events") as {
      count: number;
      events: Array<{
        id: string; timestamp: string; type: string;
        location: string; description: string; actor: string | null; cameraRef: string | null;
      }>;
    };
    return {
      events: data.events.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    };
  });
});

// ---------------------------------------------------------------------------
// GET /api/activity — derived from MCP security events + shared notification store
// ---------------------------------------------------------------------------

app.get("/api/activity", async (_req, res) => {
  await withMcp(res, async () => {
    const secData = await callMcpTool("get_security_events") as {
      events: Array<{ id: string; timestamp: string; type: string; description: string; location: string; actor: string | null }>;
    };

    const items: Array<{ id: string; timestamp: string; type: string; summary: string }> = [];

    // Delivery-related security events
    const deliveryEvents = secData.events.filter(
      (e) => e.type === "delivery_arrival" || e.type === "delivery_departed",
    );
    for (const e of deliveryEvents) {
      items.push({
        id: e.id,
        timestamp: e.timestamp,
        type: e.type,
        summary: e.description + (e.actor ? ` — ${e.actor}` : ""),
      });
    }

    // Access denied / door alarm alerts
    const alertEvents = secData.events.filter(
      (e) => e.type === "access_denied" || e.type === "door_alarm",
    );
    for (const e of alertEvents) {
      items.push({
        id: e.id,
        timestamp: e.timestamp,
        type: "security_alert",
        summary: `⚠ ${e.description} (${e.location})`,
      });
    }

    // Notifications from shared file store — visible across all processes
    for (const n of readNotifications()) {
      items.push({
        id: n.id,
        timestamp: n.sentAt,
        type: "notification",
        summary: `Arclio notified procurement — "${n.subject}"`,
      });
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return { activity: items };
  });
});

// ---------------------------------------------------------------------------
// GET /api/notifications — procurement notifications from shared file store
// ---------------------------------------------------------------------------

app.get("/api/notifications", (_req, res) => {
  try {
    res.json({ notifications: readNotifications() });
  } catch (err) {
    console.error("[api] notifications read error:", err);
    res.status(500).json({ error: "Failed to read notifications" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/dashboard — combined snapshot
// ---------------------------------------------------------------------------

app.get("/api/dashboard", async (_req, res) => {
  await withMcp(res, async () => {
    const [calData, delData, secData] = await Promise.all([
      callMcpTool("get_today_calendar") as Promise<{ date: string; events: Array<{ id: string; title: string; time: string; location: string }> }>,
      callMcpTool("get_pending_deliveries") as Promise<{ deliveries: Array<{ id: string; vendor: string; status: string; expectedTimeWindow: string }> }>,
      callMcpTool("get_security_events") as Promise<{ events: Array<{ id: string; timestamp: string; type: string; description: string; location: string }> }>,
    ]);

    const alerts = secData.events.filter(
      (e) => e.type === "access_denied" || e.type === "door_alarm",
    ).length;

    return {
      date: calData.date,
      calendarCount: calData.events.length,
      pendingDeliveryCount: delData.deliveries.length,
      securityAlertCount: alerts,
      upcomingEvents: calData.events.slice(0, 3).map((e) => {
        const [start, end] = e.time.split(" – ");
        return { id: e.id, title: e.title, time: `${start?.trim()} – ${end?.trim()}`, location: e.location ?? null };
      }),
      pendingDeliveries: delData.deliveries.slice(0, 5).map((d) => ({
        id: d.id, vendor: d.vendor, status: d.status, expectedTimeWindow: d.expectedTimeWindow,
      })),
      recentSecurity: secData.events
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 5),
    };
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[api] Arclio API server listening on http://localhost:${PORT}`);
  console.log(`[api] Health: http://localhost:${PORT}/health`);
  console.log(`[api] MCP server expected at: ${MCP_URL}`);
});

