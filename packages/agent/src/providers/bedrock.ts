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
 * Authentication — two modes, checked in order:
 *
 *   1. Bedrock API key (bearer token) — preferred for hackathon / standalone use:
 *      AWS_BEARER_TOKEN_BEDROCK=<your-bedrock-api-key>
 *      The key is passed as an HTTP Bearer token via smithy.api#httpBearerAuth.
 *      No IAM credentials required in this mode.
 *
 *   2. Standard AWS credential chain — for IAM users / roles / profiles:
 *      AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY  (env vars)
 *      ~/.aws/credentials                          (named profile)
 *      EC2/ECS/Lambda instance role                (automatic)
 *
 * Other configuration (all optional):
 *   ARCLIO_MODEL_ID           — Bedrock model ID (default: anthropic.claude-sonnet-4-6)
 *   ARCLIO_BEDROCK_MODEL_ID   — legacy alias for ARCLIO_MODEL_ID
 *   AWS_REGION                — AWS region (default: us-east-1)
 *   ARCLIO_BEDROCK_REGION     — legacy alias for AWS_REGION
 *
 * NEVER hardcode credentials here.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
} from "@aws-sdk/client-bedrock-runtime";

import type { LLMProvider } from "../llm-provider.js";
import type { Plan } from "../types.js";
import { TOOL_REGISTRY } from "../tool-registry.js";
import { validatePlan, PlanValidationError } from "../plan-validator.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_ID = "global.anthropic.claude-sonnet-4-6";
const DEFAULT_REGION   = "us-east-1";
const MAX_TOKENS       = 2048;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  const toolList = TOOL_REGISTRY.map((t) => {
    const argLines = Object.entries(t.args).map(
      ([k, v]) =>
        `      ${k} (${v.type}${v.optional ? ", optional" : ""}): ${v.description}`,
    );
    return [
      `  - name: ${t.name}`,
      `    description: ${t.description}`,
      argLines.length ? `    args:\n${argLines.join("\n")}` : "    args: none",
    ].join("\n");
  });

  return `You are Arclio, an AI business operations agent.

Your job is to analyse a user's request and produce a structured execution plan.
You MUST NOT execute tools yourself. You MUST NOT call any APIs.
You ONLY produce a JSON plan that the Arclio executor will carry out.

REGISTERED TOOLS (you may only reference these exact tool names):
${toolList.join("\n\n")}

OUTPUT FORMAT — respond with ONLY this JSON object, no markdown fences, no explanation:
{
  "userInput": "<the original user input>",
  "intent": "<one of: office_briefing | delivery_status | mark_received | calendar_only | security_only | unknown>",
  "steps": [
    {
      "tool": "<tool name from the registered list above>",
      "args": { /* tool arguments as a JSON object */ },
      "reason": "<one sentence explaining why this tool is needed>"
    }
  ]
}

RULES:
- steps may be empty [] if the intent is "unknown" or no tools are needed.
- Only use tool names from the REGISTERED TOOLS list.
- args must be a plain JSON object (strings, numbers, booleans, arrays of primitives).
- For mark_delivery_received, use deliveryId "__resolve__" when the ID is not yet known.
- Do not include any text outside the JSON object.`;
}

// ---------------------------------------------------------------------------
// Response parser — extracts the JSON plan from the model's text output
// ---------------------------------------------------------------------------

function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // Direct JSON object
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  // Unwrap markdown code fences the model sometimes adds despite instructions
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1]!.trim());
  }

  // Last resort: find the first { … } block
  const braceStart = trimmed.indexOf("{");
  const braceEnd   = trimmed.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return JSON.parse(trimmed.slice(braceStart, braceEnd + 1));
  }

  throw new SyntaxError("No JSON object found in model response");
}

// ---------------------------------------------------------------------------
// BedrockProvider
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bearer token decoder
// Bedrock API keys are base64-encoded with a 3-byte binary prefix.
// If the env var is already a plain ASCII token this is a no-op.
// ---------------------------------------------------------------------------

