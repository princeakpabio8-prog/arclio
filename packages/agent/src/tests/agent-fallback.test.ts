/**
 * Unit tests — agent stub fallback
 *
 * Verifies that when a non-stub LLM provider (e.g. Bedrock) returns
 * intent:"unknown" (due to a network/auth failure), the agent pipeline
 * automatically falls back to the StubProvider for deterministic intent
 * matching.  This covers the production failure mode where
 * ARCLIO_LLM_PROVIDER=bedrock is set but credentials are invalid.
 *
 * Run:
 *   node --test packages/agent/dist/tests/agent-fallback.test.js
 */

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runAgent, setProvider, resetProvider } from "../agent.js";
import type { LLMProvider } from "../llm-provider.js";
import type { Plan } from "../types.js";

// ---------------------------------------------------------------------------
// Mock provider that always returns unknown (simulates Bedrock auth failure)
// ---------------------------------------------------------------------------

class AlwaysUnknownProvider implements LLMProvider {
  readonly name = "bedrock"; // Must NOT be "stub" to trigger fallback

  async buildPlan(userInput: string): Promise<Plan> {
    // Simulates Bedrock catching an error and returning unknown
    return { userInput, intent: "unknown", steps: [] };
  }
}

afterEach(() => {
  resetProvider();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("stub fallback — 'Give me a business briefing today' succeeds when primary returns unknown", async () => {
  setProvider(new AlwaysUnknownProvider());

  const response = await runAgent("Give me a business briefing today");

  // The stub fallback should have matched business_briefing
  assert.equal(response.intent, "business_briefing",
    "Agent should fall back to stub and match business_briefing intent");

  // Verification should not be 'failed' (all 3 tools succeed in direct mode)
  assert.notEqual(response.verification.status, "failed",
    "Verification should not be failed after successful stub fallback");

  // Answer should not be the error/unknown message
  assert.ok(
    !response.answer.includes("I'm not sure what you're asking"),
    "Answer should not be the unknown-intent help message after fallback",
  );
});

test("stub fallback — 'What needs my attention today?' succeeds when primary returns unknown", async () => {
  setProvider(new AlwaysUnknownProvider());

  const response = await runAgent("What needs my attention today?");

  assert.equal(response.intent, "needs_attention");
  assert.notEqual(response.verification.status, "failed");
});

test("stub fallback — 'Is anything waiting on me?' succeeds when primary returns unknown", async () => {
  setProvider(new AlwaysUnknownProvider());

  const response = await runAgent("Is anything waiting on me?");

  assert.equal(response.intent, "waiting_on_me");
  assert.notEqual(response.verification.status, "failed");
});

test("stub fallback — 'Handle the Acme delivery.' succeeds when primary returns unknown", async () => {
  setProvider(new AlwaysUnknownProvider());

  const response = await runAgent("Handle the Acme delivery.");

  assert.equal(response.intent, "mark_received",
    "Agent should fall back to stub and match mark_received intent for delivery handling");
  assert.notEqual(response.verification.status, "failed");
  assert.ok(
    !response.answer.includes("I'm not sure what you're asking"),
    "Answer should not be the unknown-intent help message after fallback",
  );
});

test("stub fallback — 'What should I follow up on today?' succeeds when primary returns unknown", async () => {
  setProvider(new AlwaysUnknownProvider());

  const response = await runAgent("What should I follow up on today?");

  assert.equal(response.intent, "follow_ups",
    "Agent should fall back to stub and match follow_ups intent");
  assert.notEqual(response.verification.status, "failed");
  assert.ok(
    !response.answer.includes("I'm not sure what you're asking"),
    "Answer should not be the unknown-intent help message after fallback",
  );
});

test("stub fallback — genuine unknown query stays unknown even after fallback attempt", async () => {
  setProvider(new AlwaysUnknownProvider());

  const response = await runAgent("Order me a pizza");

  // Stub also returns unknown for this → should stay unknown
  assert.equal(response.intent, "unknown",
    "Truly unknown queries should remain unknown even after stub fallback");
});

test("stub fallback — NOT triggered when provider is stub (provider.name === 'stub')", async () => {
  // When StubProvider itself is the provider, the fallback block is skipped
  // (provider.name === "stub"). This test verifies no infinite recursion occurs.
  // The stub is the default when ARCLIO_LLM_PROVIDER is not set, so just run
  // with a fresh singleton.
  resetProvider();

  const response = await runAgent("What meetings do I have today?");

  // With a clean slate (no env override), stub provider is created and used directly
  assert.equal(response.intent, "calendar_only");
});
