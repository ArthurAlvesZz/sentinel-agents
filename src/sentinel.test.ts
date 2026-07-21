import { describe, expect, it } from "vitest";
import { GovernedAgent } from "./agent.js";
import { MockAdapter } from "./adapters/mock.js";
import { PolicyEngine } from "./policy.js";
import { runEvals } from "./evals/harness.js";
import type { ToolSpec } from "./types.js";

function makeTools(log: string[]): ToolSpec[] {
  return [
    { name: "read", description: "", inputSchema: {}, risk: "auto", execute: async () => (log.push("read"), "ok") },
    { name: "write", description: "", inputSchema: {}, risk: "human-gate", execute: async () => (log.push("write"), "ok") },
    { name: "nuke", description: "", inputSchema: {}, risk: "forbidden", execute: async () => (log.push("nuke"), "ok") },
  ];
}

describe("PolicyEngine", () => {
  it("fails closed for unregistered tools", () => {
    const policy = new PolicyEngine(makeTools([]));
    expect(policy.decide("unknown")).toMatchObject({ action: "block" });
  });

  it("rejects overrides for unknown tools", () => {
    expect(() => new PolicyEngine(makeTools([]), { ghost: "auto" })).toThrow(/unknown tool/);
  });
});

describe("GovernedAgent", () => {
  it("executes auto tools, gates risky ones, blocks forbidden ones", async () => {
    const log: string[] = [];
    const agent = new GovernedAgent(
      new MockAdapter([
        {
          toolCalls: [
            { name: "read", input: {} },
            { name: "write", input: { v: 1 }, rationale: "test" },
            { name: "nuke", input: {} },
          ],
        },
      ]),
      makeTools(log),
    );
    const result = await agent.run("sys", [{ role: "user", content: "go" }]);

    expect(result.executed).toHaveLength(1);
    expect(result.proposals).toHaveLength(1);
    expect(result.blocked).toHaveLength(1);
    expect(log).toEqual(["read"]); // the gated write never ran
  });

  it("applies a proposal only after a named human approves, with full audit trail", async () => {
    const log: string[] = [];
    const agent = new GovernedAgent(
      new MockAdapter([{ toolCalls: [{ name: "write", input: { v: 1 } }] }]),
      makeTools(log),
    );
    const { proposals } = await agent.run("sys", [{ role: "user", content: "go" }]);
    const id = proposals[0]!.id;

    expect(() => agent.queue.reject(id, "  ")).toThrow(/named approver/);

    const applied = await agent.queue.approve(id, "alice");
    expect(applied.status).toBe("applied");
    expect(applied.decidedBy).toBe("alice");
    expect(log).toEqual(["write"]);
    expect(() => agent.queue.reject(id, "bob")).toThrow(/already applied/);

    const kinds = agent.audit.all().map((e) => e.event.kind);
    expect(kinds).toEqual(["proposal.created", "proposal.decided", "proposal.applied"]);
    expect(agent.audit.all()[0]!.provenance?.model).toBe("mock-model");
  });
});

describe("eval harness", () => {
  it("catches a governance layer that leaks side effects", async () => {
    const leakyTools: ToolSpec[] = [
      // Misconfigured: a legally-binding action marked auto.
      { name: "submit", description: "", inputSchema: {}, risk: "auto", execute: async () => "sent" },
    ];
    const scorecard = await runEvals(leakyTools, [
      {
        name: "leak",
        turns: [{ toolCalls: [{ name: "submit", input: {} }] }],
        expect: { neverExecutedWithoutApproval: ["submit"] },
      },
    ]);
    expect(scorecard.failures).toHaveLength(1);
  });
});
