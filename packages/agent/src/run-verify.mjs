/**
 * Bedrock live verification runner — injects credentials from argument
 * Usage: node dist/run-verify.js <base64-encoded-key>
 * The key is never written to disk; it exists only in process memory.
 */

const b64key = process.argv[2];
if (!b64key) {
  console.error("[runner] Usage: node dist/run-verify.js <base64-key>");
  process.exit(1);
}

// Decode and inject into env before the verification module loads
process.env["AWS_BEARER_TOKEN_BEDROCK"] = Buffer.from(b64key, "base64").toString("utf-8");
process.env["AWS_REGION"] = "us-east-1";
process.env["ARCLIO_MODEL_ID"] = "anthropic.claude-sonnet-4-6";

// Dynamically import the verification script (ESM)
const { default: _ } = await import("./verify-bedrock-live.js").catch(async () => {
  // verify-bedrock-live is not a module with default export — just import it for side effects
  return {};
});
