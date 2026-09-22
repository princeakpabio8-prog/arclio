/**
 * Result verifier
 *
 * Inspects execution results and produces a VerificationResult.
 * Rules are intent-aware — what counts as "passed" differs per intent.
 */
export function verifyResults(plan, results) {
    if (plan.intent === "unknown") {
        return {
            status: "failed",
            findings: [
                {
                    tool: "get_today_calendar",
                    ok: false,
                    detail: "No intent was recognised — no tools were called.",
                },
            ],
        };
    }
    if (results.length === 0) {
        return {
            status: "failed",
            findings: [],
        };
    }
    const findings = results.map((r) => ({
        tool: r.tool,
        ok: r.ok,
        detail: r.ok ? successDetail(r) : `Tool error: ${r.error ?? "unknown"}`,
    }));
    const failCount = findings.filter((f) => !f.ok).length;
    let status;
    if (failCount === 0) {
        status = "passed";
    }
    else if (failCount < results.length) {
        status = "partial";
    }
    else {
        status = "failed";
    }
    return { status, findings };
}
function successDetail(result) {
    const data = result.parsed;
    if (!data || typeof data !== "object")
        return "OK";
    switch (result.tool) {
        case "get_today_calendar": {
            const events = data["events"];
            return `Retrieved ${events?.length ?? 0} calendar event(s).`;
        }
        case "get_pending_deliveries": {
            const deliveries = data["deliveries"];
            return `Retrieved ${deliveries?.length ?? 0} pending delivery/deliveries.`;
        }
        case "get_security_events": {
            const events = data["events"];
            return `Retrieved ${events?.length ?? 0} security event(s).`;
        }
        case "mark_delivery_received": {
            if (data["success"] === true) {
                const d = data["delivery"];
                return `Delivery ${d?.["id"] ?? ""} marked as received at ${d?.["receivedAt"] ?? "unknown time"}.`;
            }
            return `Mark failed: ${data["error"] ?? "unknown reason"}`;
        }
        case "notify_procurement": {
            if (data["success"] === true) {
                const n = data["notification"];
                return `Notification sent (id: ${n?.["id"] ?? "?"}, subject: "${n?.["subject"] ?? "?"}")`;
            }
            return "Notification send failed.";
        }
        default:
            return "OK";
    }
}
//# sourceMappingURL=verifier.js.map