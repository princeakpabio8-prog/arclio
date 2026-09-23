/**
 * AlexaSimulator.tsx
 *
 * Alexa+ Simulation page for the Arclio Amazon Developer Hackathon.
 * Demonstrates how Arclio can be used conversationally through an
 * Alexa+-style interface. This is a SIMULATED experience — it uses
 * the existing Arclio agent pipeline (/api/agent) as its backend.
 *
 * Voice: Web Speech API (SpeechRecognition + SpeechSynthesis) with
 * graceful degradation to text input if the browser does not support them.
 * Optional: ElevenLabs TTS via /api/voice/tts proxy (key stays server-side).
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "../api.js";
import type { AgentResponse } from "../types.js";
import {
  createVoiceProvider,
  BrowserVoiceProvider,
  type VoiceProvider,
  type VoiceProviderType,
} from "../voice-provider.js";

// ─── Types ───────────────────────────────────────────────────────────────────

type MicState = "idle" | "listening" | "processing" | "speaking";

type StageKey = "understanding" | "planning" | "checking" | "executing" | "verifying" | "done";

interface ToolCard {
  domain: "procurement" | "calendar" | "security" | "notification";
  title: string;
  lines: string[];
}

interface Message {
  id: string;
  role: "user" | "arclio";
  text: string;
  timestamp: Date;
  agentData?: AgentResponse;
  toolCards?: ToolCard[];
  stage?: StageKey;
  confirmed?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  { id: "briefing",   label: "Give me my business briefing.",              icon: "office" },
  { id: "attention",  label: "What needs my attention?",                   icon: "shield" },
  { id: "waiting",    label: "Is anything waiting on me?",                 icon: "calendar" },
  { id: "delivery",   label: "Handle the Acme delivery.",                  icon: "package" },
  { id: "followups",  label: "What should I follow up on today?",          icon: "check" },
];

const STAGES: Array<{ key: StageKey; label: string }> = [
  { key: "understanding", label: "Understanding your request" },
  { key: "planning",      label: "Planning actions" },
  { key: "checking",      label: "Checking connected systems" },
  { key: "executing",     label: "Executing" },
  { key: "verifying",     label: "Verifying" },
  { key: "done",          label: "Done" },
];

const STAGE_TIMINGS: Record<StageKey, number> = {
  understanding: 0,
  planning:      700,
  checking:      1300,
  executing:     2100,
  verifying:     3000,
  done:          3800,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2); }

function formatTime(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

/**
 * toVoiceText — convert a structured agent answer into natural spoken text.
 *
 * Handles all patterns produced by the synthesizer:
 *   📋 **Office Briefing**
 *   📅 **Calendar — Tuesday, ...**
 *   📦 **Vendor** — expected ...
 *   🔒 **Security Events — Today**
 *   📨 Procurement notified ...
 *   • 9:00 AM–10:00 AM  Title  (Location)
 *   ✅ / ⚠️ / ⏳ inline inline status phrases
 */
