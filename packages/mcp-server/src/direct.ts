/**
 * Direct in-process tool calls — used by the Vercel serverless API and the
 * agent executor when MCP_BASE_URL is not set (production / Vercel).
 *
 * The MCP server's tools are pure in-memory logic backed by mock-data.
 * In production (Vercel), there is no separate MCP server process to reach,
 * so the API and agent call these functions directly instead of going over HTTP.
 *
 * In local dev the normal HTTP path via MCP_BASE_URL is used instead.
 * This file adds zero new dependencies — it only re-uses the existing
 * tool implementations.
 */

import { CALENDAR_EVENTS, DELIVERIES, EMAILS, SECURITY_EVENTS } from "./data/mock-data.js";
import type { EmailImportance, SecurityEventType } from "./data/mock-data.js";
import { appendNotification, readNotifications } from "./data/notification-store.js";

// ---------------------------------------------------------------------------
// get_today_calendar
// ---------------------------------------------------------------------------

export function getTodayCalendar(): {
  date: string;
  events: Array<{
    id: string;
    title: string;
    time: string;
    location: string;
    organizer: string;
    attendeeCount: number;
  }>;
} {
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const events = CALENDAR_EVENTS.map((e) => ({
    id: e.id,
    title: e.title,
    time: `${e.start} – ${e.end}`,
    location: e.location ?? "No location",
    organizer: e.organizer,
    attendeeCount: e.attendees.length,
  }));
  return { date, events };
}

// ---------------------------------------------------------------------------
// get_pending_deliveries
// ---------------------------------------------------------------------------

export function getPendingDeliveries(opts: {
  vendor?: string;
  includeToday?: boolean;
}): {
  count: number;
  deliveries: Array<{
    id: string;
    vendor: string;
    description: string;
    expectedDate: string;
    expectedTimeWindow: string;
    status: string;
    poNumber: string;
    trackingNumber: string;
  }>;
} {
  const today = new Date().toISOString().slice(0, 10);
  const includeToday = opts.includeToday ?? true;

  let results = DELIVERIES.filter(
    (d) => d.status === "pending" || d.status === "in_transit",
  );

  if (includeToday) {
    results = results.filter((d) => d.expectedDate <= today);
  }

  if (opts.vendor) {
    const term = opts.vendor.toLowerCase();
    results = results.filter((d) => d.vendor.toLowerCase().includes(term));
  }

  return {
    count: results.length,
    deliveries: results.map((d) => ({
      id: d.id,
      vendor: d.vendor,
      description: d.description,
      expectedDate: d.expectedDate,
      expectedTimeWindow: d.expectedTimeWindow,
      status: d.status,
      poNumber: d.poNumber,
      trackingNumber: d.trackingNumber,
    })),
  };
}

// ---------------------------------------------------------------------------
// get_security_events
// ---------------------------------------------------------------------------

export function getSecurityEvents(opts: {
  type?: SecurityEventType;
  location?: string;
  since?: string;
}): {
  count: number;
  events: Array<{
    id: string;
    timestamp: string;
    type: string;
    location: string;
    description: string;
    actor: string | null;
    cameraRef: string | null;
  }>;
} {
  let events = [...SECURITY_EVENTS];

  if (opts.type) events = events.filter((e) => e.type === opts.type);

  if (opts.location) {
    const term = opts.location.toLowerCase();
    events = events.filter((e) => e.location.toLowerCase().includes(term));
  }

  if (opts.since) {
    const [hh, mm] = opts.since.split(":").map(Number);
    const sinceMs = new Date();
    sinceMs.setHours(hh, mm ?? 0, 0, 0);
    events = events.filter((e) => new Date(e.timestamp).getTime() >= sinceMs.getTime());
  }

  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

  return {
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
  };
}

// ---------------------------------------------------------------------------
// notify_procurement  (write side — also re-export the read side)
// ---------------------------------------------------------------------------

export function notifyProcurement(opts: {
  subject: string;
  body: string;
  recipients?: string[];
}): { success: boolean; notification: object } {
  const notification = {
    id: `notif-${Date.now()}`,
    sentAt: new Date().toISOString(),
    subject: opts.subject,
    body: opts.body,
    recipients: opts.recipients ?? ["procurement@arclio.dev"],
  };
  appendNotification(notification);
  return { success: true, notification };
}

// ---------------------------------------------------------------------------
// mark_delivery_received
// ---------------------------------------------------------------------------

export function markDeliveryReceived(opts: {
  deliveryId: string;
  receivedBy?: string;
  notes?: string;
}): { success: boolean; delivery?: object; error?: string } {
  const delivery = DELIVERIES.find((d) => d.id === opts.deliveryId);

  if (!delivery) {
    return { success: false, error: `Delivery '${opts.deliveryId}' not found.` };
  }

  if (delivery.status === "received") {
    return {
      success: false,
      error: `Delivery '${opts.deliveryId}' is already marked as received.`,
    };
  }

  delivery.status = "received";
  delivery.receivedAt = new Date().toISOString();
  delivery.receivedBy = opts.receivedBy ?? "system";
  if (opts.notes) delivery.notes = opts.notes;

  return {
    success: true,
    delivery: {
      id: delivery.id,
      vendor: delivery.vendor,
      description: delivery.description,
      status: delivery.status,
      receivedAt: delivery.receivedAt,
      receivedBy: delivery.receivedBy,
      notes: delivery.notes,
    },
  };
}

// ---------------------------------------------------------------------------
// get_recent_emails
// ---------------------------------------------------------------------------

export function getRecentEmails(opts: { limit?: number }): {
  count: number;
  emails: Array<{
    id: string;
    subject: string;
    from: string;
    receivedAt: string;
    snippet: string;
    isRead: boolean;
    importance: EmailImportance;
    labels: string[];
  }>;
} {
  const limit = opts.limit ?? 10;
  const sorted = [...EMAILS].sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );
  const emails = sorted.slice(0, limit).map((e) => ({
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
  }));
  return { count: emails.length, emails };
}

// ---------------------------------------------------------------------------
// get_important_emails
// ---------------------------------------------------------------------------

export function getImportantEmails(): {
  count: number;
  emails: Array<{
    id: string;
    subject: string;
    from: string;
    receivedAt: string;
    snippet: string;
    isRead: boolean;
    importance: EmailImportance;
    labels: string[];
  }>;
} {
  const important = EMAILS.filter(
    (e) => !e.isRead || e.importance === ("high" satisfies EmailImportance),
  ).sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );
  const emails = important.map((e) => ({
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
  }));
  return { count: emails.length, emails };
}

export { readNotifications } from "./data/notification-store.js";
export { DELIVERIES } from "./data/mock-data.js";
