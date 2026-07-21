import type { ChatMessage, ModelAdapter, ModelTurn, ToolSpec } from "../types.js";

/**
 * AWS Bedrock adapter (Anthropic models via the Bedrock Runtime Converse API).
 * Requires optional peer deps: `npm i @aws-sdk/client-bedrock-runtime`.
 * Loaded dynamically so the core stays dependency-free.
 */
export class BedrockAdapter implements ModelAdapter {
  constructor(
    readonly model: string = "us.anthropic.claude-sonnet-4-6",
    private region: string = process.env.AWS_REGION ?? "us-east-1",
  ) {}

  async complete(req: {
    system: string;
    messages: ChatMessage[];
    tools: Array<Pick<ToolSpec, "name" | "description" | "inputSchema">>;
  }): Promise<ModelTurn> {
    const sdk = await import("@aws-sdk/client-bedrock-runtime").catch(() => {
      throw new Error("BedrockAdapter requires @aws-sdk/client-bedrock-runtime — npm i @aws-sdk/client-bedrock-runtime");
    });
    const client = new sdk.BedrockRuntimeClient({ region: this.region });
    const res = await client.send(
      new sdk.ConverseCommand({
        modelId: this.model,
        system: [{ text: req.system }],
        messages: req.messages
          .filter((m) => m.role !== "tool")
          .map((m) => ({ role: m.role as "user" | "assistant", content: [{ text: m.content }] })),
        toolConfig: req.tools.length
          ? {
              tools: req.tools.map((t) => ({
                toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema as never } },
              })),
            }
          : undefined,
      }),
    );

    const turn: ModelTurn = { toolCalls: [] };
    for (const block of res.output?.message?.content ?? []) {
      if ("text" in block && block.text) turn.text = (turn.text ?? "") + block.text;
      if ("toolUse" in block && block.toolUse?.name) {
        turn.toolCalls.push({
          name: block.toolUse.name,
          input: (block.toolUse.input ?? {}) as Record<string, unknown>,
        });
      }
    }
    return turn;
  }
}
