/**
 * MCP tool executor
 *
 * Sends each planned tool call to the Arclio MCP server over Streamable HTTP
 * and collects the results. Handles session lifecycle automatically.
 *
 * Special runtime resolution:
 *   mark_delivery_received with deliveryId "__resolve__" will look up the
 *   actual delivery ID from a prior get_pending_deliveries result.
 */
import type { Plan, ToolResult } from "./types.js";
export declare function executePlan(plan: Plan): Promise<ToolResult[]>;
//# sourceMappingURL=executor.d.ts.map