function toVoiceText(answer: string): string {
  // ── Step 1: strip emoji ──────────────────────────────────────────────────
  let text = answer
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u2700-\u27BF]/g, "")
    .replace(/✅|⚠️|⏳|📋|📅|📦|🔒|📨|🔔/g, "");

  // ── Step 2: strip markdown bold/italic ──────────────────────────────────
  text = text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");

  // ── Step 3: split lines ──────────────────────────────────────────────────
  const rawLines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // ── Step 4: classify and transform each line ────────────────────────────
  // Returns the spoken replacement, or null to drop the line entirely.
  function transformLine(line: string): string | null {
    // Drop "Say '...'" prompt lines — they're UI hints, not for speaking
    if (/^Say "/.test(line)) return null;

    // Drop numbered-list prompts with quoted suggestions
    if (/^\d+\.\s*Say "/.test(line)) return null;

    // Section headers produced by the synthesizer — replace with natural transitions
    if (/^Office Briefing\s*$/i.test(line))
      return "Here's your office briefing for today.";
    if (/^Calendar\s*[—–-]\s*.+/i.test(line))
      return "On your calendar:";
    if (/^Calendar\s*$/i.test(line))
      return "On your calendar:";
    if (/^Pending Deliveries\s*$/i.test(line))
      return "For pending deliveries:";
    if (/^Security Events?\s*(—|–|-|Today|\(\d+\s*total\)).*$/i.test(line))
      return "For security:";
    if (/^Security log shows:?\s*$/i.test(line))
      return "The security log shows:";

    // New intent headers — natural spoken lead-ins
    if (/^Here'?s what needs your attention:?$/i.test(line))
      return "Here's what needs your attention:";
    if (/^You have \d+ items? waiting on you:?$/i.test(line))
      return line.replace(/:$/, ".");
    if (/^You have \d+ follow-?ups? for today:?$/i.test(line))
      return line.replace(/:$/, ".");

    // Drop lines that are just metadata/labels with no content value
    if (/^\(organised by .+\)$/i.test(line)) return null;

    // Numbered list items (1. ... 2. ...) — strip the number prefix
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      // Strip any remaining markdown bold and return the content
      return numberedMatch[1]!
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .trim();
    }

    // Procurement notification — rewrite
    const notifyMatch = line.match(
      /^Procurement notified\s*\(([^)]+)\)\s*[—–-]\s*"?(.+?)"?\s*$/i,
    );
    if (notifyMatch) {
      return `I've notified the procurement team — ${notifyMatch[2].replace(/"/g, "")}.`;
    }

    // handle_approval confirmation lines
    if (/^Procurement approval sent\.?$/i.test(line))
      return "The procurement approval has been sent.";
    if (/^The vendor will be notified/i.test(line))
      return "The vendor will be notified to proceed.";
    if (/^Notified:/i.test(line)) return null; // drop the email list line when speaking

    // Delivery received confirmation
    const receivedMatch = line.match(/^Delivery received\s*[—–-]\s*(.+?)\s*\(([^)]+)\)\s*$/i);
    if (receivedMatch) {
      return `The ${receivedMatch[1].trim()} delivery has been marked as received.`;
    }

    // "Recorded at: ..." / "Received by: ..." — inline facts, keep concise
    const recordedMatch = line.match(/^Recorded at:\s*(.+)$/i);
    if (recordedMatch) return `Recorded at ${recordedMatch[1].trim()}.`;

    const receivedByMatch = line.match(/^Received by:\s*(.+)$/i);
    if (receivedByMatch) return `Received by ${receivedByMatch[1].trim()}.`;

    // Calendar event line: "9:00 AM–10:00 AM  Title  (Location)"
    const calEventMatch = line.match(
      /^(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[—–-]?\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s+(.+?)\s+\((.+)\)\s*$/i,
    );
    if (calEventMatch) {
      const [, start, end, title, loc] = calEventMatch;
      return `${title.trim()} from ${start.trim()} to ${end.trim()} in ${loc.trim()}`;
    }

    // Delivery line: "Vendor — Description  [10:00 AM–12:00 PM, status: pending]"
    const deliveryMatch = line.match(
      /^(.+?)\s*[—–-]\s*(.+?)\s+\[(.+?),\s*status:\s*(.+?)\]\s*$/i,
    );
    if (deliveryMatch) {
      const [, vendor, desc, window_, status] = deliveryMatch;
      if (status.toLowerCase() === "pending" || status.toLowerCase() === "in_transit" || status.toLowerCase() === "in transit") {
        return `${vendor.trim()} is expected — ${desc.trim()} — arriving ${window_.trim()}`;
      }
      return `${vendor.trim()} — ${desc.trim()} — ${window_.trim()}, status: ${status.trim()}`;
    }

    // Delivery status line (delivery_status intent): "Vendor — expected HH:MM (status: ...)"
    const delivStatusMatch = line.match(/^(.+?)\s*[—–-]\s*expected\s+(.+?)\s+\(status:\s*(.+?)\)\s*$/i);
    if (delivStatusMatch) {
      const [, vendor, window_, status] = delivStatusMatch;
      const normalStatus = status.trim().replace(/_/g, " ");
      return `The ${vendor.trim()} delivery is expected ${window_.trim()}, currently ${normalStatus}.`;
    }

    // Security event line: "HH:MM:SS — description"
    // Guard: do NOT match time-range lines where the content after the dash
    // starts with another time (e.g. "9:00 AM–10:00 AM  Title").
    const secEventMatch = line.match(
      /^(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\s*[—–-]\s*(.+)$/i,
    );
    if (secEventMatch && !/^\d{1,2}:\d{2}/.test(secEventMatch[2]!.trim())) {
      return `At ${secEventMatch[1].trim()}: ${secEventMatch[2].trim()}.`;
    }

    // Security event with type bracket
    const secBracketMatch = line.match(
      /^(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM)?)?)\s+\[([^\]]+)\]\s+(.+?)\s+Location:\s*(.+)$/i,
    );
    if (secBracketMatch) {
      const [, time, , desc, loc] = secBracketMatch;
      return `At ${time.trim()}: ${desc.trim()} at ${loc.trim()}.`;
    }

    // "Location: ..." standalone line — skip
    if (/^Location:\s*(.+)$/i.test(line)) return null;

    // Inline status conclusions ("Based on security events, ...")
    const basedOnMatch = line.match(/^Based on security events?,?\s*(.+)$/i);
    if (basedOnMatch) return basedOnMatch[1].trim();

    // Strip leading bullet characters and return
    const clean = line.replace(/^[•\-–*]\s*/, "").trim();
    return clean || null;
  }

  // ── Step 5: build processed lines ───────────────────────────────────────
  const processedLines: string[] = [];
  for (const line of rawLines) {
    const result = transformLine(line);
    if (result !== null) processedLines.push(result);
  }

  // ── Step 6: group into natural spoken paragraphs ─────────────────────────
  const TRANSITION = /^(Here's|On your|For pending|For security|The security log|I've notified|I could not|Failed|Unable|There are no|No meetings|No deliveries|No notable|No security|The .+ delivery|You have \d+|Everything looks|The procurement)/i;

  const sentences: string[] = [];
  let buffer: string[] = [];

  function flushBuffer(): void {
    if (!buffer.length) return;
    if (buffer.length === 1) {
      sentences.push(buffer[0]);
    } else {
      sentences.push(buffer.join(". "));
    }
    buffer = [];
  }

  for (const line of processedLines) {
    if (TRANSITION.test(line)) {
      flushBuffer();
      sentences.push(line);
    } else {
      buffer.push(line);
    }
  }
  flushBuffer();

  // ── Step 7: final punctuation cleanup ────────────────────────────────────
  const result = sentences
    .join(" ")
    .replace(/\.{2,}/g, ".")
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/([^.!?])\s*$/, "$1.")
    .trim();

  return result;
}

