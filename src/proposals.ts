import type { AuditLog } from "./audit.js";
import type { Proposal, Provenance, ToolSpec } from "./types.js";

/**
 * The heart of Sentinel: risky actions become proposals.
 * The agent can create them; only a named human can approve; only approved proposals execute.
 */
export class ProposalQueue {
  private proposals = new Map<string, Proposal>();
  private counter = 0;

  constructor(
    private tools: Map<string, ToolSpec>,
    private audit: AuditLog,
    private clock: () => Date = () => new Date(),
  ) {}

  create(tool: string, input: Record<string, unknown>, rationale: string, provenance: Provenance): Proposal {
    if (!this.tools.has(tool)) throw new Error(`Cannot propose unknown tool "${tool}"`);
    const proposal: Proposal = {
      id: `prop_${++this.counter}`,
      tool,
      input,
      rationale,
      status: "pending",
      provenance,
    };
    this.proposals.set(proposal.id, proposal);
    this.audit.record({ kind: "proposal.created", proposalId: proposal.id, tool }, provenance);
    return proposal;
  }

  /** Approve and immediately apply. `by` is the accountable human — never the agent. */
  async approve(id: string, by: string): Promise<Proposal> {
    const p = this.decide(id, "approved", by);
    const tool = this.tools.get(p.tool)!;
    try {
      p.result = await tool.execute(p.input);
      p.status = "applied";
      this.audit.record({ kind: "proposal.applied", proposalId: p.id, ok: true }, p.provenance);
    } catch (err) {
      p.status = "failed";
      p.error = err instanceof Error ? err.message : String(err);
      this.audit.record({ kind: "proposal.applied", proposalId: p.id, ok: false }, p.provenance);
    }
    return p;
  }

  reject(id: string, by: string): Proposal {
    return this.decide(id, "rejected", by);
  }

  pending(): Proposal[] {
    return [...this.proposals.values()].filter((p) => p.status === "pending");
  }

  get(id: string): Proposal | undefined {
    return this.proposals.get(id);
  }

  private decide(id: string, decision: "approved" | "rejected", by: string): Proposal {
    const p = this.proposals.get(id);
    if (!p) throw new Error(`Unknown proposal "${id}"`);
    if (p.status !== "pending") throw new Error(`Proposal "${id}" already ${p.status}`);
    if (!by.trim()) throw new Error("A named approver is required");
    p.status = decision;
    p.decidedBy = by;
    p.decidedAt = this.clock().toISOString();
    this.audit.record({ kind: "proposal.decided", proposalId: id, decision, by }, p.provenance);
    return p;
  }
}
