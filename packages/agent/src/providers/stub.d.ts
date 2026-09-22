/**
 * StubProvider — deterministic rule-based planner
 *
 * Implements LLMProvider using keyword/intent matching.
 * No LLM key required. Fully deterministic — safe for CI and demos.
 *
 * This is the default provider (ARCLIO_LLM_PROVIDER=stub).
 * Swap for BedrockProvider by setting ARCLIO_LLM_PROVIDER=bedrock.
 *
 * Intent taxonomy:
 *   office_briefing  — "what's happening today / at the office"
 *   mark_received    — "mark [vendor] delivery as received"
 *   delivery_status  — "is the [vendor] delivery here / arrived"
 *   calendar_only    — "what meetings do I have"
 *   security_only    — "show security events / alerts"
 *   unknown          — no intent matched (graceful fallback)
 */
import type { LLMProvider } from "../llm-provider.js";
import type { Plan } from "../types.js";
export declare class StubProvider implements LLMProvider {
    readonly name = "stub";
    buildPlan(userInput: string): Promise<Plan>;
}
//# sourceMappingURL=stub.d.ts.map