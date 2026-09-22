/**
 * Security tools
 *
 * get_security_events — retrieve today's security log, with optional filters
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SECURITY_EVENTS } from "../data/mock-data.js";
import type { SecurityEventType } from "../data/mock-data.js";

const VALID_TYPES: SecurityEventType[] = [
  "access_granted",
  "access_denied",
  "visitor_sign_in",
  "visitor_sign_out",
  "door_alarm",
  "motion_detected",
  "delivery_arrival",
  "delivery_departed",
];

export function registerSecurityTools(server: McpServer): void {
  server.tool(
    "get_security_events",
    "Retrieve today's security event log. Can filter by event type or location substring.",
    {
      type: z
        .enum(VALID_TYPES as [SecurityEventType, ...SecurityEventType[]])
        .optional()
        .describe("Filter by event type"),
      location: z
        .string()
        .optional()
        .describe("Filter by location substring (case-insensitive)"),
      since: z
        .string()
        .optional()
        .describe(
          "Return only events at or after this time (HH:MM, 24-hour local)",
        ),
    },
    async ({ type, location, since }) => {
      let events = [...SECURITY_EVENTS];

      if (type) {
        events = events.filter((e) => e.type === type);
      }

      if (location) {
        const term = location.toLowerCase();
        events = events.filter((e) =>
          e.location.toLowerCase().includes(term),
        );
      }

      if (since) {
        const [hh, mm] = since.split(":").map(Number);
        const sinceMs = new Date();
        sinceMs.setHours(hh, mm ?? 0, 0, 0);
        events = events.filter(
          (e) => new Date(e.timestamp).getTime() >= sinceMs.getTime(),
        );
      }

      // Sort chronologically
      events.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                count: events.length,
                events: events.map((e) => ({
                  id: e.id,
                  timestamp: formatTime(e.timestamp),
                  type: e.type,
                  location: e.location,
                  description: e.description,
                  actor: e.actor ?? null,
                  cameraRef: e.cameraRef ?? null,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
