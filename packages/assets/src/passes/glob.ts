/**
 * Minimal glob matching for config-declared path overrides: `*` matches within one path
 * segment, `**` matches any number of whole segments, `?` matches one character. Deliberately
 * not a dependency — the asset config needs exactly this vocabulary and nothing more.
 */
export function globMatch(glob: string, logicalPath: string): boolean {
  return new RegExp(`^${globSource(glob)}$`, "u").test(logicalPath);
}

function globSource(glob: string): string {
  let source = "";
  let index = 0;
  for (;;) {
    const char = glob[index];
    if (char === undefined) break;
    if (char === "*") {
      if (glob[index + 1] === "*") {
        let end = index;
        while (glob[end] === "*") end += 1;
        // A "**/" pair crosses any number of whole segments; any other "**" takes the rest
        // of the path ("props/**" matches everything under props/, at any depth).
        if (glob[end] === "/") {
          index = end + 1;
          source += "(?:[^/]+/)*";
          continue;
        }
        index = end;
        source += ".*";
        continue;
      }
      index += 1;
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      index += 1;
      source += "[^/]";
      continue;
    }
    index += 1;
    source += char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  return source;
}
