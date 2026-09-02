import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import * as ts from "typescript";

export const TEMPLATE_CONVENTIONS = [
  "GroundSnap",
  "normaliseToMetres",
  "attachToBone",
  "AnimationPlayer",
] as const;

export type TemplateConvention = (typeof TEMPLATE_CONVENTIONS)[number];

export const APPLICABILITY_TABLE = "docs/verification/PRD-289-conventions-2026-08-31.md" as const;

interface ICallCell {
  readonly file: string;
  readonly kind: "call";
  readonly line: number;
}

interface INaCell {
  readonly kind: "na";
  readonly reason: string;
}

type ApplicabilityCell = ICallCell | INaCell;

interface IApplicabilityRow {
  readonly cells: Readonly<Record<TemplateConvention, ApplicabilityCell>>;
  readonly template: string;
}

interface ICallSite {
  readonly file: string;
  readonly line: number;
  readonly symbol: TemplateConvention;
}

interface IParsedTable {
  readonly findings: readonly string[];
  readonly rows: readonly IApplicabilityRow[];
}

/** Checks that each convention named by a generated template's AGENTS.md has a real source call. */
export async function checkTemplateConventions(
  root: string = process.cwd(),
  tableRelativePath: string = APPLICABILITY_TABLE,
): Promise<readonly string[]> {
  const tablePath = path.join(root, tableRelativePath);
  const { findings: tableFindings, rows } = await readApplicabilityTable(tablePath);
  const findings = [...tableFindings];
  const templateRoot = path.join(root, "packages/create-threenative/templates");
  const templates = await directoryNames(templateRoot);
  if (templates.length === 0) {
    findings.push(`No template directories found under ${templateRoot}.`);
    return findings;
  }

  const rowsByTemplate = new Map(rows.map((row) => [row.template, row]));
  for (const row of rows) {
    if (!templates.includes(row.template))
      findings.push(`Applicability table names unknown template '${row.template}'.`);
  }

  for (const template of templates) {
    const row = rowsByTemplate.get(template);
    if (row === undefined) {
      findings.push(`Template '${template}' has no applicability-table row.`);
      continue;
    }
    findings.push(...(await checkTemplate(template, row, templateRoot)));
  }
  return findings;
}

async function checkTemplate(
  template: string,
  row: IApplicabilityRow,
  templateRoot: string,
): Promise<readonly string[]> {
  const templateRootPath = path.join(templateRoot, template);
  const callSites = await findCallSites(path.join(templateRootPath, "src"), templateRootPath);
  const agents = await readText(path.join(templateRootPath, "AGENTS.md"));
  if (agents === undefined) return [`Template '${template}' is missing AGENTS.md.`];
  return TEMPLATE_CONVENTIONS.flatMap((symbol) =>
    checkConvention(template, symbol, row.cells[symbol], agents, callSites),
  );
}

function checkConvention(
  template: string,
  symbol: TemplateConvention,
  cell: ApplicabilityCell | undefined,
  agents: string,
  callSites: readonly ICallSite[],
): readonly string[] {
  if (cell === undefined)
    return [`Template '${template}' convention '${symbol}' is missing from the table.`];
  if (!agents.includes(symbol)) {
    return cell.kind === "call"
      ? [`Template '${template}' applicable convention '${symbol}' is missing from AGENTS.md.`]
      : [];
  }
  const sourceCalls = callSites.filter(({ symbol: callSymbol }) => callSymbol === symbol);
  if (cell.kind === "na") {
    return sourceCalls.length === 0
      ? []
      : [`Template '${template}' convention '${symbol}' is marked N/A but src/ calls it.`];
  }
  if (sourceCalls.length === 0)
    return [
      `Template '${template}' convention '${symbol}' has no call in src/ (table points to ${cell.file}:${cell.line}).`,
    ];
  return sourceCalls.some(({ file, line }) => file === cell.file && line === cell.line)
    ? []
    : [
        `Template '${template}' convention '${symbol}' table cell ${cell.file}:${cell.line} does not resolve to its src/ call.`,
      ];
}

