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
      "I'm not sure what you're asking. Try one of these:\n" +
      '  \u2022 "Give me my business briefing."\n' +
      '  \u2022 "What needs my attention?"\n' +
      '  \u2022 "Is anything waiting on me?"\n' +
      '  \u2022 "Handle the Acme delivery."\n' +
      '  \u2022 "Anything important in my inbox?"\n' +
      '  \u2022 "What should I follow up on today?"'
    );
  }

  if (verification.status === "failed") {
    return "I ran into an error completing that request. Please check that the MCP server is running and try again.";
  }

  switch (plan.intent) {
    case "business_briefing":
      return buildBusinessBriefing(results);
    case "needs_attention":
      return buildNeedsAttention(results);
    case "waiting_on_me":
      return buildWaitingOnMe(results);
    case "handle_approval":
      return buildHandleApproval(results);
    case "follow_ups":
      return buildFollowUps(results);
    case "office_briefing":
      return buildOfficeBriefing(results);
    case "delivery_status":
      return buildDeliveryStatus(results);
    case "mark_received":
      return buildMarkReceived(results);
    case "calendar_only":
      return buildCalendarOnly(results);
    case "security_only":
      return buildSecurityOnly(results);
    case "inbox_important":
      return buildInboxImportant(results);
    case "inbox_recent":
      return buildInboxRecent(results);
    default:
      return "Done. Here's what I found:\n\n" + formatRawResults(results);
  }
}

// ---------------------------------------------------------------------------
// Intent-specific response builders
// ---------------------------------------------------------------------------

/**
 * business_briefing — primary experience.
 * Concise, conversational, voice-friendly operational snapshot.
 */
function buildBusinessBriefing(results: ToolResult[]): string {
  const parts: string[] = [];

  // Calendar
  const calResult = results.find((r) => r.tool === "get_today_calendar");
  const calData = calResult?.ok
    ? (calResult.parsed as { events?: Array<{ title: string; time: string; location: string }> })
    : null;
  const meetings = calData?.events ?? [];

  // Deliveries
  const delResult = results.find((r) => r.tool === "get_pending_deliveries");
  const delData = delResult?.ok
    ? (delResult.parsed as { deliveries?: Array<{ vendor: string; status: string; expectedTimeWindow: string }> })
    : null;
  const deliveries = delData?.deliveries ?? [];
  const activeDeliveries = deliveries.filter(
    (d) => d.status === "in_transit" || d.status === "pending",
  );

  // Security
  const secResult = results.find((r) => r.tool === "get_security_events");
  const secData = secResult?.ok
    ? (secResult.parsed as { events?: Array<{ type: string; description: string }> })
    : null;
  const secAlerts = (secData?.events ?? []).filter(
    (e) => e.type === "access_denied" || e.type === "door_alarm",
  );

  // Build concise briefing
  // Calendar line
  if (meetings.length === 0) {
    parts.push("Your calendar is clear today.");
  } else if (meetings.length === 1) {
    parts.push(`You have one meeting today — ${meetings[0]!.title} at ${meetings[0]!.time}.`);
  } else {
    const first = meetings[0]!;
    parts.push(
      `You have ${meetings.length} meetings today, starting with ${first.title} at ${first.time}.`,
    );
  }

  // Deliveries line
  if (activeDeliveries.length === 1) {
    const d = activeDeliveries[0]!;
    parts.push(`The ${d.vendor} delivery is expected ${d.expectedTimeWindow}.`);
  } else if (activeDeliveries.length > 1) {
    const names = activeDeliveries.map((d) => d.vendor).join(" and ");
    parts.push(`${activeDeliveries.length} deliveries are expected today from ${names}.`);
  }

  // Mock comms / follow-ups — always present to demonstrate the broader layer
  parts.push(
    "Procurement has a pending approval waiting for your sign-off, and Finance has requested confirmation on the Q3 budget allocation.",
  );
  parts.push("You have two follow-ups due: a supplier check-in with Acme and preparation for this afternoon's Engineering Standup.");

  // Security line
  if (secAlerts.length > 0) {
    parts.push(
      `Security flagged ${secAlerts.length === 1 ? "one item" : `${secAlerts.length} items`} requiring your attention.`,
    );
  } else {
    parts.push("No outstanding security events.");
  }

  return parts.join(" ");
}

/**
 * needs_attention — most urgent items across all connected systems.
 */
