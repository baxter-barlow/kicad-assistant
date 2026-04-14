import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { SchematicDocument } from "../src/document/SchematicDocument.js";
import { readSchematic, inferNets } from "../src/reader/SchematicReader.js";
import { SymbolLibrary } from "../src/library/SymbolLibrary.js";

const OUT_DIR = join(import.meta.dirname, "..", "test-output");

function buildResistorSymbol(
  ref: string,
  x: number,
  y: number,
  rotation: number,
  value: string,
  index: number,
): string {
  const symbolUuid = `00000000-0000-0000-0000-000000000${index}1`;
  const pin1Uuid = `00000000-0000-0000-0000-000000000${index}2`;
  const pin2Uuid = `00000000-0000-0000-0000-000000000${index}3`;
  return [
    `\t(symbol`,
    `\t\t(lib_id "Device:R")`,
    `\t\t(at ${x} ${y} ${rotation})`,
    `\t\t(unit 1)`,
    `\t\t(exclude_from_sim no)`,
    `\t\t(in_bom yes)`,
    `\t\t(on_board yes)`,
    `\t\t(dnp no)`,
    `\t\t(uuid "${symbolUuid}")`,
    `\t\t(property "Reference" "${ref}"`,
    `\t\t\t(at ${x} ${y - 4} 0)`,
    `\t\t\t(effects (font (size 1.27 1.27)))`,
    `\t\t)`,
    `\t\t(property "Value" "${value}"`,
    `\t\t\t(at ${x} ${y + 4} 0)`,
    `\t\t\t(effects (font (size 1.27 1.27)))`,
    `\t\t)`,
    `\t\t(property "Footprint" ""`,
    `\t\t\t(at ${x} ${y} 0)`,
    `\t\t\t(effects (font (size 1.27 1.27)) (hide yes))`,
    `\t\t)`,
    `\t\t(pin "1" (uuid "${pin1Uuid}"))`,
    `\t\t(pin "2" (uuid "${pin2Uuid}"))`,
    `\t)`,
  ].join("\n");
}

function buildWire(fromX: number, fromY: number, toX: number, toY: number, index: number): string {
  return [
    `\t(wire`,
    `\t\t(pts (xy ${fromX} ${fromY}) (xy ${toX} ${toY}))`,
    `\t\t(uuid "10000000-0000-0000-0000-000000000${index}")`,
    `\t)`,
  ].join("\n");
}

function buildLabel(
  kind: "label" | "global_label" | "hierarchical_label",
  name: string,
  x: number,
  y: number,
  index: number,
): string {
  return [
    `\t(${kind} "${name}"`,
    `\t\t(shape input)`,
    `\t\t(at ${x} ${y} 0)`,
    `\t\t(effects (font (size 1.27 1.27)))`,
    `\t\t(uuid "20000000-0000-0000-0000-000000000${index}")`,
    `\t)`,
  ].join("\n");
}

function buildJunction(x: number, y: number, index: number): string {
  return [
    `\t(junction`,
    `\t\t(at ${x} ${y})`,
    `\t\t(diameter 0)`,
    `\t\t(color 0 0 0 0)`,
    `\t\t(uuid "30000000-0000-0000-0000-000000000${index}")`,
    `\t)`,
  ].join("\n");
}

function wrapSchematic(body: string): string {
  return [
    `(kicad_sch`,
    `\t(version 20250114)`,
    `\t(generator "test")`,
    `\t(uuid "40000000-0000-0000-0000-000000000001")`,
    `\t(paper "A4")`,
    body,
    `\t(sheet_instances`,
    `\t\t(path "/" (page "1"))`,
    `\t)`,
    `\t(embedded_fonts no)`,
    `)`,
    ``,
  ].join("\n");
}

function buildTJunctionSchematic(): string {
  return wrapSchematic([
    buildResistorSymbol("R1", 86.19, 100, 90, "1k", 1),
    buildResistorSymbol("R2", 113.81, 100, 90, "2k", 2),
    buildResistorSymbol("R3", 100, 107.62, 0, "3k", 3),
    buildWire(90, 100, 110, 100, 1),
    buildWire(100, 103.81, 100, 100, 2),
  ].join("\n"));
}

function buildCrossingSchematic(withJunction: boolean): string {
  return wrapSchematic([
    buildResistorSymbol("R1", 86.19, 100, 90, "1k", 4),
    buildResistorSymbol("R2", 113.81, 100, 90, "2k", 5),
    buildResistorSymbol("R3", 100, 113.81, 0, "3k", 6),
    buildResistorSymbol("R4", 100, 86.19, 0, "4k", 7),
    buildWire(90, 100, 110, 100, 3),
    buildWire(100, 90, 100, 110, 4),
    buildLabel("label", "BUS", 90, 100, 1),
    ...(withJunction ? [buildJunction(100, 100, 1)] : []),
  ].join("\n"));
}

