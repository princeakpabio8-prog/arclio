/**
 * Result verifier
 *
 * Inspects execution results and produces a VerificationResult.
 * Rules are intent-aware — what counts as "passed" differs per intent.
 */
import type { Plan, ToolResult, VerificationResult } from "./types.js";
export declare function verifyResults(plan: Plan, results: ToolResult[]): VerificationResult;
//# sourceMappingURL=verifier.d.ts.map