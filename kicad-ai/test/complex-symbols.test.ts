import { describe, it, expect } from "vitest";
import { SchematicBuilder } from "../src/builder/SchematicBuilder.js";
import { SymbolLibrary } from "../src/library/SymbolLibrary.js";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { findKicadCli } from "../src/utils/kicad-paths.js";

const OUT_DIR = join(import.meta.dirname, "..", "test-output");
const KICAD_CLI = findKicadCli();

function testSymbolLoadsInKicad(libraryId: string): void {
  const lib = new SymbolLibrary();
  const def = lib.resolve(libraryId);
  expect(def.pins.length).toBeGreaterThan(0);

  const rawText = lib.getRawSymbolText(libraryId);
  expect(rawText).toContain(`(symbol "${libraryId}"`);

  const sch = `(kicad_sch
\t(version 20250114)
\t(generator "test")
\t(generator_version "0.1")
\t(uuid "11111111-2222-3333-4444-555555555555")
\t(paper "A4")
\t(lib_symbols
\t\t${rawText}
\t)
\t(sheet_instances
\t\t(path "/"
\t\t\t(page "1")
\t\t)
\t)
\t(embedded_fonts no)
)
`;
  mkdirSync(OUT_DIR, { recursive: true });
  const safeName = libraryId.replace(/[:/]/g, "_");
  const path = join(OUT_DIR, `test-${safeName}.kicad_sch`);
  writeFileSync(path, sch);

  const result = execSync(`"${KICAD_CLI}" sch export svg "${path}" -o "${join(OUT_DIR, "svg")}" 2>&1`, {
    encoding: "utf-8",
  });
  expect(result).toContain("Plotted");
}

describe("Complex symbol loading", () => {
  it("loads LM358 (opamp, extends LM2904)", () => {
    testSymbolLoadsInKicad("Amplifier_Operational:LM358");
  });

  it("loads Conn_01x10 (generic connector)", () => {
    testSymbolLoadsInKicad("Connector_Generic:Conn_01x10");
  });

  it("loads 74HC00 (digital logic with text elements)", () => {
    testSymbolLoadsInKicad("74xx:74HC00");
  });

  it("loads STM32F103C8Tx (MCU, 48 pins, extends)", () => {
    testSymbolLoadsInKicad("MCU_ST_STM32F1:STM32F103C8Tx");
  });

  it("loads BSS138 (MOSFET)", () => {
    testSymbolLoadsInKicad("Transistor_FET:BSS138");
  });

  it("loads LM7805 (voltage regulator)", () => {
    testSymbolLoadsInKicad("Regulator_Linear:LM7805_TO220");
  });

  it("resolves extended symbol pins from base", () => {
    const lib = new SymbolLibrary();
    const lm358 = lib.resolve("Amplifier_Operational:LM358");
    // LM358 is a dual opamp: 8 pins (3 per unit + 2 power)
    expect(lm358.pins.length).toBe(8);
    const pinNumbers = lm358.pins.map(p => p.number).sort();
    expect(pinNumbers).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });
});
