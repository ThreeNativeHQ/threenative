export interface INotOwnedCapability {
  readonly id: string;
  readonly situations: readonly string[];
  readonly guidance: string;
}

/**
 * Measured requests for which the framework deliberately owns no complete system. These rows are
 * guidance, not capabilities: an authoring agent should write the mechanic in the game or add its
 * own dependency instead of selecting an unrelated engine export.
 */
export const NOT_OWNED_CAPABILITIES: readonly INotOwnedCapability[] = [
  {
    guidance:
      "The framework owns no save/load system. Write a save module in your project's src/ using your own plain state shape (for example, ctx.state), and read agent-docs/gameplay-recipes.md for the template recipe.",
    id: "save-load",
    situations: [
      "persist a player's progress between sessions",
      "save player progress between sessions",
      "load a saved game state",
    ],
  },
  {
    guidance:
      "The framework owns no inventory system. Write inventory state in your project's src/ with plain objects under ctx.state, and read agent-docs/gameplay-recipes.md for the template recipe.",
    id: "inventory",
    situations: ["inventory system", "manage inventory contents"],
  },
  {
    guidance:
      "The framework owns no dialogue system. Write the conversation data and state in your project's src/; render it with the template UI (starter uses src/ui/), and read agent-docs/gameplay-recipes.md.",
    id: "dialogue",
    situations: ["NPC dialogue system", "write conversation choices for an NPC"],
  },
  {
    guidance:
      "The framework owns no network transport or multiplayer system. Add the networking library you choose with pnpm add <networking-library>, then write synchronization in your project's src/ and keep game state in ctx.state.",
    id: "networked-multiplayer",
    situations: ["networked multiplayer", "multiplayer mode", "connect players online"],
  },
];
