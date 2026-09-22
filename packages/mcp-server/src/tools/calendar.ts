/**
 * Calendar tools
 *
 * get_today_calendar — returns today's scheduled events
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CALENDAR_EVENTS } from "../data/mock-data.js";

export function registerCalendarTools(server: McpServer): void {
  server.tool(
    "get_today_calendar",
    "Retrieve all calendar events scheduled for today.",
    {},
    async () => {
      const events = CALENDAR_EVENTS.map((e) => ({
        id: e.id,
        title: e.title,
        time: `${e.start} – ${e.end}`,
        location: e.location ?? "No location",
        organizer: e.organizer,
        attendeeCount: e.attendees.length,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ date: todayLabel(), events }, null, 2),
          },
        ],
      };
    },
  );
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