function buildNeedsAttention(results: ToolResult[]): string {
  const items: string[] = [];

  // Deliveries needing action
  const delResult = results.find((r) => r.tool === "get_pending_deliveries");
  const deliveries = (
    (delResult?.parsed as { deliveries?: Array<{ vendor: string; status: string }> })
      ?.deliveries ?? []
  );
  const transit = deliveries.filter((d) => d.status === "in_transit");
  if (transit.length) {
    const names = transit.map((d) => d.vendor).join(", ");
    items.push(
      `${transit.length === 1 ? "A delivery" : `${transit.length} deliveries`} from ${names} ${transit.length === 1 ? "is" : "are"} in transit and may need sign-off`,
    );
  }

  // Upcoming meetings needing prep
  const calResult = results.find((r) => r.tool === "get_today_calendar");
  const meetings = (
    (calResult?.parsed as { events?: Array<{ title: string; time: string }> })?.events ?? []
  );
  if (meetings.length > 0) {
    const next = meetings[0]!;
    items.push(`Your ${next.title} is coming up at ${next.time} — you may want to prepare`);
  }

  // Security alerts
  const secResult = results.find((r) => r.tool === "get_security_events");
  const secAlerts = (
    (secResult?.parsed as { events?: Array<{ type: string }> })?.events ?? []
  ).filter((e) => e.type === "access_denied" || e.type === "door_alarm");
  if (secAlerts.length > 0) {
    items.push(
      `${secAlerts.length === 1 ? "One security alert requires" : `${secAlerts.length} security alerts require`} your review`,
    );
  }

  // Live email data
  const emailResult = results.find((r) => r.tool === "get_important_emails");
  const emails = (
    (emailResult?.parsed as { emails?: Array<{ subject: string; from: string; isRead: boolean }> })?.emails ?? []
  );
  const unreadEmails = emails.filter((e) => !e.isRead);
  if (unreadEmails.length > 0) {
    items.push(
      `You have ${unreadEmails.length} unread email${unreadEmails.length !== 1 ? "s" : ""} requiring attention — including "${unreadEmails[0]!.subject}"`,
    );
  }

  // Mock comms fallback if no email data available
  if (!emailResult?.ok) {
    items.push("Procurement is waiting for your approval on the TechVault laptop order");
    items.push("Finance has requested confirmation on the Q3 budget allocation");
  }

  if (items.length === 0) {
    return "Everything looks clear. No urgent items across your connected systems.";
  }

  const lines = items.map((item, i) => `  ${i + 1}. ${item}.`).join("\n");
  return `Here's what needs your attention:\n\n${lines}`;
}

/**
 * waiting_on_me — pending approvals, replies, and sign-offs.
 */
function buildWaitingOnMe(results: ToolResult[]): string {
  const parts: string[] = [];

  // Check for deliveries awaiting receipt confirmation
  const delResult = results.find((r) => r.tool === "get_pending_deliveries");
  const deliveries = (
    (delResult?.parsed as { deliveries?: Array<{ vendor: string; status: string }> })
      ?.deliveries ?? []
  ).filter((d) => d.status === "in_transit");

  const waitingItems: string[] = [];

  // Mock business comms — the core of this intent
  waitingItems.push("📋 **Procurement approval** — TechVault laptop order (PO-2024-0201) is waiting for your sign-off before it can be dispatched to the vendor.");
  waitingItems.push("💰 **Finance confirmation** — Q3 budget allocation requires your review and confirmation by end of business today.");

  if (deliveries.length > 0) {
    const d = deliveries[0]!;
    waitingItems.push(`📦 **Delivery receipt** — The ${d.vendor} delivery has arrived and is waiting for someone to sign it off.`);
  }

  waitingItems.push("📧 **Supplier reply** — Acme Corp sent a revised quote for Q4 supplies. They're waiting for your response before the deadline tomorrow.");

  parts.push(`You have ${waitingItems.length} items waiting on you:\n`);
  waitingItems.forEach((item, i) => {
    parts.push(`${i + 1}. ${item}`);
  });
  parts.push('\nSay "Handle the procurement one" to action it now.');

  return parts.join("\n");
}

/**
 * handle_approval — act on a pending approval/procurement item.
 */
function buildHandleApproval(results: ToolResult[]): string {
  const notifyResult = results.find((r) => r.tool === "notify_procurement");
  const parts: string[] = [];

  if (!notifyResult?.ok) {
    return "I was unable to process the approval. Please check that the notification service is running.";
  }

  const n = (notifyResult.parsed as { notification?: { id: string; subject: string; recipients: string[] } })?.notification;

  parts.push("✅ **Procurement approval sent.**");
  parts.push("The TechVault laptop order (PO-2024-0201) has been approved and the confirmation has been sent to procurement and finance.");

  if (n) {
    parts.push(`\n📨 Notified: ${n.recipients.join(", ")} — "${n.subject}"`);
  }

  parts.push("\nThe vendor will be notified to proceed with dispatch.");

  return parts.join("\n");
}

/**
 * follow_ups — what needs to be followed up today.
 */
