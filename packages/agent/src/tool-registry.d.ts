/**
 * TOOL_REGISTRY
 *
 * Single source of truth for every MCP tool Arclio is authorised to call.
 * Both the stub planner and the Bedrock prompt use this list to constrain
 * which tools can appear in a Plan.  The validator also references it.
 *
 * To add a new tool: add it to ToolName in types.ts, then add its descriptor
 * here.  Nothing else needs updating to make it available for planning.
 */
import type { ToolName } from "./types.js";
export interface ToolDescriptor {
    name: ToolName;
    description: string;
    /** JSON-schema-style arg descriptors for the prompt */
    args: Record<string, {
        type: string;
        description: string;
        optional?: boolean;
    }>;
}
export declare const TOOL_REGISTRY: ToolDescriptor[];
/** Fast lookup set used by the plan validator */
export declare const REGISTERED_TOOL_NAMES: Set<string>;
//# sourceMappingURL=tool-registry.d.ts.map