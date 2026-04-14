import { describe, it, expect } from "vitest";
import { getAbsolutePinPosition } from "../src/library/PinCalculator.js";
import { SchematicBuilder } from "../src/builder/SchematicBuilder.js";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const OUT_DIR = join(import.meta.dirname, "..", "test-output");

describe("PinCalculator transforms", () => {
  it("computes pin position with no rotation", () => {
    const pos = getAbsolutePinPosition({ x: 100, y: 50 }, { x: 0, y: 3.81 }, 0);
    expect(pos).toEqual({ x: 100, y: 53.81 });
  });

  it("computes pin position with 90 degree rotation", () => {
    // KiCad schematic rotation is clockwise in screen coordinates.
    const pos = getAbsolutePinPosition({ x: 100, y: 50 }, { x: 0, y: 3.81 }, 90);
    expect(pos.x).toBeCloseTo(103.81, 1);
    expect(pos.y).toBeCloseTo(50, 1);
  });

  it("computes pin position with 180 degree rotation", () => {
    const pos = getAbsolutePinPosition({ x: 100, y: 50 }, { x: 0, y: 3.81 }, 180);
    expect(pos.x).toBeCloseTo(100, 1);
    expect(pos.y).toBeCloseTo(46.19, 1);
  });

  it("computes pin position with 270 degree rotation", () => {
    const pos = getAbsolutePinPosition({ x: 100, y: 50 }, { x: 0, y: 3.81 }, 270);
    expect(pos.x).toBeCloseTo(96.19, 1);
    expect(pos.y).toBeCloseTo(50, 1);
  });

  it("computes pin position with mirror x", () => {
    const pos = getAbsolutePinPosition({ x: 100, y: 50 }, { x: 5, y: 0 }, 0, "x");
    expect(pos).toEqual({ x: 95, y: 50 });
  });

  it("computes pin position with mirror y", () => {
    const pos = getAbsolutePinPosition({ x: 100, y: 50 }, { x: 0, y: 5 }, 0, "y");
    expect(pos).toEqual({ x: 100, y: 45 });
  });
});

describe("SchematicBuilder with rotation", () => {
  it("marks rotated resistor pins as no-connect and only leaves expected off-grid warnings", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const sch = new SchematicBuilder({ title: "Rotation Test" });

    // Place 4 resistors at different rotations
    const r0 = sch.addSymbol("Device:R", { ref: "R1", value: "1k", at: [80, 80], rotation: 0 });
    const r90 = sch.addSymbol("Device:R", { ref: "R2", value: "1k", at: [100, 80], rotation: 90 });
    const r180 = sch.addSymbol("Device:R", { ref: "R3", value: "1k", at: [120, 80], rotation: 180 });
    const r270 = sch.addSymbol("Device:R", { ref: "R4", value: "1k", at: [140, 80], rotation: 270 });

    // Check pin positions differ by rotation
    expect(r0.pinPositions.get("1")!.x).toBeCloseTo(80, 0);
    expect(r90.pinPositions.get("1")!.y).toBeCloseTo(80, 0);
    expect(r180.pinPositions.get("1")!.x).toBeCloseTo(120, 0);
    expect(r270.pinPositions.get("1")!.y).toBeCloseTo(80, 0);

    for (const resistor of [r0, r90, r180, r270]) {
      sch.addNoConnect(resistor.pinPositions.get("1")!);
      sch.addNoConnect(resistor.pinPositions.get("2")!);
    }

    const outPath = join(OUT_DIR, "rotation-test.kicad_sch");
    sch.save(outPath);

    const erc = sch.validate(outPath);
    expect(erc.passed).toBe(true);
    expect(erc.errors).toHaveLength(0);
    expect(erc.warnings).toHaveLength(4);
    expect(erc.warnings.every(w => w.message.includes("off connection grid"))).toBe(true);
  });
});
