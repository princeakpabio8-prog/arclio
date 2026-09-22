/**
 * Arclio agent — main pipeline
 *
 * Architecture:  User → LLM Planner → Structured Plan → MCP Executor → Verification → Response
 *
 * The LLM provider is selected at startup via ARCLIO_LLM_PROVIDER env var.
 * All plans pass through the validator before reaching the executor.
 */

import { createProvider } from "./providers/index.js";
import { validatePlan, PlanValidationError } from "./plan-validator.js";
import { executePlan } from "./executor.js";
import { verifyResults } from "./verifier.js";
import { buildAnswer } from "./synthesizer.js";
import type { LLMProvider } from "./llm-provider.js";
import type { AgentResponse, Plan } from "./types.js";

// ---------------------------------------------------------------------------
// Provider singleton — initialised once on first call
// ---------------------------------------------------------------------------

let _provider: LLMProvider | null = null;

async function getProvider(): Promise<LLMProvider> {
  if (!_provider) {
    _provider = await createProvider();
  }
  return _provider;
}

/** Inject a provider directly — used by tests to supply mocks without env vars. */
export function setProvider(provider: LLMProvider): void {
  _provider = provider;
}

/** Reset the provider singleton — used by tests to clean up between runs. */
export function resetProvider(): void {
  _provider = null;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runAgent(userInput: string): Promise<AgentResponse> {
  const provider = await getProvider();

  // Stage 1 — Plan (via LLM provider)
  let plan: Plan;
  try {
    const rawPlan = await provider.buildPlan(userInput);

    // Stage 1b — Validate (safety boundary between LLM and executor)
    plan = validatePlan(rawPlan);
  } catch (err) {
    if (err instanceof PlanValidationError) {
      console.warn(
        `[agent] Plan validation rejected output from '${provider.name}':`,
        err.violations.join("; "),
      );
    } else {
      console.error(`[agent] Planner error (${provider.name}):`, err);
    }
    // Safe fallback — unknown intent, no tool calls
    plan = { userInput, intent: "unknown", steps: [] };
  }

  console.log(
    `[agent] provider: ${provider.name} | intent: ${plan.intent} | steps: ${plan.steps.length}`,
  );

  // Stage 2 — Execute
  const results = await executePlan(plan);
  console.log(
    `[agent] executed ${results.length} tool(s), ` +
      `${results.filter((r) => r.ok).length} succeeded`,
  );

  // Stage 3 — Verify
  const verification = verifyResults(plan, results);
  console.log(`[agent] verification: ${verification.status}`);

  // Stage 4 — Synthesize response
  const answer = buildAnswer(plan, results, verification);

  return { userInput, intent: plan.intent, plan, results, verification, answer };
}
