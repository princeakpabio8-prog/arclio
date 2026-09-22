/**
 * Bedrock live verification — makes exactly ONE real API call.
 *
 * Purpose: confirm that authentication, network, and model response all work
 * end-to-end before switching the full application to ARCLIO_LLM_PROVIDER=bedrock.
 *
 * Usage:
 *   AWS_BEARER_TOKEN_BEDROCK=<key> AWS_REGION=us-east-1 node dist/verify-bedrock-live.js
 *
 * The API key is read exclusively from the environment — never hardcoded here.
 * This script MUST NOT be run during CI or automated test suites.
 *
 * Exit codes:
 *   0 — Bedrock returned a valid plan
 *   1 — Error (auth failure, network error, bad response)
 */

import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const MODEL_ID = process.env["ARCLIO_MODEL_ID"] ?? "global.anthropic.claude-sonnet-4-6";
const REGION   = process.env["AWS_REGION"] ?? "us-east-1";
const TOKEN    = process.env["AWS_BEARER_TOKEN_BEDROCK"];

// ── Safety checks ────────────────────────────────────────────────────────────

if (!TOKEN) {
  console.error(
    "[verify] ERROR: AWS_BEARER_TOKEN_BEDROCK is not set.\n" +
    "         Run as: AWS_BEARER_TOKEN_BEDROCK=<key> node dist/verify-bedrock-live.js",
  );
  process.exit(1);
}

// Confirm the token is not printed — only its presence and length
console.log(`[verify] Model  : ${MODEL_ID}`);
console.log(`[verify] Region : ${REGION}`);
console.log(`[verify] Auth   : bearer token present (${TOKEN.length} chars)`);
console.log("[verify] Making ONE real Bedrock request…\n");

// ── Client ───────────────────────────────────────────────────────────────────

const client = new BedrockRuntimeClient({
  region: REGION,
  token: { token: TOKEN },
});

// ── Single request ────────────────────────────────────────────────────────────

const TEST_INPUT = "What's happening at the office today?";

const SYSTEM_PROMPT = `You are Arclio, an AI business operations agent.
Respond with ONLY this JSON object (no markdown, no explanation):
{
  "userInput": "<the original user input>",
  "intent": "office_briefing",
  "steps": [
    { "tool": "get_today_calendar",     "args": {}, "reason": "Retrieve today's meetings." },
    { "tool": "get_pending_deliveries", "args": {}, "reason": "Check pending deliveries." },
    { "tool": "get_security_events",    "args": {}, "reason": "Check security events." }
  ]
}`;

try {
  const command = new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [
      { role: "user", content: [{ text: TEST_INPUT }] },
    ],
    inferenceConfig: { maxTokens: 512, temperature: 0, topP: 1 },
  });

  const response = await client.send(command);

  const textBlock = response.output?.message?.content?.find(
    (b) => typeof (b as { text?: unknown }).text === "string",
  ) as { text: string } | undefined;

  if (!textBlock?.text) {
    throw new Error("Bedrock returned an empty response body");
  }

  const raw = textBlock.text.trim();
  console.log("[verify] Raw model output:");
  console.log("─".repeat(60));
  console.log(raw);
  console.log("─".repeat(60));

  // Parse and do a basic structural check — don't import full validator here
  const parsed = JSON.parse(raw.startsWith("{") ? raw : raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ?? raw);

  if (typeof parsed.intent !== "string") throw new Error("Response missing 'intent' field");
  if (!Array.isArray(parsed.steps))      throw new Error("Response missing 'steps' array");

  console.log(`\n[verify] ✅ SUCCESS`);
  console.log(`[verify] Intent : ${parsed.intent}`);
  console.log(`[verify] Steps  : ${parsed.steps.length}`);
  parsed.steps.forEach((s: { tool: string; reason: string }) => {
    console.log(`         • ${s.tool}`);
  });

  const usage = response.usage;
  if (usage) {
    console.log(`\n[verify] Token usage: ${usage.inputTokens} in + ${usage.outputTokens} out = ${usage.totalTokens} total`);
  }

  console.log("\n[verify] Bedrock + global.anthropic.claude-sonnet-4-6 integration verified. ✓");
  process.exit(0);

} catch (err) {
  console.error("\n[verify] ❌ FAILED");
  const message = err instanceof Error ? err.message : String(err);
  // Strip any token value that might appear in error messages
  const safe = TOKEN ? message.replace(new RegExp(TOKEN, "g"), "***") : message;
  console.error("[verify] Error:", safe);

  if (message.includes("UnrecognizedClientException") || message.includes("InvalidSignatureException")) {
    console.error("[verify] Hint: The bearer token is invalid or has expired.");
  } else if (message.includes("AccessDeniedException")) {
    console.error("[verify] Hint: The token lacks Bedrock access or the model is not enabled in this region.");
  } else if (message.includes("ResourceNotFoundException")) {
    console.error("[verify] Hint: Model ID not found. Check ARCLIO_MODEL_ID and region.");
  }

  process.exit(1);
}
