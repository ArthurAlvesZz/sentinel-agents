/** Risk tier assigned to every tool an agent can call. Fail-closed: unknown tools are forbidden. */
export type RiskTier = "auto" | "human-gate" | "forbidden";

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
  risk: RiskTier;
  /** Executes the real side effect. Only ever called for `auto` tools or approved proposals. */
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

/** Where a piece of AI-generated work came from — attached to every proposal and audit entry. */
export interface Provenance {
  model: string;
  /** Hash or excerpt of the prompt that produced the action. */
  promptDigest: string;
  agentRun: string;
  createdAt: string;
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "failed";

export interface Proposal {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  /** Human-readable summary the agent must provide — what and why. */
  rationale: string;
  status: ProposalStatus;
  provenance: Provenance;
  decidedBy?: string;
  decidedAt?: string;
  result?: unknown;
  error?: string;
}

export type AuditEvent =
  | { kind: "tool.executed"; tool: string; input: Record<string, unknown> }
  | { kind: "tool.blocked"; tool: string; reason: string }
  | { kind: "proposal.created"; proposalId: string; tool: string }
  | { kind: "proposal.decided"; proposalId: string; decision: "approved" | "rejected"; by: string }
  | { kind: "proposal.applied"; proposalId: string; ok: boolean };

export interface AuditEntry {
  seq: number;
  at: string;
  event: AuditEvent;
  provenance?: Provenance;
}

/** LLM adapter — a single turn with tool use. Implementations: Anthropic API, AWS Bedrock, mocks. */
export interface ModelAdapter {
  readonly model: string;
  complete(req: {
    system: string;
    messages: ChatMessage[];
    tools: Array<Pick<ToolSpec, "name" | "description" | "inputSchema">>;
  }): Promise<ModelTurn>;
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCall?: { name: string; input: Record<string, unknown> };
}

export interface ModelTurn {
  text?: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown>; rationale?: string }>;
}
