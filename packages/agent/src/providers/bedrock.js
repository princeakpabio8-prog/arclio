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
import { BedrockRuntimeClient, ConverseCommand, } from "@aws-sdk/client-bedrock-runtime";
import { TOOL_REGISTRY } from "../tool-registry.js";
import { validatePlan, PlanValidationError } from "../plan-validator.js";
// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DEFAULT_MODEL_ID = "amazon.nova-lite-v1:0";
const DEFAULT_REGION = "us-east-1";
const MAX_TOKENS = 1024;
// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
function buildSystemPrompt() {
    const toolList = TOOL_REGISTRY.map((t) => {
        const argLines = Object.entries(t.args).map(([k, v]) => `      ${k} (${v.type}${v.optional ? ", optional" : ""}): ${v.description}`);
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
function extractJson(text) {
    const trimmed = text.trim();
    // Direct JSON object
    if (trimmed.startsWith("{")) {
        return JSON.parse(trimmed);
    }
    // Unwrap markdown code fences the model sometimes adds despite instructions
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
        return JSON.parse(fenceMatch[1].trim());
    }
    // Last resort: find the first { … } block
    const braceStart = trimmed.indexOf("{");
    const braceEnd = trimmed.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
        return JSON.parse(trimmed.slice(braceStart, braceEnd + 1));
    }
    throw new SyntaxError("No JSON object found in model response");
}
// ---------------------------------------------------------------------------
// BedrockProvider
// ---------------------------------------------------------------------------
export class BedrockProvider {
    name = "bedrock";
    client;
    modelId;
    constructor(client, modelId) {
        this.modelId =
            modelId ??
                process.env["ARCLIO_BEDROCK_MODEL_ID"] ??
                DEFAULT_MODEL_ID;
        this.client =
            client ??
                new BedrockRuntimeClient({
                    region: process.env["ARCLIO_BEDROCK_REGION"] ?? DEFAULT_REGION,
                    // Credentials come from the standard AWS credential chain.
                    // Do NOT set credentials here — let the SDK resolve them.
                });
    }
    async buildPlan(userInput) {
        const messages = [
            {
                role: "user",
                content: [{ text: userInput }],
            },
        ];
        let rawText;
        try {
            const command = new ConverseCommand({
                modelId: this.modelId,
                system: [{ text: buildSystemPrompt() }],
                messages,
                inferenceConfig: {
                    maxTokens: MAX_TOKENS,
                    temperature: 0, // deterministic output
                    topP: 1,
                },
            });
            const response = await this.client.send(command);
            const outputMessage = response.output?.message;
            const textBlock = outputMessage?.content?.find((b) => typeof b.text === "string");
            if (!textBlock?.text) {
                throw new Error("Bedrock returned an empty response");
            }
            rawText = textBlock.text;
        }
        catch (err) {
            // Network / auth errors must not crash the agent — return unknown intent
            console.error("[bedrock] Converse API error:", err);
            return { userInput, intent: "unknown", steps: [] };
        }
        // Parse and validate — malformed output is rejected here, not in executor
        let raw;
        try {
            raw = extractJson(rawText);
        }
        catch (err) {
            console.error("[bedrock] Failed to parse model JSON:", rawText, err);
            return { userInput, intent: "unknown", steps: [] };
        }
        try {
            return validatePlan(raw);
        }
        catch (err) {
            if (err instanceof PlanValidationError) {
                console.error("[bedrock] Plan validation failed:", err.violations.join("; "));
            }
            else {
                console.error("[bedrock] Unexpected validation error:", err);
            }
            return { userInput, intent: "unknown", steps: [] };
        }
    }
}
//# sourceMappingURL=bedrock.js.map