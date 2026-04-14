import { describe, it, expect } from "vitest";
import { computeBoundingBox } from "../src/layout/BoundingBox.js";
import { autoLayout } from "../src/layout/AutoLayout.js";
import { NetlistBuilder } from "../src/netlist/NetlistBuilder.js";
import { SymbolLibrary } from "../src/library/SymbolLibrary.js";
import { Netlist } from "../src/netlist/Netlist.js";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const OUT_DIR = join(import.meta.dirname, "..", "test-output");

describe("BoundingBox", () => {
  it("computes bounding box for Device:R", () => {
    const lib = new SymbolLibrary();
    const def = lib.resolve("Device:R");
    const bbox = computeBoundingBox(def);

    // R symbol: rectangle from (-1.016, -2.54) to (1.016, 2.54), pins at y=+/-3.81
    expect(bbox.width).toBeGreaterThan(2);
    expect(bbox.height).toBeGreaterThan(7);
    expect(bbox.minY).toBeCloseTo(-3.81, 1);
    expect(bbox.maxY).toBeCloseTo(3.81, 1);
  });

  it("computes bounding box for Device:LED", () => {
    const lib = new SymbolLibrary();
    const def = lib.resolve("Device:LED");
    const bbox = computeBoundingBox(def);

    // LED: pins at x=-3.81 and x=3.81, body about -1.27 to 1.27
    expect(bbox.width).toBeGreaterThan(7);
    expect(bbox.minX).toBeCloseTo(-4.572, 1); // includes arrow markers
    expect(bbox.maxX).toBeCloseTo(3.81, 1);
  });

  it("computes bounding box for a complex symbol", () => {
    const lib = new SymbolLibrary();
    const def = lib.resolve("Connector_Generic:Conn_01x10");
    const bbox = computeBoundingBox(def);

    // 10-pin connector should be tall
    expect(bbox.height).toBeGreaterThan(20);
  });
});

describe("AutoLayout", () => {
  it("assigns placements to all symbols", () => {
    const lib = new SymbolLibrary();
    const powerNames = new Set(["VCC", "GND"]);
    const netlist = new Netlist(powerNames);

    netlist.addSymbol({
      libraryId: "Device:R", ref: "R1", value: "330", footprint: "", rotation: 0,
      nets: new Map([["1", "VCC"], ["2", "MID"]]),
    });
    netlist.addSymbol({
      libraryId: "Device:LED", ref: "D1", value: "Red", footprint: "", rotation: 0,
      nets: new Map([["1", "MID"], ["2", "GND"]]),
    });

    const result = autoLayout(netlist, lib);

    expect(result.placements.size).toBe(2);
    expect(result.placements.has("R1")).toBe(true);
    expect(result.placements.has("D1")).toBe(true);

    // Placements should be on-grid (within floating point tolerance)
    const r1 = result.placements.get("R1")!;
    const isOnGrid = (v: number) => Math.abs(Math.round(v / 2.54) * 2.54 - v) < 0.01;
    expect(isOnGrid(r1.at.x)).toBe(true);
    expect(isOnGrid(r1.at.y)).toBe(true);
  });

  it("places connected symbols in adjacent columns", () => {
    const lib = new SymbolLibrary();
    const powerNames = new Set(["VCC", "GND"]);
    const netlist = new Netlist(powerNames);

    netlist.addSymbol({
      libraryId: "Device:R", ref: "R1", value: "1k", footprint: "", rotation: 0,
      nets: new Map([["1", "A"], ["2", "B"]]),
    });
    netlist.addSymbol({
      libraryId: "Device:R", ref: "R2", value: "2k", footprint: "", rotation: 0,
      nets: new Map([["1", "B"], ["2", "C"]]),
    });
    netlist.addSymbol({
      libraryId: "Device:R", ref: "R3", value: "3k", footprint: "", rotation: 0,
      nets: new Map([["1", "C"], ["2", "D"]]),
    });

    const result = autoLayout(netlist, lib);
    const positions = [...result.placements.values()].map(p => p.at.x);

    // R1 should be leftmost, R3 rightmost (signal flows left to right)
    expect(result.placements.get("R1")!.at.x).toBeLessThanOrEqual(
      result.placements.get("R2")!.at.x
    );
    expect(result.placements.get("R2")!.at.x).toBeLessThanOrEqual(
      result.placements.get("R3")!.at.x
    );
  });

  it("produces no overlapping symbols", () => {
    const lib = new SymbolLibrary();
    const powerNames = new Set(["VCC", "GND"]);
    const netlist = new Netlist(powerNames);

    // 4 resistors in a chain
    for (let i = 1; i <= 4; i++) {
      const nets = new Map<string, string>();
      nets.set("1", i === 1 ? "IN" : `N${i-1}`);
      nets.set("2", i === 4 ? "OUT" : `N${i}`);
      netlist.addSymbol({
        libraryId: "Device:R", ref: `R${i}`, value: `${i}k`, footprint: "", rotation: 0, nets,
      });
    }

    const result = autoLayout(netlist, lib);
    const placements = [...result.placements.entries()];

    // Check no two symbols overlap
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const a = placements[i][1].at;
        const b = placements[j][1].at;
        const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
        expect(dist).toBeGreaterThan(5); // at least 5mm apart
      }
    }
  });
});

describe("NetlistBuilder with auto-layout", () => {
  it("generates valid schematic without explicit coordinates", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const sch = new NetlistBuilder({ title: "Auto-Layout LED" });
    sch.addSymbol("Device:R", {
      ref: "R1", value: "330",
      nets: { 1: "VCC", 2: "LED_K" },
    });
    sch.addSymbol("Device:LED", {
      ref: "D1", value: "Red",
      nets: { K: "LED_K", A: "GND" },
    });

    const outPath = join(OUT_DIR, "auto-layout-led.kicad_sch");
    sch.save(outPath);
    expect(existsSync(outPath)).toBe(true);

    // Should export SVG (proves KiCad can load it)
    sch.export(outPath, join(OUT_DIR, "svg"));

    // Content should have power symbols and connectivity (wires or labels)
    const content = readFileSync(outPath, "utf-8");
    expect(content).toContain('(lib_id "power:VCC")');
    expect(content).toContain('(lib_id "power:GND")');
    // LED_K net connects R1 and D1 -- should be wired or labeled
    expect(content.includes('(label "LED_K"') || content.includes('(wire')).toBe(true);
  });

  it("auto-layouts a voltage divider circuit", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const sch = new NetlistBuilder({ title: "Auto-Layout Voltage Divider" });
    sch.addSymbol("Device:R", {
      ref: "R1", value: "10k",
      nets: { 1: "VIN", 2: "VDIV" },
    });
    sch.addSymbol("Device:R", {
      ref: "R2", value: "10k",
      nets: { 1: "VDIV", 2: "GND" },
    });
    sch.addSymbol("Device:C", {
      ref: "C1", value: "100n",
      nets: { 1: "+3.3V", 2: "GND" },
    });

    const outPath = join(OUT_DIR, "auto-layout-vdiv.kicad_sch");
    sch.save(outPath);

    // Export SVG to validate
    sch.export(outPath, join(OUT_DIR, "svg"));

    const content = readFileSync(outPath, "utf-8");
    expect(content).toContain('(lib_id "Device:R")');
    expect(content).toContain('(lib_id "Device:C")');
    // VDIV is a local net shared by R1 and R2 -- wired or labeled depending on distance
    expect(content.includes('(label "VDIV"') || content.includes('(wire')).toBe(true);
  });
});
