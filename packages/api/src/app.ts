/**
 * Arclio Express app — shared between the dev server and Vercel serverless function.
 *
 * Exports the configured `app` without calling `app.listen()` so it can be
 * wrapped by serverless-http in the Vercel entry point.
 *
 * Endpoints:
 *   POST /api/agent          — run the agent pipeline
 *   GET  /api/dashboard      — combined snapshot for dashboard cards
 *   GET  /api/calendar       — today's calendar events
 *   GET  /api/deliveries     — all deliveries (live from MCP)
 *   GET  /api/security       — today's security events (live from MCP)
 *   GET  /api/activity       — recent Arclio actions (live from MCP)
 *   GET  /api/notifications  — procurement notifications from shared store
 *   GET  /health             — health check
 *
 * Voice endpoints (Alexa+ Simulator):
 *   GET  /api/voice/config   — returns { elevenlabsAvailable: boolean }
 *   POST /api/voice/tts      — proxies ElevenLabs TTS; falls back gracefully if unconfigured
 *
 * MCP strategy
 * ────────────
 * When MCP_BASE_URL is set (local dev: http://localhost:3001/mcp), the API
 * reaches the standalone MCP server over HTTP using JSON-RPC.
 *
 * When MCP_BASE_URL is NOT set (production / Vercel), the tool logic is called
 * directly in-process via @arclio/mcp-server/direct.  No HTTP round-trip, no
 * localhost dependency.  Vercel bundles the workspace package at build time.
 */

import express from "express";
import cors from "cors";

// ---------------------------------------------------------------------------
// MCP call strategy — HTTP (local dev) vs direct in-process (production)
// ---------------------------------------------------------------------------

const MCP_URL = process.env.MCP_BASE_URL; // undefined → use direct calls

// --- HTTP path (local dev only) -------------------------------------------

interface JsonRpcMsg {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

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
            try {
              reader.cancel().catch(() => {});
              return JSON.parse(d) as JsonRpcMsg;
            } catch { /* skip */ }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error("No JSON-RPC message in SSE stream");
}

async function mcpPost(
  url: string,
  body: JsonRpcMsg,
  sessionId?: string,
): Promise<{ msg: JsonRpcMsg; sessionId: string | null }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const returnedSession = res.headers.get("mcp-session-id");
  const ct = res.headers.get("content-type") ?? "";
  const msg = ct.includes("text/event-stream")
    ? await sseFirstMessage(res)
    : (await res.json()) as JsonRpcMsg;
  return { msg, sessionId: returnedSession };
}

async function callMcpToolHttp(url: string, tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
  let counter = 1;
  const { msg: initMsg, sessionId } = await mcpPost(url, {
    jsonrpc: "2.0",
    id: counter++,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "arclio-api", version: "0.1.0" },
    },
  });
  if (!sessionId || (initMsg as { error?: unknown }).error) {
    throw new Error("MCP initialize failed");
  }

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }).catch(() => {});

  const { msg: toolMsg } = await mcpPost(
    url,
    { jsonrpc: "2.0", id: counter++, method: "tools/call", params: { name: tool, arguments: args } },
    sessionId,
  );

  fetch(url, { method: "DELETE", headers: { "mcp-session-id": sessionId } }).catch(() => {});

  const result = (toolMsg as { result?: { content?: Array<{ type: string; text?: string }> } }).result;
  const text = result?.content?.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

// --- Direct path (production / Vercel) ------------------------------------

