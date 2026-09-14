import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { test } from "vitest";

const exportsToCheck = [
  ["runner/index.ts", "withBrowserCapture", "@threenative/playtest/runner"],
  ["runner/index.ts", "resolveBrowserArguments", "@threenative/playtest/runner"],
  ["runner/index.ts", "softwareAdapterName", "@threenative/playtest/runner"],
  ["runner/index.ts", "reconcileBrowserPointers", "@threenative/playtest/runner"],
  ["index.ts", "PlaytestScenarioError", "@threenative/playtest"],
  ["index.ts", "invalidScenario", "@threenative/playtest"],
  ["index.ts", "loadPlaytestScenario", "@threenative/playtest"],
  ["index.ts", "playtestStepHoldTicks", "@threenative/playtest"],
  ["index.ts", "playtestStepWaitTicks", "@threenative/playtest"],
  ["index.ts", "rejectUnknownKeys", "@threenative/playtest"],
] as const;

function operationDoc(file: string, symbol: string): string {
  const url = new URL(`../../packages/playtest/src/${file}`, import.meta.url);
  const source = ts.createSourceFile(file, readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.exportClause === undefined
      || !ts.isNamedExports(statement.exportClause)) continue;
    if (!statement.exportClause.elements.some((element) => element.name.text === symbol)) continue;
    assert.equal(statement.exportClause.elements.length, 1, `${symbol} shares another callable's metadata`);
    return source.text.slice(statement.getFullStart(), statement.getStart());
  }
  throw new Error(`${symbol} must have operation-specific metadata, not a wildcard's example`);
}

for (const [file, symbol, importPath] of exportsToCheck) {
  test(`${symbol}'s example imports and invokes that public operation`, () => {
    const doc = operationDoc(file, symbol);
    const example = doc.split("@example")[1]?.split("*/")[0]?.replace(/^\s*\* ?/gm, "");
    assert.ok(example, `${symbol} needs an example`);
    const source = ts.createSourceFile("example.ts", example, ts.ScriptTarget.Latest, true);
    const imported = new Set<string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
        || statement.moduleSpecifier.text !== importPath) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
      for (const binding of bindings.elements) {
        if ((binding.propertyName ?? binding.name).text === symbol) imported.add(binding.name.text);
      }
    }
    let invoked = false;
    const visit = (node: ts.Node): void => {
      if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression)
        && imported.has(node.expression.text)) invoked = true;
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(invoked, `${symbol}'s example must call its import, not merely mention its name`);
  });
}

test("browser recipe is explicit and does not contaminate pointer metadata", () => {
  assert.match(operationDoc("runner/index.ts", "resolveBrowserArguments"), /resolveBrowserArguments\(WEBGPU_BROWSER_ARGS\)/);
  assert.doesNotMatch(operationDoc("runner/index.ts", "reconcileBrowserPointers"), /Vulkan|SwiftShader|Chromium/);
});

test("scenario error construction does not advertise loading or deterministic stepping", () => {
  assert.doesNotMatch(operationDoc("index.ts", "invalidScenario"), /@situation.*(?:load|deterministic|ticks)/);
});
