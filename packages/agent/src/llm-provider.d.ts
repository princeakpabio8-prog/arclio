/**
 * LLMProvider interface
 *
 * Every planning backend (stub, Bedrock, future OpenAI, …) implements this
 * single contract. The agent pipeline only knows about LLMProvider — it never
 * imports a concrete provider directly.
 *
 * Architecture guarantee:
 *   LLMProvider → returns Plan
 *   Plan        → consumed by executor
 *   The LLM NEVER calls tools itself.
 */
import type { Plan } from "./types.js";
export interface LLMProvider {
    /** Human-readable name used in logs */
    readonly name: string;
    /**
     * Given raw user input, produce a structured Plan.
     * Must never throw for recoverable errors — return intent:"unknown" instead.
     */
    buildPlan(userInput: string): Promise<Plan>;
}
//# sourceMappingURL=llm-provider.d.ts.map