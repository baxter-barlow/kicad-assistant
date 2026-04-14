import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { SchematicDocument } from "../src/document/SchematicDocument.js";

const TEMPLATE = join(import.meta.dirname, "..", "template.kicad_sch");
const OUT_DIR = join(import.meta.dirname, "..", "test-output");

const LABEL_ALIAS_SCHEMATIC = `(kicad_sch
\t(version 20250114)
\t(generator "test")
\t(uuid "00000000-0000-0000-0000-000000000001")
\t(paper "A4")
\t(symbol
\t\t(lib_id "Device:R")
\t\t(at 100 100 0)
\t\t(uuid "s0000001-0000-0000-0000-000000000001")
\t\t(property "Reference" "R1"
\t\t\t(at 100 96 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Value" "10k"
\t\t\t(at 100 104 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Footprint" "Resistor_SMD:R_0805_2012Metric"
\t\t\t(at 100 100 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(pin "1" (uuid "p0000001-0000-0000-0000-000000000001"))
\t\t(pin "2" (uuid "p0000001-0000-0000-0000-000000000002"))
\t)
\t(symbol
\t\t(lib_id "Device:R")
\t\t(at 120 100 0)
\t\t(uuid "s0000002-0000-0000-0000-000000000002")
\t\t(property "Reference" "R2"
\t\t\t(at 120 96 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Value" "47k"
\t\t\t(at 120 104 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Footprint" "Resistor_SMD:R_0805_2012Metric"
\t\t\t(at 120 100 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(pin "1" (uuid "p0000002-0000-0000-0000-000000000001"))
\t\t(pin "2" (uuid "p0000002-0000-0000-0000-000000000002"))
\t)
\t(label "SIG"
\t\t(at 100 103.81 0)
\t\t(effects (font (size 1.27 1.27)))
\t)
\t(label "SIG"
\t\t(at 120 103.81 0)
\t\t(effects (font (size 1.27 1.27)))
\t)
\t(label "SENSE"
\t\t(at 100 96.19 0)
\t\t(effects (font (size 1.27 1.27)))
\t)
\t(no_connect
\t\t(at 120 96.19)
\t)
\t(sheet_instances
\t\t(path "/"
\t\t\t(page "1")
\t\t)
\t)
\t(embedded_fonts no)
)
`;

describe("SchematicDocument locators", () => {
  it("finds symbols by ref, library ID, value, and footprint on an opened schematic", () => {
    const doc = SchematicDocument.open(TEMPLATE);

    expect(doc.getByRef("R1").one().libraryId).toBe("Device:R");
    expect(doc.getByLibraryId("Device:R").one().ref).toBe("R1");
    expect(doc.getByValue("Red").one().ref).toBe("D1");
    expect(doc.getByFootprint("LED_SMD:LED_0805_2012Metric").one().ref).toBe("D1");
  });

  it("supports pin and net lookup on existing schematics", () => {
    const doc = SchematicDocument.open(TEMPLATE);

    expect(doc.pin("R1", "1").one().netName).toBe("NET_1");
    expect(doc.pin("R1", "2").one().netName).toBe("VCC");
    expect(doc.pin("D1", "2").one().netName).toBe("GND");

    const vcc = doc.getByNet("VCC").one();
    expect(vcc.pins.map(pin => `${pin.symbolRef}:${pin.pinId}`)).toContain("R1:2");

    const net1 = doc.getByNet("NET_1").one();
    expect(net1.pins.map(pin => `${pin.symbolRef}:${pin.pinId}`).sort()).toEqual(["D1:1", "R1:1"]);
  });

  it("supports label locators, nth, filter, and count APIs", () => {
    const doc = SchematicDocument.parse(LABEL_ALIAS_SCHEMATIC);

    expect(doc.getByLabel("SIG").count()).toBe(2);
    expect(doc.getByLabel("SIG").nth(1).one().at?.x).toBe(120);
    expect(doc.getByLabel("SIG").filter(label => label.at?.x === 100, "x === 100").one().name).toBe("SIG");

    expect(doc.getByLibraryId("Device:R").count()).toBe(2);
    expect(doc.getByLibraryId("Device:R").nth(1).one().ref).toBe("R2");
    expect(
      doc.getByLibraryId("Device:R").filter(symbol => symbol.value === "47k", "value === 47k").one().ref
    ).toBe("R2");
  });

  it("merges same-name labels into a single logical single-sheet net", () => {
    const doc = SchematicDocument.parse(LABEL_ALIAS_SCHEMATIC);

    const signalNet = doc.getByNet("SIG").one();
    expect(signalNet.pins.map(pin => `${pin.symbolRef}:${pin.pinId}`).sort()).toEqual(["R1:1", "R2:1"]);

    expect(doc.pin("R2", "2").one().isNoConnect).toBe(true);
    expect(doc.pin("R2", "2").one().netName).toBeUndefined();
  });

  it("reports specific errors for missing refs, pins, and nets", () => {
    const doc = SchematicDocument.parse(LABEL_ALIAS_SCHEMATIC);

    expect(() => doc.getByRef("R9").one()).toThrowError(/Available refs: R1, R2/);
    expect(() => doc.pin("R1", "9").one()).toThrowError(/No pin "9" exists on ref "R1"\. Available pins: 1, 2/);
    expect(() => doc.getByNet("NOPE").one()).toThrowError(/Available named nets: SIG, SENSE/);
  });

  it("re-resolves locators after document reload", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const outPath = join(OUT_DIR, "schematic-locator-reload.kicad_sch");
    writeFileSync(outPath, LABEL_ALIAS_SCHEMATIC, "utf-8");

    const doc = SchematicDocument.open(outPath);
    const valueLocator = doc.getByValue("10k");
    expect(valueLocator.one().ref).toBe("R1");

    writeFileSync(outPath, LABEL_ALIAS_SCHEMATIC.replace('"10k"', '"22k"'), "utf-8");
    doc.reload();

    expect(valueLocator.count()).toBe(0);
    expect(doc.getByValue("22k").one().ref).toBe("R1");
  });
});
