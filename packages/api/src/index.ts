/**
 * Arclio API Dev Server
 *
 * Thin wrapper around app.ts that calls app.listen() for local development.
 * The Express app logic lives in app.ts and is shared with the Vercel
 * serverless function at api/index.ts.
 *
 * Startup order:
 *   1. Verify agent dist exists (fails fast with a clear message if not built)
 *   2. Start Express
 *   3. On first /api/agent call, the agent initialises its provider singleton
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";

// Load .env from the monorepo root (two levels up from packages/api/src/)
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

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

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

import { app } from "./app.js";

const PORT = parseInt(process.env.API_PORT ?? "3002", 10);

app.listen(PORT, () => {
  const MCP_URL = process.env.MCP_BASE_URL ?? "http://localhost:3001/mcp";
  console.log(`[api] Arclio API server listening on http://localhost:${PORT}`);
  console.log(`[api] Health: http://localhost:${PORT}/health`);
  console.log(`[api] MCP server expected at: ${MCP_URL}`);
});
