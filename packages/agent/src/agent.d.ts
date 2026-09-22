/**
 * Arclio agent — main pipeline
 *
 * Architecture:  User → LLM Planner → Structured Plan → MCP Executor → Verification → Response
 *
 * The LLM provider is selected at startup via ARCLIO_LLM_PROVIDER env var.
 * All plans pass through the validator before reaching the executor.
 */
import type { LLMProvider } from "./llm-provider.js";
import type { AgentResponse } from "./types.js";
/** Inject a provider directly — used by tests to supply mocks without env vars. */
export declare function setProvider(provider: LLMProvider): void;
/** Reset the provider singleton — used by tests to clean up between runs. */
export declare function resetProvider(): void;
export declare function runAgent(userInput: string): Promise<AgentResponse>;
//# sourceMappingURL=agent.d.ts.map