async function callMcpToolDirect(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const direct = await import("@arclio/mcp-server/direct");

  switch (tool) {
    case "get_today_calendar":
      return direct.getTodayCalendar();

    case "get_pending_deliveries":
      return direct.getPendingDeliveries({
        vendor: args.vendor as string | undefined,
        includeToday: args.includeToday as boolean | undefined,
      });

    case "get_security_events":
      return direct.getSecurityEvents({
        type: args.type as Parameters<typeof direct.getSecurityEvents>[0]["type"],
        location: args.location as string | undefined,
        since: args.since as string | undefined,
      });

    case "mark_delivery_received":
      return direct.markDeliveryReceived({
        deliveryId: args.deliveryId as string,
        receivedBy: args.receivedBy as string | undefined,
        notes: args.notes as string | undefined,
      });

    case "notify_procurement":
      return direct.notifyProcurement({
        subject: args.subject as string,
        body: args.body as string,
        recipients: args.recipients as string[] | undefined,
      });

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

// --- Unified dispatcher ---------------------------------------------------

async function callMcpTool(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (MCP_URL) {
    return callMcpToolHttp(MCP_URL, tool, args);
  }
  return callMcpToolDirect(tool, args);
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

export const app = express();

// Allow any origin in production (Vercel preview URLs are dynamic).
// Dev restricts to localhost ports.
const allowedOrigins =
  process.env.NODE_ENV === "production"
    ? true // all origins — Vercel preview URLs vary
    : ["http://localhost:5173", "http://localhost:4173"];

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "arclio-api",
    version: "0.1.0",
    mcpMode: MCP_URL ? "http" : "direct",
    mcpUrl: MCP_URL ?? "(direct in-process)",
  });
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
    // Dynamic import — works both in local dev (dist path) and in Vercel
    // bundled context where the workspace package is resolved by npm.
    const { runAgent } = await import("@arclio/agent");
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
          `Please start it with: npm run dev:server (expects ${MCP_URL ?? "direct"})`,
      });
    } else {
      res.status(500).json({ error: "Agent pipeline error: " + message });
    }
  }
});

// ---------------------------------------------------------------------------
// Helper: wrap MCP tool calls with 503 on connection failure
// ---------------------------------------------------------------------------

async function withMcp<T>(res: express.Response, fn: () => Promise<T>): Promise<void> {
  try {
    const data = await fn();
    res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const down = msg.includes("ECONNREFUSED") || msg.includes("fetch failed");
    console.error("[api] MCP query error:", err);
    res.status(down ? 503 : 500).json({
      error: down
        ? `MCP server not reachable (${MCP_URL ?? "direct"}). Start with: npm run dev:server`
        : "Data fetch error: " + msg,
    });
  }
}

// ---------------------------------------------------------------------------
// GET /api/calendar
// ---------------------------------------------------------------------------

