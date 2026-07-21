import type { ChatMessage, ModelAdapter, ModelTurn, ToolSpec } from "../types.js";

/**
 * Anthropic Messages API adapter (no SDK dependency — plain fetch).
 * Set ANTHROPIC_API_KEY. For AWS Bedrock, see ./bedrock.ts.
 */
export class AnthropicAdapter implements ModelAdapter {
  constructor(
    readonly model: string = "claude-sonnet-4-6",
    private apiKey: string | undefined = process.env.ANTHROPIC_API_KEY,
  ) {}

  async complete(req: {
    system: string;
    messages: ChatMessage[];
    tools: Array<Pick<ToolSpec, "name" | "description" | "inputSchema">>;
  }): Promise<ModelTurn> {
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        system: req.system,
        messages: req.messages
          .filter((m) => m.role !== "tool")
          .map((m) => ({ role: m.role, content: m.content })),
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);

    const body = (await res.json()) as {
      content: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
    };
    const turn: ModelTurn = { toolCalls: [] };
    for (const block of body.content) {
      if (block.type === "text") turn.text = (turn.text ?? "") + block.text;
      if (block.type === "tool_use" && block.name) {
        turn.toolCalls.push({ name: block.name, input: block.input ?? {} });
      }
    }
    return turn;
  }
}
