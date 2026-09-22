/**
 * LLM provider factory
 *
 * Reads ARCLIO_LLM_PROVIDER from the environment and returns the appropriate
 * LLMProvider instance.  Defaults to "stub" so the agent works out of the box
 * with no credentials.
 *
 * Supported values:
 *   stub    — deterministic keyword planner (default)
 *   bedrock — Amazon Bedrock Runtime, Converse API
 *
 * BedrockProvider is imported lazily (dynamic import) so that projects without
 * @aws-sdk/client-bedrock-runtime installed can still use the stub provider.
 */
export async function createProvider(override) {
    const name = override ?? process.env["ARCLIO_LLM_PROVIDER"] ?? "stub";
    switch (name) {
        case "stub": {
            const { StubProvider } = await import("./stub.js");
            const provider = new StubProvider();
            console.log(`[agent] LLM provider: ${provider.name}`);
            return provider;
        }
        case "bedrock": {
            const { BedrockProvider } = await import("./bedrock.js");
            const provider = new BedrockProvider();
            console.log(`[agent] LLM provider: ${provider.name} ` +
                `(model: ${process.env["ARCLIO_BEDROCK_MODEL_ID"] ?? "amazon.nova-lite-v1:0"}, ` +
                `region: ${process.env["ARCLIO_BEDROCK_REGION"] ?? "us-east-1"})`);
            return provider;
        }
        default:
            console.warn(`[agent] Unknown ARCLIO_LLM_PROVIDER value '${name}' — falling back to stub`);
            const { StubProvider } = await import("./stub.js");
            return new StubProvider();
    }
}
//# sourceMappingURL=index.js.map