app.get("/api/calendar", async (_req, res) => {
  await withMcp(res, async () => {
    const data = (await callMcpTool("get_today_calendar")) as {
      date: string;
      events: Array<{
        id: string;
        title: string;
        time: string;
        location: string;
        organizer: string;
        attendeeCount: number;
      }>;
    };
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
// GET /api/deliveries
// ---------------------------------------------------------------------------

app.get("/api/deliveries", async (_req, res) => {
  await withMcp(res, async () => {
    const data = (await callMcpTool("get_pending_deliveries", { includeToday: false })) as {
      count: number;
      deliveries: Array<{
        id: string;
        vendor: string;
        description: string;
        expectedDate: string;
        expectedTimeWindow: string;
        status: string;
        poNumber: string;
        trackingNumber: string;
      }>;
    };

    // Import DELIVERIES from the workspace package source so Vercel can bundle it.
    const { DELIVERIES } = await import("@arclio/mcp-server/direct");
    const received = DELIVERIES.filter(
      (d) => d.status === "received" || d.status === "delivered",
    );

    const all = [
      ...data.deliveries.map((d) => ({
        id: d.id,
        vendor: d.vendor,
        description: d.description,
        expectedDate: d.expectedDate,
        expectedTimeWindow: d.expectedTimeWindow,
        status: d.status,
        poNumber: d.poNumber,
        trackingNumber: d.trackingNumber,
        receivedAt: null,
        receivedBy: null,
      })),
      ...received.map((d) => ({
        id: d.id,
        vendor: d.vendor,
        description: d.description,
        expectedDate: d.expectedDate,
        expectedTimeWindow: d.expectedTimeWindow,
        status: d.status,
        poNumber: d.poNumber,
        trackingNumber: d.trackingNumber,
        receivedAt: d.receivedAt ?? null,
        receivedBy: d.receivedBy ?? null,
      })),
    ];

    return { deliveries: all };
  });
});

// ---------------------------------------------------------------------------
// GET /api/security
// ---------------------------------------------------------------------------

app.get("/api/security", async (_req, res) => {
  await withMcp(res, async () => {
    const data = (await callMcpTool("get_security_events")) as {
      count: number;
      events: Array<{
        id: string;
        timestamp: string;
        type: string;
        location: string;
        description: string;
        actor: string | null;
        cameraRef: string | null;
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
// GET /api/activity
// ---------------------------------------------------------------------------

app.get("/api/activity", async (_req, res) => {
  await withMcp(res, async () => {
    const secData = (await callMcpTool("get_security_events")) as {
      events: Array<{
        id: string;
        timestamp: string;
        type: string;
        description: string;
        location: string;
        actor: string | null;
      }>;
    };

    const items: Array<{ id: string; timestamp: string; type: string; summary: string }> = [];

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

    // readNotifications() safely returns [] if file does not exist (serverless-safe)
    const { readNotifications } = await import("@arclio/mcp-server/direct");
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
// GET /api/notifications
// ---------------------------------------------------------------------------

app.get("/api/notifications", async (_req, res) => {
  try {
    const { readNotifications } = await import("@arclio/mcp-server/direct");
    res.json({ notifications: readNotifications() });
  } catch (err) {
    console.error("[api] notifications read error:", err);
    res.status(500).json({ error: "Failed to read notifications" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/dashboard
// ---------------------------------------------------------------------------

app.get("/api/dashboard", async (_req, res) => {
  await withMcp(res, async () => {
    const [calData, delData, secData] = await Promise.all([
      callMcpTool("get_today_calendar") as Promise<{
        date: string;
        events: Array<{ id: string; title: string; time: string; location: string }>;
      }>,
      callMcpTool("get_pending_deliveries") as Promise<{
        deliveries: Array<{ id: string; vendor: string; status: string; expectedTimeWindow: string }>;
      }>,
      callMcpTool("get_security_events") as Promise<{
        events: Array<{
          id: string;
          timestamp: string;
          type: string;
          description: string;
          location: string;
        }>;
      }>,
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
        return {
          id: e.id,
          title: e.title,
          time: `${start?.trim()} – ${end?.trim()}`,
          location: e.location ?? null,
        };
      }),
      pendingDeliveries: delData.deliveries.slice(0, 5).map((d) => ({
        id: d.id,
        vendor: d.vendor,
        status: d.status,
        expectedTimeWindow: d.expectedTimeWindow,
      })),
      recentSecurity: secData.events
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 5),
    };
  });
});

// ---------------------------------------------------------------------------
// Voice endpoints — Alexa+ Simulator (ElevenLabs optional TTS proxy)
// ---------------------------------------------------------------------------

const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY  ?? "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "";
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5";

const elevenlabsAvailable = Boolean(ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID);

if (elevenlabsAvailable) {
  console.log(
    `[api] ElevenLabs TTS enabled (voice: ${ELEVENLABS_VOICE_ID}, model: ${ELEVENLABS_MODEL_ID})`,
  );
} else {
  console.log(
    "[api] ElevenLabs TTS not configured — set ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID to enable",
  );
}

app.get("/api/voice/config", (_req, res) => {
  res.json({ elevenlabsAvailable, provider: elevenlabsAvailable ? "elevenlabs" : "browser" });
});

app.post("/api/voice/tts", async (req, res) => {
  const { text } = req.body as { text?: string };

  if (!text || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  if (!elevenlabsAvailable) {
    res.status(503).json({ error: "ElevenLabs TTS is not configured on this server" });
    return;
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: ELEVENLABS_MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!upstream.ok) {
      const errBody = await upstream.text().catch(() => "");
      console.error(`[api] ElevenLabs TTS error ${upstream.status}: ${errBody}`);
      res.status(502).json({ error: `ElevenLabs returned ${upstream.status}` });
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "audio/mpeg";
    const audioBuffer = await upstream.arrayBuffer();

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", audioBuffer.byteLength);
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api] ElevenLabs TTS fetch error:", msg);
    res.status(502).json({ error: "ElevenLabs request failed: " + msg });
  }
});
