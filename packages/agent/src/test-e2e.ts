/**
 * End-to-end test script for the three Arclio demo workflows.
 * Requires the MCP server to be running on http://localhost:3001
 *
 * Run: node packages/agent/dist/test-e2e.js
 */

import { runAgent } from "./agent.js";

const DIVIDER = "═".repeat(64);
const SEP     = "─".repeat(64);

interface TestCase {
  label: string;
  input: string;
  verify: (result: Awaited<ReturnType<typeof runAgent>>) => string[];
}

const TESTS: TestCase[] = [
  // -----------------------------------------------------------------------
  // TEST 1 — office briefing
  // -----------------------------------------------------------------------
  {
    label: "TEST 1 — What's happening at the office today?",
    input: "What's happening at the office today?",
    verify(r) {
      const errors: string[] = [];
      const tools = r.results.map((x) => x.tool);

      if (!tools.includes("get_today_calendar"))
        errors.push("MISSING: get_today_calendar was not called");
      if (!tools.includes("get_pending_deliveries"))
        errors.push("MISSING: get_pending_deliveries was not called");
      if (!tools.includes("get_security_events"))
        errors.push("MISSING: get_security_events was not called");

      const calResult = r.results.find((x) => x.tool === "get_today_calendar");
      const calData = calResult?.parsed as { events?: unknown[] } | null;
      if (!calData?.events?.length)
        errors.push("FAIL: Calendar returned no events");

      const delResult = r.results.find((x) => x.tool === "get_pending_deliveries");
      const delData = delResult?.parsed as { deliveries?: unknown[] } | null;
      if (!delData?.deliveries?.length)
        errors.push("FAIL: Procurement returned no deliveries");

      const secResult = r.results.find((x) => x.tool === "get_security_events");
      const secData = secResult?.parsed as { events?: unknown[] } | null;
      if (!secData?.events?.length)
        errors.push("FAIL: Security returned no events");

      if (r.verification.status === "failed")
        errors.push(`FAIL: verification status is '${r.verification.status}'`);

      return errors;
    },
  },

  // -----------------------------------------------------------------------
  // TEST 2 — delivery status
  // -----------------------------------------------------------------------
  {
    label: "TEST 2 — Is the Acme delivery here yet?",
    input: "Is the Acme delivery here yet?",
    verify(r) {
      const errors: string[] = [];
      const tools = r.results.map((x) => x.tool);

      if (!tools.includes("get_pending_deliveries"))
        errors.push("MISSING: get_pending_deliveries was not called");
      if (!tools.includes("get_security_events"))
        errors.push("MISSING: get_security_events was not called");

      const delResult = r.results.find((x) => x.tool === "get_pending_deliveries");
      const delData = delResult?.parsed as { deliveries?: Array<{ vendor: string }> } | null;
      const hasAcme = (delData?.deliveries ?? []).some((d) =>
        d.vendor.toLowerCase().includes("acme"),
      );
      if (!hasAcme)
        errors.push("FAIL: Acme delivery not found in procurement results");

      const secResult = r.results.find((x) => x.tool === "get_security_events");
      const secData = secResult?.parsed as { events?: Array<{ type: string }> } | null;
      const hasArrival = (secData?.events ?? []).some(
        (e) => e.type === "delivery_arrival",
      );
      if (!hasArrival)
        errors.push("FAIL: No delivery_arrival event found in security log");

      if (!r.answer.toLowerCase().includes("acme") && !r.answer.toLowerCase().includes("delivery"))
        errors.push("FAIL: Answer does not mention the Acme delivery");

      if (r.verification.status === "failed")
        errors.push(`FAIL: verification status is '${r.verification.status}'`);

      return errors;
    },
  },

  // -----------------------------------------------------------------------
  // TEST 3 — mark received + notify
  // -----------------------------------------------------------------------
  {
    label: "TEST 3 — Mark the Acme delivery as received and notify procurement",
    input: "Mark the Acme delivery as received and notify procurement.",
    verify(r) {
      const errors: string[] = [];
      const tools = r.results.map((x) => x.tool);

      if (!tools.includes("mark_delivery_received"))
        errors.push("MISSING: mark_delivery_received was not called");
      if (!tools.includes("notify_procurement"))
        errors.push("MISSING: notify_procurement was not called");

      const markResult = r.results.find((x) => x.tool === "mark_delivery_received");
      const markData = markResult?.parsed as { success?: boolean; delivery?: { status: string } } | null;
      if (!markData?.success)
        errors.push(`FAIL: mark_delivery_received did not succeed — ${markResult?.error ?? JSON.stringify(markData)}`);
      if (markData?.delivery?.status !== "received")
        errors.push(`FAIL: delivery status is '${markData?.delivery?.status}', expected 'received'`);

      const notifyResult = r.results.find((x) => x.tool === "notify_procurement");
      const notifyData = notifyResult?.parsed as { success?: boolean } | null;
      if (!notifyData?.success)
        errors.push(`FAIL: notify_procurement did not succeed — ${notifyResult?.error ?? JSON.stringify(notifyData)}`);

      if (r.verification.status === "failed")
        errors.push(`FAIL: verification status is '${r.verification.status}'`);

      if (!r.answer.toLowerCase().includes("received"))
        errors.push("FAIL: Answer does not confirm receipt");

      return errors;
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(DIVIDER);
  console.log("  Arclio End-to-End Test Suite");
  console.log(DIVIDER);
  console.log();

  let passed = 0;
  let failed = 0;

  for (const test of TESTS) {
    console.log(`\n${SEP}`);
    console.log(`  ${test.label}`);
    console.log(SEP);
    console.log(`  Input: "${test.input}"`);
    console.log();

    let result: Awaited<ReturnType<typeof runAgent>>;
    try {
      result = await runAgent(test.input);
    } catch (err) {
      console.error(`  ❌ EXCEPTION: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
      continue;
    }

    // Print pipeline summary
    console.log(`  Intent:       ${result.intent}`);
    console.log(`  Steps run:    ${result.results.length}`);
    console.log(`  Verification: ${result.verification.status}`);
    console.log();

    // Print tool results
    for (const r of result.results) {
      const status = r.ok ? "✓" : "✗";
      console.log(`  [${status}] ${r.tool}`);
      if (!r.ok) console.log(`      error: ${r.error}`);
    }

    // Print answer
    console.log();
    console.log("  ─── ANSWER ───────────────────────────────────────────");
    result.answer.split("\n").forEach((line) => console.log(`  ${line}`));
    console.log("  ──────────────────────────────────────────────────────");

    // Run assertions
    const errors = test.verify(result);
    console.log();
    if (errors.length === 0) {
      console.log("  ✅ PASS");
      passed++;
    } else {
      console.log("  ❌ FAIL");
      errors.forEach((e) => console.log(`     ${e}`));
      failed++;
    }
  }

  console.log();
  console.log(DIVIDER);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(DIVIDER);
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
