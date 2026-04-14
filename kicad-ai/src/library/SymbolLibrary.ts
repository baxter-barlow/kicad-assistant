import { readFileSync, readdirSync } from "fs";
import { parseSExpr, findChild, findChildren, type SExpr } from "../sexpr/parser.js";
import { findSymbolsPath } from "../utils/kicad-paths.js";

export interface SearchResult {
  libraryId: string;
  name: string;
  description: string;
  keywords: string;
  reference: string;
  pinCount: number;
  score: number;
}

interface SearchEntry {
  libraryId: string;
  name: string;
  description: string;
  keywords: string;
  reference: string;
  pinCount: number;
  libraryName: string;
  // Pre-tokenized fields for scoring
  nameTokens: Set<string>;
  keywordTokens: Set<string>;
  descriptionTokens: Set<string>;
}

export interface PinDef {
  number: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  type: string;   // passive, power_in, input, output, etc.
  shape: string;  // line, inverted, clock, etc.
  length: number;
}

export interface PropertyDef {
  key: string;
  value: string;
}

export interface SymbolDef {
  libraryId: string;
  name: string;
  pins: PinDef[];
  properties: PropertyDef[];
  isPower: boolean;
  rawSExpr: SExpr;
}

export class SymbolLibrary {
  private cache = new Map<string, SExpr[]>();
  private rawTextCache = new Map<string, string>();
  private symbolsPath: string;
  private searchIndex: Map<string, Set<number>> | null = null;
  private searchEntries: SearchEntry[] = [];

  constructor(symbolsPath?: string) {
    this.symbolsPath = symbolsPath ?? findSymbolsPath();
  }

  get basePath(): string {
    return this.symbolsPath;
  }

  resolve(libraryId: string): SymbolDef {
    const [libName, symbolName] = libraryId.split(":");
    if (!libName || !symbolName) {
      throw new Error(`Invalid library ID: "${libraryId}". Expected "Library:Symbol" format.`);
    }

    const symbols = this.loadLibrary(libName);
    const symExpr = symbols.find(s => s[1] === symbolName);
    if (!symExpr) {
      throw new Error(`Symbol "${symbolName}" not found in library "${libName}"`);
    }

    // If this symbol extends another, resolve the base for pin definitions
    const extendsExpr = findChild(symExpr, "extends");
    if (extendsExpr && typeof extendsExpr[1] === "string") {
      const baseName = extendsExpr[1];
      const baseExpr = symbols.find(s => s[1] === baseName);
      if (!baseExpr) {
        throw new Error(`Base symbol "${baseName}" not found for "${symbolName}" in library "${libName}"`);
      }
      // Parse the base for pins, use derived for properties
      const baseDef = this.parseSymbol(libName, baseExpr);
      const derivedDef = this.parseSymbol(libName, symExpr);
      return {
        ...baseDef,
        libraryId: `${libName}:${symbolName}`,
        name: symbolName,
        properties: derivedDef.properties,
      };
    }

    return this.parseSymbol(libName, symExpr);
  }

  /**
   * Get the raw S-expression text for a symbol, suitable for embedding in lib_symbols.
   * Handles extends inheritance by using base symbol's structure with derived properties.
   */
  getRawSymbolText(libraryId: string): string {
    const [libName, symbolName] = libraryId.split(":");
    this.loadLibrary(libName);

    // Check if this symbol extends another
    const symbols = this.cache.get(libName) as SExpr[][];
    const symExpr = symbols.find(s => s[1] === symbolName);
    if (!symExpr) {
      throw new Error(`Symbol "${symbolName}" not found in library "${libName}"`);
    }

    const extendsExpr = findChild(symExpr, "extends");
    let rawText: string;

    if (extendsExpr && typeof extendsExpr[1] === "string") {
      rawText = this.resolveExtendsRawText(libName, symbolName, extendsExpr[1] as string);
    } else {
      rawText = this.rawTextCache.get(`${libName}:${symbolName}`)!;
      if (!rawText) {
        throw new Error(`Raw text not found for ${libraryId}`);
      }
    }

    // Rewrite only the top-level symbol name to library-qualified form.
    let result = rawText.replace(
      `(symbol "${symbolName}"`,
      `(symbol "${libraryId}"`
    );

    // Convert the entire merged text from v10 to sch format
    result = this.convertV10ToSchFormat(result);
    return result;
  }

