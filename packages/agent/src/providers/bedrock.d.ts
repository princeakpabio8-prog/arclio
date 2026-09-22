/**
 * BedrockProvider
 *
 * Implements LLMProvider using Amazon Bedrock Runtime — Converse API.
 *
 * IMPORTANT ARCHITECTURE CONTRACT:
 *   The LLM produces a structured JSON plan.
 *   It NEVER calls tools directly.
 *   All tool execution goes through the MCP executor.
 *
 * Configuration (environment variables):
 *   ARCLIO_BEDROCK_MODEL_ID   — Bedrock model ID (default: amazon.nova-lite-v1:0)
 *   ARCLIO_BEDROCK_REGION     — AWS region        (default: us-east-1)
 *   AWS_PROFILE               — AWS named profile (optional, uses default credential chain)
 *
 * The provider uses the standard AWS credential chain:
 *   env vars → ~/.aws/credentials → EC2/ECS instance role
 *   No credentials are ever hardcoded here.
 *
 * Output format:
 *   The model is instructed to return ONLY a JSON object matching the Plan
 *   schema.  The raw text response is parsed and passed through plan-validator
 *   before reaching the executor.
 */
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type { LLMProvider } from "../llm-provider.js";
import type { Plan } from "../types.js";
export declare class BedrockProvider implements LLMProvider {
    readonly name = "bedrock";
    private readonly client;
    private readonly modelId;
    constructor(client?: BedrockRuntimeClient, modelId?: string);
    buildPlan(userInput: string): Promise<Plan>;
}
//# sourceMappingURL=bedrock.d.ts.map