/**
 * parse-agent-answer.ts
 *
 * Converts the raw `answer` string (produced by packages/agent/src/synthesizer.ts)
 * into a typed structure that AgentResponsePanel can render with proper visual
 * hierarchy instead of a raw text dump.
 *
 * Rules:
 * - This module is a pure function — no side effects, no imports other than types.
 * - It must never throw; malformed input falls back to { kind: "prose" }.
 * - The Alexa Simulator's toVoiceText() is independent and unaffected.
 */

import type { AgentResponse } from "./types.js";

// ─── Output types ────────────────────────────────────────────────────────────

/** A plain-text paragraph with no further structure. */
export interface ProseBlock {
  kind: "prose";
  text: string;
}

/**
 * A numbered list derived from lines starting with "1. ", "2. " etc.
 * Each item may have a bold label (text before " — ") and a body.
 */
export interface NumberedListBlock {
  kind: "numbered-list";
  heading: string;
  items: Array<{ label: string | null; body: string }>;
  footer: string | null;
}

/**
 * A section-based layout: one or more titled sections each containing
 * bullet rows. Used for office_briefing, calendar_only, security_only,
 * delivery_status.
 */
export interface SectionRow {
  text: string;
  /** colour hint for the dot/icon beside the row */
  tone: "default" | "alert" | "info" | "success" | "warn";
}

export interface Section {
  /** e.g. "Calendar — Tuesday, …" or "Pending Deliveries" */
  title: string;
  /** accent colour for the section header icon */
  accent: "calendar" | "delivery" | "security" | "notification" | "default";
  rows: SectionRow[];
  /** optional single-line footer beneath the rows */
  footer: string | null;
}

export interface SectionsBlock {
  kind: "sections";
  sections: Section[];
}

/**
 * A receipt / confirmation card: a headline + detail lines.
 * Used for mark_received and handle_approval.
 */
export interface ReceiptLine {
  text: string;
  tone: "default" | "muted" | "notify" | "warn";
}

export interface ReceiptBlock {
  kind: "receipt";
  /** e.g. "Delivery received — Acme Corp (del-001)" */
  headline: string;
  lines: ReceiptLine[];
}

export type ParsedBlock = ProseBlock | NumberedListBlock | SectionsBlock | ReceiptBlock;