function buildToolCards(response: AgentResponse, query: string): ToolCard[] {
  const cards: ToolCard[] = [];
  const q = query.toLowerCase();
  const intent = response.intent;

  // Deduplicate — show each domain card at most once per response
  const seen = new Set<string>();

  for (const step of response.steps) {
    if (!step.ok) continue;

    if (
      (step.tool === "get_pending_deliveries" || step.tool === "mark_delivery_received") &&
      !seen.has("procurement")
    ) {
      seen.add("procurement");
      const isMarkReceived = step.tool === "mark_delivery_received" ||
        intent === "mark_received" || intent === "handle_approval";
      const isBriefing = intent === "business_briefing" || intent === "needs_attention" ||
        intent === "follow_ups";
      cards.push({
        domain: "procurement",
        title: "Procurement",
        lines: isMarkReceived
          ? ["Acme Office Supplies", "Status: Received ✓", "Marked received"]
          : isBriefing
          ? ["Deliveries checked", "1 in transit", "Approval pending"]
          : ["Acme delivery", "Expected today", "Status: In transit"],
      });
    }

    if (step.tool === "notify_procurement" && !seen.has("notification")) {
      seen.add("notification");
      const isApproval = intent === "handle_approval";
      cards.push({
        domain: "notification",
        title: "Notification",
        lines: isApproval
          ? ["Procurement team", "Finance team", "Approval confirmed ✓"]
          : ["Procurement team", "Notified via Arclio", "Delivery confirmation sent"],
      });
    }

    if (step.tool === "get_security_events" && !seen.has("security")) {
      seen.add("security");
      const isDelivery = q.includes("delivery") || q.includes("acme");
      const isBriefing = intent === "business_briefing" || intent === "needs_attention";
      cards.push({
        domain: "security",
        title: "Security",
        lines: isDelivery
          ? ["Front entrance", "Delivery detected", new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })]
          : isBriefing
          ? ["Security log", "No active alerts", "All clear"]
          : ["Security log", "Events reviewed", "No active alerts"],
      });
    }

    if (step.tool === "get_today_calendar" && !seen.has("calendar")) {
      seen.add("calendar");
      const isBriefing = intent === "business_briefing" || intent === "needs_attention" ||
        intent === "follow_ups" || intent === "waiting_on_me";
      cards.push({
        domain: "calendar",
        title: "Calendar",
        lines: isBriefing
          ? ["4 meetings today", "Next: 9:00 AM", "Q3 Procurement Review"]
          : q.includes("calendar")
          ? ["Today's schedule", "Events retrieved", "Up to date"]
          : ["Procurement review", "9:00 AM", "Up to date"],
      });
    }
  }

  return cards;
}

