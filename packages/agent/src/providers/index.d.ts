/**
 * LLM provider factory
 *
 * Reads ARCLIO_LLM_PROVIDER from the environment and returns the appropriate
 * LLMProvider instance.  Defaults to "stub" so the agent works out of the box
 * with no credentials.
 *
 * Supported values:
 *   stub    — deterministic keyword planner (default)
 *   bedrock — Amazon Bedrock Runtime, Converse API
 *
 * BedrockProvider is imported lazily (dynamic import) so that projects without
 * @aws-sdk/client-bedrock-runtime installed can still use the stub provider.
 */
import type { LLMProvider } from "../llm-provider.js";
export type ProviderName = "stub" | "bedrock";
export declare function createProvider(override?: ProviderName): Promise<LLMProvider>;
//# sourceMappingURL=index.d.ts.map