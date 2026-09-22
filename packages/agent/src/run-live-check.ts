/**
 * One-shot Bedrock live verification.
 * Receives the API key as a base64-encoded CLI argument.
 * Key exists only in process memory — never written to disk or logged.
 *
 * Usage: node dist/run-live-check.js <base64key>
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";

const b64 = process.argv[2];
if (!b64) {
  console.error("[live-check] Pass the base64-encoded key as the first argument.");
  process.exit(1);
}

// Decode the base64 key.
// Bedrock API keys are base64-encoded with a 3-byte binary prefix (version + length marker).
// The actual bearer token is the ASCII string starting after the last non-printable byte.
function decodeBedrockApiKey(b64Input: string): string {
  const raw = Buffer.from(b64Input.trim(), "base64");
  // Find first printable ASCII byte (0x20–0x7E)
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i]!;
    if (b >= 0x20 && b <= 0x7e) { start = i; break; }
  }
  return raw.slice(start).toString("ascii").trim();
}

const token = decodeBedrockApiKey(b64);
const region = "us-east-1";
const model  = "global.anthropic.claude-sonnet-4-6";

console.log(`[live-check] Model  : ${model}`);
console.log(`[live-check] Region : ${region}`);
console.log(`[live-check] Auth   : bearer token (${token.length} chars, not shown)`);
console.log("[live-check] Sending ONE request to Bedrock…\n");

const client = new BedrockRuntimeClient({
  region,
  token: { token },
  authSchemePreference: ["httpBearerAuth"],
  // Force HTTP/1.1 — avoids NGHTTP2_PROTOCOL_ERROR on some Node/network environments
  requestHandler: new NodeHttpHandler({ connectionTimeout: 30_000, requestTimeout: 30_000 }),
});

const systemPrompt = `You are Arclio, an AI business operations agent.
Respond with ONLY this JSON object (no markdown, no explanation):
{"userInput":"What is happening today?","intent":"office_briefing","steps":[{"tool":"get_today_calendar","args":{},"reason":"Retrieve today meetings."},{"tool":"get_pending_deliveries","args":{},"reason":"Check deliveries."},{"tool":"get_security_events","args":{},"reason":"Check security."}]}`;

try {
  const cmd = new ConverseCommand({
    modelId: model,
    system: [{ text: systemPrompt }],
    messages: [{ role: "user", content: [{ text: "What is happening today?" }] }],
    inferenceConfig: { maxTokens: 512, temperature: 0, topP: 1 },
  });

  const res = await client.send(cmd);

  const textBlock = res.output?.message?.content?.find(
    (b) => typeof b.text === "string",
  );

  if (!textBlock?.text) throw new Error("Empty response from Bedrock");

  const raw = textBlock.text.trim();

  // Safe-print: redact token if it somehow appears (it won't, but be safe)
  const safePrint = raw.replace(new RegExp(token.slice(0, 8), "g"), "***");
  console.log("[live-check] Model response:");
  console.log("─".repeat(56));
  console.log(safePrint);
  console.log("─".repeat(56));

  // Structural check
  const startIdx = raw.indexOf("{");
  const endIdx   = raw.lastIndexOf("}");
  if (startIdx === -1) throw new Error("No JSON object in response");
  const parsed = JSON.parse(raw.slice(startIdx, endIdx + 1));

  if (typeof parsed.intent !== "string") throw new Error("Missing 'intent' field");
  if (!Array.isArray(parsed.steps))      throw new Error("Missing 'steps' array");

  console.log(`\n[live-check] ✅  SUCCESS`);
  console.log(`[live-check] Intent : ${parsed.intent}`);
  console.log(`[live-check] Steps  : ${parsed.steps.length}`);
  (parsed.steps as Array<{tool: string}>).forEach(s => console.log(`           • ${s.tool}`));

  const u = res.usage;
  if (u) console.log(`\n[live-check] Tokens : ${u.inputTokens} in + ${u.outputTokens} out`);

  console.log("\n[live-check] Bedrock + global.anthropic.claude-sonnet-4-6 verified ✓");
  process.exit(0);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  // Redact key prefix from error messages just in case
  const safe = msg.replace(new RegExp(token.slice(0, 8), "g"), "***");
  console.error(`\n[live-check] ❌  FAILED: ${safe}`);

  if (msg.includes("UnrecognizedClientException") || msg.includes("InvalidSignature")) {
    console.error("[live-check] Hint: Token invalid or expired.");
  } else if (msg.includes("AccessDeniedException")) {
    console.error("[live-check] Hint: Token lacks Bedrock access or model not enabled in region.");
  } else if (msg.includes("ResourceNotFound")) {
    console.error("[live-check] Hint: Model ID not found — check region and model access.");
  }
  process.exit(1);
}