  /**
   * For a derived symbol that uses `(extends "Base")`, produce a complete raw text
   * by taking the base symbol and replacing its properties with the derived's.
   */
  private resolveExtendsRawText(libName: string, derivedName: string, baseName: string): string {
    const baseRaw = this.rawTextCache.get(`${libName}:${baseName}`);
    if (!baseRaw) {
      throw new Error(`Base symbol "${baseName}" raw text not found in "${libName}"`);
    }

    const derivedRaw = this.rawTextCache.get(`${libName}:${derivedName}`);
    if (!derivedRaw) {
      throw new Error(`Derived symbol "${derivedName}" raw text not found in "${libName}"`);
    }

    // Rename symbol declarations only -- NOT property values, descriptions, or URLs.
    let result = baseRaw;
    result = result.replace(`(symbol "${baseName}"`, `(symbol "${derivedName}"`);
    result = result.replaceAll(`(symbol "${baseName}_`, `(symbol "${derivedName}_`);

    // Extract property blocks from both
    const baseProperties = this.extractPropertyBlocks(result);
    const derivedProperties = this.extractPropertyBlocks(derivedRaw);

    // Build replacements, then apply in reverse order to preserve indices
    const replacements: Array<{ start: number; end: number; block: string }> = [];
    for (const derived of derivedProperties) {
      const baseMatch = baseProperties.find(b => b.key === derived.key);
      if (baseMatch) {
        replacements.push({ start: baseMatch.start, end: baseMatch.end, block: derived.block });
      }
    }

    // Sort by start position descending so we can replace without index corruption
    replacements.sort((a, b) => b.start - a.start);
    for (const rep of replacements) {
      result = result.slice(0, rep.start) + rep.block + result.slice(rep.end);
    }

    return result;
  }

  /**
   * Extract all (property "Key" "Value" ...) blocks from raw text.
   * Returns start/end indices for precise replacement.
   */
  private extractPropertyBlocks(rawText: string): Array<{ key: string; block: string; start: number; end: number }> {
    const results: Array<{ key: string; block: string; start: number; end: number }> = [];
    const regex = /^\s*\(property "([^"]+)"/gm;
    let match;

