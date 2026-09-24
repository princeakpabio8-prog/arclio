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
 *   business_briefing — "give me my business briefing" / broader daily snapshot
 *   office_briefing   — "what's happening at the office today"
 *   needs_attention   — "what needs my attention"
 *   waiting_on_me     — "is anything waiting on me" / pending approvals / comms
 *   follow_ups        — "what should I follow up on today"
 *   handle_approval   — "handle the procurement one" / approve/action a pending item
 *   set_reminder      — "remind me about X at Y time"
 *   mark_received     — "mark [vendor] delivery as received"
 *   delivery_status   — "is the [vendor] delivery here / arrived"
 *   calendar_only     — "what meetings do I have"
 *   security_only     — "show security events / alerts"
 *   unknown           — no intent matched (graceful fallback)
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
  // business_briefing — primary experience; broad operational snapshot
  // -----------------------------------------------------------------------
  {
    intent: "business_briefing",
    patterns: [
      /business.*briefing/i,
      /briefing.*business/i,
      /give me.*briefing/i,
      /my briefing/i,
      /morning.*briefing/i,
      /briefing.*morning/i,
      /daily.*update/i,
      /operational.*briefing/i,
      /operations.*briefing/i,
      /status.*briefing/i,
    ],
    build: () => [
      {
        tool: "get_today_calendar",
        args: {},
        reason: "Include today's meetings in the business briefing.",
      },
      {
        tool: "get_pending_deliveries",
        args: {},
        reason: "Include delivery status in the business briefing.",
      },
      {
        tool: "get_security_events",
        args: {},
        reason: "Include security events in the business briefing.",
      },
    ],
  },

  // -----------------------------------------------------------------------
  // needs_attention — what is most urgent across all systems
  // -----------------------------------------------------------------------
  {
    intent: "needs_attention",
    patterns: [
      /what.*needs.*attention/i,
      /needs.*my.*attention/i,
      // natural speech variations: "pay attention to", "deal with today", "requires attention"
      /pay.*attention/i,
      /attention.*to/i,
      /need.*deal.*with/i,
      /anything.*need.*deal/i,
      /anything.*need.*handle/i,
      /need.*to.*handle.*today/i,
      /what.*requires.*attention/i,
      /requires.*my.*attention/i,
      /what.*urgent/i,
      /what.*priority/i,
      /most.*important/i,
      /anything.*urgent/i,
      /what.*should.*focus/i,
      /what.*action/i,
      /action.*items/i,
    ],
    build: () => [
      {
        tool: "get_pending_deliveries",
        args: {},
        reason: "Check for deliveries that need attention.",
      },
      {
        tool: "get_today_calendar",
        args: {},
        reason: "Check for upcoming meetings that need preparation.",
      },
      {
        tool: "get_security_events",
        args: {},
        reason: "Check for security events requiring a response.",
      },
      {
        tool: "get_important_emails",
        args: {},
        reason: "Check for important or unread emails requiring action.",
      },
    ],
  },

  // -----------------------------------------------------------------------
  // waiting_on_me — pending approvals, replies, follow-throughs
  // -----------------------------------------------------------------------
  {
    intent: "waiting_on_me",
    patterns: [
      /waiting.*on.*me/i,
      /waiting.*for.*me/i,
      /anything.*waiting/i,
      /what.*waiting/i,
      /pending.*approval/i,
      /approval.*pending/i,
      /needs.*my.*approval/i,
      /my.*approval/i,
      /inbox.*waiting/i,
      /what.*outstanding/i,
      /outstanding.*items/i,
    ],
    build: () => [
      {
        tool: "get_pending_deliveries",
        args: {},
        reason: "Check for deliveries awaiting confirmation or sign-off.",
      },
    ],
  },

  // -----------------------------------------------------------------------
  // handle_approval — act on a pending procurement / approval item
  // -----------------------------------------------------------------------
  {
    intent: "handle_approval",
    patterns: [
      /handle.*procurement/i,
      /approve.*procurement/i,
      /procurement.*approve/i,
      /handle.*approval/i,
      /approve.*that/i,
      /action.*that/i,
      /deal.*with.*procurement/i,
      /sort.*procurement/i,
      /handle.*the.*one/i,
      /do.*the.*procurement/i,
    ],
    build: () => [
      {
        tool: "notify_procurement",
        args: {
          subject: "Procurement approval confirmed",
          body: "The pending procurement request has been reviewed and approved.",
          recipients: ["procurement@arclio.dev", "finance@arclio.dev"],
        },
        reason: "Send approval confirmation to the procurement and finance teams.",
      },
    ],
  },

  // -----------------------------------------------------------------------
  // follow_ups — what needs to be followed up today
  // -----------------------------------------------------------------------
  {
    intent: "follow_ups",
    patterns: [
      /follow.*up/i,
      /follow up/i,
      /what.*follow/i,
      /should.*follow/i,
      /items.*today/i,
      /anything.*due/i,
      /what.*due/i,
      /pending.*tasks/i,
      /tasks.*pending/i,
      /to.*do.*today/i,
      /remind.*me/i,
    ],
    build: () => [
      {
        tool: "get_pending_deliveries",
        args: {},
        reason: "Surface deliveries that may need a follow-up.",
      },
      {
        tool: "get_today_calendar",
        args: {},
        reason: "Surface upcoming meetings that need preparation.",
      },
    ],
  },

  // -----------------------------------------------------------------------
  // office_briefing  — "what's happening at the office today"
  // -----------------------------------------------------------------------
  {
    intent: "office_briefing",
    patterns: [
      /what.*(happening|going on).*(office|today)/i,
      /office.*briefing/i,
      /daily.*briefing/i,
      /briefing.*today/i,
      /what.*(happening|going on|scheduled|planned|\bon\b).*today/i,
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
      /handle.*acme.*delivery/i,
      /handle.*delivery/i,
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

  // -----------------------------------------------------------------------
  // inbox_important — "anything important in my inbox" / "what's in my email"
  // -----------------------------------------------------------------------
  {
    intent: "inbox_important",
    patterns: [
      /important.*inbox/i,
      /inbox.*important/i,
      /anything.*important.*email/i,
      /anything.*important.*inbox/i,
      /what.*important.*email/i,
      /important.*email/i,
      /email.*important/i,
      /urgent.*email/i,
      /email.*urgent/i,
      /unread.*email/i,
      /email.*unread/i,
      /what.*inbox/i,
      /check.*inbox/i,
      /anything.*inbox/i,
      /inbox.*today/i,
    ],
    build: () => [
      {
        tool: "get_important_emails",
        args: {},
        reason: "Retrieve unread or high-importance emails requiring attention.",
      },
    ],
  },

  // -----------------------------------------------------------------------
  // inbox_recent — "show me my recent emails" / "what emails did I get today"
  // -----------------------------------------------------------------------
  {
    intent: "inbox_recent",
    patterns: [
      /recent.*email/i,
      /email.*recent/i,
      /latest.*email/i,
      /email.*latest/i,
      /show.*email/i,
      /my.*email/i,
      /what.*email/i,
      /new.*email/i,
      /email.*today/i,
      /today.*email/i,
    ],
    build: () => [
      {
        tool: "get_recent_emails",
        args: {},
        reason: "Retrieve recent inbox emails.",
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
