export interface ICodeBlockProps {
  readonly language: "bash" | "tsx" | "typescript";
  readonly source: string;
}

const KEYWORDS = new Set([
  "await",
  "class",
  "const",
  "default",
  "export",
  "extends",
  "from",
  "function",
  "import",
  "interface",
  "let",
  "new",
  "override",
  "readonly",
  "return",
  "static",
  "type",
]);

interface IToken {
  readonly kind: "comment" | "keyword" | "number" | "plain" | "string";
  readonly text: string;
}

/**
 * A deliberately small tokenizer instead of a highlighter dependency: the panel shows three known
 * files, and shipping a 200 kB grammar bundle to colour eighteen lines is the kind of trade the
 * repository's own kill-switch rule exists to stop.
 */
function tokenize(line: string): readonly IToken[] {
  const tokens: IToken[] = [];
  const pattern =
    /(\/\/.*$|#.*$)|("[^"]*"|'[^']*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/gu;
  let index = 0;
  for (const match of line.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > index) tokens.push({ kind: "plain", text: line.slice(index, start) });
    const [text, comment, quoted, numeric, word] = match;
    if (comment !== undefined) tokens.push({ kind: "comment", text });
    else if (quoted !== undefined) tokens.push({ kind: "string", text });
    else if (numeric !== undefined) tokens.push({ kind: "number", text });
    else if (word !== undefined)
      tokens.push({ kind: KEYWORDS.has(word) ? "keyword" : "plain", text });
    index = start + text.length;
  }
  if (index < line.length) tokens.push({ kind: "plain", text: line.slice(index) });
  return tokens;
}

const TOKEN_CLASS: Record<IToken["kind"], string> = {
  comment: "text-tn-fg-subtle/70 italic",
  keyword: "text-[#c792ea]",
  number: "text-[#f78c6c]",
  plain: "text-[#c8ced6]",
  string: "text-[#c3e88d]",
};

export function CodeBlock({ language, source }: ICodeBlockProps) {
  const lines = source.replace(/\n+$/u, "").split("\n");
  return (
    <pre
      className="overflow-x-auto px-5 py-4 font-mono text-[13.5px] leading-[1.62]"
      data-language={language}
    >
      <code>
        {lines.map((line, lineIndex) => (
          // Source lines have no identity beyond their position in the file.
          // biome-ignore lint/suspicious/noArrayIndexKey: a line's index is its identity here.
          <span className="grid grid-cols-[2.25rem_1fr]" key={lineIndex}>
            <span aria-hidden="true" className="select-none text-right text-tn-fg-subtle/45">
              {lineIndex + 1}
            </span>
            <span className="pl-4">
              {tokenize(line).map((token, tokenIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional too.
                <span className={TOKEN_CLASS[token.kind]} key={tokenIndex}>
                  {token.text}
                </span>
              ))}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}