    while ((match = regex.exec(rawText)) !== null) {
      const key = match[1];
      const startIdx = match.index;

      // Find the matching close paren using bracket counting
      let depth = 0;
      let i = startIdx;
      while (i < rawText.length && rawText[i] !== "(") i++;
      for (; i < rawText.length; i++) {
        const ch = rawText[i];
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0) {
            results.push({
              key,
              block: rawText.slice(startIdx, i + 1),
              start: startIdx,
              end: i + 1,
            });
            break;
          }
        } else if (ch === '"') {
          i++;
          while (i < rawText.length && rawText[i] !== '"') {
            if (rawText[i] === "\\") i++;
            i++;
          }
        }
      }
    }

    return results;
  }

  /**
   * Convert .kicad_sym v10 format to .kicad_sch lib_symbols format.
   */
  private convertV10ToSchFormat(text: string): string {
    let result = text;

    result = result.replace(/\(power global\)/g, "(power)");
    result = result.replace(/^\s*\(in_pos_files\s+\w+\)\s*$/gm, "");
    result = result.replace(/^\s*\(duplicate_pin_numbers_are_jumpers\s+\w+\)\s*$/gm, "");
    result = result.replace(/^\s*\(show_name\s+\w+\)\s*$/gm, "");
    result = result.replace(/^\s*\(do_not_autoplace\s+\w+\)\s*$/gm, "");
    result = result.replace(/^\s*\(body_styles\s+\w+\)\s*$/gm, "");

    // Move property-level (hide yes) into effects blocks.
    // Only for (property ...) context, NOT for (pin ...) context.
    result = this.moveHideIntoEffects(result);

    result = result.replace(/\n\s*\n/g, "\n");
    return result;
  }

  /**
   * Move (hide yes) from property level into effects block.
   * Only operates when (hide yes) is followed by (effects ...) —
   * this pattern only occurs in property blocks, not pin blocks.
   * Pin-level (hide yes) is NOT followed by (effects ...), so it's left alone.
   */
  private moveHideIntoEffects(text: string): string {
    const lines = text.split("\n");
    const output: string[] = [];
    let i = 0;

    while (i < lines.length) {
      if (lines[i].trim() === "(hide yes)") {
        // Check if next non-blank line starts an effects block
        let nextIdx = i + 1;
        while (nextIdx < lines.length && lines[nextIdx].trim() === "") nextIdx++;

        if (nextIdx < lines.length && lines[nextIdx].trim().startsWith("(effects")) {
          // Property-level hide: skip this line, inject inside effects block
          const effectsStartIdx = nextIdx;

          // Find end of effects block by bracket counting
          let depth = 0;
          let effectsEndIdx = effectsStartIdx;
          for (let j = effectsStartIdx; j < lines.length; j++) {
            for (const ch of lines[j]) {
              if (ch === "(") depth++;
              else if (ch === ")") depth--;
            }
            if (depth <= 0) {
              effectsEndIdx = j;
              break;
            }
          }

          // Emit the effects block lines (without the closing line)
          for (let j = effectsStartIdx; j < effectsEndIdx; j++) {
            output.push(lines[j]);
          }
          // Add (hide yes) inside effects, before closing
          const indent = lines[effectsStartIdx].match(/^(\s*)/)?.[1] ?? "";
          output.push(`${indent}\t(hide yes)`);
          output.push(lines[effectsEndIdx]);

          i = effectsEndIdx + 1;
          continue;
        }
        // Pin-level hide (not followed by effects): keep it as-is
      }
      output.push(lines[i]);
      i++;
    }

    return output.join("\n");
  }

  private loadLibrary(libName: string): SExpr[][] {
    if (this.cache.has(libName)) {
      return this.cache.get(libName) as SExpr[][];
    }

    const filePath = `${this.symbolsPath}/${libName}.kicad_sym`;
    let text: string;
    try {
      text = readFileSync(filePath, "utf-8");
    } catch {
      throw new Error(`Symbol library file not found: ${filePath}`);
    }

    const parsed = parseSExpr(text);
    if (parsed.length === 0 || !Array.isArray(parsed[0])) {
      throw new Error(`Failed to parse symbol library: ${filePath}`);
    }

    const lib = parsed[0] as SExpr[];
    const symbols = findChildren(lib, "symbol");
    this.cache.set(libName, symbols);
    this.extractRawSymbolTexts(libName, text);

    return symbols;
  }

  private extractRawSymbolTexts(libName: string, fileText: string): void {
    const regex = /(\n\t\(symbol "([^"]+)")/g;
    let match;
    while ((match = regex.exec(fileText)) !== null) {
      const symbolName = match[2];
      const startIdx = match.index + 1; // skip the leading \n

      let depth = 0;
      let i = startIdx;
      while (i < fileText.length && fileText[i] !== "(") i++;

      for (; i < fileText.length; i++) {
        const ch = fileText[i];
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0) {
            const rawText = fileText.slice(startIdx, i + 1).replace(/^\t/, "");
            this.rawTextCache.set(`${libName}:${symbolName}`, rawText);
            break;
          }
        } else if (ch === '"') {
          i++;
          while (i < fileText.length && fileText[i] !== '"') {
            if (fileText[i] === "\\") i++;
            i++;
          }
        }
      }
    }
  }

  private parseSymbol(libName: string, symExpr: SExpr[]): SymbolDef {
    const name = typeof symExpr[1] === "string" ? symExpr[1] : String(symExpr[1]);
    const libraryId = `${libName}:${name}`;

    const isPower = symExpr.some(
      child => Array.isArray(child) && child[0] === "power"
    );

    const properties: PropertyDef[] = [];
    for (const prop of findChildren(symExpr, "property")) {
      if (prop.length >= 3 && typeof prop[1] === "string" && typeof prop[2] === "string") {
        properties.push({ key: prop[1], value: prop[2] });
      }
    }

    const pins: PinDef[] = [];
    const subSymbols = findChildren(symExpr, "symbol");
    for (const sub of subSymbols) {
      for (const pinExpr of findChildren(sub, "pin")) {
        const pin = this.parsePin(pinExpr);
        if (pin) pins.push(pin);
      }
    }

    return { libraryId, name, pins, properties, isPower, rawSExpr: symExpr };
  }

  private parsePin(pinExpr: SExpr[]): PinDef | null {
    if (pinExpr.length < 3) return null;

    const type = typeof pinExpr[1] === "string" ? pinExpr[1] : String(pinExpr[1]);
    const shape = typeof pinExpr[2] === "string" ? pinExpr[2] : String(pinExpr[2]);

    const atExpr = findChild(pinExpr, "at");
    const lengthExpr = findChild(pinExpr, "length");
    const nameExpr = findChild(pinExpr, "name");
    const numberExpr = findChild(pinExpr, "number");

    if (!atExpr || !numberExpr) return null;

    return {
      number: String(numberExpr[1]),
      name: nameExpr ? String(nameExpr[1]) : "",
      x: typeof atExpr[1] === "number" ? atExpr[1] : 0,
      y: typeof atExpr[2] === "number" ? atExpr[2] : 0,
      angle: typeof atExpr[3] === "number" ? atExpr[3] : 0,
      type,
      shape,
      length: lengthExpr && typeof lengthExpr[1] === "number" ? lengthExpr[1] : 0,
    };
  }

  // ============================================================
  // Component Search
  // ============================================================

  /**
   * Search for symbols across all KiCad libraries.
   * Matches against symbol name, description, keywords, and library name.
   * Results ranked by relevance. Index built lazily on first call.
   */
  search(query: string, limit: number = 20): SearchResult[] {
    if (!this.searchIndex) this.buildSearchIndex();

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    // Collect candidate symbol indices that match at least one query token
    const candidates = new Set<number>();
    for (const token of queryTokens) {
      const exact = this.searchIndex!.get(token);
      if (exact) for (const idx of exact) candidates.add(idx);

      // Prefix match for partial queries (e.g., "LM78" matches "lm7805")
      if (token.length >= 3) {
        for (const [indexToken, indices] of this.searchIndex!) {
          if (indexToken.startsWith(token) && indexToken !== token) {
            for (const idx of indices) candidates.add(idx);
          }
        }
      }
    }

    // Score each candidate
    const queryNorm = normalize(query);
    const results: SearchResult[] = [];

    for (const idx of candidates) {
      const entry = this.searchEntries[idx];
      let score = 0;

      const nameNorm = normalize(entry.name);

      // 1. Exact name match -- dominant signal (+25)
      if (nameNorm === queryNorm) {
        score += 25;
      }
      // 2. Name contains full query as substring (+12)
      else if (nameNorm.includes(queryNorm) && queryNorm.length >= 2) {
        score += 12;
      }
      // 3. Query contains full name (e.g., query "STM32F103C8Tx" matches name "STM32F103C8Tx")
      else if (queryNorm.includes(nameNorm) && nameNorm.length >= 3) {
        score += 10;
      }

      // 4. Per-token field-weighted matching
      for (const qt of queryTokens) {
        // Name token: exact +5, prefix +2.5
        if (entry.nameTokens.has(qt)) score += 5;
        else if ([...entry.nameTokens].some(t => t.startsWith(qt) && qt.length >= 2)) score += 2.5;

        // Keyword token: exact +4, prefix +2 (curated, high signal)
        if (entry.keywordTokens.has(qt)) score += 4;
        else if ([...entry.keywordTokens].some(t => t.startsWith(qt) && qt.length >= 2)) score += 2;

        // Library name token: exact +1.5 (category signal, lower than keywords)
        if (tokenize(entry.libraryName).some(t => t === qt)) score += 1.5;

        // Description token: +0.3 penalized by length (avoid long-description bias)
        if (entry.descriptionTokens.has(qt)) {
          score += 0.3 * Math.min(1, 8 / Math.max(1, entry.descriptionTokens.size));
        }
      }

      // 5. All query tokens matched bonus (+6)
      const allMatch = queryTokens.every(qt =>
        entry.nameTokens.has(qt) ||
        entry.keywordTokens.has(qt) ||
        entry.descriptionTokens.has(qt) ||
        [...entry.nameTokens].some(t => t.startsWith(qt) && qt.length >= 2) ||
        [...entry.keywordTokens].some(t => t.startsWith(qt) && qt.length >= 2)
      );
      if (allMatch) score += 6;

      // 6. Reference designator match: query "resistor" + reference "R" = boost
      if (REFERENCE_MAP[queryNorm]?.includes(entry.reference)) score += 3;
      for (const qt of queryTokens) {
        if (REFERENCE_MAP[qt]?.includes(entry.reference)) score += 2;
      }

      // 7. Common component boost -- Device:R, Device:C, Device:LED etc.
      if (entry.libraryName === "Device" && entry.name.length <= 3) score += 1;

      if (score > 0) {
        results.push({
          libraryId: entry.libraryId,
          name: entry.name,
          description: entry.description,
          keywords: entry.keywords,
          reference: entry.reference,
          pinCount: entry.pinCount,
          score,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Build the search index by scanning all .kicad_sym files.
   * Uses parsed top-level symbols so search coverage matches resolver coverage.
   */
  private buildSearchIndex(): void {
    this.searchIndex = new Map();
    this.searchEntries = [];

    let files: string[];
    try {
      files = readdirSync(this.symbolsPath)
        .filter(f => f.endsWith(".kicad_sym"))
        .sort();
    } catch {
      return; // no symbols directory
    }

    for (const file of files) {
      const libName = file.replace(".kicad_sym", "");
      try {
        const text = readFileSync(`${this.symbolsPath}/${file}`, "utf-8");
        const parsed = parseSExpr(text);
        if (parsed.length === 0 || !Array.isArray(parsed[0])) continue;
        const lib = parsed[0] as SExpr[];
        const symbols = findChildren(lib, "symbol");
        this.indexLibrarySymbols(libName, symbols);
      } catch {
        continue;
      }
    }
  }

  private indexLibrarySymbols(libName: string, symbols: SExpr[][]): void {
    const symbolByName = new Map<string, SExpr[]>();
    const pinCountCache = new Map<string, number>();
    for (const symbol of symbols) {
      const name = typeof symbol[1] === "string" ? symbol[1] : String(symbol[1]);
      symbolByName.set(name, symbol);
    }

    for (const symExpr of symbols) {
      const name = typeof symExpr[1] === "string" ? symExpr[1] : String(symExpr[1]);
      const props = new Map<string, string>();
      for (const prop of findChildren(symExpr, "property")) {
        if (typeof prop[1] === "string" && typeof prop[2] === "string") {
          props.set(prop[1], prop[2]);
        }
      }

      const description = props.get("Description") ?? "";
      const keywords = props.get("ki_keywords") ?? "";
      const reference = props.get("Reference") ?? "";
      const pinCount = this.getIndexedPinCount(symExpr, symbolByName, pinCountCache);

      const nameTokens = new Set(tokenize(name));
      const keywordTokens = new Set(tokenize(keywords));
      const descriptionTokens = new Set(tokenize(description));
      const libTokens = tokenize(libName);

      const entry: SearchEntry = {
        libraryId: `${libName}:${name}`,
        name,
        description,
        keywords,
        reference,
        pinCount,
        libraryName: libName,
        nameTokens,
        keywordTokens,
        descriptionTokens,
      };

      const idx = this.searchEntries.length;
      this.searchEntries.push(entry);

      const allTokens = new Set([
        ...nameTokens, ...keywordTokens, ...descriptionTokens, ...libTokens,
      ]);

      for (const token of allTokens) {
        if (!this.searchIndex!.has(token)) {
          this.searchIndex!.set(token, new Set());
        }
        this.searchIndex!.get(token)!.add(idx);
      }
    }
  }

  private getIndexedPinCount(
    symExpr: SExpr[],
    symbolByName: Map<string, SExpr[]>,
    pinCountCache: Map<string, number>,
  ): number {
    const name = typeof symExpr[1] === "string" ? symExpr[1] : String(symExpr[1]);
    const cached = pinCountCache.get(name);
    if (cached !== undefined) {
      return cached;
    }

    const extendsExpr = findChild(symExpr, "extends");
    if (extendsExpr && typeof extendsExpr[1] === "string") {
      const baseExpr = symbolByName.get(extendsExpr[1]);
      const pinCount = baseExpr
        ? this.getIndexedPinCount(baseExpr, symbolByName, pinCountCache)
        : 0;
      pinCountCache.set(name, pinCount);
      return pinCount;
    }

    let pinCount = 0;
    for (const sub of findChildren(symExpr, "symbol")) {
      pinCount += findChildren(sub, "pin").length;
    }
    pinCountCache.set(name, pinCount);
    return pinCount;
  }
}

/**
 * Tokenize a string into searchable lowercase terms.
 * Splits on whitespace, underscores, hyphens, commas, and other punctuation.
 * Filters out very short tokens (< 2 chars) and common stop words.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s_\-,;:\/\(\)\[\]\.]+/)
    .filter(t => t.length >= 2 || EDA_SINGLE_CHARS.has(t))
    .filter(t => !STOP_WORDS.has(t));
}

/** Normalize a string for substring comparison: lowercase, strip all non-alphanumeric */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "pin", "pins", "type", "from",
  "to", "in", "of", "or", "no", "yes", "an", "is", "it",
]);

/** Single characters that are meaningful in EDA context (reference designators) */
const EDA_SINGLE_CHARS = new Set(["r", "c", "l", "u", "j", "d", "q", "k", "f"]);

/** Map common search terms to EDA reference designators */
const REFERENCE_MAP: Record<string, string[]> = {
  resistor: ["R"], resistance: ["R"], res: ["R"], r: ["R"],
  capacitor: ["C"], cap: ["C"], c: ["C"],
  inductor: ["L"], coil: ["L"], l: ["L"],
  diode: ["D"], led: ["D"], d: ["D"],
  transistor: ["Q"], mosfet: ["Q"], bjt: ["Q"], fet: ["Q"], q: ["Q"],
  connector: ["J"], jack: ["J"], plug: ["J"], header: ["J"], j: ["J"],
  ic: ["U"], mcu: ["U"], microcontroller: ["U"], chip: ["U"], u: ["U"],
  crystal: ["Y"], oscillator: ["Y"],
  fuse: ["F"], f: ["F"],
  relay: ["K"], k: ["K"],
};
