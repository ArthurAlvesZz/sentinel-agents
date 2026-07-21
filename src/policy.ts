import type { RiskTier, ToolSpec } from "./types.js";

export type PolicyDecision =
  | { action: "execute" }
  | { action: "propose" }
  | { action: "block"; reason: string };

/**
 * Classifies every tool call before it can touch the world.
 * Fail-closed: a tool the policy has never seen is blocked, not guessed.
 */
export class PolicyEngine {
  private tiers = new Map<string, RiskTier>();

  constructor(tools: ToolSpec[], overrides: Record<string, RiskTier> = {}) {
    for (const t of tools) this.tiers.set(t.name, t.risk);
    for (const [name, tier] of Object.entries(overrides)) {
      if (!this.tiers.has(name)) {
        throw new Error(`Policy override for unknown tool "${name}"`);
      }
      this.tiers.set(name, tier);
    }
  }

  decide(toolName: string): PolicyDecision {
    const tier = this.tiers.get(toolName);
    switch (tier) {
      case "auto":
        return { action: "execute" };
      case "human-gate":
        return { action: "propose" };
      case "forbidden":
        return { action: "block", reason: `tool "${toolName}" is forbidden by policy` };
      default:
        return { action: "block", reason: `tool "${toolName}" is not registered — fail-closed` };
    }
  }
}