function buildFollowUps(results: ToolResult[]): string {
  const parts: string[] = [];

  const delResult = results.find((r) => r.tool === "get_pending_deliveries");
  const deliveries = (
    (delResult?.parsed as { deliveries?: Array<{ vendor: string; status: string; expectedTimeWindow: string }> })
      ?.deliveries ?? []
  );

  const calResult = results.find((r) => r.tool === "get_today_calendar");
  const meetings = (
    (calResult?.parsed as { events?: Array<{ title: string; time: string }> })?.events ?? []
  );

  const followUps: string[] = [];

  // Supplier follow-up — always shown
  followUps.push("📞 **Supplier check-in** — Follow up with Acme Corp on the Q4 supplies quote. Their deadline is tomorrow.");

  // Meeting prep from real calendar data
  const standUp = meetings.find((m) => /standup|stand-up|engineering/i.test(m.title));
  if (standUp) {
    followUps.push(`📅 **Meeting preparation** — Prepare your update for the ${standUp.title} at ${standUp.time}.`);
  } else if (meetings.length > 0) {
    const last = meetings[meetings.length - 1]!;
    followUps.push(`📅 **Meeting preparation** — Prepare your notes for ${last.title} at ${last.time}.`);
  }

  // Pending approval
  followUps.push("✍️ **Pending approval** — The TechVault laptop order is waiting for your sign-off. Procurement needs a decision today.");

  // Delivery confirmation from real data
  const inTransit = deliveries.find((d) => d.status === "in_transit");
  if (inTransit) {
    followUps.push(`📦 **Delivery confirmation** — Confirm receipt of the ${inTransit.vendor} delivery once it arrives ${inTransit.expectedTimeWindow}.`);
  }

  parts.push(`You have ${followUps.length} follow-ups for today:\n`);
  followUps.forEach((item, i) => {
    parts.push(`${i + 1}. ${item}`);
  });
  parts.push('\nSay "Remind me about the supplier at 3 PM" to set a reminder.');

  return parts.join("\n");
}

/**
 * office_briefing — structured office status (existing behaviour, preserved).
 */
function buildOfficeBriefing(results: ToolResult[]): string {
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
    events?: Array<{ title: string; time: string; location: string; organizer?: string }>;
  };

  // Use the same single-line format as buildOfficeBriefing so toVoiceText
  // can parse each event with the calEventMatch regex (time – time  title  (location)).
  const lines: string[] = [`📅 **Calendar — ${data.date ?? "Today"}**\n`];
  if (!data.events?.length) {
    lines.push("No meetings scheduled today.");
  } else {
    data.events.forEach((e) => {
      lines.push(`  • ${e.time}  ${e.title}  (${e.location})`);
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

// ---------------------------------------------------------------------------
// Email intent builders
// ---------------------------------------------------------------------------

type EmailEntry = {
  subject: string;
  from: string;
  receivedAt: string;
  snippet: string;
  isRead: boolean;
  importance: string;
  labels: string[];
};

function buildInboxImportant(results: ToolResult[]): string {
  const result = results.find((r) => r.tool === "get_important_emails");
  if (!result?.ok) return "Unable to retrieve inbox emails.";

  const data = result.parsed as { count?: number; emails?: EmailEntry[] };
  const emails = data.emails ?? [];

  if (emails.length === 0) {
    return "Your inbox is clear — no important or unread emails right now.";
  }

  const unread = emails.filter((e) => !e.isRead);
  const high = emails.filter((e) => e.importance === "high");

  const lines: string[] = [
    `📧 **Inbox — ${emails.length} item${emails.length !== 1 ? "s" : ""} need${emails.length === 1 ? "s" : ""} your attention** (${unread.length} unread)\n`,
  ];

  emails.forEach((e) => {
    const flag = e.importance === "high" ? "🔴" : e.isRead ? "📨" : "📩";
    lines.push(`${flag} **${e.subject}**`);
    lines.push(`   From: ${e.from}  ·  ${e.receivedAt}`);
    lines.push(`   ${e.snippet.slice(0, 120)}${e.snippet.length > 120 ? "…" : ""}`);
    lines.push("");
  });

  if (high.length > 0) {
    lines.push(`${high.length} email${high.length !== 1 ? "s" : ""} marked high importance — consider addressing those first.`);
  }

  return lines.join("\n").trimEnd();
}

function buildInboxRecent(results: ToolResult[]): string {
  const result = results.find((r) => r.tool === "get_recent_emails");
  if (!result?.ok) return "Unable to retrieve recent emails.";

  const data = result.parsed as { count?: number; emails?: EmailEntry[] };
  const emails = data.emails ?? [];

  if (emails.length === 0) {
    return "No recent emails found in your inbox.";
  }

  const lines: string[] = [
    `📧 **Recent Emails — ${emails.length} message${emails.length !== 1 ? "s" : ""}**\n`,
  ];

  emails.forEach((e) => {
    const flag = e.isRead ? "📨" : "📩";
    lines.push(`${flag} **${e.subject}**`);
    lines.push(`   From: ${e.from}  ·  ${e.receivedAt}${e.isRead ? "" : "  · *unread*"}`);
    lines.push(`   ${e.snippet.slice(0, 120)}${e.snippet.length > 120 ? "…" : ""}`);
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

function formatRawResults(results: ToolResult[]): string {
  return results
    .map((r) => `**${r.tool}**: ${r.ok ? r.raw : `ERROR — ${r.error}`}`)
    .join("\n\n");
}
