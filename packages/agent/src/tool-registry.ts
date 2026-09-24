/**
 * TOOL_REGISTRY
 *
 * Single source of truth for every MCP tool Arclio is authorised to call.
 * Both the stub planner and the Bedrock prompt use this list to constrain
 * which tools can appear in a Plan.  The validator also references it.
 *
 * To add a new tool: add it to ToolName in types.ts, then add its descriptor
 * here.  Nothing else needs updating to make it available for planning.
 */

import type { ToolName } from "./types.js";

export interface ToolDescriptor {
  name: ToolName;
  description: string;
  /** JSON-schema-style arg descriptors for the prompt */
  args: Record<
    string,
    { type: string; description: string; optional?: boolean }
  >;
}

export const TOOL_REGISTRY: ToolDescriptor[] = [
  {
    name: "get_today_calendar",
    description: "Retrieve all calendar events scheduled for today.",
    args: {},
  },
  {
    name: "get_pending_deliveries",
    description:
      "Retrieve deliveries that are pending or in transit (not yet received). " +
      "Optionally filter by vendor name or limit to today.",
    args: {
      vendor: {
        type: "string",
        description: "Optional vendor name substring to filter results.",
        optional: true,
      },
      includeToday: {
        type: "boolean",
        description: "Include deliveries expected today (default: true).",
        optional: true,
      },
    },
  },
  {
    name: "get_security_events",
    description: "Retrieve today's security event log.",
    args: {
      type: {
        type: "string",
        description:
          "Filter by event type: access_granted | access_denied | " +
          "visitor_sign_in | visitor_sign_out | door_alarm | " +
          "motion_detected | delivery_arrival | delivery_departed",
        optional: true,
      },
      location: {
        type: "string",
        description: "Filter by location substring (case-insensitive).",
        optional: true,
      },
      since: {
        type: "string",
        description: "Return only events at or after this time (HH:MM, 24-hour local).",
        optional: true,
      },
    },
  },
  {
    name: "mark_delivery_received",
    description:
      "Mark a delivery as received. Requires the delivery ID. " +
      "Optionally record who received it and any notes.",
    args: {
      deliveryId: {
        type: "string",
        description:
          'The delivery ID (e.g. del-001). Use "__resolve__" if unknown — ' +
          "the executor will look it up from a prior get_pending_deliveries result.",
      },
      receivedBy: {
        type: "string",
        description: "Email or name of the person confirming receipt.",
        optional: true,
      },
      notes: {
        type: "string",
        description: "Optional free-text notes about the delivery condition.",
        optional: true,
      },
    },
  },
  {
    name: "notify_procurement",
    description:
      "Send an internal notification to the procurement team. Returns a notification receipt.",
    args: {
      subject: { type: "string", description: "Notification subject line." },
      body: { type: "string", description: "Notification body text." },
      recipients: {
        type: "array",
        description:
          "List of recipient emails (defaults to [\"procurement@arclio.dev\"]).",
        optional: true,
      },
    },
  },
  {
    name: "get_recent_emails",
    description:
      "Retrieve the most recent emails from the inbox. Returns subject, sender, time, snippet, read status, and importance.",
    args: {
      limit: {
        type: "number",
        description: "Maximum number of emails to return (default: 10).",
        optional: true,
      },
    },
  },
  {
    name: "get_important_emails",
    description:
      "Retrieve unread or high-importance emails that may require the user's attention.",
    args: {},
  },
];

/** Fast lookup set used by the plan validator */
export const REGISTERED_TOOL_NAMES = new Set<string>(
  TOOL_REGISTRY.map((t) => t.name),
);
