/**
 * Response synthesizer
 *
 * Takes verified tool results and produces a concise natural-language answer.
 * This is the final stage of the agent pipeline before the answer is returned
 * to the user (or spoken by Alexa+).
 *
 * When an LLM is added, replace this module's buildAnswer function with an
 * LLM call that receives the same structured inputs.
 */

import type { Plan, ToolResult, VerificationResult } from "./types.js";

export function buildAnswer(
  plan: Plan,
  results: ToolResult[],
  verification: VerificationResult,
): string {
  if (plan.intent === "unknown") {
    return (
      "I'm not sure what you're asking. " +
      "Try something like:\n" +
      '  \u2022 "What\'s happening at the office today?"\n' +
      '  \u2022 "Is the Acme delivery here yet?"\n' +
      '  \u2022 "Mark the Acme delivery as received and notify procurement."'
    );
  }

  if (verification.status === "failed") {
    return "I ran into an error completing that request. Please check that the MCP server is running and try again.";
  }

  switch (plan.intent) {
    case "office_briefing":
      return buildBriefing(results);
    case "delivery_status":
      return buildDeliveryStatus(results);
    case "mark_received":
      return buildMarkReceived(results);
    case "calendar_only":
      return buildCalendarOnly(results);
    case "security_only":
      return buildSecurityOnly(results);
    default:
      return "Done. Here's what I found:\n\n" + formatRawResults(results);
  }
}

// ---------------------------------------------------------------------------
// Intent-specific response builders
// ---------------------------------------------------------------------------

function buildBriefing(results: ToolResult[]): string {
  const parts: string[] = ["📋 **Office Briefing**\n"];

  const calResult = results.find((r) => r.tool === "get_today_calendar");
  if (calResult?.ok) {
    const data = calResult.parsed as {
      date?: string;
      events?: Array<{ title: string; time: string; location: string }>;
    };
    parts.push(`📅 **Calendar — ${data.date ?? "Today"}**`);
    if (!data.events?.length) {
      parts.push("  No meetings scheduled.");
    } else {
      data.events.forEach((e) => {
        parts.push(`  • ${e.time}  ${e.title}  (${e.location})`);
      });
    }
    parts.push("");
  }

  const delResult = results.find((r) => r.tool === "get_pending_deliveries");
  if (delResult?.ok) {
    const data = delResult.parsed as {
      deliveries?: Array<{
        vendor: string;
        description: string;
        expectedTimeWindow: string;
        status: string;
      }>;
    };
    parts.push("📦 **Pending Deliveries**");
    if (!data.deliveries?.length) {
      parts.push("  No deliveries expected today.");
    } else {
      data.deliveries.forEach((d) => {
        parts.push(
          `  • ${d.vendor} — ${d.description}  [${d.expectedTimeWindow}, status: ${d.status}]`,
        );
      });
    }
    parts.push("");
  }

  const secResult = results.find((r) => r.tool === "get_security_events");
  if (secResult?.ok) {
    const data = secResult.parsed as {
      events?: Array<{ type: string; timestamp: string; description: string; location: string }>;
    };
    parts.push("🔒 **Security Events**");
    const relevant = (data.events ?? []).filter(
      (e) =>
        e.type === "access_denied" ||
        e.type === "door_alarm" ||
        e.type === "delivery_arrival" ||
        e.type === "delivery_departed",
    );
    if (!relevant.length) {
      parts.push("  No notable security events.");
    } else {
      relevant.forEach((e) => {
        parts.push(`  • ${e.timestamp}  ${e.description}  (${e.location})`);
      });
    }
  }

  return parts.join("\n");
}

