/**
 * StubProvider — deterministic rule-based planner
 *
 * Implements LLMProvider using keyword/intent matching.
 * No LLM key required. Fully deterministic — safe for CI and demos.
 *
 * This is the default provider (ARCLIO_LLM_PROVIDER=stub).
 * Swap for BedrockProvider by setting ARCLIO_LLM_PROVIDER=bedrock.
 *
 * Intent taxonomy:
 *   office_briefing  — "what's happening today / at the office"
 *   mark_received    — "mark [vendor] delivery as received"
 *   delivery_status  — "is the [vendor] delivery here / arrived"
 *   calendar_only    — "what meetings do I have"
 *   security_only    — "show security events / alerts"
 *   unknown          — no intent matched (graceful fallback)
 */

import type { LLMProvider } from "../llm-provider.js";
import type { Plan, ToolCall } from "../types.js";

// ---------------------------------------------------------------------------
// Intent rules  (more-specific rules must appear before broader ones)
// ---------------------------------------------------------------------------

const INTENT_RULES: Array<{
  intent: string;
  patterns: RegExp[];
  build: (input: string) => ToolCall[];
}> = [
  // -----------------------------------------------------------------------
  // office_briefing
  // -----------------------------------------------------------------------
  {
    intent: "office_briefing",
    patterns: [
      /what.*(happening|going on).*(office|today)/i,
      /office.*briefing/i,
      /daily.*briefing/i,
      /briefing.*today/i,
      /what.*(happening|going on|scheduled|planned|on).*today/i,
      /today.*summary/i,
      /summary.*today/i,
    ],
    build: () => [
      {
        tool: "get_today_calendar",
        args: {},
        reason: "Retrieve today's scheduled meetings and events.",
      },
      {
        tool: "get_pending_deliveries",
        args: {},
        reason: "Check for any deliveries expected today.",
      },
      {
        tool: "get_security_events",
        args: {},
        reason: "Include relevant security events in the daily briefing.",
      },
    ],
  },

  // -----------------------------------------------------------------------
  // mark_received  — more specific than delivery_status, must come first
  // -----------------------------------------------------------------------
  {
    intent: "mark_received",
    patterns: [
      /mark.*delivery.*received/i,
      /mark.*received/i,
      /confirm.*receipt/i,
      /delivery.*received/i,
      /received.*delivery/i,
      /sign.*delivery/i,
    ],
    build: (input) => {
      const vendor = extractVendor(input);
      const steps: ToolCall[] = [
        {
          tool: "get_pending_deliveries",
          args: vendor ? { vendor } : {},
          reason: "Look up the delivery ID before marking it received.",
        },
        {
          tool: "mark_delivery_received",
          args: { deliveryId: "__resolve__", vendor: vendor ?? "" },
          reason: "Mark the identified delivery as received.",
        },
      ];

      if (/notify|notif|procurement/i.test(input)) {
        steps.push({
          tool: "notify_procurement",
          args: {
            subject: `Delivery received${vendor ? ` \u2014 ${titleCase(vendor)}` : ""}`,
            body: `The ${vendor ? titleCase(vendor) : "pending"} delivery has been marked as received.`,
          },
          reason: "Notify the procurement team as requested.",
        });
      }

      return steps;
    },
  },

  // -----------------------------------------------------------------------
  // delivery_status
  // -----------------------------------------------------------------------
  {
    intent: "delivery_status",
    patterns: [
      /is.*delivery.*(here|arrived|come)/i,
      /delivery.*arrived/i,
      /arrived.*delivery/i,
      /has.*delivery/i,
      /delivery.*status/i,
      /where.*delivery/i,
      /acme.*delivery/i,
      /delivery.*acme/i,
      /(techvault|cleanpro).*delivery/i,
      /delivery.*(techvault|cleanpro)/i,
    ],
    build: (input) => {
      const vendor = extractVendor(input);
      return [
        {
          tool: "get_pending_deliveries",
          args: vendor ? { vendor } : {},
          reason: vendor
            ? `Check delivery status for vendor: ${vendor}.`
            : "Check all pending deliveries.",
        },
        {
          tool: "get_security_events",
          args: { type: "delivery_arrival" },
          reason:
            "Correlate with security log to confirm whether a delivery vehicle arrived.",
        },
      ];
    },
  },

  // -----------------------------------------------------------------------
  // calendar_only
  // -----------------------------------------------------------------------
  {
    intent: "calendar_only",
    patterns: [
      /what meetings/i,
      /my calendar/i,
      /calendar today/i,
      /scheduled.*today/i,
      /today.*scheduled/i,
      /any meetings/i,
    ],
    build: () => [
      {
        tool: "get_today_calendar",
        args: {},
        reason: "Retrieve today's calendar events.",
      },
    ],
  },

  // -----------------------------------------------------------------------
  // security_only
  // -----------------------------------------------------------------------
  {
    intent: "security_only",
    patterns: [
      /security.*(events|alerts|log|incidents)/i,
      /(events|alerts|log|incidents).*security/i,
      /any.*alerts/i,
      /access.*log/i,
      /show.*security/i,
    ],
    build: () => [
      {
        tool: "get_security_events",
        args: {},
        reason: "Retrieve today's security event log.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// StubProvider
// ---------------------------------------------------------------------------

export class StubProvider implements LLMProvider {
  readonly name = "stub";

  async buildPlan(userInput: string): Promise<Plan> {
    const trimmed = userInput.trim();

    for (const rule of INTENT_RULES) {
      if (rule.patterns.some((p) => p.test(trimmed))) {
        return {
          userInput: trimmed,
          intent: rule.intent,
          steps: rule.build(trimmed),
        };
      }
    }

    return { userInput: trimmed, intent: "unknown", steps: [] };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KNOWN_VENDORS = ["acme", "techvault", "cleanpro"];

function extractVendor(input: string): string | undefined {
  const lower = input.toLowerCase();
  return KNOWN_VENDORS.find((v) => lower.includes(v));
}

function titleCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
