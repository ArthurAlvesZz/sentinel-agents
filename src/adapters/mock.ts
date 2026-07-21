import type { ChatMessage, ModelAdapter, ModelTurn, ToolSpec } from "../types.js";

/** Deterministic adapter for tests, evals and the offline demo — plays back scripted turns. */
export class MockAdapter implements ModelAdapter {
  readonly model = "mock-model";
  private cursor = 0;

  constructor(private turns: ModelTurn[]) {}

  async complete(_req: {
    system: string;
    messages: ChatMessage[];
    tools: Array<Pick<ToolSpec, "name" | "description" | "inputSchema">>;
  }): Promise<ModelTurn> {
    const turn = this.turns[this.cursor];
    if (!turn) return { toolCalls: [] };
    this.cursor++;
    return turn;
  }
}
