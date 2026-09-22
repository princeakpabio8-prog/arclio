// Shared API types matching the packages/api response shapes

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string | null;
  organizer: string;
  attendeeCount: number;
}

export interface Delivery {
  id: string;
  vendor: string;
  description: string;
  expectedDate: string;
  expectedTimeWindow: string;
  status: "pending" | "in_transit" | "delivered" | "received";
  poNumber: string;
  trackingNumber: string;
  receivedAt: string | null;
  receivedBy: string | null;
}

export interface SecurityEvent {
  id: string;
  timestamp: string;
  type: string;
  location: string;
  description: string;
  actor: string | null;
  cameraRef: string | null;
}

export interface ActivityItem {
  id: string;
  timestamp: string;
  type: string;
  summary: string;
}

export interface DashboardData {
  date: string;
  calendarCount: number;
  pendingDeliveryCount: number;
  securityAlertCount: number;
  upcomingEvents: Array<{ id: string; title: string; time: string; location: string | null }>;
  pendingDeliveries: Array<{ id: string; vendor: string; status: string; expectedTimeWindow: string }>;
  recentSecurity: Array<{ id: string; timestamp: string; type: string; description: string; location: string }>;
}

export interface ProcurementNotification {
  id: string;
  sentAt: string;
  subject: string;
  body: string;
  recipients: string[];
}

export interface AgentResponse {
  answer: string;
  intent: string;
  verification: "passed" | "partial" | "failed";
  steps: Array<{ tool: string; ok: boolean; detail: string | null }>;
}
