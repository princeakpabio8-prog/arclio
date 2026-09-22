/**
 * planner.ts — compatibility shim
 *
 * The planner logic now lives in providers/stub.ts (StubProvider).
 * This file re-exports buildPlan as a thin wrapper so any direct callers
 * continue to work during the transition.
 */

import { StubProvider } from "./providers/stub.js";

const _stub = new StubProvider();

/** @deprecated Use StubProvider directly or the provider factory. */
export async function buildPlan(
  userInput: string,
): ReturnType<StubProvider["buildPlan"]> {
  return _stub.buildPlan(userInput);
}