function buildDeliveryStatus(results: ToolResult[]): string {
  const delResult = results.find((r) => r.tool === "get_pending_deliveries");
  const secResult = results.find((r) => r.tool === "get_security_events");

  const deliveries = (
    (delResult?.parsed as { deliveries?: Array<{ vendor: string; status: string; expectedTimeWindow: string }> })
      ?.deliveries ?? []
  );
  const secEvents = (
    (secResult?.parsed as { events?: Array<{ type: string; description: string; timestamp: string }> })
      ?.events ?? []
  );

  const arrivals = secEvents.filter((e) => e.type === "delivery_arrival");
  const departed = secEvents.filter((e) => e.type === "delivery_departed");

  const parts: string[] = [];

  if (!deliveries.length) {
    parts.push("There are no pending deliveries matching your query.");
  } else {
    deliveries.forEach((d) => {
      parts.push(`📦 **${d.vendor}** — expected ${d.expectedTimeWindow} (status: ${d.status})`);
    });
  }

  if (arrivals.length) {
    parts.push("\n🔒 **Security log shows:**");
    arrivals.forEach((e) => {
      parts.push(`  • ${e.timestamp} — ${e.description}`);
    });
    if (departed.length) {
      departed.forEach((e) => {
        parts.push(`  • ${e.timestamp} — ${e.description}`);
      });
    }

    const deliveryNames = deliveries.map((d) => d.vendor).join(", ");
    if (departed.length) {
      parts.push(
        `\n✅ Based on security events, the delivery vehicle has arrived and departed. ${deliveryNames ? `The ${deliveryNames} delivery appears to have been completed.` : ""}`,
      );
    } else {
      parts.push(
        `\n⏳ A delivery vehicle was detected on-site. ${deliveryNames ? `The ${deliveryNames} delivery may currently be in progress.` : ""}`,
      );
    }
  } else if (deliveries.length) {
    parts.push(
      "\nNo delivery vehicle has been detected at the loading dock yet according to the security log.",
    );
  }

  return parts.join("\n");
}

function buildMarkReceived(results: ToolResult[]): string {
  const markResult = results.find((r) => r.tool === "mark_delivery_received");
  const notifyResult = results.find((r) => r.tool === "notify_procurement");
  const parts: string[] = [];

  if (!markResult) {
    return "I could not locate the delivery to mark as received.";
  }

  const data = markResult.parsed as Record<string, unknown>;
  if (!markResult.ok || data["success"] !== true) {
    const error =
      (data["error"] as string | undefined) ?? markResult.error ?? "Unknown error";
    return `Failed to mark the delivery as received: ${error}`;
  }

  const d = data["delivery"] as Record<string, unknown>;
  parts.push(
    `✅ **Delivery received** — ${d["vendor"] ?? ""} (${d["id"] ?? ""})`,
  );
  parts.push(`   Recorded at: ${d["receivedAt"] ?? "N/A"}`);
  parts.push(`   Received by: ${d["receivedBy"] ?? "N/A"}`);

  if (notifyResult?.ok) {
    const n = notifyResult.parsed as {
      notification?: { id: string; subject: string; recipients: string[] };
    };
    const notif = n?.notification;
    if (notif) {
      parts.push(
        `\n📨 Procurement notified (${notif.recipients.join(", ")}) — "${notif.subject}"`,
      );
    }
  } else if (notifyResult && !notifyResult.ok) {
    parts.push(
      `\n⚠️  Notification failed: ${notifyResult.error ?? "Unknown error"}`,
    );
  }

  return parts.join("\n");
}

function buildCalendarOnly(results: ToolResult[]): string {
  const result = results.find((r) => r.tool === "get_today_calendar");
  if (!result?.ok) return "Unable to retrieve calendar events.";

  const data = result.parsed as {
    date?: string;
    events?: Array<{ title: string; time: string; location: string; organizer: string }>;
  };

  const lines: string[] = [`📅 **Calendar — ${data.date ?? "Today"}**\n`];
  if (!data.events?.length) {
    lines.push("No meetings scheduled today.");
  } else {
    data.events.forEach((e) => {
      lines.push(`• ${e.time}  **${e.title}**`);
      lines.push(`  ${e.location}  (organised by ${e.organizer})`);
    });
  }
  return lines.join("\n");
}

function buildSecurityOnly(results: ToolResult[]): string {
  const result = results.find((r) => r.tool === "get_security_events");
  if (!result?.ok) return "Unable to retrieve security events.";

  const data = result.parsed as {
    events?: Array<{ type: string; timestamp: string; description: string; location: string; actor?: string }>;
  };

  const lines: string[] = [`🔒 **Security Events — Today** (${data.events?.length ?? 0} total)\n`];
  if (!data.events?.length) {
    lines.push("No security events recorded today.");
  } else {
    data.events.forEach((e) => {
      const actor = e.actor ? ` — ${e.actor}` : "";
      lines.push(`• ${e.timestamp}  [${e.type}]  ${e.description}${actor}`);
      lines.push(`  Location: ${e.location}`);
    });
  }
  return lines.join("\n");
}

function formatRawResults(results: ToolResult[]): string {
  return results
    .map((r) => `**${r.tool}**: ${r.ok ? r.raw : `ERROR — ${r.error}`}`)
    .join("\n\n");
}