function buildScopedLabelSchematic(): string {
  return wrapSchematic([
    buildResistorSymbol("R1", 100, 100, 0, "1k", 8),
    buildResistorSymbol("R2", 120, 100, 0, "2k", 9),
    buildLabel("global_label", "CTRL", 100, 103.81, 2),
    buildLabel("hierarchical_label", "CTRL", 120, 103.81, 3),
  ].join("\n"));
}

function writeFixture(name: string, content: string): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

function netPins(doc: SchematicDocument, name: string): string[] {
  return doc.getByNet(name).one().pins.map(pin => `${pin.symbolRef}:${pin.pinId}`).sort();
}

function inferredNetPins(path: string, name: string): string[] {
  const result = readSchematic(path);
  const nets = inferNets(result, new SymbolLibrary());
  const net = nets.find(candidate => candidate.name === name);
  expect(net).toBeTruthy();
  return net!.pins.map(pin => `${pin.symbolRef}:${pin.pinId}`).sort();
}

describe("Phase 4 connectivity", () => {
  it("connects T-junction branches when a wire endpoint lands on another wire segment", () => {
    const doc = SchematicDocument.parse(buildTJunctionSchematic());

    expect(netPins(doc, "NET_1")).toEqual(["R1:1", "R2:2", "R3:2"]);
    expect(doc.pin("R3", "2").one().netName).toBe("NET_1");
  });

  it("keeps plain perpendicular crossings electrically separate without a junction", () => {
    const doc = SchematicDocument.parse(buildCrossingSchematic(false));

    expect(netPins(doc, "BUS")).toEqual(["R1:1", "R2:2"]);

    const verticalNetName = doc.pin("R3", "2").one().netName;
    expect(verticalNetName).toBeTruthy();
    expect(verticalNetName).not.toBe("BUS");
    expect(netPins(doc, verticalNetName!)).toEqual(["R3:2", "R4:1"]);
  });

  it("connects perpendicular crossings when an explicit junction exists at the intersection", () => {
    const doc = SchematicDocument.parse(buildCrossingSchematic(true));

    expect(netPins(doc, "BUS")).toEqual(["R1:1", "R2:2", "R3:2", "R4:1"]);
  });

  it("treats global and hierarchical labels as named nets without forcing power semantics", () => {
    const doc = SchematicDocument.parse(buildScopedLabelSchematic());

    expect(netPins(doc, "CTRL")).toEqual(["R1:1", "R2:1"]);
    expect(doc.getByNet("CTRL").one().isPower).toBe(false);
    expect(doc.getByNet("CTRL").one().labels.map(label => label.labelKind).sort()).toEqual([
      "global_label",
      "hierarchical_label",
    ]);
  });

  it("makes connectTo and disconnect predictable on branched edited nets", () => {
    const doc = SchematicDocument.parse(buildTJunctionSchematic());

    doc.pin("R3", "2").connectTo("SIG");
    expect(netPins(doc, "SIG")).toEqual(["R1:1", "R2:2", "R3:2"]);

    doc.pin("R3", "2").disconnect();
    expect(doc.pin("R3", "2").one().netName).toBeUndefined();
    expect(netPins(doc, "NET_1")).toEqual(["R1:1", "R2:2"]);

    const reopened = SchematicDocument.parse(doc.toString());
    expect(reopened.pin("R3", "2").one().netName).toBeUndefined();
    expect(netPins(reopened, "NET_1")).toEqual(["R1:1", "R2:2"]);
  });

  it("keeps reader net inference aligned with document connectivity for Phase 4 fixtures", () => {
    const tJunctionPath = writeFixture("phase4-t-junction.kicad_sch", buildTJunctionSchematic());
    const crossingPath = writeFixture("phase4-crossing-junction.kicad_sch", buildCrossingSchematic(true));
    const scopedLabelPath = writeFixture("phase4-scoped-labels.kicad_sch", buildScopedLabelSchematic());

    const crossingResult = readSchematic(crossingPath);
    expect(crossingResult.junctions).toHaveLength(1);
    expect(crossingResult.labels.map(label => label.kind)).toContain("label");

    expect(inferredNetPins(tJunctionPath, "NET_1")).toEqual(["R1:1", "R2:2", "R3:2"]);
    expect(inferredNetPins(crossingPath, "BUS")).toEqual(["R1:1", "R2:2", "R3:2", "R4:1"]);
    expect(inferredNetPins(scopedLabelPath, "CTRL")).toEqual(["R1:1", "R2:1"]);
    expect(inferNets(readSchematic(scopedLabelPath), new SymbolLibrary()).find(net => net.name === "CTRL")?.isPower)
      .toBe(false);
  });
});
