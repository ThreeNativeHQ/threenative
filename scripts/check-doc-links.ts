import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DocLinkIssue = {
  file: string;
  target: string;
};

export type DocLinkCheckResult = {
  filesChecked: number;
  linksChecked: number;
  missing: DocLinkIssue[];
};

type Fence = {
  character: "`" | "~";
  length: number;
};

function fenceAt(line: string): Fence | undefined {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
  if (!match) {
    return undefined;
  }

  const marker = match[1];
  if (!marker) {
    throw new Error("Malformed fenced code block marker");
  }

  return { character: marker[0] as "`" | "~", length: marker.length };
}

function closesFence(line: string, fence: Fence): boolean {
  const marker = line.trim();
  return (
    marker.length >= fence.length &&
    marker.split("").every((character) => character === fence.character)
  );
}

export function stripFencedCodeBlocks(markdown: string, file = "Markdown document"): string {
  const lines = markdown.split(/\r?\n/);
  const openFences: Fence[] = [];
  const stripped = lines.map((line) => {
    const fence = fenceAt(line);
    const openFence = openFences.at(-1);
    if (openFence) {
      if (closesFence(line, openFence)) {
        openFences.pop();
      } else if (fence?.character === openFence.character && fence.length >= openFence.length) {
        openFences.push(fence);
      }
      return "";
    }

    if (fence) {
      openFences.push(fence);
      return "";
    }

    return line;
  });

  if (openFences.length > 0) {
    throw new Error(`Malformed Markdown in ${file}: unclosed fenced code block`);
  }

  return stripped.join("\n");
}

function backtickRunLength(source: string, start: number): number {
  let length = 0;
  while (source[start + length] === "`") {
    length += 1;
  }
  return length;
}

function isEscaped(source: string, index: number): boolean {
  let precedingBackslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    precedingBackslashes += 1;
  }
  return precedingBackslashes % 2 === 1;
}

function findClosingBacktickRun(source: string, start: number, length: number): number {
  let cursor = start;
  while (cursor < source.length) {
    const nextBacktick = source.indexOf("`", cursor);
    if (nextBacktick === -1) {
      return -1;
    }

    const runLength = backtickRunLength(source, nextBacktick);
    if (runLength === length) {
      return nextBacktick;
    }
    cursor = nextBacktick + runLength;
  }

  return -1;
}

function blankInlineCode(source: string): string {
  return source.replace(/[^\r\n]/g, " ");
}

/**
 * Blank out inline code spans, keeping every character position and every newline.
 *
 * A backtick span is link-free by construction, and prose *about* links puts real `](` inside one
 * — `docs/PRDs/batch-26-08-16/PRD-125-docs-and-readme-overhaul.md:315` is a sentence describing
 * this very rule, and it was the first thing this checker choked on. Fenced blocks were already
 * stripped; inline spans were not, so the checker read documentation about itself as a malformed
 * link and exited 1 on a clean tree.
 *
 * Positions are preserved rather than removed so that error messages keep pointing at the real
 * offset, and CommonMark's rules are honoured: a run of N backticks is closed by the next run of
 * exactly N, a backslash-escaped backtick opens nothing, and an unclosed run is a literal
 * backtick left alone rather than swallowing the rest of the document.
 */
export function blankInlineCodeSpans(markdown: string): string {
  let stripped = "";
  let cursor = 0;

  while (cursor < markdown.length) {
    if (markdown[cursor] !== "`" || isEscaped(markdown, cursor)) {
      stripped += markdown[cursor];
      cursor += 1;
      continue;
    }

    const runLength = backtickRunLength(markdown, cursor);
    const closingRun = findClosingBacktickRun(markdown, cursor + runLength, runLength);
    if (closingRun === -1) {
      stripped += markdown.slice(cursor, cursor + runLength);
      cursor += runLength;
      continue;
    }

    const spanEnd = closingRun + runLength;
    stripped += blankInlineCode(markdown.slice(cursor, spanEnd));
    cursor = spanEnd;
  }

  return stripped;
}

function findClosingParenthesis(source: string, start: number): number {
  let nestedParentheses = 0;
  let escaped = false;

  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (!character) {
      return -1;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "(") {
      nestedParentheses += 1;
      continue;
    }
    if (character !== ")") {
      continue;
    }
    if (nestedParentheses === 0) {
      return cursor;
    }
    nestedParentheses -= 1;
  }

  return -1;
}