async function readApplicabilityTable(file: string): Promise<IParsedTable> {
  const markdown = await readText(file);
  if (markdown === undefined)
    return { findings: [`Applicability table is missing: ${file}.`], rows: [] };
  const lines = markdown.split(/\r?\n/u);
  const headerIndex = lines.findIndex((line) => {
    const cells = splitRow(line);
    return (
      cells !== undefined &&
      cells.length === TEMPLATE_CONVENTIONS.length + 1 &&
      cells[0] === "Template" &&
      TEMPLATE_CONVENTIONS.every((symbol, index) => cells[index + 1] === symbol)
    );
  });
  if (headerIndex < 0)
    return { findings: ["Applicability table has no recognized convention header."], rows: [] };

  const findings: string[] = [];
  const rows: IApplicabilityRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const parsed = parseRow(line);
    if (parsed === undefined) {
      if (applicabilityTableEnded(line, rows.length > 0)) break;
      continue;
    }
    findings.push(...parsed.findings);
    if (parsed.row === undefined) continue;
    if (rows.some((row) => row.template === parsed.row?.template)) {
      findings.push(`Applicability table has duplicate template row '${parsed.row.template}'.`);
      continue;
    }
    rows.push(parsed.row);
  }
  return { findings, rows };
}

function applicabilityTableEnded(line: string, hasRows: boolean): boolean {
  return hasRows && line.trim() !== "" && splitRow(line) === undefined;
}

function parseRow(
  line: string,
): { findings: readonly string[]; row?: IApplicabilityRow } | undefined {
  const cells = splitRow(line);
  if (cells === undefined || cells.every((cell) => /^-+$/u.test(cell))) return undefined;
  if (cells.length !== TEMPLATE_CONVENTIONS.length + 1)
    return {
      findings: [`Applicability table row has ${cells.length} cells; expected 5: ${line}`],
    };
  const template = cells[0];
  if (template === undefined || template.length === 0)
    return { findings: [`Applicability table row has an empty template name: ${line}`] };
  const parsedCells = {} as Record<TemplateConvention, ApplicabilityCell>;
  const findings: string[] = [];
  for (const [index, symbol] of TEMPLATE_CONVENTIONS.entries()) {
    const cell = cells[index + 1];
    const parsed = cell === undefined ? undefined : parseCell(cell);
    if (parsed === undefined) {
      findings.push(`Applicability table cell for '${template}/${symbol}' is not a call or N/A.`);
      continue;
    }
    parsedCells[symbol] = parsed;
  }
  if (findings.length > 0) return { findings };
  return { findings, row: { cells: parsedCells, template } };
}

function parseCell(cell: string): ApplicabilityCell | undefined {
  if (/^N\/A\s+(?:—|-)\s+\S/iu.test(cell)) {
    return { kind: "na", reason: cell.replace(/^N\/A\s+(?:—|-)\s+/iu, "") };
  }
  const call = cell.match(/^`?(src\/[^:`|]+):(\d+)`?$/u);
  if (call === null) return undefined;
  const line = Number(call[2]);
  if (!Number.isSafeInteger(line) || line < 1) return undefined;
  return { file: call[1] ?? "", kind: "call", line };
}

function splitRow(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

async function findCallSites(
  sourceRoot: string,
  templateRoot: string,
): Promise<readonly ICallSite[]> {
  const files = (await filesUnder(sourceRoot)).filter((file) => /\.(?:ts|tsx)$/u.test(file));
  const sites: ICallSite[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      const symbol = calledConvention(node);
      if (symbol !== undefined) {
        sites.push({
          file: path.relative(templateRoot, file).split(path.sep).join("/"),
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          symbol,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return sites;
}

function calledConvention(node: ts.Node): TemplateConvention | undefined {
  let expression: ts.Expression | undefined;
  if (ts.isNewExpression(node)) expression = node.expression;
  else if (ts.isCallExpression(node)) expression = node.expression;
  if (expression === undefined || !ts.isIdentifier(expression)) return undefined;
  return TEMPLATE_CONVENTIONS.find((symbol) => symbol === expression.text);
}

async function filesUnder(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(file)));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

async function directoryNames(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function readText(file: string): Promise<string | undefined> {
  return readFile(file, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = await checkTemplateConventions();
  if (findings.length > 0) {
    console.error(
      `TN_TEMPLATE_CONVENTIONS_FAILED:\n${findings.map((finding) => `- ${finding}`).join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.info("Template convention applicability and source-call checks passed.");
  }
}
