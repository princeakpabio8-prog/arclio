/**
 * Arclio mock data
 *
 * All data is static and in-memory. Replace individual sections with real
 * connector calls when integrating with live business systems.
 */
export interface CalendarEvent {
    id: string;
    title: string;
    start: string;
    end: string;
    location?: string;
    attendees: string[];
    organizer: string;
}
export declare const CALENDAR_EVENTS: CalendarEvent[];
export type DeliveryStatus = "pending" | "in_transit" | "delivered" | "received";
export interface Delivery {
    id: string;
    vendor: string;
    description: string;
    expectedDate: string;
    expectedTimeWindow: string;
    status: DeliveryStatus;
    trackingNumber: string;
    poNumber: string;
    receivedAt?: string;
    receivedBy?: string;
    notes?: string;
}
export declare const DELIVERIES: Delivery[];
export interface ProcurementNotification {
    id: string;
    sentAt: string;
    subject: string;
    body: string;
    recipients: string[];
}
export declare const NOTIFICATIONS: ProcurementNotification[];
export type SecurityEventType = "access_granted" | "access_denied" | "visitor_sign_in" | "visitor_sign_out" | "door_alarm" | "motion_detected" | "delivery_arrival" | "delivery_departed";
export interface SecurityEvent {
    id: string;
    timestamp: string;
    type: SecurityEventType;
    location: string;
    description: string;
    actor?: string;
    cameraRef?: string;
}
export declare const SECURITY_EVENTS: SecurityEvent[];
//# sourceMappingURL=mock-data.d.ts.map