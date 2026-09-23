# Arclio — Governance Architecture

> **Scope:** This document describes the *intended long-term architectural direction* for Arclio's governance and execution model. It is not a description of the current hackathon/demo implementation, which is intentionally lightweight and does not include the controls described here. Do not interpret this document as a claim about functionality already present in the current build.

---

## Overview

The current Arclio execution model is:

```
Request
  ↓
Understand
  ↓
Plan
  ↓
Execute
  ↓
Verify
```

This is sufficient for a demonstration of agentic orchestration. For production deployment in an enterprise context, additional layers are required between **Plan** and **Execute**, and after **Verify**, to ensure that actions are properly authorized, recorded, and attributable.

The intended long-term model is:

```
Request
  ↓
Understand
  ↓
Plan
  ↓
Governance Check ──┬── Deny
                   ├── Require Approval
                   └── Allow
                          ↓
                        Execute
                          ↓
                        Verify
                          ↓
                        Audit
```

---

## Governance Layers

### Identity

**What it answers:** Who initiated this request?

Every request to the system must be attributable to an authenticated actor — a human user, a service account, or an external system. Identity is the foundation on which all other governance layers depend.

Without identity, authorization is impossible: the system cannot check whether an action is permitted if it does not know who is asking.

**Future considerations:**
- Integration with an identity provider (IdP)
- Session tokens or signed request context passed through the agent pipeline
- Support for delegated identity (acting on behalf of another principal)

---

### Authorization

**What it answers:** Is this actor permitted to perform the requested action?

Authorization determines whether the authenticated identity has the right to invoke the tools and take the actions described in the plan. This is checked before execution begins.

Authorization is distinct from plan validation (which checks structural correctness and tool allowlist membership). Authorization adds actor-awareness: the same tool call may be permitted for one user and denied for another.

**Future considerations:**
- Role-based access control (RBAC) at the tool level
- Resource-scoped permissions (e.g. "may mark deliveries received for site A but not site B")
- Integration with an authorization service or policy engine

---

### Policy

**What it answers:** Is the action permitted under organizational rules?

Policy enforcement is the layer between authorization and execution. It evaluates the planned action against organizational rules that go beyond individual actor permissions — for example:

- "No delivery may be marked received outside business hours without a supervisor approval."
- "Procurement notifications above a threshold value require a secondary approver."
- "Security log queries are permitted, but export operations require compliance review."

Policy operates on the *plan* (the full sequence of tool calls and their arguments), not just on individual tool names. A plan that is individually tool-allowlist-compliant may still fail a policy check when evaluated holistically.

**Future considerations:**
- Declarative policy language (e.g. OPA/Rego, Cedar)
- Policy versioning and rollback
- Organization-specific rule sets applied at runtime

---

### Human Approval

**What it answers:** Does this action require explicit human sign-off before it executes?

Some actions are consequential enough that they should not proceed automatically, even when the actor is authorized and the plan passes policy. Human approval gates allow an organization to require explicit human confirmation for high-stakes or irreversible operations.

Examples:
- Marking a high-value delivery received
- Sending notifications to external parties
- Initiating a procurement action above a certain value

**Future considerations:**
- Approval routing (who is the right approver for this action?)
- Asynchronous approval with time-bounded expiry
- Escalation paths when the primary approver is unavailable
- Approval state surfaced in the web UI

---

### Execution

**What it answers:** What action was actually performed?

Execution is the current MCP tool layer. In the governed model, execution is gated by identity, authorization, and policy — it only runs when all upstream checks have passed (or been explicitly overridden with appropriate authority).

The execution record captures: which tools were called, with what arguments, at what time, and under what authorization context.

---

### Verification

**What it answers:** Did the requested outcome actually occur?

Post-execution verification is already implemented in the current Arclio build. The verifier inspects tool results against the declared intent and produces a `passed`, `partial`, or `failed` status.

In the governed model, the verification result becomes part of the audit record — it is not just a user-facing status but a durable, attributable statement of outcome.

---

### Audit

**What it answers:** What happened, when, why, and who authorized it?

The audit layer produces an immutable, queryable record of every execution cycle. An audit entry captures the full context of a request: the identity of the actor, the intent detected, the plan produced, the governance decisions taken, the tools executed, the verification outcome, and any human approvals that occurred along the way.

Audit records enable:
- Post-hoc review of agent actions
- Compliance reporting
- Incident investigation
- Operational memory (patterns in what was asked and done over time)

**Future considerations:**
- Append-only audit log (database or log service)
- Structured audit events with a defined schema
- Retention and archival policy
- Query interface for audit review (by actor, by tool, by time range, by outcome)

---

## Relationship to Current Implementation

| Layer | Current status |
|---|---|
| **Identity** | Not implemented. Requests are anonymous in the demo. |
| **Authorization** | Partially present — the plan validator enforces a tool allowlist, but this is structural, not actor-aware. |
| **Policy** | Not implemented. |
| **Human approval** | Not implemented. All plans execute automatically if they pass validation. |
| **Execution** | Implemented via MCP tool layer. |
| **Verification** | Implemented — `passed` / `partial` / `failed` status per execution. |
| **Audit** | Not implemented. Execution history is not durably recorded. |

The current implementation is appropriate for a hackathon demonstration. It is not suitable for production deployment in contexts that require accountability, compliance, or fine-grained access control.

---

## Migration Path

Moving from the current demo architecture to a governed execution model is intended to be incremental:

1. **Identity first** — introduce authenticated sessions. Everything else depends on knowing who is acting.
2. **Authorization layer** — add actor-aware tool permission checks, initially as a simple role-to-tool mapping.
3. **Audit log** — capture execution events durably. Even a simple append-only log provides significant accountability.
4. **Policy engine** — once identity and audit are in place, policy rules can be evaluated against real actor context.
5. **Approval workflows** — add human-in-the-loop gates for high-stakes actions, building on the policy layer to determine when approval is required.
6. **Organizational memory** — accumulate operational history and use it to surface patterns, anomalies, and recurring action types.

Each step adds value independently and does not require the next step to be in place first.

---

## Architectural Intent

Arclio's intended differentiation is not ownership of a foundation model. It is the orchestration and governed execution layer that sits between a user's natural-language intent and the real-world actions taken on their behalf.

The combination of:
- Cross-system operational context (what is actually happening across multiple business systems)
- Action orchestration (structured, validated, multi-step plans)
- Governed execution (identity, authorization, policy, approval)
- Verified outcomes (did it actually happen?)
- Audit trail (what happened, when, and why)
- Organizational memory (accumulated operational history)

...represents a layer that is specific to an organization's operations, policies, and history — and therefore not easily replicated by substituting a different foundation model.

This is an architectural direction, not a claim about the current implementation.
