/**
 * Shared notification store.
 *
 * Two storage backends, selected automatically:
 *
 *   In-memory (default / production / Vercel)
 *     A module-level array.  Works in any environment with no filesystem
 *     dependency.  Shared within a single process — sufficient for the
 *     direct in-process path used in production, where appendNotification
 *     and readNotifications run in the same Node module instance.
 *
 *   File-backed (local dev — opt-in via ARCLIO_NOTIFY_FILE=1)
 *     Persists to <workspace-root>/.arclio-notifications.json so the
 *     standalone MCP server process and the API server process can share
 *     state across a process boundary.  Set MCP_BASE_URL and
 *     ARCLIO_NOTIFY_FILE=1 in .env to activate.
 *
 * Consumers:
 *   appendNotification  — called by notify_procurement (direct.ts / MCP tool)
 *   readNotifications   — called by /api/activity and /api/notifications
 *   clearNotifications  — used in tests / dev resets
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcurementNotification } from "./mock-data.js";

// ---------------------------------------------------------------------------
// In-memory backend (always present)
// ---------------------------------------------------------------------------

const _memStore: ProcurementNotification[] = [];

// ---------------------------------------------------------------------------
// File backend (local dev cross-process sharing — opt-in via ARCLIO_NOTIFY_FILE=1)
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
const FILE_PATH = join(__dir, "../../../../.arclio-notifications.json");

function fileReadAll(): ProcurementNotification[] {
  try {
    if (!existsSync(FILE_PATH)) return [];
    const raw = readFileSync(FILE_PATH, "utf-8").trim();
    if (!raw) return [];
    return JSON.parse(raw) as ProcurementNotification[];
  } catch {
    return [];
  }
}

function fileWriteAll(items: ProcurementNotification[]): void {
  try {
    writeFileSync(FILE_PATH, JSON.stringify(items, null, 2), "utf-8");
  } catch (err) {
    console.error("[notification-store] file write error:", err);
  }
}

// ---------------------------------------------------------------------------
// Backend selector
// ---------------------------------------------------------------------------

function useFile(): boolean {
  return Boolean(process.env.ARCLIO_NOTIFY_FILE);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append a new notification to the store.
 * Called by the notify_procurement tool (direct.ts and MCP server tool).
 */
export function appendNotification(n: ProcurementNotification): void {
  if (useFile()) {
    const existing = fileReadAll();
    existing.push(n);
    fileWriteAll(existing);
  } else {
    _memStore.push(n);
  }
}

/**
 * Read all notifications from the store.
 * Called by /api/activity and /api/notifications endpoints.
 */
export function readNotifications(): ProcurementNotification[] {
  if (useFile()) {
    return fileReadAll();
  }
  return [..._memStore];
}

/**
 * Clear all notifications.
 * Used in tests and dev resets.
 */
export function clearNotifications(): void {
  if (useFile()) {
    fileWriteAll([]);
  } else {
    _memStore.length = 0;
  }
}