function extractMarkdownLinkTargets(markdown: string, file: string): string[] {
  const source = blankInlineCodeSpans(stripFencedCodeBlocks(markdown, file));
  const targets: string[] = [];
  let searchFrom = 0;

  while (true) {
    const marker = source.indexOf("](", searchFrom);
    if (marker === -1) {
      return targets;
    }

    const closingParenthesis = findClosingParenthesis(source, marker + 2);
    if (closingParenthesis === -1) {
      throw new Error(`Malformed Markdown link in ${file}: missing closing ')'`);
    }

    const target = source.slice(marker + 2, closingParenthesis).trim();
    if (!target) {
      throw new Error(`Malformed Markdown link in ${file}: empty target`);
    }

    targets.push(target);
    searchFrom = closingParenthesis + 1;
  }
}

function destinationFromTarget(rawTarget: string, file: string): string {
  let target = rawTarget.trim();
  if (target.startsWith("<")) {
    const closingAngle = target.indexOf(">");
    if (closingAngle === -1) {
      throw new Error(`Malformed Markdown link in ${file}: unclosed '<' destination`);
    }
    target = target.slice(1, closingAngle).trim();
  } else {
    const titledTarget = target.match(/^(.*?)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))$/);
    if (titledTarget?.[1]) {
      target = titledTarget[1].trim();
    }
  }

  if (!target) {
    throw new Error(`Malformed Markdown link in ${file}: empty destination`);
  }
  return target;
}

function relativeTarget(rawTarget: string, file: string): string | undefined {
  const target = destinationFromTarget(rawTarget, file);
  if (target.startsWith("#") || target.startsWith("/")) {
    return undefined;
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(target)) {
    return undefined;
  }

  const withoutFragment = target.split("#", 1)[0];
  if (!withoutFragment) {
    return undefined;
  }
  return withoutFragment;
}

export function listTrackedMarkdownFiles(root: string): string[] {
  let output: string;
  try {
    output = execFileSync("git", ["ls-files", "-z", "--", "*.md"], {
      cwd: root,
      encoding: "utf8",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to list tracked Markdown files: ${detail}`);
  }

  const files = output
    .split("\0")
    .filter((file) => file.length > 0)
    .filter((file) => !file.startsWith("docs/benchmark/sweeps/"));
  if (files.length === 0) {
    throw new Error("No tracked Markdown files found outside docs/benchmark/sweeps/");
  }
  return files;
}

export function checkDocLinks(
  root = process.cwd(),
  files: readonly string[] = listTrackedMarkdownFiles(root),
): DocLinkCheckResult {
  if (files.length === 0) {
    throw new Error("No Markdown files supplied to the documentation link checker");
  }

  const missing: DocLinkIssue[] = [];
  let linksChecked = 0;

  for (const file of files) {
    const absoluteFile = join(root, file);
    let contents: string;
    try {
      contents = readFileSync(absoluteFile, "utf8");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read ${file}: ${detail}`);
    }

    const targets = extractMarkdownLinkTargets(contents, file);
    for (const rawTarget of targets) {
      const target = relativeTarget(rawTarget, file);
      if (!target) {
        continue;
      }

      linksChecked += 1;
      const resolvedTarget = resolve(dirname(absoluteFile), target);
      if (!existsSync(resolvedTarget)) {
        missing.push({ file, target: rawTarget });
      }
    }
  }

  return { filesChecked: files.length, linksChecked, missing };
}

export function assertDocLinks(
  root = process.cwd(),
  files?: readonly string[],
): DocLinkCheckResult {
  const result = files === undefined ? checkDocLinks(root) : checkDocLinks(root, files);
  if (result.missing.length > 0) {
    const details = result.missing.map(({ file, target }) => `${file} -> ${target}`).join("\n");
    throw new Error(`Broken documentation links:\n${details}`);
  }
  return result;
}

function run(): void {
  try {
    const result = assertDocLinks();
    console.log(
      `Checked ${result.linksChecked} relative documentation links across ${result.filesChecked} Markdown files.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
