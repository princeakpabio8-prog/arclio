/**
 * Arclio MCP Server — Streamable HTTP transport
 *
 * Exposes all business tools over a single HTTP endpoint using the
 * Model Context Protocol Streamable HTTP transport. This transport is
 * compatible with Alexa+ and other remote MCP clients.
 *
 * POST /mcp  — JSON-RPC 2.0 request  → response (or SSE stream for notifications)
 * GET  /mcp  — SSE stream for server-sent notifications
 * DELETE /mcp — close a session
 *
 * Health check: GET /health
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";

import { registerCalendarTools } from "./tools/calendar.js";
import { registerGmailTools } from "./tools/gmail.js";
import { registerProcurementTools } from "./tools/procurement.js";
import { registerSecurityTools } from "./tools/security.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ---------------------------------------------------------------------------
// Session store — each client connection gets its own McpServer + transport
// ---------------------------------------------------------------------------
const sessions = new Map<
  string,
  { server: McpServer; transport: StreamableHTTPServerTransport }
>();

function createSession(): {
  id: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
} {
  const server = new McpServer({
    name: "arclio",
    version: "0.1.0",
  });

  registerCalendarTools(server);
  registerGmailTools(server);
  registerProcurementTools(server);
  registerSecurityTools(server);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      console.log(`[mcp] session initialised: ${sessionId}`);
    },
  });

  transport.onclose = () => {
    const id = transport.sessionId;
    if (id) {
      sessions.delete(id);
      console.log(`[mcp] session closed: ${id}`);
    }
  };

  server.connect(transport);

  return { id: "", server, transport };
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "arclio-mcp-server",
    version: "0.1.0",
    sessions: sessions.size,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// POST /mcp — handle JSON-RPC requests (and initialize new sessions)
// ---------------------------------------------------------------------------
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    if (sessionId && sessions.has(sessionId)) {
      // Existing session
      const { transport } = sessions.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session — must start with an InitializeRequest
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Must send an InitializeRequest to start a new session.",
        },
        id: null,
      });
      return;
    }

    const { server, transport } = createSession();

    // The transport assigns a session ID during initialize handling
    await transport.handleRequest(req, res, req.body);

    const assignedId = transport.sessionId;
    if (assignedId) {
      sessions.set(assignedId, { server, transport });
      console.log(`[mcp] new session registered: ${assignedId}`);
    }
  } catch (err) {
    console.error("[mcp] error handling POST /mcp:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// ---------------------------------------------------------------------------
// GET /mcp — SSE stream for server-sent notifications
// ---------------------------------------------------------------------------
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Unknown or missing session ID." });
    return;
  }

  const { transport } = sessions.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// ---------------------------------------------------------------------------
// DELETE /mcp — close a session
// ---------------------------------------------------------------------------
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !sessions.has(sessionId)) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  const { transport } = sessions.get(sessionId)!;
  await transport.handleRequest(req, res);
  sessions.delete(sessionId);
  console.log(`[mcp] session deleted: ${sessionId}`);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[mcp] Arclio MCP server listening on http://localhost:${PORT}`);
  console.log(`[mcp] Health: http://localhost:${PORT}/health`);
  console.log(`[mcp] Endpoint: http://localhost:${PORT}/mcp`);
});
