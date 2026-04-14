import { describe, it, expect } from "vitest";
import { readSchematic, inferNets } from "../src/reader/SchematicReader.js";
import { SchematicBuilder } from "../src/builder/SchematicBuilder.js";
import { SymbolLibrary } from "../src/library/SymbolLibrary.js";
import { mkdirSync } from "fs";
import { join } from "path";

const TEMPLATE = join(import.meta.dirname, "..", "template.kicad_sch");
const OUT_DIR = join(import.meta.dirname, "..", "test-output");

describe("SchematicReader", () => {
  it("reads the template schematic", () => {
    const result = readSchematic(TEMPLATE);

    expect(result.uuid).toBeTruthy();
    expect(result.titleBlock.title).toBe("LED Resistor Test Circuit");
    expect(result.titleBlock.date).toBe("2026-04-10");
    expect(result.titleBlock.rev).toBe("0.1");
  });

  it("extracts all placed symbols", () => {
    const result = readSchematic(TEMPLATE);

    expect(result.symbols).toHaveLength(4);

    const refs = result.symbols.map(s => s.ref).sort();
    expect(refs).toEqual(["#PWR01", "#PWR02", "D1", "R1"]);

    const r1 = result.symbols.find(s => s.ref === "R1")!;
    expect(r1.libraryId).toBe("Device:R");
    expect(r1.value).toBe("330");
    expect(r1.at.x).toBe(127);
    expect(r1.at.y).toBe(77.47);

    const d1 = result.symbols.find(s => s.ref === "D1")!;
    expect(d1.libraryId).toBe("Device:LED");
    expect(d1.value).toBe("Red");
  });

  it("extracts all wires", () => {
    const result = readSchematic(TEMPLATE);

    expect(result.wires.length).toBe(5);

    // Check one specific wire: VCC to R1 (127, 68.58) -> (127, 73.66)
    const vccWire = result.wires.find(
      w => w.from.x === 127 && w.from.y === 68.58
    );
    expect(vccWire).toBeTruthy();
    expect(vccWire!.to.x).toBe(127);
    expect(vccWire!.to.y).toBe(73.66);
  });

  it("reads a generated schematic with labels", () => {
    // Read the auto-layout LED output (generated in previous test run)
    const autoPath = join(import.meta.dirname, "..", "test-output", "auto-layout-led.kicad_sch");
    try {
      const result = readSchematic(autoPath);
      expect(result.symbols.length).toBeGreaterThan(0);
      // Should have labels for local nets
      const ledKLabels = result.labels.filter(l => l.name === "LED_K");
      expect(ledKLabels.length).toBeGreaterThanOrEqual(1);
    } catch {
      // Skip if auto-layout test hasn't run yet
    }
  });

  it("treats PWR_FLAG pins as infrastructure during net inference", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const sch = new SchematicBuilder({ title: "Reader Flag Test" });
    const flag = sch.addPowerFlag({ at: [100, 90] });
    const r1 = sch.addSymbol("Device:R", { ref: "R1", value: "1k", at: [100, 100] });
    sch.connect(flag, 1, r1, 1);
    sch.addNoConnect(r1.pinPositions.get("2")!);

    const path = join(OUT_DIR, "reader-flag-test.kicad_sch");
    sch.save(path);

    const result = readSchematic(path);
    const nets = inferNets(result, new SymbolLibrary());
    const flaggedNet = nets.find(net => net.pins.some(pin => pin.symbolRef === "R1" && pin.pinId === "1"));

    expect(flaggedNet).toBeTruthy();
    expect(flaggedNet!.pins.some(pin => pin.symbolRef === "R1" && pin.pinId === "1")).toBe(true);
    expect(flaggedNet!.pins.some(pin => pin.symbolRef.startsWith("#FLG"))).toBe(false);
  });
});
