/**
 * Unit tests — plan-validator
 *
 * Verifies that the validator accepts well-formed plans and rejects:
 *   - structurally malformed objects
 *   - plans referencing unregistered tools
 *   - plans that exceed the step limit
 *
 * Run:
 *   node --test packages/agent/dist/tests/plan-validator.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlan, PlanValidationError } from "../plan-validator.js";

// ---------------------------------------------------------------------------
// Valid plan fixture
// ---------------------------------------------------------------------------

const VALID_PLAN = {
  userInput: "What's happening today?",
  intent: "office_briefing",
  steps: [
    {
      tool: "get_today_calendar",
      args: {},
      reason: "Retrieve calendar events.",
    },
    {
      tool: "get_pending_deliveries",
      args: { vendor: "acme" },
      reason: "Check deliveries.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("accepts a valid plan", () => {
  const result = validatePlan(VALID_PLAN);
  assert.equal(result.intent, "office_briefing");
  assert.equal(result.steps.length, 2);
});

test("accepts plan with empty steps", () => {
  const result = validatePlan({ userInput: "hi", intent: "unknown", steps: [] });
  assert.equal(result.intent, "unknown");
  assert.deepEqual(result.steps, []);
});

test("rejects non-object input", () => {
  assert.throws(
    () => validatePlan("not an object"),
    PlanValidationError,
  );
});

test("rejects plan missing 'intent'", () => {
  assert.throws(
    () => validatePlan({ userInput: "hi", steps: [] }),
    PlanValidationError,
  );
});

test("rejects step missing 'reason'", () => {
  assert.throws(
    () =>
      validatePlan({
        userInput: "hi",
        intent: "calendar_only",
        steps: [{ tool: "get_today_calendar", args: {} }],
      }),
    PlanValidationError,
  );
});

test("rejects unregistered tool name", () => {
  let caught: PlanValidationError | null = null;
  try {
    validatePlan({
      userInput: "hi",
      intent: "test",
      steps: [
        {
          tool: "drop_database",
          args: {},
          reason: "Malicious step",
        },
      ],
    });
  } catch (err) {
    caught = err as PlanValidationError;
  }
  assert.ok(caught instanceof PlanValidationError, "should throw PlanValidationError");
  assert.ok(
    caught.violations.some((v) => v.includes("drop_database")),
    "violation should name the offending tool",
  );
});

test("rejects plan exceeding MAX_STEPS (10)", () => {
  const steps = Array.from({ length: 11 }, () => ({
    tool: "get_today_calendar",
    args: {},
    reason: "Step",
  }));
  assert.throws(
    () => validatePlan({ userInput: "hi", intent: "test", steps }),
    PlanValidationError,
  );
});

test("multiple unregistered tools reported as separate violations", () => {
  let caught: PlanValidationError | null = null;
  try {
    validatePlan({
      userInput: "hi",
      intent: "test",
      steps: [
        { tool: "bad_tool_1", args: {}, reason: "r1" },
        { tool: "bad_tool_2", args: {}, reason: "r2" },
      ],
    });
  } catch (err) {
    caught = err as PlanValidationError;
  }
  assert.ok(caught instanceof PlanValidationError);
  assert.equal(caught.violations.length, 2);
});