// ─── Speech helpers ───────────────────────────────────────────────────────────

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function stopBrowserSpeaking() {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DomainIcon({ domain }: { domain: ToolCard["domain"] }) {
  if (domain === "procurement") return (
    <svg viewBox="0 0 24 24" className="alexa-tool-icon-svg">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>
  );
  if (domain === "calendar") return (
    <svg viewBox="0 0 24 24" className="alexa-tool-icon-svg">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
  if (domain === "security") return (
    <svg viewBox="0 0 24 24" className="alexa-tool-icon-svg">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
  // notification
  return (
    <svg viewBox="0 0 24 24" className="alexa-tool-icon-svg">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  );
}

function SuggestIcon({ icon }: { icon: string }) {
  if (icon === "office") return (
    <svg viewBox="0 0 24 24" className="alexa-prompt-icon">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );
  if (icon === "package") return (
    <svg viewBox="0 0 24 24" className="alexa-prompt-icon">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  );
  if (icon === "check") return (
    <svg viewBox="0 0 24 24" className="alexa-prompt-icon">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
  if (icon === "calendar") return (
    <svg viewBox="0 0 24 24" className="alexa-prompt-icon">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
  // shield
  return (
    <svg viewBox="0 0 24 24" className="alexa-prompt-icon">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
}

function AgentActivityIndicator({ stage }: { stage: StageKey }) {
  const stageIndex = STAGES.findIndex((s) => s.key === stage);
  return (
    <div className="alexa-activity">
      {STAGES.map((s, i) => {
        const isDone    = i < stageIndex;
        const isActive  = i === stageIndex;
        const isPending = i > stageIndex;
        return (
          <div
            key={s.key}
            className={`alexa-activity-step${isDone ? " done" : isActive ? " active" : ""}`}
            aria-hidden={isPending}
          >
            <div className={`alexa-activity-dot${isDone ? " done" : isActive ? " active" : ""}`}>
              {isDone && (
                <svg viewBox="0 0 24 24" style={{ width: 9, height: 9, stroke: "currentColor", fill: "none", strokeWidth: 3, strokeLinecap: "round" }}>
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
              {isActive && <div className="alexa-activity-spinner" />}
            </div>
            <span className="alexa-activity-label">{s.label}</span>
            {i < STAGES.length - 1 && !isDone && <div className="alexa-activity-connector" />}
            {i < STAGES.length - 1 && isDone  && <div className="alexa-activity-connector done" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Waveform ─────────────────────────────────────────────────────────────────

function VoiceWaveform({ active }: { active: boolean }) {
  return (
    <div className={`alexa-waveform${active ? " active" : ""}`} aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="alexa-waveform-bar" style={{ animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AlexaSimulator() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [textInput, setTextInput] = useState("");
  const [micState, setMicState] = useState<MicState>("idle");
  const [currentStage, setCurrentStage] = useState<StageKey>("understanding");
  const [speechSupported] = useState(() => !!getSpeechRecognition());
  const [ttsSupported]    = useState(() => typeof window !== "undefined" && "speechSynthesis" in window);
  const [showAbout, setShowAbout] = useState(false);

  // Voice provider state
  const [elevenlabsAvailable, setElevenlabsAvailable] = useState(false);
  const [voiceProviderType, setVoiceProviderType] = useState<VoiceProviderType>("browser");
  const [elevenLabsFallback, setElevenLabsFallback] = useState(false);
  const voiceProviderRef = useRef<VoiceProvider>(new BrowserVoiceProvider());
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const stageTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const bottomRef      = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);

  // Probe server for ElevenLabs availability on mount.
  // When ElevenLabs is configured server-side, automatically select it as the
  // active provider so it is the default — not browser TTS.
  // Browser TTS remains the fallback for when ElevenLabs is unavailable or fails.
  useEffect(() => {
    fetch("/api/voice/config")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { elevenlabsAvailable?: boolean } | null) => {
        if (data?.elevenlabsAvailable) {
          setElevenlabsAvailable(true);
          setVoiceProviderType("elevenlabs"); // ElevenLabs is default when configured
        }
      })
      .catch(() => { /* server offline — browser voice is already the default */ });
  }, []);

  // Callback fired when ElevenLabsVoiceProvider falls back to browser TTS
  const handleElevenLabsFallback = useCallback(() => {
    setElevenLabsFallback(true);
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = setTimeout(() => setElevenLabsFallback(false), 4000);
  }, []);

  // Re-create provider when type or availability changes
  useEffect(() => {
    voiceProviderRef.current.stopSpeaking();
    voiceProviderRef.current = createVoiceProvider(
      voiceProviderType,
      elevenlabsAvailable,
      handleElevenLabsFallback,
    );
  }, [voiceProviderType, elevenlabsAvailable, handleElevenLabsFallback]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup timers and recognition on unmount
  useEffect(() => () => {
    stageTimersRef.current.forEach(clearTimeout);
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    recognitionRef.current?.abort();
    voiceProviderRef.current.stopSpeaking();
    stopBrowserSpeaking();
  }, []);

  function clearStageTimers() {
    stageTimersRef.current.forEach(clearTimeout);
    stageTimersRef.current = [];
  }

  function advanceStages(onDone: () => void) {
    clearStageTimers();
    setCurrentStage("understanding");
    const order: StageKey[] = ["understanding", "planning", "checking", "executing", "verifying", "done"];
    for (const key of order) {
      const delay = STAGE_TIMINGS[key];
      const t = setTimeout(() => setCurrentStage(key), delay);
      stageTimersRef.current.push(t);
    }
    const doneTimer = setTimeout(onDone, STAGE_TIMINGS["done"] + 200);
    stageTimersRef.current.push(doneTimer);
  }

  const sendQuery = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed || micState === "processing") return;

    // Stop any ongoing TTS
    voiceProviderRef.current.stopSpeaking();

    // Add user message
    const userMsg: Message = {
      id: uid(),
      role: "user",
      text: trimmed,
      timestamp: new Date(),
    };

    // Add thinking placeholder for Arclio
    const thinkingId = uid();
    const thinkingMsg: Message = {
      id: thinkingId,
      role: "arclio",
      text: "",
      timestamp: new Date(),
      stage: "understanding",
    };

    setMessages((prev) => [...prev, userMsg, thinkingMsg]);
    setTextInput("");
    setMicState("processing");

    advanceStages(() => {
      // Stage animation completes — but real API call may still be pending
      // (state update is fine; message will update once API returns)
    });

    try {
      const response = await api.agent(trimmed);
      const toolCards = buildToolCards(response, trimmed);
      const isAction = response.intent === "mark_received";

      clearStageTimers();
      setCurrentStage("done");

      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId
            ? {
                ...m,
                text: response.answer,
                agentData: response,
                toolCards,
                stage: "done",
                confirmed: isAction && response.verification === "passed",
              }
            : m,
        ),
      );

      // Speak the answer via the active voice provider.
      // Always run through toVoiceText() first to strip labels,
      // markdown, and structured formatting into natural speech.
      const canSpeak = ttsSupported || voiceProviderType === "elevenlabs";
      if (canSpeak) {
        setMicState("speaking");
        const cleaned = toVoiceText(response.answer);
        // ElevenLabs has a 500-char proxy limit; browser TTS handles any length.
        const voiceText = voiceProviderType === "elevenlabs" && cleaned.length > 490
          ? cleaned.slice(0, 489) + "…"
          : cleaned;
        voiceProviderRef.current.speakText(voiceText, () => setMicState("idle"));
      } else {
        setMicState("idle");
      }
    } catch (err) {
      clearStageTimers();
      setCurrentStage("done");
      const message = err instanceof Error ? err.message : "An error occurred.";
      const isOffline = message.includes("Cannot reach") || message.includes("ECONNREFUSED");

      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId
            ? {
                ...m,
                text: isOffline
                  ? "I'm unable to connect to Arclio right now. Please make sure the API server is running."
                  : `I encountered an issue: ${message}`,
                stage: "done",
              }
            : m,
        ),
      );
      setMicState("idle");
    }
  }, [micState, ttsSupported, voiceProviderType]);

  function handleTextSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (textInput.trim()) sendQuery(textInput);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
  }

  function startListening() {
    const SR = getSpeechRecognition();
    if (!SR || micState !== "idle") return;

    voiceProviderRef.current.stopSpeaking();
    setMicState("listening");

    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) {
        sendQuery(transcript);
      } else {
        setMicState("idle");
      }
    };

    recognition.onerror = () => {
      setMicState("idle");
    };

    recognition.onend = () => {
      // Reset to idle after recognition ends (unless we already moved to processing)
      setMicState((prev) => prev === "listening" ? "idle" : prev);
    };

    try {
      recognition.start();
    } catch {
      setMicState("idle");
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (micState === "listening") setMicState("idle");
  }

  const isBusy = micState === "listening" || micState === "processing" || micState === "speaking";

  return (
    <div className="alexa-shell">
      {/* ── Header ── */}
      <div className="alexa-header">
        <div className="alexa-header-left">
          <div className="alexa-badge">
            <div className="alexa-badge-dot" />
            Alexa+ Simulation
          </div>
          <div className="alexa-header-title">Arclio — Alexa+ Experience</div>
        </div>
        <div className="alexa-header-right">
          {/* Voice provider toggle — inline in header */}
          {elevenlabsAvailable ? (
            <div className="alexa-voice-toggle" role="group" aria-label="Voice provider">
              <button
                className={`alexa-voice-toggle-opt${voiceProviderType === "browser" ? " active" : ""}`}
                onClick={() => { setVoiceProviderType("browser"); setElevenLabsFallback(false); }}
                disabled={isBusy}
                aria-pressed={voiceProviderType === "browser"}
              >
                Browser
              </button>
              <button
                className={`alexa-voice-toggle-opt${voiceProviderType === "elevenlabs" ? " active" : ""}`}
                onClick={() => { setVoiceProviderType("elevenlabs"); setElevenLabsFallback(false); }}
                disabled={isBusy}
                aria-pressed={voiceProviderType === "elevenlabs"}
              >
                ElevenLabs
              </button>
              {elevenLabsFallback && (
                <span className="alexa-voice-toggle-fallback" title="ElevenLabs failed — using browser TTS">
                  ↩ browser fallback
                </span>
              )}
            </div>
          ) : (
            <div className="alexa-caps">
              {speechSupported && !ttsSupported && <span className="alexa-cap-tag">Voice ready</span>}
              {ttsSupported && <span className="alexa-cap-tag">Browser TTS</span>}
              {!speechSupported && <span className="alexa-cap-tag muted">Text mode</span>}
            </div>
          )}
          <button className="alexa-about-btn" onClick={() => setShowAbout((v) => !v)}>
            {showAbout ? "Hide" : "About this simulation"}
          </button>
        </div>
      </div>

      {/* ── About panel ── */}
      {showAbout && (
        <div className="alexa-about">
          <p>
            This experience simulates how Arclio can be used conversationally through an
            Alexa+-style interface. Arclio's orchestration layer connects the conversation
            to authorized business tools and verifies completed actions.
          </p>
          <p>
            Conversation flows through the existing Arclio agent pipeline
            (Reason → Plan → Execute → Verify), powered by Amazon Bedrock / Claude,
            using the same MCP tools that a real Alexa+ integration would invoke as an
            MCP client once Amazon access is granted.
          </p>
          <p style={{ marginTop: 6 }}>
            <strong>Note:</strong> This is not official Alexa+ integration — it is a hackathon
            demonstration of the conversational pattern Arclio enables.
          </p>
        </div>
      )}

      <div className="alexa-body">
        {/* ── Conversation pane ── */}
        <div className="alexa-conversation">
          {messages.length === 0 && (
            <div className="alexa-empty">
              <div className="alexa-empty-icon">
                <svg viewBox="0 0 24 24" style={{ width: 28, height: 28, stroke: "var(--brass)", fill: "none", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }}>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </div>
              <div className="alexa-empty-title">Say something or tap a prompt below</div>
              <div className="alexa-empty-sub">Arclio is listening for your office commands.</div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`alexa-message alexa-message--${msg.role}`}>
              {msg.role === "user" ? (
                <div className="alexa-user-bubble">
                  <div className="alexa-user-text">{msg.text}</div>
                  <div className="alexa-msg-time">{formatTime(msg.timestamp)}</div>
                </div>
              ) : (
                <div className="alexa-arclio-bubble">
                  <div className="alexa-arclio-header">
                    <div className="alexa-arclio-label">
                      <div className={`alexa-arclio-dot${msg.stage !== "done" ? " pulsing" : ""}`} />
                      Arclio
                    </div>
                    {msg.agentData && msg.stage === "done" && (
                      <span className={`alexa-verify-badge alexa-verify-${msg.agentData.verification}`}>
                        {msg.agentData.verification === "passed"  && "✓ Verified"}
                        {msg.agentData.verification === "partial" && "⚠ Partial"}
                        {msg.agentData.verification === "failed"  && "✗ Failed"}
                      </span>
                    )}
                  </div>

                  {/* Activity indicator — shown while processing */}
                  {msg.stage !== "done" && (
                    <AgentActivityIndicator stage={currentStage} />
                  )}

                  {/* Response text */}
                  {msg.stage === "done" && msg.text && (
                    <div className="alexa-arclio-text">{msg.text}</div>
                  )}

                  {/* Confirmation banner for actions */}
                  {msg.confirmed && (
                    <div className="alexa-confirm-banner">
                      <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: "var(--green)", fill: "none", strokeWidth: 2.5, strokeLinecap: "round", flexShrink: 0 }}>
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      Action confirmed and verified
                    </div>
                  )}

                  {/* Tool/action cards */}
                  {msg.toolCards && msg.toolCards.length > 0 && (
                    <div className="alexa-tool-cards">
                      {msg.toolCards.map((card, i) => (
                        <div key={i} className={`alexa-tool-card alexa-tool-card--${card.domain}`}>
                          <div className="alexa-tool-card-icon">
                            <DomainIcon domain={card.domain} />
                          </div>
                          <div className="alexa-tool-card-body">
                            <div className="alexa-tool-card-title">{card.title}</div>
                            {card.lines.map((line, j) => (
                              <div key={j} className="alexa-tool-card-line">{line}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Step breakdown */}
                  {msg.agentData && msg.agentData.steps.length > 0 && msg.stage === "done" && (
                    <div className="alexa-steps">
                      {msg.agentData.steps.map((step) => (
                        <span key={step.tool} className={`alexa-step-chip${step.ok ? "" : " fail"}`}>
                          {step.ok ? (
                            <svg viewBox="0 0 24 24" style={{ width: 9, height: 9, stroke: "currentColor", fill: "none", strokeWidth: 3, strokeLinecap: "round" }}>
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" style={{ width: 9, height: 9, stroke: "currentColor", fill: "none", strokeWidth: 3, strokeLinecap: "round" }}>
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          )}
                          {step.tool}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="alexa-msg-time">{formatTime(msg.timestamp)}</div>
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* ── Input + Controls ── */}
        <div className="alexa-controls">
          {/* Mic area */}
          <div className="alexa-mic-area">
            <VoiceWaveform active={micState === "listening" || micState === "speaking"} />

            <button
              className={`alexa-mic-btn alexa-mic-btn--${micState}`}
              onClick={micState === "listening" ? stopListening : startListening}
              disabled={micState === "processing" || !speechSupported}
              aria-label={micState === "listening" ? "Stop listening" : "Start voice input"}
              title={speechSupported ? undefined : "Voice input not supported in this browser"}
            >
              {micState === "processing" ? (
                <div className="alexa-mic-spinner" />
              ) : (
                <svg viewBox="0 0 24 24" className="alexa-mic-svg">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </button>

            <div className="alexa-mic-status">
              {micState === "idle"       && (speechSupported ? "Tap to speak" : "Voice unavailable")}
              {micState === "listening"  && "Listening…"}
              {micState === "processing" && "Processing…"}
              {micState === "speaking"   && "Responding…"}
            </div>
          </div>

          {/* Text input fallback */}
          <form className="alexa-text-form" onSubmit={handleTextSubmit}>
            <input
              ref={inputRef}
              className="alexa-text-input"
              placeholder={`Or type a command — "Alexa, what's happening today?"`}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isBusy}
            />
            <button
              className="alexa-text-send"
              type="submit"
              disabled={isBusy || !textInput.trim()}
              aria-label="Send"
            >
              <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "#fff", fill: "none", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", marginLeft: 1 }}>
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </form>

          {/* Suggested prompts */}
          <div className="alexa-prompts">
            <div className="alexa-prompts-label">Try saying</div>
            <div className="alexa-prompts-list">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p.id}
                  className="alexa-prompt-chip"
                  onClick={() => sendQuery(p.label)}
                  disabled={isBusy}
                >
                  <SuggestIcon icon={p.icon} />
                  <span className="alexa-prompt-text">"{p.label}"</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
