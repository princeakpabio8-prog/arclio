/**
 * LLMProvider interface
 *
 * Every planning backend (stub, Bedrock, future OpenAI, …) implements this
 * single contract. The agent pipeline only knows about LLMProvider — it never
 * imports a concrete provider directly.
 *
 * Architecture guarantee:
 *   LLMProvider → returns Plan
 *   Plan        → consumed by executor
 *   The LLM NEVER calls tools itself.
 */
export {};
//# sourceMappingURL=llm-provider.js.map