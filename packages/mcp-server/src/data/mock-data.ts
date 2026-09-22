/**
 * Arclio mock data
 *
 * All data is static and in-memory. Replace individual sections with real
 * connector calls when integrating with live business systems.
 */

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO 8601 local time
  end: string;
  location?: string;
  attendees: string[];
  organizer: string;
}

export const CALENDAR_EVENTS: CalendarEvent[] = [
  {
    id: "evt-001",
    title: "Q3 Procurement Review",
    start: "09:00",
    end: "10:00",
    location: "Conference Room A",
    attendees: ["alice@arclio.dev", "bob@arclio.dev", "carol@arclio.dev"],
    organizer: "alice@arclio.dev",
  },
  {
    id: "evt-002",
    title: "Acme Corp Delivery Window",
    start: "10:00",
    end: "12:00",
    location: "Loading Dock — Bay 3",
    attendees: ["facilities@arclio.dev"],
    organizer: "procurement@arclio.dev",
  },
  {
    id: "evt-003",
    title: "Security Briefing — Weekly",
    start: "13:00",
    end: "13:30",
    location: "Security Office",
    attendees: ["security@arclio.dev", "ops@arclio.dev"],
    organizer: "security@arclio.dev",
  },
  {
    id: "evt-004",
    title: "Engineering Standup",
    start: "14:00",
    end: "14:15",
    location: "Zoom",
    attendees: ["engineering@arclio.dev"],
    organizer: "eng-lead@arclio.dev",
  },
];

// ---------------------------------------------------------------------------
// Procurement
// ---------------------------------------------------------------------------

export type DeliveryStatus = "pending" | "in_transit" | "delivered" | "received";

export interface Delivery {
  id: string;
  vendor: string;
  description: string;
  expectedDate: string; // YYYY-MM-DD
  expectedTimeWindow: string; // e.g. "10:00–12:00"
  status: DeliveryStatus;
  trackingNumber: string;
  poNumber: string;
  receivedAt?: string; // ISO 8601 timestamp, set when status → received
  receivedBy?: string;
  notes?: string;
}

// Mutable so mark_delivery_received can update it
export const DELIVERIES: Delivery[] = [
  {
    id: "del-001",
    vendor: "Acme Corp",
    description: "Office supplies — Q3 restock (boxes × 12)",
    expectedDate: new Date().toISOString().slice(0, 10), // today
    expectedTimeWindow: "10:00–12:00",
    status: "in_transit",
    trackingNumber: "ACME-2024-0731",
    poNumber: "PO-2024-0187",
  },
  {
    id: "del-002",
    vendor: "TechVault",
    description: "Laptop hardware — 4 × MacBook Pro M3",
    expectedDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), // tomorrow
    expectedTimeWindow: "09:00–17:00",
    status: "pending",
    trackingNumber: "TVLT-2024-0088",
    poNumber: "PO-2024-0201",
  },
  {
    id: "del-003",
    vendor: "CleanPro Services",
    description: "Cleaning supplies — monthly delivery",
    expectedDate: new Date(Date.now() - 86400000).toISOString().slice(0, 10), // yesterday
    expectedTimeWindow: "08:00–09:00",
    status: "received",
    trackingNumber: "CPS-2024-0310",
    poNumber: "PO-2024-0175",
    receivedAt: new Date(Date.now() - 86400000).toISOString(),
    receivedBy: "facilities@arclio.dev",
  },
];

// Notification log — appended to by notify_procurement
export interface ProcurementNotification {
  id: string;
  sentAt: string;
  subject: string;
  body: string;
  recipients: string[];
}

export const NOTIFICATIONS: ProcurementNotification[] = [];

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export type SecurityEventType =
  | "access_granted"
  | "access_denied"
  | "visitor_sign_in"
  | "visitor_sign_out"
  | "door_alarm"
  | "motion_detected"
  | "delivery_arrival"
  | "delivery_departed";

export interface SecurityEvent {
  id: string;
  timestamp: string; // ISO 8601
  type: SecurityEventType;
  location: string;
  description: string;
  actor?: string; // person or vehicle
  cameraRef?: string;
}

// Timestamps relative to today so the demo always feels current
function todayAt(hhmm: string): string {
  const [hh, mm] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(hh, mm ?? 0, 0, 0);
  return d.toISOString();
}

export const SECURITY_EVENTS: SecurityEvent[] = [
  {
    id: "sec-001",
    timestamp: todayAt("07:45"),
    type: "access_granted",
    location: "Main Entrance",
    description: "Employee badge scan — entry granted",
    actor: "alice@arclio.dev",
  },
  {
    id: "sec-002",
    timestamp: todayAt("08:12"),
    type: "visitor_sign_in",
    location: "Reception",
    description: "Visitor signed in — awaiting escort",
    actor: "John Smith (Acme Corp)",
  },
  {
    id: "sec-003",
    timestamp: todayAt("10:08"),
    type: "delivery_arrival",
    location: "Loading Dock — Bay 3",
    description: "Delivery vehicle arrived — Acme Corp truck",
    actor: "Acme Corp — truck plate AX-9921",
    cameraRef: "CAM-DOCK-03",
  },
  {
    id: "sec-004",
    timestamp: todayAt("10:22"),
    type: "access_granted",
    location: "Loading Dock — Bay 3",
    description: "Loading dock door opened for delivery",
    actor: "facilities@arclio.dev",
  },
  {
    id: "sec-005",
    timestamp: todayAt("11:05"),
    type: "motion_detected",
    location: "Loading Dock — Bay 3",
    description: "Motion detected — delivery in progress",
    cameraRef: "CAM-DOCK-03",
  },
  {
    id: "sec-006",
    timestamp: todayAt("11:47"),
    type: "delivery_departed",
    location: "Loading Dock — Bay 3",
    description: "Delivery vehicle departed",
    actor: "Acme Corp — truck plate AX-9921",
    cameraRef: "CAM-DOCK-03",
  },
  {
    id: "sec-007",
    timestamp: todayAt("12:03"),
    type: "access_denied",
    location: "Server Room",
    description: "Unauthorised access attempt — badge rejected",
    actor: "unknown",
  },
];
