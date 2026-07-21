/**
 * Demo: an agent drafts an electronic invoice and tries to submit it to a (mock) tax authority.
 * Submission is human-gated — the run pauses until you approve or reject in the terminal.
 * Runs fully offline with a scripted model; pass --live to use the real Anthropic API.
 */
import { createInterface } from "node:readline/promises";
import { AnthropicAdapter, GovernedAgent, MockAdapter, type ModelAdapter, type ToolSpec } from "../../src/index.js";

// ---- Mock tax authority (stands in for a real government web service) ----
const taxAuthority = {
  async submit(invoice: Record<string, unknown>) {
    return { protocol: `MOCK-${JSON.stringify(invoice).length}${String(invoice.number ?? "0")}`, status: "authorized" };
  },
};

const tools: ToolSpec[] = [
  {
    name: "validate_invoice",
    description: "Validate invoice fields against the fiscal schema (read-only).",
    inputSchema: { type: "object", properties: { number: { type: "number" }, amount: { type: "number" } } },
    risk: "auto",
    execute: async (input) => ({ valid: typeof input.amount === "number" && (input.amount as number) > 0 }),
  },
  {
    name: "submit_invoice",
    description: "Submit the invoice to the tax authority. Legally binding.",
    inputSchema: { type: "object", properties: { number: { type: "number" }, amount: { type: "number" } } },
    risk: "human-gate",
    execute: async (input) => taxAuthority.submit(input),
  },
];

const adapter: ModelAdapter = process.argv.includes("--live")
  ? new AnthropicAdapter()
  : new MockAdapter([
      {
        text: "Invoice validated. Requesting approval to submit.",
        toolCalls: [
          { name: "validate_invoice", input: { number: 42, amount: 1250.5 } },
          { name: "submit_invoice", input: { number: 42, amount: 1250.5 }, rationale: "Monthly invoice #42 for R$1,250.50 — validation passed." },
        ],
      },
    ]);

const agent = new GovernedAgent(adapter, tools);
const result = await agent.run(
  "You prepare and submit electronic invoices. Always validate before submitting.",
  [{ role: "user", content: "Issue invoice #42, amount 1250.50." }],
);

console.log(`\nagent: ${result.text ?? "(no text)"}`);
for (const e of result.executed) console.log(`  ✓ auto-executed ${e.tool} → ${JSON.stringify(e.result)}`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
for (const p of agent.queue.pending()) {
  console.log(`\n┌─ PROPOSAL ${p.id} ─ requires human approval`);
  console.log(`│ tool:       ${p.tool}`);
  console.log(`│ input:      ${JSON.stringify(p.input)}`);
  console.log(`│ rationale:  ${p.rationale}`);
  console.log(`│ provenance: ${p.provenance.model} · ${p.provenance.promptDigest}`);
  const answer = (await rl.question(`└─ approve? [y/N] `)).trim().toLowerCase();
  const decided = answer === "y" ? await agent.queue.approve(p.id, "demo-operator") : agent.queue.reject(p.id, "demo-operator");
  console.log(decided.status === "applied" ? `  ✓ applied → ${JSON.stringify(decided.result)}` : `  ✗ ${decided.status}`);
}
rl.close();

console.log("\naudit trail:");
for (const entry of agent.audit.all()) console.log(`  ${entry.seq}. ${entry.at} ${JSON.stringify(entry.event)}`);
