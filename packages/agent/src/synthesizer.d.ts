/**
 * Response synthesizer
 *
 * Takes verified tool results and produces a concise natural-language answer.
 * This is the final stage of the agent pipeline before the answer is returned
 * to the user (or spoken by Alexa+).
 *
 * When an LLM is added, replace this module's buildAnswer function with an
 * LLM call that receives the same structured inputs.
 */
import type { Plan, ToolResult, VerificationResult } from "./types.js";
export declare function buildAnswer(plan: Plan, results: ToolResult[], verification: VerificationResult): string;
//# sourceMappingURL=synthesizer.d.ts.map