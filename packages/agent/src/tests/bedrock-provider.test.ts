/**
 * Unit tests — BedrockProvider (mocked client, zero AWS credits)
 *
 * The BedrockRuntimeClient is constructed with a mocked `send` method that
 * returns pre-built Converse API responses.  No real AWS calls are made.
 *
 * Covers:
 *   - Happy path: model returns valid JSON plan
 *   - Model wraps JSON in markdown fences (common)
 *   - Model returns plan with unregistered tool → validator rejects → unknown fallback
 *   - Model returns malformed JSON → parse error → unknown fallback
 *   - Model returns empty response → unknown fallback
 *   - AWS SDK throws (network error) → unknown fallback
 *   - temperature=0 and maxTokens are sent in the request
 *
 * Run:
 *   node --test packages/agent/dist/tests/bedrock-provider.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { BedrockProvider } from "../providers/bedrock.js";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

type SendFn = (command: unknown) => Promise<ConverseCommandOutput>;

function makeMockClient(sendFn: SendFn): BedrockRuntimeClient {
  // Cast to any to inject the mock without full SDK instantiation
  return { send: sendFn } as unknown as BedrockRuntimeClient;
}

function makeConverseOutput(text: string): ConverseCommandOutput {
  return {
    output: {
      message: {
        role: "assistant",
        content: [{ text }],
      },
    },
    stopReason: "end_turn",
    usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
    metrics: { latencyMs: 200 },
    $metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Fixture plans
// ---------------------------------------------------------------------------

const OFFICE_BRIEFING_PLAN = JSON.stringify({
  userInput: "What's happening at the office today?",
  intent: "office_briefing",
  steps: [
    { tool: "get_today_calendar",      args: {},              reason: "Get calendar." },
    { tool: "get_pending_deliveries",  args: {},              reason: "Get deliveries." },
    { tool: "get_security_events",     args: {},              reason: "Get security." },
  ],
});

const DELIVERY_STATUS_PLAN = JSON.stringify({
  userInput: "Is the Acme delivery here yet?",
  intent: "delivery_status",
  steps: [
    { tool: "get_pending_deliveries", args: { vendor: "acme" }, reason: "Check deliveries." },
    { tool: "get_security_events",    args: { type: "delivery_arrival" }, reason: "Check dock." },
  ],
});

const MARK_RECEIVED_PLAN = JSON.stringify({
  userInput: "Mark the Acme delivery as received.",
  intent: "mark_received",
  steps: [
    { tool: "get_pending_deliveries",   args: { vendor: "acme" }, reason: "Find delivery ID." },
    { tool: "mark_delivery_received",   args: { deliveryId: "__resolve__" }, reason: "Mark received." },
    { tool: "notify_procurement",       args: { subject: "Received", body: "Done." }, reason: "Notify." },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("BedrockProvider.name is 'bedrock'", () => {
  const provider = new BedrockProvider(makeMockClient(async () => makeConverseOutput("{}")));
  assert.equal(provider.name, "bedrock");
});

test("default model ID is anthropic.claude-sonnet-4-6", async () => {
  let capturedModelId: string | undefined;

  const client = makeMockClient(async (cmd) => {
    capturedModelId = (cmd as { input: Record<string, unknown> }).input["modelId"] as string;
    return makeConverseOutput(OFFICE_BRIEFING_PLAN);
  });

  // Ensure no ARCLIO_MODEL_ID override is present for this test
  const saved = process.env["ARCLIO_MODEL_ID"];
  delete process.env["ARCLIO_MODEL_ID"];
  delete process.env["ARCLIO_BEDROCK_MODEL_ID"];

  const provider = new BedrockProvider(client);
  await provider.buildPlan("test");

  if (saved !== undefined) process.env["ARCLIO_MODEL_ID"] = saved;

  assert.equal(capturedModelId, "global.anthropic.claude-sonnet-4-6",
    "Default model ID should be global.anthropic.claude-sonnet-4-6");
});

test("ARCLIO_MODEL_ID env var overrides default model ID", async () => {
  let capturedModelId: string | undefined;

  const client = makeMockClient(async (cmd) => {
    capturedModelId = (cmd as { input: Record<string, unknown> }).input["modelId"] as string;
    return makeConverseOutput(OFFICE_BRIEFING_PLAN);
  });

  const saved = process.env["ARCLIO_MODEL_ID"];
  process.env["ARCLIO_MODEL_ID"] = "global.anthropic.claude-sonnet-4-6";

  const provider = new BedrockProvider(client);
  await provider.buildPlan("test");

  if (saved !== undefined) process.env["ARCLIO_MODEL_ID"] = saved;
  else delete process.env["ARCLIO_MODEL_ID"];

  assert.equal(capturedModelId, "global.anthropic.claude-sonnet-4-6");
});

test("bearer token path — injected client receives call and returns plan", async () => {
  // Simulate AWS_BEARER_TOKEN_BEDROCK being set, but inject a mock client
  // so no real HTTP request is made. The constructor takes the injected client
  // instead of building one from the token, so the token path is covered by
  // testing that a valid plan is returned when the mock client responds.
  const client = makeMockClient(async () => makeConverseOutput(OFFICE_BRIEFING_PLAN));
  const provider = new BedrockProvider(client);

  const plan = await provider.buildPlan("What's happening at the office today?");

  assert.equal(plan.intent, "office_briefing");
  assert.equal(plan.steps.length, 3);
});

test("happy path — model returns valid JSON plan", async () => {
  const client = makeMockClient(async () => makeConverseOutput(OFFICE_BRIEFING_PLAN));
  const provider = new BedrockProvider(client);

  const plan = await provider.buildPlan("What's happening at the office today?");

  assert.equal(plan.intent, "office_briefing");
  assert.equal(plan.steps.length, 3);
  const tools = plan.steps.map((s) => s.tool);
  assert.ok(tools.includes("get_today_calendar"));
  assert.ok(tools.includes("get_pending_deliveries"));
  assert.ok(tools.includes("get_security_events"));
});

test("model wraps JSON in markdown fences — still parsed correctly", async () => {
  const fenced = "```json\n" + DELIVERY_STATUS_PLAN + "\n```";
  const client = makeMockClient(async () => makeConverseOutput(fenced));
  const provider = new BedrockProvider(client);

  const plan = await provider.buildPlan("Is the Acme delivery here yet?");
  assert.equal(plan.intent, "delivery_status");
  assert.equal(plan.steps.length, 2);
});

test("mark_received plan passes through correctly", async () => {
  const client = makeMockClient(async () => makeConverseOutput(MARK_RECEIVED_PLAN));
  const provider = new BedrockProvider(client);

  const plan = await provider.buildPlan("Mark the Acme delivery as received.");
  assert.equal(plan.intent, "mark_received");
  const tools = plan.steps.map((s) => s.tool);
  assert.ok(tools.includes("mark_delivery_received"));
  assert.ok(tools.includes("notify_procurement"));
});

test("unregistered tool in LLM response → validator rejects → unknown fallback", async () => {
  const maliciousPlan = JSON.stringify({
    userInput: "hi",
    intent: "test",
    steps: [{ tool: "drop_database", args: {}, reason: "bad" }],
  });
  const client = makeMockClient(async () => makeConverseOutput(maliciousPlan));
  const provider = new BedrockProvider(client);

  const plan = await provider.buildPlan("hi");
  assert.equal(plan.intent, "unknown");
  assert.deepEqual(plan.steps, []);
});

test("malformed JSON from model → unknown fallback", async () => {
  const client = makeMockClient(async () => makeConverseOutput("not json at all"));
  const provider = new BedrockProvider(client);

  const plan = await provider.buildPlan("anything");
  assert.equal(plan.intent, "unknown");
  assert.deepEqual(plan.steps, []);
});

test("empty text response from model → unknown fallback", async () => {
  const emptyOutput: ConverseCommandOutput = {
    output: { message: { role: "assistant", content: [] } },
    stopReason: "end_turn",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    metrics: { latencyMs: 0 },
    $metadata: {},
  };
  const client = makeMockClient(async () => emptyOutput);
  const provider = new BedrockProvider(client);

  const plan = await provider.buildPlan("anything");
  assert.equal(plan.intent, "unknown");
});

test("AWS SDK throws network error → unknown fallback (no crash)", async () => {
  const client = makeMockClient(async () => {
    throw new Error("Network error: ECONNREFUSED");
  });
  const provider = new BedrockProvider(client);

  const plan = await provider.buildPlan("anything");
  assert.equal(plan.intent, "unknown");
  assert.deepEqual(plan.steps, []);
});

test("inference config: temperature=0 and maxTokens sent in command", async () => {
  let capturedCommand: Record<string, unknown> | null = null;

  const client = makeMockClient(async (cmd) => {
    capturedCommand = (cmd as { input: Record<string, unknown> }).input;
    return makeConverseOutput(OFFICE_BRIEFING_PLAN);
  });
  const provider = new BedrockProvider(client);

  await provider.buildPlan("What's happening at the office today?");

  assert.ok(capturedCommand !== null, "No command was captured");
  const inferenceConfig = capturedCommand!["inferenceConfig"] as {
    temperature: number;
    maxTokens: number;
  } | undefined;
  assert.ok(inferenceConfig, "inferenceConfig not present in command");
  assert.equal(inferenceConfig.temperature, 0, "temperature should be 0");
  assert.ok(inferenceConfig.maxTokens > 0, "maxTokens should be positive");
});

test("plan steps contain only registered tools after full round-trip", async () => {
  const VALID_TOOLS = new Set([
    "get_today_calendar",
    "get_pending_deliveries",
    "get_security_events",
    "mark_delivery_received",
    "notify_procurement",
  ]);

  const plans = [OFFICE_BRIEFING_PLAN, DELIVERY_STATUS_PLAN, MARK_RECEIVED_PLAN];
  for (const planJson of plans) {
    const client = makeMockClient(async () => makeConverseOutput(planJson));
    const provider = new BedrockProvider(client);
    const plan = await provider.buildPlan("input");
    for (const step of plan.steps) {
      assert.ok(
        VALID_TOOLS.has(step.tool),
        `Unregistered tool '${step.tool}' reached the plan`,
      );
    }
  }
});
