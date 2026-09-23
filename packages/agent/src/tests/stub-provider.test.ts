/**
 * Unit tests — StubProvider
 *
 * Verifies that the deterministic planner produces correct plans for all
 * supported intents.  No network calls.  Runs with Node built-in test runner.
 *
 * Run:
 *   node --test packages/agent/dist/tests/stub-provider.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { StubProvider } from "../providers/stub.js";

const stub = new StubProvider();

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function toolNames(plan: Awaited<ReturnType<typeof stub.buildPlan>>): string[] {
  return plan.steps.map((s) => s.tool);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("StubProvider.name is 'stub'", () => {
  assert.equal(stub.name, "stub");
});

test("office_briefing — calls all three tools", async () => {
  const plan = await stub.buildPlan("What's happening at the office today?");
  assert.equal(plan.intent, "office_briefing");
  const tools = toolNames(plan);
  assert.ok(tools.includes("get_today_calendar"), "missing get_today_calendar");
  assert.ok(tools.includes("get_pending_deliveries"), "missing get_pending_deliveries");
  assert.ok(tools.includes("get_security_events"), "missing get_security_events");
});

test("delivery_status — Acme query calls pending + security", async () => {
  const plan = await stub.buildPlan("Is the Acme delivery here yet?");
  assert.equal(plan.intent, "delivery_status");
  const tools = toolNames(plan);
  assert.ok(tools.includes("get_pending_deliveries"), "missing get_pending_deliveries");
  assert.ok(tools.includes("get_security_events"), "missing get_security_events");
  // vendor arg should be scoped to acme
  const delStep = plan.steps.find((s) => s.tool === "get_pending_deliveries")!;
  assert.equal((delStep.args as { vendor?: string }).vendor, "acme");
});

test("mark_received — not misrouted to delivery_status", async () => {
  const plan = await stub.buildPlan(
    "Mark the Acme delivery as received and notify procurement.",
  );
  assert.equal(plan.intent, "mark_received");
  const tools = toolNames(plan);
  assert.ok(tools.includes("mark_delivery_received"), "missing mark_delivery_received");
  assert.ok(tools.includes("notify_procurement"), "missing notify_procurement");
});

test("mark_received — without notify keyword omits notify_procurement", async () => {
  const plan = await stub.buildPlan("Mark the Acme delivery as received.");
  assert.equal(plan.intent, "mark_received");
  assert.ok(
    !toolNames(plan).includes("notify_procurement"),
    "should not include notify_procurement without keyword",
  );
});

test("calendar_only — only calls get_today_calendar", async () => {
  const plan = await stub.buildPlan("What meetings do I have today?");
  assert.equal(plan.intent, "calendar_only");
  assert.deepEqual(toolNames(plan), ["get_today_calendar"]);
});

test("security_only — only calls get_security_events", async () => {
  const plan = await stub.buildPlan("Show me the security events log.");
  assert.equal(plan.intent, "security_only");
  assert.deepEqual(toolNames(plan), ["get_security_events"]);
});

// ---------------------------------------------------------------------------
// needs_attention — exact suggested prompt + natural speech variations
// ---------------------------------------------------------------------------

test("needs_attention — exact suggested prompt", async () => {
  const plan = await stub.buildPlan("What needs my attention?");
  assert.equal(plan.intent, "needs_attention");
});

test("needs_attention — with trailing 'today' (reported voice failure)", async () => {
  const plan = await stub.buildPlan("What needs my attention today?");
  assert.equal(plan.intent, "needs_attention");
});

test("needs_attention — 'pay attention to today' variation", async () => {
  const plan = await stub.buildPlan("What do I need to pay attention to today?");
  assert.equal(plan.intent, "needs_attention");
});

test("needs_attention — 'deal with today' variation", async () => {
  const plan = await stub.buildPlan("Is there anything I need to deal with today?");
  assert.equal(plan.intent, "needs_attention");
});

test("needs_attention — calls the three urgency tools", async () => {
  const plan = await stub.buildPlan("What needs my attention today?");
  const tools = toolNames(plan);
  assert.ok(tools.includes("get_pending_deliveries"), "missing get_pending_deliveries");
  assert.ok(tools.includes("get_today_calendar"), "missing get_today_calendar");
  assert.ok(tools.includes("get_security_events"), "missing get_security_events");
});

// Regression: office_briefing must not capture "attention" via the word "on"
test("office_briefing — 'What is on today' still routes correctly", async () => {
  const plan = await stub.buildPlan("What is on today?");
  assert.equal(plan.intent, "office_briefing");
});

test("office_briefing — NOT triggered by attention query containing 'on'", async () => {
  const plan = await stub.buildPlan("What do I need to pay attention to today?");
  assert.notEqual(plan.intent, "office_briefing");
});

test("unknown intent — returns empty steps", async () => {
  const plan = await stub.buildPlan("Order me a pizza");
  assert.equal(plan.intent, "unknown");
  assert.deepEqual(plan.steps, []);
});

test("all steps reference only registered tool names", async () => {
  const inputs = [
    "What's happening at the office today?",
    "Is the Acme delivery here yet?",
    "Mark the Acme delivery as received and notify procurement.",
    "What meetings do I have?",
    "Show me the security alerts.",
  ];
  const VALID = new Set([
    "get_today_calendar",
    "get_pending_deliveries",
    "get_security_events",
    "mark_delivery_received",
    "notify_procurement",
  ]);
  for (const input of inputs) {
    const plan = await stub.buildPlan(input);
    for (const step of plan.steps) {
      assert.ok(VALID.has(step.tool), `Unregistered tool '${step.tool}' in plan for: "${input}"`);
    }
  }
});
