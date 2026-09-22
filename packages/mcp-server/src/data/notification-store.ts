/**
 * Shared notification store — file-backed, cross-process safe.
 *
 * The MCP server writes notifications here via appendNotification().
 * The API server reads them via readNotifications().
 * Both processes share the same file on disk so mutations are visible
 * across process boundaries immediately.
 *
 * File location: <workspace-root>/.arclio-notifications.json
 * Format: JSON array of ProcurementNotification objects.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcurementNotification } from "./mock-data.js";

// Resolve path relative to monorepo root (4 dirs up from src/data/)
const __dir = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dir, "../../../../.arclio-notifications.json");

function readAll(): ProcurementNotification[] {
  try {
    if (!existsSync(STORE_PATH)) return [];
    const raw = readFileSync(STORE_PATH, "utf-8").trim();
    if (!raw) return [];
    return JSON.parse(raw) as ProcurementNotification[];
  } catch {
    return [];
  }
}

function writeAll(items: ProcurementNotification[]): void {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(items, null, 2), "utf-8");
  } catch (err) {
    console.error("[notification-store] write error:", err);
  }
}

/**
 * Append a new notification to the shared store.
 * Called by notify_procurement tool inside the MCP server process.
 */
export function appendNotification(n: ProcurementNotification): void {
  const existing = readAll();
  existing.push(n);
  writeAll(existing);
}

/**
 * Read all notifications from the shared store.
 * Called by the API server's /api/activity and /api/notifications endpoints.
 */
export function readNotifications(): ProcurementNotification[] {
  return readAll();
}

/**
 * Clear all notifications (used in tests / dev resets).
 */
export function clearNotifications(): void {
  writeAll([]);
}
