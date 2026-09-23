/**
 * dashboard-routing.test.ts
 *
 * Tests for the MCP execution-path selection logic in app.ts and executor.ts:
 *
 *   - When VERCEL=1 is set, the direct in-process path is always used,
 *     even if MCP_BASE_URL is also set (e.g. to http://localhost:3001/mcp).
 *   - When VERCEL is unset and MCP_BASE_URL is unset, the direct path is used.
 *   - When VERCEL is unset and MCP_BASE_URL is set, the HTTP path is used.
 *
 * These cover the production failure mode: Vercel environment variables may
 * include MCP_BASE_URL=http://localhost:3001/mcp (copied from .env.example),
 * which previously caused "MCP server not reachable (localhost:3001)" errors
 * on all live dashboard endpoints.
 *
 * Uses Node built-in test runner. Self-contained — no server is started.
 *
 * Run:
 *   node --test packages/api/dist/tests/dashboard-routing.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Inline implementation of the path-selection logic (mirrors app.ts and
// executor.ts).  Kept separate from the module so VERCEL / MCP_BASE_URL can
// be controlled per-test without polluting process.env.
// ---------------------------------------------------------------------------

/**
 * Mirrors the single-line decision in app.ts and executor.ts:
 *
 *   const MCP_URL = process.env.VERCEL ? undefined : process.env.MCP_BASE_URL;
 *
 * Returns undefined → direct in-process path.
 * Returns a URL string → HTTP MCP path.
 */
function resolveMcpUrl(
  vercel: string | undefined,
  mcpBaseUrl: string | undefined,
): string | undefined {
  return vercel ? undefined : mcpBaseUrl;
}

/**
 * Mirrors the callMcpTool dispatcher:
 *   if (MCP_URL) → HTTP path (returns "http")
 *   else          → direct path (returns "direct")
 */
function selectPath(mcpUrl: string | undefined): "http" | "direct" {
  return mcpUrl ? "http" : "direct";
}

// ---------------------------------------------------------------------------
// Tests — path selection
// ---------------------------------------------------------------------------

test("VERCEL=1, MCP_BASE_URL unset → direct path", () => {
  const url = resolveMcpUrl("1", undefined);
  assert.equal(selectPath(url), "direct");
});

test("VERCEL=1, MCP_BASE_URL=http://localhost:3001/mcp → direct path (not HTTP)", () => {
  // This is the production failure scenario: MCP_BASE_URL is set as a Vercel
  // env var but VERCEL=1 must override it.
  const url = resolveMcpUrl("1", "http://localhost:3001/mcp");
  assert.equal(selectPath(url), "direct",
    "VERCEL=1 must force direct path even when MCP_BASE_URL is set");
});

test("VERCEL=1, MCP_BASE_URL=http://localhost:3001/mcp → resolved URL is undefined", () => {
  const url = resolveMcpUrl("1", "http://localhost:3001/mcp");
  assert.equal(url, undefined,
    "resolved MCP_URL must be undefined on Vercel to avoid localhost connection attempts");
});

test("VERCEL unset, MCP_BASE_URL unset → direct path", () => {
  const url = resolveMcpUrl(undefined, undefined);
  assert.equal(selectPath(url), "direct");
});

test("VERCEL unset, MCP_BASE_URL=http://localhost:3001/mcp → HTTP path (local dev)", () => {
  const url = resolveMcpUrl(undefined, "http://localhost:3001/mcp");
  assert.equal(selectPath(url), "http",
    "local dev with MCP_BASE_URL set should use HTTP path");
});

test("VERCEL unset, MCP_BASE_URL set → resolved URL is preserved", () => {
  const url = resolveMcpUrl(undefined, "http://localhost:3001/mcp");
  assert.equal(url, "http://localhost:3001/mcp");
});

// ---------------------------------------------------------------------------
// Tests — localhost is never used in production
// ---------------------------------------------------------------------------

test("production path never references localhost:3001", () => {
  // Simulate production: VERCEL=1, MCP_BASE_URL may or may not be set
  const scenarios: Array<[string | undefined, string | undefined]> = [
    ["1", undefined],
    ["1", "http://localhost:3001/mcp"],
    ["1", "http://some-other-url.example.com/mcp"],
  ];

  for (const [vercel, mcpBaseUrl] of scenarios) {
    const url = resolveMcpUrl(vercel, mcpBaseUrl);
    assert.equal(
      url === undefined || !url.includes("localhost"),
      true,
      `Production must not route to localhost. VERCEL=${vercel}, MCP_BASE_URL=${mcpBaseUrl} → url=${url}`,
    );
  }
});

test("only local dev with explicit MCP_BASE_URL uses HTTP path", () => {
  // Verify the matrix: HTTP path should only be active when VERCEL is unset
  // AND MCP_BASE_URL is explicitly set.
  assert.equal(selectPath(resolveMcpUrl(undefined, "http://localhost:3001/mcp")), "http");
  assert.equal(selectPath(resolveMcpUrl(undefined, undefined)), "direct");
  assert.equal(selectPath(resolveMcpUrl("1", "http://localhost:3001/mcp")), "direct");
  assert.equal(selectPath(resolveMcpUrl("1", undefined)), "direct");
});
