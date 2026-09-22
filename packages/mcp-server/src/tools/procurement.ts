/**
 * Procurement tools
 *
 * get_pending_deliveries      — list deliveries that are not yet received
 * mark_delivery_received      — update a delivery's status to received
 * notify_procurement          — send an internal procurement notification
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DELIVERIES } from "../data/mock-data.js";
import type { DeliveryStatus } from "../data/mock-data.js";
import { appendNotification } from "../data/notification-store.js";

export function registerProcurementTools(server: McpServer): void {
  // ------------------------------------------------------------------
  // get_pending_deliveries
  // ------------------------------------------------------------------
  server.tool(
    "get_pending_deliveries",
    "Retrieve deliveries that are pending or in transit (not yet received). Optionally filter by vendor name.",
    {
      vendor: z
        .string()
        .optional()
        .describe("Optional vendor name substring to filter results"),
      includeToday: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include deliveries expected today (default: true)"),
    },
    async ({ vendor, includeToday }) => {
      const today = new Date().toISOString().slice(0, 10);
      const activeStatuses: DeliveryStatus[] = ["pending", "in_transit"];

      let results = DELIVERIES.filter((d) =>
        activeStatuses.includes(d.status),
      );

      if (includeToday) {
        results = results.filter((d) => d.expectedDate <= today);
      }

      if (vendor) {
        const term = vendor.toLowerCase();
        results = results.filter((d) =>
          d.vendor.toLowerCase().includes(term),
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
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
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ------------------------------------------------------------------
  // mark_delivery_received
  // ------------------------------------------------------------------
  server.tool(
    "mark_delivery_received",
    "Mark a delivery as received. Requires the delivery ID. Optionally record who received it and any notes.",
    {
      deliveryId: z
        .string()
        .describe("The delivery ID (e.g. del-001)"),
      receivedBy: z
        .string()
        .optional()
        .describe("Email or name of the person confirming receipt"),
      notes: z
        .string()
        .optional()
        .describe("Optional free-text notes about the delivery condition"),
    },
    async ({ deliveryId, receivedBy, notes }) => {
      const delivery = DELIVERIES.find((d) => d.id === deliveryId);

      if (!delivery) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Delivery '${deliveryId}' not found.`,
              }),
            },
          ],
        };
      }

      if (delivery.status === "received") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Delivery '${deliveryId}' is already marked as received.`,
                receivedAt: delivery.receivedAt,
                receivedBy: delivery.receivedBy,
              }),
            },
          ],
        };
      }

      // Mutate mock state
      delivery.status = "received";
      delivery.receivedAt = new Date().toISOString();
      delivery.receivedBy = receivedBy ?? "system";
      if (notes) delivery.notes = notes;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
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
            }),
          },
        ],
      };
    },
  );

  // ------------------------------------------------------------------
  // notify_procurement
  // ------------------------------------------------------------------
  server.tool(
    "notify_procurement",
    "Send an internal notification to the procurement team. Returns a notification receipt.",
    {
      subject: z.string().describe("Notification subject line"),
      body: z.string().describe("Notification body text"),
      recipients: z
        .array(z.string())
        .optional()
        .default(["procurement@arclio.dev"])
        .describe("List of recipient emails (defaults to procurement team)"),
    },
    async ({ subject, body, recipients }) => {
      const notification = {
        id: `notif-${Date.now()}`,
        sentAt: new Date().toISOString(),
        subject,
        body,
        recipients,
      };

      appendNotification(notification);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              notification,
            }),
          },
        ],
      };
    },
  );
}
