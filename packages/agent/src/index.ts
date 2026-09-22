/**
 * Arclio CLI — interactive local development entrypoint
 *
 * Usage:
 *   npm run dev --workspace=packages/agent
 *
 * Requires the MCP server to be running:
 *   npm run dev:server
 */

import * as readline from "node:readline";
import { runAgent } from "./agent.js";

const MCP_URL = process.env.MCP_BASE_URL ?? "http://localhost:3001";

console.log("╔════════════════════════════════════════════╗");
console.log("║  Arclio — AI orchestration for the real world  ║");
console.log("╚════════════════════════════════════════════╝");
console.log(`MCP server: ${MCP_URL}`);
console.log("Type a request and press Enter. Ctrl+C to exit.\n");
console.log("Example requests:");
console.log('  "What\'s happening at the office today?"');
console.log('  "Is the Acme delivery here yet?"');
console.log('  "Mark the Acme delivery as received and notify procurement."');
console.log("");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "You> ",
});

rl.prompt();

rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }

  try {
    console.log("\n[Arclio thinking...]\n");
    const response = await runAgent(input);

    console.log("─".repeat(60));
    console.log(response.answer);
    console.log("─".repeat(60));
    console.log(
      `[verification: ${response.verification.status}  |  intent: ${response.intent}]\n`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ECONNREFUSED") || message.includes("fetch")) {
      console.error(
        `\n⚠️  Cannot connect to MCP server at ${MCP_URL}\n` +
          "   Please start the server first: npm run dev:server\n",
      );
    } else {
      console.error(`\n⚠️  Error: ${message}\n`);
    }
  }

  rl.prompt();
});

rl.on("close", () => {
  console.log("\nGoodbye.");
  process.exit(0);
});
