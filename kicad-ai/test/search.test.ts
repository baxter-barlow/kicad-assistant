import { describe, it, expect } from "vitest";
import { SymbolLibrary } from "../src/library/SymbolLibrary.js";
import { readdirSync, readFileSync } from "fs";
import { parseSExpr, findChildren } from "../src/sexpr/parser.js";

describe("Component search", () => {
  const lib = new SymbolLibrary();

  it("finds STM32F103 by exact name", () => {
    const results = lib.search("STM32F103C8Tx");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].libraryId).toContain("STM32F103");
  });

  it("finds STM32 MCUs by partial name", () => {
    const results = lib.search("STM32F103");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.libraryId.includes("STM32"))).toBe(true);
  });

  it("finds components by keyword", () => {
    const results = lib.search("cortex-m3");
    expect(results.length).toBeGreaterThan(0);
    // Should find ARM Cortex-M3 MCUs
    expect(results.some(r => r.keywords.toLowerCase().includes("cortex"))).toBe(true);
  });

  it("finds USB connectors", () => {
    const results = lib.search("USB connector");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.name.includes("USB"))).toBe(true);
  });

  it("finds resistors", () => {
    const results = lib.search("resistor");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.reference === "R")).toBe(true);
  });

  it("finds voltage regulators by LM78xx", () => {
    const results = lib.search("LM7805");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toContain("LM78");
  });

  it("finds LEDs", () => {
    const results = lib.search("LED");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.name === "LED")).toBe(true);
  });

  it("returns pinCount for non-extended symbols", () => {
    // Device:R has 2 pins and doesn't use extends
    const results = lib.search("resistor");
    const resistor = results.find(r => r.name === "R");
    expect(resistor).toBeTruthy();
    expect(resistor!.pinCount).toBe(2);
  });

  it("returns pinCount for extended symbols", () => {
    const results = lib.search("LM358");
    const lm358 = results.find(r => r.name === "LM358");
    expect(lm358).toBeTruthy();
    expect(lm358!.pinCount).toBe(8);
  });

  it("returns empty array for nonsense query", () => {
    const results = lib.search("xyzzy123nonsense");
    expect(results).toEqual([]);
  });

  it("respects limit parameter", () => {
    const results = lib.search("STM32", 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("returns results with scores in descending order", () => {
    const results = lib.search("operational amplifier");
    expect(results.length).toBeGreaterThan(1);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it("ranks exact name matches higher than partial matches", () => {
    const results = lib.search("LM358");
    expect(results.length).toBeGreaterThan(0);
    // First result should be the exact LM358, not a variant
    expect(results[0].name).toBe("LM358");
  });

  it("searches across library categories", () => {
    const results = lib.search("temperature sensor");
    expect(results.length).toBeGreaterThan(0);
    // Should find sensors from Sensor_Temperature library
    expect(results.some(r => r.libraryId.includes("Sensor"))).toBe(true);
  });
});

describe("Search performance", () => {
  it("indexes the same number of top-level symbols that the parser sees", () => {
    const lib = new SymbolLibrary();
    lib.search("resistor"); // triggers index build and library loading

    const entryCount = (lib as any).searchEntries.length as number;
    const files = readdirSync(lib.basePath)
      .filter(file => file.endsWith(".kicad_sym"))
      .sort();

    const parsedSymbolCount = files.reduce((count, file) => {
      const text = readFileSync(`${lib.basePath}/${file}`, "utf-8");
      const parsed = parseSExpr(text);
      if (parsed.length === 0 || !Array.isArray(parsed[0])) return count;
      return count + findChildren(parsed[0] as unknown[], "symbol").length;
    }, 0);

    expect(entryCount).toBe(parsedSymbolCount);
  });

  it("builds index and searches in reasonable time", () => {
    const lib = new SymbolLibrary();
    const start = Date.now();
    const results1 = lib.search("STM32"); // triggers index build
    const indexTime = Date.now() - start;

    const start2 = Date.now();
    const results2 = lib.search("USB connector"); // cached index
    const searchTime = Date.now() - start2;

    expect(indexTime).toBeLessThan(5000); // < 5 seconds for index build
    expect(searchTime).toBeLessThan(100);  // < 100ms for cached search
    expect(results1.length).toBeGreaterThan(0);
    expect(results2.length).toBeGreaterThan(0);

    console.log(`Index build: ${indexTime}ms, Search: ${searchTime}ms`);
    console.log(`Index size: ${results1.length > 0 ? "OK" : "EMPTY"}`);
  });
});
