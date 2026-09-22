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
import type { Plan } from "./types.js";
export declare class PlanValidationError extends Error {
    readonly violations: string[];
    constructor(message: string, violations: string[]);
}
/**
 * Validates a raw object (from an LLM or stub) as a safe Plan.
 * Returns the typed Plan on success; throws PlanValidationError on failure.
 */
export declare function validatePlan(raw: unknown): Plan;
//# sourceMappingURL=plan-validator.d.ts.map