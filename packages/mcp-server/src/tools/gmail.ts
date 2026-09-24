/**
 * Gmail tools (read-only demo)
 *
 * get_recent_emails     — returns the most recent emails
 * get_important_emails  — returns unread or high-importance emails
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EMAILS } from "../data/mock-data.js";
import type { EmailImportance } from "../data/mock-data.js";

function formatEmail(e: (typeof EMAILS)[number]) {
  return {
    id: e.id,
    subject: e.subject,
    from: e.from,
    receivedAt: new Date(e.receivedAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
    snippet: e.snippet,
    isRead: e.isRead,
    importance: e.importance,
    labels: e.labels,
  };
}

export function registerGmailTools(server: McpServer): void {
  // ------------------------------------------------------------------
  // get_recent_emails
  // ------------------------------------------------------------------
  server.tool(
    "get_recent_emails",
    "Retrieve the most recent emails from the inbox. Optionally limit the count.",
    {
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .default(10)
        .describe("Maximum number of emails to return (default: 10)"),
    },
    async ({ limit }) => {
      const sorted = [...EMAILS].sort(
        (a, b) =>
          new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
      );
      const emails = sorted.slice(0, limit).map(formatEmail);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: emails.length, emails }, null, 2),
          },
        ],
      };
    },
  );

  // ------------------------------------------------------------------
  // get_important_emails
  // ------------------------------------------------------------------
  server.tool(
    "get_important_emails",
    "Retrieve unread or high-importance emails that may require attention.",
    {},
    async () => {
      const important = EMAILS.filter(
        (e) => !e.isRead || e.importance === ("high" satisfies EmailImportance),
      ).sort(
        (a, b) =>
          new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
      );

      const emails = important.map(formatEmail);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: emails.length, emails }, null, 2),
          },
        ],
      };
    },
  );
}
