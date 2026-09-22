/**
 * LLM provider factory
 *
 * Reads ARCLIO_LLM_PROVIDER from the environment and returns the appropriate
 * LLMProvider instance.  Defaults to "stub" so the agent works out of the box
 * with no credentials.
 *
 * Supported values:
 *   stub    — deterministic keyword planner (default, no AWS required)
 *   bedrock — Amazon Bedrock Runtime, Converse API
 *
 * Required environment variables when ARCLIO_LLM_PROVIDER=bedrock:
 *   AWS_REGION (or ARCLIO_BEDROCK_REGION)  — AWS region for Bedrock Runtime
 *   AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY  — or any other supported credential source
 *
 * Optional:
 *   ARCLIO_MODEL_ID (or ARCLIO_BEDROCK_MODEL_ID) — override the model (default: anthropic.claude-sonnet-4-6)
 *
 * BedrockProvider is imported lazily (dynamic import) so the stub provider
 * works with no AWS dependencies at all.
 */

import type { LLMProvider } from "../llm-provider.js";

export type ProviderName = "stub" | "bedrock";

const DEFAULT_MODEL_ID = "global.anthropic.claude-sonnet-4-6";
const DEFAULT_REGION   = "us-east-1";

export async function createProvider(
  override?: ProviderName,
): Promise<LLMProvider> {
  const name: string =
    override ?? process.env["ARCLIO_LLM_PROVIDER"] ?? "stub";

  switch (name) {
    case "stub": {
      const { StubProvider } = await import("./stub.js");
      const provider = new StubProvider();
      console.log(`[agent] LLM provider: ${provider.name}`);
      return provider;
    }

    case "bedrock": {
      // Resolve config for the startup log
      const modelId =
        process.env["ARCLIO_MODEL_ID"] ??
        process.env["ARCLIO_BEDROCK_MODEL_ID"] ??
        DEFAULT_MODEL_ID;

      const region =
        process.env["AWS_REGION"] ??
        process.env["ARCLIO_BEDROCK_REGION"] ??
        DEFAULT_REGION;

      // Warn if no region was explicitly set — the SDK will still try the default
      if (!process.env["AWS_REGION"] && !process.env["ARCLIO_BEDROCK_REGION"]) {
        console.warn(
          `[agent] WARNING: No AWS region configured. ` +
          `Set AWS_REGION (e.g. us-east-1) for Bedrock Runtime. ` +
          `Falling back to default: ${DEFAULT_REGION}`,
        );
      }

      // Warn if no recognised auth source is present.
      // AWS_BEARER_TOKEN_BEDROCK (API key) is the preferred path for standalone use.
      // The SDK may still succeed via instance role / SSO — this is advisory only.
      const hasBearerToken  = !!process.env["AWS_BEARER_TOKEN_BEDROCK"];
      const hasIamKeys      = !!process.env["AWS_ACCESS_KEY_ID"];
      const hasProfile      = !!process.env["AWS_PROFILE"];
      const hasInstanceRole = !!(
        process.env["AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"] ||
        process.env["AWS_WEB_IDENTITY_TOKEN_FILE"]
      );

      if (!hasBearerToken && !hasIamKeys && !hasProfile && !hasInstanceRole) {
        console.warn(
          `[agent] WARNING: No AWS auth source detected. ` +
          `Options: (1) Set AWS_BEARER_TOKEN_BEDROCK=<api-key> for Bedrock API key auth, ` +
          `(2) Set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY for IAM auth, ` +
          `(3) Use an AWS named profile (AWS_PROFILE), ` +
          `(4) Run on an EC2/ECS instance with an attached role. ` +
          `Attempting credential chain anyway — this may fail.`,
        );
      } else {
        const authMode = hasBearerToken ? "bearer token (AWS_BEARER_TOKEN_BEDROCK)"
          : hasIamKeys  ? "IAM keys (AWS_ACCESS_KEY_ID)"
          : hasProfile  ? `AWS profile (${process.env["AWS_PROFILE"]})`
          : "instance role / web identity";
        console.log(`[agent] Bedrock auth: ${authMode}`);
      }

      const { BedrockProvider } = await import("./bedrock.js");
      const provider = new BedrockProvider();
      console.log(
        `[agent] LLM provider: ${provider.name} | model: ${modelId} | region: ${region}`,
      );
      return provider;
    }

    default: {
      console.warn(
        `[agent] Unknown ARCLIO_LLM_PROVIDER value '${name}' — falling back to stub`,
      );
      const { StubProvider } = await import("./stub.js");
      return new StubProvider();
    }
  }
}
