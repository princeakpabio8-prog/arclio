// Thin API client — all calls go through Vite's proxy to localhost:3002

const BASE = "";

export class ApiError extends Error {
  readonly status: number;
  readonly isNetworkError: boolean;

  constructor(message: string, status: number, isNetworkError = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.isNetworkError = isNetworkError;
  }
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`);
  } catch {
    throw new ApiError(
      "Cannot reach the Arclio API. Is the API server running? (npm run dev:api)",
      0,
      true,
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "Cannot reach the Arclio API. Is the API server running? (npm run dev:api)",
      0,
      true,
    );
  }
  if (!res.ok) {
    const body2 = await res.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(body2?.error ?? `Request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

import type {
  DashboardData,
  CalendarEvent,
  Delivery,
  SecurityEvent,
  ActivityItem,
  ProcurementNotification,
  AgentResponse,
} from "./types.js";

export const api = {
  dashboard: () => get<DashboardData>("/api/dashboard"),
  calendar: () => get<{ date: string; events: CalendarEvent[] }>("/api/calendar"),
  deliveries: () => get<{ deliveries: Delivery[] }>("/api/deliveries"),
  security: () => get<{ events: SecurityEvent[] }>("/api/security"),
  activity: () => get<{ activity: ActivityItem[] }>("/api/activity"),
  notifications: () => get<{ notifications: ProcurementNotification[] }>("/api/notifications"),
  agent: (query: string) => post<AgentResponse>("/api/agent", { query }),
};