function decodeBearerToken(raw: string): string {
  // If it looks like base64 and decodes to something with a binary prefix, extract ASCII
  try {
    const buf = Buffer.from(raw.trim(), "base64");
    // Check if decoded bytes start with non-printable chars (binary prefix pattern)
    if (buf.length > 4 && (buf[0]! < 0x20 || buf[1]! < 0x20)) {
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i]! >= 0x20 && buf[i]! <= 0x7e) { start = i; break; }
      }
      const ascii = buf.slice(start).toString("ascii").trim();
      if (ascii.length > 10) return ascii; // looks like a real key
    }
  } catch {
    // Not valid base64 — treat as plain token
  }
  // Plain token (already decoded by caller, or not base64)
  return raw.replace(/\s/g, "");
}

export class BedrockProvider implements LLMProvider {
  readonly name = "bedrock";

  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor(
    client?: BedrockRuntimeClient,
    modelId?: string,
  ) {
    // Resolve model ID: explicit arg > ARCLIO_MODEL_ID > ARCLIO_BEDROCK_MODEL_ID (legacy) > default
    this.modelId =
      modelId ??
      process.env["ARCLIO_MODEL_ID"] ??
      process.env["ARCLIO_BEDROCK_MODEL_ID"] ??
      DEFAULT_MODEL_ID;

    // Resolve region: AWS_REGION (standard SDK var) > ARCLIO_BEDROCK_REGION (legacy) > default
    const region =
      process.env["AWS_REGION"] ??
      process.env["ARCLIO_BEDROCK_REGION"] ??
      DEFAULT_REGION;

    if (client) {
      // Test injection — use the provided client as-is
      this.client = client;
    } else {
      // Build a real client.
      // Auth mode A: Bedrock API key (bearer token) — AWS_BEARER_TOKEN_BEDROCK
      // Auth mode B: Standard AWS credential chain (IAM keys / profile / instance role)
      // Decode the bearer token: handles both plain ASCII keys and base64-prefixed Bedrock API keys
      const rawEnvToken = process.env["AWS_BEARER_TOKEN_BEDROCK"];
      const bearerToken = rawEnvToken ? decodeBearerToken(rawEnvToken) : undefined;

      this.client = bearerToken
        ? new BedrockRuntimeClient({
            region,
            // Pass the API key as a static bearer token.
            // The SDK maps this to smithy.api#httpBearerAuth (HTTP Authorization: Bearer …).
            // authSchemePreference uses the short name (strip namespace prefix) so the
            // middleware orders bearer auth FIRST, preventing SigV4 from running first.
            token: { token: bearerToken },
            authSchemePreference: ["httpBearerAuth"],
          })
        : new BedrockRuntimeClient({
            region,
            // No token → fall back to standard AWS credential chain automatically.
            // Sources: AWS_ACCESS_KEY_ID/SECRET, ~/.aws/credentials, instance role.
            // NEVER hardcode credentials here.
          });
    }
  }

  async buildPlan(userInput: string): Promise<Plan> {
    const messages: Message[] = [
      {
        role: "user",
        content: [{ text: userInput } as ContentBlock],
      },
    ];

    let rawText: string;
    try {
      const command = new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: buildSystemPrompt() }],
        messages,
        inferenceConfig: {
          maxTokens: MAX_TOKENS,
          temperature: 0,   // deterministic output
          topP: 1,
        },
      });

      const response = await this.client.send(command);

      const outputMessage = response.output?.message;
      const textBlock = outputMessage?.content?.find(
        (b): b is ContentBlock & { text: string } =>
          typeof (b as { text?: unknown }).text === "string",
      );

      if (!textBlock?.text) {
        throw new Error("Bedrock returned an empty response");
      }

      rawText = textBlock.text;
    } catch (err) {
      // Network / auth errors must not crash the agent — return unknown intent
      console.error("[bedrock] Converse API error:", err);
      return { userInput, intent: "unknown", steps: [] };
    }

    // Parse and validate — malformed output is rejected here, not in executor
    let raw: unknown;
    try {
      raw = extractJson(rawText);
    } catch (err) {
      console.error("[bedrock] Failed to parse model JSON:", rawText, err);
      return { userInput, intent: "unknown", steps: [] };
    }

    try {
      return validatePlan(raw);
    } catch (err) {
      if (err instanceof PlanValidationError) {
        console.error(
          "[bedrock] Plan validation failed:",
          err.violations.join("; "),
        );
      } else {
        console.error("[bedrock] Unexpected validation error:", err);
      }
      return { userInput, intent: "unknown", steps: [] };
    }
  }
}
