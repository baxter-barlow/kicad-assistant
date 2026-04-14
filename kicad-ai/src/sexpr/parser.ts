/**
 * Lenient S-expression parser for KiCad files (.kicad_sym, .kicad_sch).
 * Returns nested arrays of strings/numbers. Does not crash on unknown tokens.
 */

export type SExpr = string | number | SExpr[];

export function parseSExpr(input: string): SExpr[] {
  let pos = 0;

  function skipWhitespaceAndComments() {
    while (pos < input.length) {
      const ch = input[pos];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        pos++;
      } else {
        break;
      }
    }
  }

  function parseString(): string {
    pos++; // skip opening quote
    let result = "";
    while (pos < input.length) {
      const ch = input[pos];
      if (ch === "\\") {
        pos++;
        if (pos < input.length) {
          const escaped = input[pos];
          if (escaped === "n") result += "\n";
          else if (escaped === "t") result += "\t";
          else result += escaped;
          pos++;
        }
      } else if (ch === '"') {
        pos++; // skip closing quote
        return result;
      } else {
        result += ch;
        pos++;
      }
    }
    return result;
  }

  function parseAtom(): string | number {
    const start = pos;
    while (pos < input.length) {
      const ch = input[pos];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "(" || ch === ")") {
        break;
      }
      pos++;
    }
    const token = input.slice(start, pos);
    const num = Number(token);
    if (token !== "" && !isNaN(num) && token !== "yes" && token !== "no") {
      return num;
    }
    return token;
  }

  function parseList(): SExpr[] {
    pos++; // skip opening paren
    const items: SExpr[] = [];
    while (pos < input.length) {
      skipWhitespaceAndComments();
      if (pos >= input.length) break;
      if (input[pos] === ")") {
        pos++; // skip closing paren
        return items;
      }
      items.push(parseOne());
    }
    return items;
  }

  function parseOne(): SExpr {
    skipWhitespaceAndComments();
    if (input[pos] === "(") {
      return parseList();
    } else if (input[pos] === '"') {
      return parseString();
    } else {
      return parseAtom();
    }
  }

  const results: SExpr[] = [];
  while (pos < input.length) {
    skipWhitespaceAndComments();
    if (pos >= input.length) break;
    results.push(parseOne());
  }
  return results;
}

/** Find a child list by its first element (token name) */
export function findChild(sexpr: SExpr[], token: string): SExpr[] | undefined {
  for (const child of sexpr) {
    if (Array.isArray(child) && child[0] === token) {
      return child;
    }
  }
  return undefined;
}

/** Find all child lists with a given token name */
export function findChildren(sexpr: SExpr[], token: string): SExpr[][] {
  const results: SExpr[][] = [];
  for (const child of sexpr) {
    if (Array.isArray(child) && child[0] === token) {
      results.push(child);
    }
  }
  return results;
}

