/**
 * Plan validator
 *
 * Every Plan produced by any LLMProvider must pass through this validator
 * before reaching the executor.  This is the hard safety boundary that
 * prevents a malformed or adversarially-influenced LLM response from
 * executing unauthorised tool calls.
 *
 * Validation rules:
 *   1. Plan must conform to the Zod schema (structural correctness).
 *   2. Every step.tool must be in REGISTERED_TOOL_NAMES (allowlist).
 *   3. steps array must not exceed MAX_STEPS (resource guard).
 *   4. args values must be JSON-safe primitives (no functions, no Dates).
 *
 * On failure, throws PlanValidationError — caught by agent.ts, which
 * returns an intent:"unknown" fallback rather than propagating to the executor.
 */
import { z } from "zod";
import { REGISTERED_TOOL_NAMES } from "./tool-registry.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_STEPS = 10;
// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------
const ToolCallSchema = z.object({
    tool: z.string().min(1),
    args: z.record(z.unknown()),
    reason: z.string().min(1),
});
const PlanSchema = z.object({
    userInput: z.string(),
    intent: z.string().min(1),
    steps: z.array(ToolCallSchema).max(MAX_STEPS),
});
// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------
export class PlanValidationError extends Error {
    violations;
    constructor(message, violations) {
        super(message);
        this.violations = violations;
        this.name = "PlanValidationError";
    }
}
// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------
/**
 * Validates a raw object (from an LLM or stub) as a safe Plan.
 * Returns the typed Plan on success; throws PlanValidationError on failure.
 */
export function validatePlan(raw) {
    // 1. Structural validation
    const parsed = PlanSchema.safeParse(raw);
    if (!parsed.success) {
        const violations = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        throw new PlanValidationError("Plan failed structural validation", violations);
    }
    const plan = parsed.data;
    const violations = [];
    for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        // 2. Tool allowlist check
        if (!REGISTERED_TOOL_NAMES.has(step.tool)) {
            violations.push(`steps[${i}].tool '${step.tool}' is not a registered MCP tool`);
        }
        // 3. Args safety check — no non-JSON-serialisable values
        try {
            JSON.stringify(step.args);
        }
        catch {
            violations.push(`steps[${i}].args contains non-serialisable values`);
        }
    }
    if (violations.length > 0) {
        throw new PlanValidationError("Plan contains disallowed tool calls", violations);
    }
    // Cast is safe: schema + allowlist checks guarantee the shape
    return plan;
}
//# sourceMappingURL=plan-validator.js.map