export interface ParsedResponse {
  /** The single primary content block. */
  block: ParsedBlock;
  /** Derived from AgentResponse.steps — tool chips to show below. */
  steps: AgentResponse["steps"];
  verification: AgentResponse["verification"];
  query: string;
  intent: string;
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function parseAgentAnswer(
  response: AgentResponse & { query: string },
): ParsedResponse {
  const { answer, intent, steps, verification, query } = response;

  try {
    const block = parseBlock(answer, intent);
    return { block, steps, verification, query, intent };
  } catch {
    return {
      block: { kind: "prose", text: answer },
      steps,
      verification,
      query,
      intent,
    };
  }
}

// ─── Intent dispatcher ────────────────────────────────────────────────────────

function parseBlock(answer: string, intent: string): ParsedBlock {
  switch (intent) {
    case "needs_attention":
      return parseNumberedList(answer);

    case "waiting_on_me":
    case "follow_ups":
      return parseEmojiNumberedList(answer);

    case "office_briefing":
    case "calendar_only":
    case "security_only":
    case "delivery_status":
      return parseSections(answer, intent);

    case "mark_received":
    case "handle_approval":
      return parseReceipt(answer);

    // business_briefing → plain prose sentences
    // unknown → plain suggestion text
    default:
      return { kind: "prose", text: stripEmoji(answer).trim() };
  }
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

/**
 * Parses output like:
 *   "Here's what needs your attention:\n\n  1. A delivery from Acme Corp is in transit…\n  2. …"
 */
function parseNumberedList(answer: string): NumberedListBlock {
  const lines = answer.split("\n").map((l) => l.trim()).filter(Boolean);

  // First non-numbered line is the heading
  const headingLine = lines.find((l) => !/^\d+\./.test(l)) ?? "Here's what needs your attention";
  // Strip trailing colon
  const heading = headingLine.replace(/:$/, "").trim();

  const itemLines = lines.filter((l) => /^\d+\./.test(l));
  const items = itemLines.map((l) => {
    // Remove leading "1. "
    const body = l.replace(/^\d+\.\s*/, "");
    return { label: null, body: stripEmoji(body).trim() };
  });

  return { kind: "numbered-list", heading, items, footer: null };
}

/**
 * Parses output like:
 *   "You have N items waiting on you:\n\n1. 📋 **Procurement approval** — TechVault…\n2. …\n\nSay "…" to action it now."
 */
function parseEmojiNumberedList(answer: string): NumberedListBlock {
  const lines = answer.split("\n").map((l) => l.trim()).filter(Boolean);

  // Heading = first line that is NOT a numbered item and NOT the footer hint
  const headingLine = lines.find((l) => !/^\d+\./.test(l) && !/^Say "/.test(l)) ?? "";
  const heading = headingLine.replace(/:$/, "").trim();

  // Footer = last line starting with 'Say "'
  const footerLine = lines.slice().reverse().find((l) => /^Say "/.test(l)) ?? null;

  const itemLines = lines.filter((l) => /^\d+\./.test(l));
  const items = itemLines.map((l) => {
    // Remove "1. " prefix
    const raw = l.replace(/^\d+\.\s*/, "");
    // Remove leading emoji
    const noEmoji = stripEmoji(raw).trim();
    // Split on first " — " to get label and body
    const dashIdx = noEmoji.indexOf(" — ");
    if (dashIdx !== -1) {
      const label = stripBold(noEmoji.slice(0, dashIdx)).trim();
      const body  = noEmoji.slice(dashIdx + 3).trim();
      return { label, body };
    }
    return { label: null, body: noEmoji };
  });

  return { kind: "numbered-list", heading, items, footer: footerLine };
}

/**
 * Parses the multi-section formats:
 *   office_briefing  → Calendar section, Deliveries section, Security section
 *   calendar_only    → one Calendar section
 *   security_only    → one Security section
 *   delivery_status  → Delivery section + optional Security log section
 */
function parseSections(answer: string, intent: string): SectionsBlock {
  const lines = answer.split("\n");
  const sections: Section[] = [];

  let currentTitle = "";
  let currentAccent: Section["accent"] = "default";
  let currentRows: SectionRow[] = [];
  let currentFooter: string | null = null;

  function flushSection() {
    if (currentTitle || currentRows.length > 0) {
      sections.push({
        title: currentTitle,
        accent: currentAccent,
        rows: currentRows,
        footer: currentFooter,
      });
    }
    currentTitle = "";
    currentAccent = "default";
    currentRows = [];
    currentFooter = null;
  }

  // Bold-section header pattern: **Some Title**  (optionally with leading emoji)
  const headerRe = /^\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u2700-\u27BF]?\s*\*\*(.+?)\*\*/u;
  // Bullet row pattern: "  • …" or "• …"
  const bulletRe = /^\s*•\s+(.+)$/;
  // Security-only raw row: "• timestamp  [type]  description"
  const secRawRe = /^\s*•\s+(.+)$/;
  // Delivery status row: "📦 **Vendor** — expected …"
  const deliveryRe = /^\s*[\u{1F4E6}]\s*\*\*(.+?)\*\*\s*—\s*(.+)$/u;
  // Security log entry: "  • timestamp — description"
  const secLogRe  = /^\s*•\s+(.+?)\s*—\s*(.+)$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // ── Section header ──────────────────────────────────────────────────────
    if (headerRe.test(line)) {
      flushSection();
      const match = headerRe.exec(line)!;
      currentTitle = stripEmoji(match[1]!).trim();
      currentAccent = accentFromTitle(currentTitle);
      continue;
    }

    // ── Delivery status intent: "📦 **Vendor** — expected …" ────────────────
    if (intent === "delivery_status" && deliveryRe.test(line)) {
      // Start a new section per delivery
      flushSection();
      const m = deliveryRe.exec(line)!;
      currentTitle = stripEmoji(m[1]!).trim();
      currentAccent = "delivery";
      const detail = stripEmoji(m[2]!).trim();
      currentRows.push({ text: detail, tone: "default" });
      continue;
    }

    // ── Footer lines (conclusion / status summary) ───────────────────────────
    if (
      (line.startsWith("✅") || line.startsWith("⏳") || line.startsWith("⚠")) &&
      (intent === "delivery_status")
    ) {
      currentFooter = stripEmoji(line).trim();
      continue;
    }

    // ── Bulletin / bullet row ─────────────────────────────────────────────────
    if (bulletRe.test(line) || secRawRe.test(line)) {
      const m = (bulletRe.exec(line) ?? secRawRe.exec(line))!;
      const text = stripEmoji(m[1]!).trim();
      // Determine tone
      let tone: SectionRow["tone"] = "default";
      if (currentAccent === "security") {
        if (/access.denied|alarm/i.test(text)) tone = "alert";
        else if (/arrival|departed/i.test(text)) tone = "warn";
        else tone = "info";
      } else if (currentAccent === "delivery") {
        if (/received|delivered/i.test(text)) tone = "success";
        else if (/in.transit/i.test(text)) tone = "warn";
      }
      currentRows.push({ text, tone });
      continue;
    }

    // ── Security log entries from delivery_status: "  • ts — desc" ──────────
    if (intent === "delivery_status" && secLogRe.test(line)) {
      const m = secLogRe.exec(line)!;
      const text = stripEmoji(`${m[1]!} — ${m[2]!}`).trim();
      currentRows.push({ text, tone: "info" });
      continue;
    }

    // ── "No …" empty-state lines inside a section ────────────────────────────
    if (
      /^No (meetings|deliveries|notable|security)/i.test(line) ||
      /^No activity/i.test(line)
    ) {
      currentRows.push({ text: stripEmoji(line).trim(), tone: "default" });
      continue;
    }

    // ── Plain text inside a section (security_only detail lines "Location: …") ─
    if (currentTitle) {
      const clean = stripEmoji(line).trim();
      if (clean) {
        // Append to the previous row as extra detail, or add as a new muted row
        if (currentRows.length > 0 && line.startsWith("  ")) {
          currentRows[currentRows.length - 1]!.text += `  ·  ${clean}`;
        } else {
          currentRows.push({ text: clean, tone: "default" });
        }
      }
      continue;
    }
  }

  flushSection();

  // Fallback: if nothing parsed into sections, treat as prose
  if (sections.length === 0) {
    return {
      kind: "sections",
      sections: [{ title: "", accent: "default", rows: [{ text: stripEmoji(answer).trim(), tone: "default" }], footer: null }],
    };
  }

  return { kind: "sections", sections };
}

/**
 * Parses mark_received and handle_approval outputs:
 *   "✅ **Delivery received** — Acme Corp (del-001)\n   Recorded at: …\n   Received by: …\n\n📨 Procurement notified …"
 */
function parseReceipt(answer: string): ReceiptBlock {
  const lines = answer.split("\n").map((l) => l.trim()).filter(Boolean);

  // First line: "✅ **Delivery received** — Acme Corp (del-001)" or "✅ **Procurement approval sent.**"
  const headlineRaw = lines[0] ?? "";
  const headline = stripEmoji(headlineRaw).replace(/\*\*/g, "").trim();

  const receiptLines: ReceiptLine[] = [];

  for (const line of lines.slice(1)) {
    const clean = stripEmoji(line).replace(/\*\*/g, "").trim();
    if (!clean) continue;

    let tone: ReceiptLine["tone"] = "default";
    if (/^Procurement notified|^Notified:/i.test(clean)) tone = "notify";
    else if (/^Notification failed|^Failed/i.test(clean))  tone = "warn";
    else if (/^Recorded at:|^Received by:|vendor will be/i.test(clean)) tone = "muted";
    else tone = "muted";

    receiptLines.push({ text: clean, tone });
  }

  return { kind: "receipt", headline, lines: receiptLines };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip the most common Unicode emoji ranges. */
function stripEmoji(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u2700-\u27BF]/g, "")
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, "")
    .replace(/[\u2000-\u206F]/g, "")
    .trim();
}

/** Strip markdown bold markers. */
function stripBold(text: string): string {
  return text.replace(/\*\*/g, "");
}

function accentFromTitle(title: string): Section["accent"] {
  const t = title.toLowerCase();
  if (/calendar/i.test(t))  return "calendar";
  if (/deliver/i.test(t))   return "delivery";
  if (/security/i.test(t))  return "security";
  if (/notif/i.test(t))     return "notification";
  return "default";
}
