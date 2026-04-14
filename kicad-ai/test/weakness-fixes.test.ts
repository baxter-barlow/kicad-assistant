import { describe, it, expect } from "vitest";
import { SymbolLibrary } from "../src/library/SymbolLibrary.js";
import { SchematicBuilder } from "../src/builder/SchematicBuilder.js";
import { NetlistBuilder } from "../src/netlist/NetlistBuilder.js";
import { autoLayout } from "../src/layout/AutoLayout.js";
import { Netlist } from "../src/netlist/Netlist.js";
import { readSchematic, inferNets } from "../src/reader/SchematicReader.js";
import { join } from "path";

describe("Fix 1: replaceAll no longer corrupts descriptions", () => {
  it("LM358 description still references LM2904", () => {
    const lib = new SymbolLibrary();
    const rawText = lib.getRawSymbolText("Amplifier_Operational:LM358");

    // The description should mention the original base part
    expect(rawText).toContain("lm2904");
  });

  it("LM358 datasheet URL still points to LM2904", () => {
    const lib = new SymbolLibrary();
    const rawText = lib.getRawSymbolText("Amplifier_Operational:LM358");

    expect(rawText).toContain("lm2904-n.pdf");
  });

  it("sub-symbols are correctly renamed", () => {
    const lib = new SymbolLibrary();
    const rawText = lib.getRawSymbolText("Amplifier_Operational:LM358");

    // Sub-symbols should use the derived name
    expect(rawText).toContain('(symbol "LM358_1_1"');
    expect(rawText).toContain('(symbol "LM358_2_1"');
    // Base name should NOT appear in symbol declarations
    expect(rawText).not.toContain('(symbol "LM2904"');
    expect(rawText).not.toContain('(symbol "LM2904_');
  });
});

describe("Fix 2: lib_symbols indentation is correct", () => {
  it("properties inside lib_symbols have exactly 3 tabs", () => {
    const sch = new SchematicBuilder({ title: "Indent Test" });
    sch.addSymbol("Device:R", { ref: "R1", value: "1k", at: [100, 100] });
    const content = sch.generate();

    // Find the first property inside lib_symbols
    const libStart = content.indexOf("(lib_symbols");
    const propMatch = content.slice(libStart).match(/\n(\t*)\(property "Reference"/);
    expect(propMatch).toBeTruthy();
    expect(propMatch![1]).toBe("\t\t\t"); // exactly 3 tabs
  });
});

describe("Fix 3: auto-layout separates independent signal paths", () => {
  it("R1->R3 and R2->R4 are grouped by signal connectivity", () => {
    const powerNames = new Set(["VCC", "GND"]);
    const netlist = new Netlist(powerNames);

    // Two independent signal paths sharing VCC and GND
    netlist.addSymbol({ libraryId: "Device:R", ref: "R1", value: "1k", footprint: "", rotation: 0,
      nets: new Map([["1", "VCC"], ["2", "SIG_A"]]) });
    netlist.addSymbol({ libraryId: "Device:R", ref: "R2", value: "2k", footprint: "", rotation: 0,
      nets: new Map([["1", "VCC"], ["2", "SIG_B"]]) });
    netlist.addSymbol({ libraryId: "Device:R", ref: "R3", value: "3k", footprint: "", rotation: 0,
      nets: new Map([["1", "SIG_A"], ["2", "GND"]]) });
    netlist.addSymbol({ libraryId: "Device:R", ref: "R4", value: "4k", footprint: "", rotation: 0,
      nets: new Map([["1", "SIG_B"], ["2", "GND"]]) });

    const lib = new SymbolLibrary();
    const result = autoLayout(netlist, lib);

    // All 4 symbols should be placed (no missing placements)
    expect(result.placements.size).toBe(4);

    // R3 is connected to R1 via SIG_A, should be placed near R1
    const r1 = result.placements.get("R1")!.at;
    const r3 = result.placements.get("R3")!.at;
    const r1r3dist = Math.sqrt((r1.x - r3.x) ** 2 + (r1.y - r3.y) ** 2);

    // R4 is connected to R2 via SIG_B, should be placed near R2
    const r2 = result.placements.get("R2")!.at;
    const r4 = result.placements.get("R4")!.at;
    const r2r4dist = Math.sqrt((r2.x - r4.x) ** 2 + (r2.y - r4.y) ** 2);

    // Connected pairs should be placed (not at infinity)
    expect(r1r3dist).toBeLessThan(150);
    expect(r2r4dist).toBeLessThan(150);
  });

  it("components only connected via power nets are not forced adjacent", () => {
    const powerNames = new Set(["VCC", "GND"]);
    const netlist = new Netlist(powerNames);

    // Two completely independent sub-circuits sharing only power
    netlist.addSymbol({ libraryId: "Device:R", ref: "R1", value: "1k", footprint: "", rotation: 0,
      nets: new Map([["1", "VCC"], ["2", "ISOLATED_A"]]) });
    netlist.addSymbol({ libraryId: "Device:R", ref: "R2", value: "2k", footprint: "", rotation: 0,
      nets: new Map([["1", "VCC"], ["2", "ISOLATED_B"]]) });

    const lib = new SymbolLibrary();
    const result = autoLayout(netlist, lib);

    // Without power net filtering, R1 and R2 would be in the same column (depth 0).
    // With filtering, R2 is unreachable from R1 (no signal path), so it gets depth 999.
    // They should NOT be at the same position.
    const r1 = result.placements.get("R1")!;
    const r2 = result.placements.get("R2")!;
    expect(r1.at.x !== r2.at.x || r1.at.y !== r2.at.y).toBe(true);
  });
});

describe("Fix 4: net inference from parsed schematic", () => {
  it("infers nets from template.kicad_sch", () => {
    const templatePath = join(import.meta.dirname, "..", "template.kicad_sch");
    const result = readSchematic(templatePath);
    const lib = new SymbolLibrary();

    const nets = inferNets(result, lib);

    expect(nets.length).toBeGreaterThanOrEqual(3);

    // Should find VCC net (from #PWR01 power symbol)
    const vccNet = nets.find(n => n.name === "VCC");
    expect(vccNet).toBeTruthy();
    expect(vccNet!.isPower).toBe(true);
    // VCC connects to R1 pin 2 (the top pin)
    expect(vccNet!.pins.some(p => p.symbolRef === "R1" && p.pinId === "2")).toBe(true);

    // Should find GND net
    const gndNet = nets.find(n => n.name === "GND");
    expect(gndNet).toBeTruthy();
    expect(gndNet!.isPower).toBe(true);

    // Should find the R1-to-LED connection net
    const midNet = nets.find(n =>
      n.pins.some(p => p.symbolRef === "R1" && p.pinId === "1") &&
      n.pins.some(p => p.symbolRef === "D1")
    );
    expect(midNet).toBeTruthy();
  });

  it("correctly traces wire chains", () => {
    const templatePath = join(import.meta.dirname, "..", "template.kicad_sch");
    const result = readSchematic(templatePath);
    const lib = new SymbolLibrary();

    const nets = inferNets(result, lib);

    // Every non-power net should have at least 2 pins
    for (const net of nets) {
      if (!net.isPower) {
        expect(net.pins.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("Fix 5: SymbolLibrary.basePath getter", () => {
  it("exposes the symbols path without bracket notation", () => {
    const lib = new SymbolLibrary();
    expect(lib.basePath).toContain("symbols");
  });
});
