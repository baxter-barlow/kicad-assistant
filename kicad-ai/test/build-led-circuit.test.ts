import { describe, it, expect } from "vitest";
import { SchematicBuilder } from "../src/builder/SchematicBuilder.js";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";

const OUT_DIR = join(import.meta.dirname, "..", "test-output");

describe("SchematicBuilder", () => {
  it("builds an LED circuit and generates a valid .kicad_sch file", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const sch = new SchematicBuilder({
      title: "LED Resistor Test Circuit",
      date: "2026-04-10",
      rev: "0.1",
    });

    // Place components
    const vcc = sch.addPower("VCC", { at: [127, 68.58] });
    const r1 = sch.addSymbol("Device:R", {
      ref: "R1",
      value: "330",
      at: [127, 77.47],
      footprint: "Resistor_SMD:R_0805_2012Metric",
    });
    const d1 = sch.addSymbol("Device:LED", {
      ref: "D1",
      value: "Red",
      at: [134.62, 86.36],
      footprint: "LED_SMD:LED_0805_2012Metric",
    });
    const gnd = sch.addPower("GND", { at: [142.24, 91.44] });
    const vccFlag = sch.addPowerFlag({ at: [114.3, 68.58] });
    const gndFlag = sch.addPowerFlag({ at: [154.94, 91.44] });

    // Verify pin positions
    expect(r1.pinPositions.get("1")).toEqual({ x: 127, y: 81.28 });
    expect(r1.pinPositions.get("2")).toEqual({ x: 127, y: 73.66 });
    expect(d1.pinPositions.get("K")).toEqual({ x: 130.81, y: 86.36 });
    expect(d1.pinPositions.get("A")).toEqual({ x: 138.43, y: 86.36 });
    expect(vcc.pinPositions.get("1")).toEqual({ x: 127, y: 68.58 });
    expect(gnd.pinPositions.get("1")).toEqual({ x: 142.24, y: 91.44 });
    expect(vccFlag.pinPositions.get("1")).toEqual({ x: 114.3, y: 68.58 });
    expect(gndFlag.pinPositions.get("1")).toEqual({ x: 154.94, y: 91.44 });

    // Connect: PWR_FLAG -> VCC -> R1 pin 2 (top) -> R1 pin 1 (bottom) -> LED K -> LED A -> GND -> PWR_FLAG
    sch.connect(vccFlag, 1, vcc, 1);
    sch.connect(vcc, 1, r1, 2);   // VCC to R1 top
    sch.connect(r1, 1, d1, "K");  // R1 bottom to LED cathode
    sch.connect(d1, "A", gnd, 1); // LED anode to GND
    sch.connect(gnd, 1, gndFlag, 1);

    // Save
    const outPath = join(OUT_DIR, "led-circuit.kicad_sch");
    sch.save(outPath);
    expect(existsSync(outPath)).toBe(true);

    // Verify content structure
    const content = readFileSync(outPath, "utf-8");
    expect(content).toContain("(kicad_sch");
    expect(content).toContain('(lib_id "Device:R")');
    expect(content).toContain('(lib_id "Device:LED")');
    expect(content).toContain('(lib_id "power:VCC")');
    expect(content).toContain('(lib_id "power:GND")');
    expect(content).toContain('(lib_id "power:PWR_FLAG")');
    expect(content).toContain('(title "LED Resistor Test Circuit")');

    // Count symbols and wires
    const symbolMatches = content.match(/\(lib_id "/g);
    expect(symbolMatches?.length).toBe(6);

    const wireMatches = content.match(/\(wire\n/g);
    // Flag->VCC = 1, VCC->R1 = 1, R1->LED = 2, LED->GND = 2, GND->Flag = 1
    expect(wireMatches?.length).toBeGreaterThanOrEqual(7);
  });

  it("passes ERC on the generated schematic once power nets are flagged", () => {
    const outPath = join(OUT_DIR, "led-circuit.kicad_sch");
    if (!existsSync(outPath)) {
      throw new Error("Run the build test first");
    }

    const sch = new SchematicBuilder();
    const erc = sch.validate(outPath);

    console.log("ERC errors:", erc.errors.length);
    console.log("ERC warnings:", erc.warnings.length);
    for (const e of erc.errors) console.log("  ERROR:", e.message);
    for (const w of erc.warnings) console.log("  WARN:", w.message);

    expect(erc.passed).toBe(true);
    expect(erc.errors).toHaveLength(0);
    expect(erc.warnings).toHaveLength(0);
  });

  it("exports SVG", () => {
    const schPath = join(OUT_DIR, "led-circuit.kicad_sch");
    if (!existsSync(schPath)) {
      throw new Error("Run the build test first");
    }

    const sch = new SchematicBuilder();
    const svgDir = join(OUT_DIR, "svg");
    sch.export(schPath, svgDir);

    // kicad-cli creates the SVG file inside the output directory
    const svgPath = join(svgDir, "led-circuit.svg");
    expect(existsSync(svgPath)).toBe(true);
    const svgContent = readFileSync(svgPath, "utf-8");
    expect(svgContent).toContain("<svg");
  });
});
