/**
 * MCP tool executor
 *
 * Sends each planned tool call to the Arclio MCP server over Streamable HTTP
 * and collects the results. Handles session lifecycle automatically.
 *
 * Special runtime resolution:
 *   mark_delivery_received with deliveryId "__resolve__" will look up the
 *   actual delivery ID from a prior get_pending_deliveries result.
 */
const MCP_BASE_URL = process.env.MCP_BASE_URL ?? "http://localhost:3001/mcp";
async function mcpPost(url, body, sessionId) {
    const headers = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
    };
    if (sessionId)
        headers["mcp-session-id"] = sessionId;
    const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    const returnedSessionId = res.headers.get("mcp-session-id");
    const contentType = res.headers.get("content-type") ?? "";
    // Streamable HTTP may return SSE for streaming responses; handle both
    let json;
    if (contentType.includes("text/event-stream")) {
        json = await parseSseResponse(res);
    }
    else {
        json = (await res.json());
    }
    return { response: json, sessionId: returnedSessionId };
}
/**
 * Read an SSE stream incrementally and return the first complete JSON-RPC
 * message found in a `data:` line.
 *
 * The MCP SDK keeps the SSE stream open indefinitely (with keep-alive frames),
 * so we MUST NOT use res.text() — that would block until the stream closes.
 * Instead we read chunks as they arrive, buffer partial lines, and return as
 * soon as we have one parseable JSON-RPC response.
 */
async function parseSseResponse(res) {
    if (!res.body) {
        throw new Error("SSE response has no body");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            // Process all complete lines in the buffer
            const lines = buffer.split("\n");
            // Keep the last (potentially incomplete) line in the buffer
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const data = line.slice(6).trim();
                    if (data && data !== "[DONE]") {
                        try {
                            const parsed = JSON.parse(data);
                            // Got a valid JSON-RPC message — stop reading the stream
                            reader.cancel().catch(() => { });
                            return parsed;
                        }
                        catch {
                            // skip malformed data lines
                        }
                    }
                }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
    throw new Error("No valid JSON-RPC message found in SSE stream.");
}
async function openSession() {
    let counter = 1;
    const nextId = () => counter++;
    const initRequest = {
        jsonrpc: "2.0",
        id: nextId(),
        method: "initialize",
        params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "arclio-agent", version: "0.1.0" },
        },
    };
    const { response, sessionId } = await mcpPost(MCP_BASE_URL, initRequest);
    if (response.error) {
        throw new Error(`MCP initialize failed: ${response.error.message}`);
    }
    if (!sessionId) {
        throw new Error("MCP server did not return a session ID.");
    }
    // Send initialized notification
    await fetch(MCP_BASE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "mcp-session-id": sessionId,
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
        }),
    });
    return { sessionId, nextId };
}
async function closeSession(sessionId) {
    await fetch(MCP_BASE_URL, {
        method: "DELETE",
        headers: { "mcp-session-id": sessionId },
    }).catch(() => {
        // Best-effort close — ignore errors
    });
}
// ---------------------------------------------------------------------------
// Execute a single tool call
// ---------------------------------------------------------------------------
async function executeToolCall(session, toolCall) {
    const { response } = await mcpPost(MCP_BASE_URL, {
        jsonrpc: "2.0",
        id: session.nextId(),
        method: "tools/call",
        params: {
            name: toolCall.tool,
            arguments: toolCall.args,
        },
    }, session.sessionId);
    if (response.error) {
        return {
            tool: toolCall.tool,
            args: toolCall.args,
            raw: JSON.stringify(response.error),
            parsed: response.error,
            ok: false,
            error: response.error.message,
        };
    }
    // MCP tool results come back as { content: [{ type: "text", text: "..." }] }
    const result = response.result;
    const rawText = result?.content?.find((c) => c.type === "text")?.text ?? "";
    let parsed = rawText;
    try {
        parsed = JSON.parse(rawText);
    }
    catch {
        // leave as string
    }
    return {
        tool: toolCall.tool,
        args: toolCall.args,
        raw: rawText,
        parsed,
        ok: true,
    };
}
// ---------------------------------------------------------------------------
// Runtime resolution of "__resolve__" delivery IDs
// ---------------------------------------------------------------------------
function resolveDeliveryId(step, priorResults) {
    if (step.tool !== "mark_delivery_received" ||
        step.args["deliveryId"] !== "__resolve__") {
        return step;
    }
    const vendor = step.args["vendor"]?.toLowerCase();
    // Find the most recent get_pending_deliveries result
    const deliveriesResult = [...priorResults]
        .reverse()
        .find((r) => r.tool === "get_pending_deliveries" && r.ok);
    if (!deliveriesResult) {
        return { ...step, args: { ...step.args, deliveryId: "__unresolved__" } };
    }
    const data = deliveriesResult.parsed;
    const candidates = (data?.deliveries ?? []).filter((d) => d.status !== "received" &&
        (!vendor || d.vendor.toLowerCase().includes(vendor)));
    if (candidates.length === 0) {
        return { ...step, args: { ...step.args, deliveryId: "__unresolved__" } };
    }
    const { vendor: _v, ...restArgs } = step.args;
    return {
        ...step,
        args: {
            ...restArgs,
            deliveryId: candidates[0].id,
        },
    };
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function executePlan(plan) {
    if (plan.steps.length === 0)
        return [];
    const session = await openSession();
    const results = [];
    try {
        for (const step of plan.steps) {
            const resolvedStep = resolveDeliveryId(step, results);
            const result = await executeToolCall(session, resolvedStep);
            results.push(result);
        }
    }
    finally {
        await closeSession(session.sessionId);
    }
    return results;
}
//# sourceMappingURL=executor.js.map