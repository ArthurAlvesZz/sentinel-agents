import { AuditLog } from "./audit.js";
import { PolicyEngine } from "./policy.js";
import { ProposalQueue } from "./proposals.js";
import type { ChatMessage, ModelAdapter, Proposal, Provenance, RiskTier, ToolSpec } from "./types.js";

export interface AgentRunResult {
  text?: string;
  executed: Array<{ tool: string; result: unknown }>;
  proposals: Proposal[];
  blocked: Array<{ tool: string; reason: string }>;
}

/**
 * A GovernedAgent never calls a risky tool directly.
 * Every tool call from the model is routed through the PolicyEngine:
 *   auto → executed and audited; human-gate → becomes a Proposal; forbidden/unknown → blocked.
 */
export class GovernedAgent {
  readonly audit: AuditLog;
  readonly queue: ProposalQueue;
  private policy: PolicyEngine;
  private tools: Map<string, ToolSpec>;
  private runCounter = 0;

  constructor(
    private adapter: ModelAdapter,
    tools: ToolSpec[],
    opts: { policyOverrides?: Record<string, RiskTier>; audit?: AuditLog } = {},
  ) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.policy = new PolicyEngine(tools, opts.policyOverrides);
    this.audit = opts.audit ?? new AuditLog();
    this.queue = new ProposalQueue(this.tools, this.audit);
  }

  async run(system: string, messages: ChatMessage[]): Promise<AgentRunResult> {
    const turn = await this.adapter.complete({
      system,
      messages,
      tools: [...this.tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });

    const provenance: Provenance = {
      model: this.adapter.model,
      promptDigest: digest(system + JSON.stringify(messages)),
      agentRun: `run_${++this.runCounter}`,
      createdAt: new Date().toISOString(),
    };

    const result: AgentRunResult = { text: turn.text, executed: [], proposals: [], blocked: [] };

    for (const call of turn.toolCalls) {
      const decision = this.policy.decide(call.name);
      if (decision.action === "execute") {
        const tool = this.tools.get(call.name)!;
        const out = await tool.execute(call.input);
        this.audit.record({ kind: "tool.executed", tool: call.name, input: call.input }, provenance);
        result.executed.push({ tool: call.name, result: out });
      } else if (decision.action === "propose") {
        const proposal = this.queue.create(
          call.name,
          call.input,
          call.rationale ?? "(no rationale provided)",
          provenance,
        );
        result.proposals.push(proposal);
      } else {
        this.audit.record({ kind: "tool.blocked", tool: call.name, reason: decision.reason }, provenance);
        result.blocked.push({ tool: call.name, reason: decision.reason });
      }
    }
    return result;
  }
}

function digest(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `djb_${(h >>> 0).toString(16)}`;
}
