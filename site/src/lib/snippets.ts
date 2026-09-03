import cliSource from "../content/snippets/hero-cli.sh?raw";
import reactSource from "../content/snippets/hero-react.tsx?raw";
import typescriptSource from "../content/snippets/hero-typescript.ts?raw";
import type { CodeTab, PackageManager } from "../store/ui.js";

export interface ISnippet {
  readonly tab: CodeTab;
  readonly label: string;
  readonly language: "bash" | "tsx" | "typescript";
  /** Repository-relative path of the file these bytes came from. */
  readonly path: string;
  readonly source: string;
}

/**
 * The panel renders these bytes and nothing else. Each one is a real file inside the typechecked
 * project, so `pnpm --filter threenative-site typecheck` compiles the homepage's code sample
 * against the shipped packages and the site breaks the build when the API moves.
 */
export const snippets: readonly ISnippet[] = [
  {
    tab: "typescript",
    label: "TypeScript",
    language: "typescript",
    path: "site/src/content/snippets/hero-typescript.ts",
    source: typescriptSource,
  },
  {
    tab: "react",
    label: "React",
    language: "tsx",
    path: "site/src/content/snippets/hero-react.tsx",
    source: reactSource,
  },
  {
    tab: "cli",
    label: "CLI",
    language: "bash",
    path: "site/src/content/snippets/hero-cli.sh",
    source: cliSource,
  },
];

export function snippet(tab: CodeTab): ISnippet {
  const found = snippets.find((item) => item.tab === tab);
  if (found === undefined) throw new Error(`TN_SITE_UNKNOWN_SNIPPET: no snippet for ${tab}.`);
  return found;
}

/** How each package manager spells "run a script from package.json". */
const RUN_PREFIX: Record<PackageManager, string> = {
  bun: "bun run",
  npm: "npm run",
  pnpm: "pnpm",
  yarn: "yarn",
};

/** The install command, verbatim from `hero-cli.sh`, rewritten for the chosen package manager. */
export function installCommand(manager: PackageManager): string {
  const source = snippet("cli").source.trimEnd();
  if (manager === "pnpm") return source;
  return source
    .replace(/^pnpm create /mu, `${manager} create `)
    .replace(/^pnpm install$/mu, `${manager} install`)
    .replace(/^pnpm (\w+)$/gmu, (_line, script: string) => `${RUN_PREFIX[manager]} ${script}`);
}
