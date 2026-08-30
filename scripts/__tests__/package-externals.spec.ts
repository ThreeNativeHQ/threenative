import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { publicWorkspacePackages } from "../workspace-packages.js";

const REPO = path.resolve(import.meta.dirname, "..", "..");

/**
 * Runtimes the game and the framework must share one instance of. Two copies of three.js print
 * `THREE.WARNING: Multiple instances of Three.js being imported`, double the shipped bytes, and
 * silently break every `instanceof` across the boundary — an engine API handed a `Scene` built by
 * the other copy sees an object of a class it does not recognise.
 */
const SHARED_RUNTIMES = ["react", "react-dom", "react-reconciler", "three", "three-mesh-bvh"];

function sourceFilesUnder(directory: string): readonly string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(file);
    return /\.tsx?$/u.test(entry.name) && !entry.name.endsWith(".d.ts") ? [file] : [];
  });
}

function builtFilesUnder(directory: string): readonly string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return builtFilesUnder(file);
    return entry.name.endsWith(".js") ? [file] : [];
  });
}

/** `@scope/name/sub` and `name/sub` both belong to the package that gets installed. */
function packageRootOf(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? specifier);
}

function isBare(specifier: string): boolean {
  return (
    !specifier.startsWith(".") && !specifier.startsWith("node:") && !path.isAbsolute(specifier)
  );
}

/**
 * Bare specifiers a file needs at runtime. Type-only imports are erased by the compiler and never
 * reach `dist`, so they say nothing about what a bundler has to keep external; a side-effect
 * import (`import "x"`) is a runtime need with no bindings at all.
 */
function runtimeImports(file: string): readonly string[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers = new Set<string>();
  const record = (node: ts.Expression | undefined): void => {
    if (node !== undefined && ts.isStringLiteral(node) && isBare(node.text))
      specifiers.add(node.text);
  };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly === true) continue;
      const named = clause?.namedBindings;
      // `import { type A, type B } from "x"` leaves nothing behind either.
      if (
        clause !== undefined &&
        clause.name === undefined &&
        named !== undefined &&
        ts.isNamedImports(named) &&
        named.elements.every((element) => element.isTypeOnly)
      ) {
        continue;
      }
      record(statement.moduleSpecifier);
    } else if (ts.isExportDeclaration(statement) && statement.isTypeOnly !== true) {
      record(statement.moduleSpecifier);
    }
  }
  return [...specifiers];
}

/** Bare specifiers a built bundle still imports — i.e. the ones the bundler left external. */
function externalisedImports(file: string): readonly string[] {
  const text = fs.readFileSync(file, "utf8");
  const specifiers = new Set<string>();
  for (const match of text.matchAll(/(?:from|import)\s*["']([^"']+)["']/gu)) {
    const specifier = match[1];
    if (specifier !== undefined && isBare(specifier)) specifiers.add(specifier);
  }
  return [...specifiers];
}

interface IPackageUnderTest {
  readonly declared: ReadonlySet<string>;
  readonly directory: string;
  readonly imports: readonly string[];
  readonly name: string;
}

function packagesUnderTest(): readonly IPackageUnderTest[] {
  return publicWorkspacePackages(REPO).flatMap((entry) => {
    const sources = sourceFilesUnder(path.join(entry.directory, "src"));
    if (sources.length === 0) return [];
    const manifest = JSON.parse(
      fs.readFileSync(path.join(entry.directory, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return [
      {
        declared: new Set([
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.peerDependencies ?? {}),
        ]),
        directory: entry.directory,
        imports: [...new Set(sources.flatMap(runtimeImports))].sort(),
        name: entry.name,
      },
    ];
  });
}

describe("published packages keep their runtime dependencies external", () => {
  // tsup externalises exactly what the manifest declares in `dependencies` and
  // `peerDependencies`; anything else it inlines into `dist`. A package that imports a module it
  // only declares in `devDependencies` therefore publishes a private copy of it, and no workspace
  // build ever notices because the examples resolve the package's `src` through tsconfig paths.
  // `@threenative/physics` shipped all of three.js that way.
  it("declares every module its source imports at runtime", () => {
    const packages = packagesUnderTest();
    // Fail closed: an emptied or renamed tree must red here, not scan to zero silently.
    expect(packages.length).toBeGreaterThan(4);

    const undeclared = packages.flatMap(({ declared, imports, name }) =>
      imports
        .map(packageRootOf)
        .filter((root) => !declared.has(root))
        .map((root) => `${name} imports '${root}' without declaring it`),
    );
    expect([...new Set(undeclared)].sort()).toEqual([]);
  });

  // The packaged reproduction. A bundler that inlined a runtime leaves no trace of it in the
  // built output's import list, so this reads `dist` — the bytes a game actually installs — and
  // not the source the workspace resolves.
  it("leaves the shared browser runtimes external in the built output", () => {
    const offenders: string[] = [];
    for (const { directory, imports, name } of packagesUnderTest()) {
      const needed = [...new Set(imports.map(packageRootOf))].filter((root) =>
        SHARED_RUNTIMES.includes(root),
      );
      if (needed.length === 0) continue;
      const built = builtFilesUnder(path.join(directory, "dist"));
      if (built.length === 0) {
        offenders.push(`${name} has no dist; run 'pnpm build' before this gate`);
        continue;
      }
      const external = new Set(built.flatMap(externalisedImports).map(packageRootOf));
      for (const root of needed) {
        if (!external.has(root)) offenders.push(`${name} bundles a private copy of '${root}'`);
      }
    }
    expect(offenders.sort()).toEqual([]);
  });
});
