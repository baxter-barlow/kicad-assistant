import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { SchematicDocument } from "../src/document/SchematicDocument.js";

const TEMPLATE = join(import.meta.dirname, "..", "template.kicad_sch");

const ISOLATED_SCHEMATIC = `(kicad_sch
\t(version 20250114)
\t(generator "test")
\t(uuid "10000000-0000-0000-0000-000000000001")
\t(paper "A4")
\t(symbol
\t\t(lib_id "Device:R")
\t\t(at 100 100 0)
\t\t(unit 1)
\t\t(exclude_from_sim no)
\t\t(in_bom yes)
\t\t(on_board yes)
\t\t(dnp no)
\t\t(uuid "10000000-0000-0000-0000-000000000002")
\t\t(property "Reference" "R1"
\t\t\t(at 103.556 96.19 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Value" "10k"
\t\t\t(at 103.556 103.81 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Footprint" "Resistor_SMD:R_0805_2012Metric"
\t\t\t(at 100 100 0)
\t\t\t(effects (font (size 1.27 1.27)) (hide yes))
\t\t)
\t\t(pin "1" (uuid "10000000-0000-0000-0000-000000000011"))
\t\t(pin "2" (uuid "10000000-0000-0000-0000-000000000012"))
\t\t(instances
\t\t\t(project "test"
\t\t\t\t(path "/10000000-0000-0000-0000-000000000001"
\t\t\t\t\t(reference "R1")
\t\t\t\t\t(unit 1)
\t\t\t\t)
\t\t\t)
\t\t)
\t)
\t(sheet_instances
\t\t(path "/" (page "1"))
\t)
\t(embedded_fonts no)
)
`;

const LABELLED_SCHEMATIC = `(kicad_sch
\t(version 20250114)
\t(generator "test")
\t(uuid "20000000-0000-0000-0000-000000000001")
\t(paper "A4")
\t(symbol
\t\t(lib_id "Device:R")
\t\t(at 100 100 0)
\t\t(unit 1)
\t\t(exclude_from_sim no)
\t\t(in_bom yes)
\t\t(on_board yes)
\t\t(dnp no)
\t\t(uuid "20000000-0000-0000-0000-000000000002")
\t\t(property "Reference" "R1"
\t\t\t(at 103.556 96.19 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Value" "10k"
\t\t\t(at 103.556 103.81 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Footprint" "Resistor_SMD:R_0805_2012Metric"
\t\t\t(at 100 100 0)
\t\t\t(effects (font (size 1.27 1.27)) (hide yes))
\t\t)
\t\t(pin "1" (uuid "20000000-0000-0000-0000-000000000011"))
\t\t(pin "2" (uuid "20000000-0000-0000-0000-000000000012"))
\t\t(instances
\t\t\t(project "test"
\t\t\t\t(path "/20000000-0000-0000-0000-000000000001"
\t\t\t\t\t(reference "R1")
\t\t\t\t\t(unit 1)
\t\t\t\t)
\t\t\t)
\t\t)
\t)
\t(symbol
\t\t(lib_id "Device:R")
\t\t(at 120 100 0)
\t\t(unit 1)
\t\t(exclude_from_sim no)
\t\t(in_bom yes)
\t\t(on_board yes)
\t\t(dnp no)
\t\t(uuid "20000000-0000-0000-0000-000000000003")
\t\t(property "Reference" "R2"
\t\t\t(at 123.556 96.19 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Value" "47k"
\t\t\t(at 123.556 103.81 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Footprint" "Resistor_SMD:R_0805_2012Metric"
\t\t\t(at 120 100 0)
\t\t\t(effects (font (size 1.27 1.27)) (hide yes))
\t\t)
\t\t(pin "1" (uuid "20000000-0000-0000-0000-000000000021"))
\t\t(pin "2" (uuid "20000000-0000-0000-0000-000000000022"))
\t\t(instances
\t\t\t(project "test"
\t\t\t\t(path "/20000000-0000-0000-0000-000000000001"
\t\t\t\t\t(reference "R2")
\t\t\t\t\t(unit 1)
\t\t\t\t)
\t\t\t)
\t\t)
\t)
\t(label "SIG"
\t\t(at 100 103.81 0)
\t\t(effects (font (size 1.27 1.27)))
\t)
\t(label "SIG"
\t\t(at 120 103.81 0)
\t\t(effects (font (size 1.27 1.27)))
\t)
\t(no_connect
\t\t(at 120 96.19)
\t)
\t(sheet_instances
\t\t(path "/" (page "1"))
\t)
\t(embedded_fonts no)
)
`;

describe("SchematicDocument actions", () => {
  it("updates value and footprint on existing symbols", () => {
    const doc = SchematicDocument.open(TEMPLATE);

    doc.getByRef("R1").setValue("470");
    doc.getByRef("R1").setFootprint("Resistor_SMD:R_0603_1608Metric");

    expect(doc.getByValue("470").one().ref).toBe("R1");
    expect(doc.getByFootprint("Resistor_SMD:R_0603_1608Metric").one().ref).toBe("R1");
    expect(doc.toString()).toContain('(property "Value" "470"');
    expect(doc.toString()).toContain('(property "Footprint" "Resistor_SMD:R_0603_1608Metric"');

    const reopened = SchematicDocument.parse(doc.toString());
    expect(reopened.getByValue("470").one().ref).toBe("R1");
    expect(reopened.getByFootprint("Resistor_SMD:R_0603_1608Metric").one().ref).toBe("R1");
  });

  it("moves and rotates symbols while keeping simple existing connections attached", () => {
    const doc = SchematicDocument.open(TEMPLATE);

    doc.getByRef("R1").move({ x: 147, y: 77.47 });
    expect(doc.getByRef("R1").one().at).toEqual({ x: 147, y: 77.47 });
    expect(doc.pin("R1", "1").one().netName).toBe("NET_1");
    expect(doc.pin("R1", "2").one().netName).toBe("VCC");

    doc.getByRef("R1").rotate(90);
    expect(doc.getByRef("R1").one().rotation).toBe(90);
    expect(doc.pin("R1", "1").one().netName).toBe("NET_1");
    expect(doc.pin("R1", "2").one().netName).toBe("VCC");

    const reopened = SchematicDocument.parse(doc.toString());
    expect(reopened.getByRef("R1").one().rotation).toBe(90);
    expect(reopened.pin("R1", "1").one().netName).toBe("NET_1");
    expect(reopened.pin("R1", "2").one().netName).toBe("VCC");
  });

  it("deletes symbols and duplicates them with a new ref and UUIDs", () => {
    const doc = SchematicDocument.open(TEMPLATE);
    const original = doc.getByRef("R1").one();

    const duplicate = doc.getByRef("R1").duplicate({ offset: { x: 20, y: 0 } });
    expect(duplicate.ref).toBe("R2");
    expect(duplicate.at).toEqual({ x: (original.at?.x ?? 0) + 20, y: original.at?.y ?? 0 });
    expect(duplicate.uuid).not.toBe(original.uuid);
    expect(doc.getByRef("R2").one().value).toBe("330");

    doc.getByRef("D1").delete();
    expect(doc.getByRef("D1").count()).toBe(0);

    const reopened = SchematicDocument.parse(doc.toString());
    expect(reopened.getByRef("R2").one().value).toBe("330");
    expect(reopened.getByRef("D1").count()).toBe(0);
  });

  it("connects isolated pins to a named net, disconnects them, and marks no-connects", () => {
    const doc = SchematicDocument.parse(ISOLATED_SCHEMATIC);

    expect(doc.pin("R1", "1").one().netName).toBeUndefined();

    doc.pin("R1", "1").connectTo("OUT");
    expect(doc.getByNet("OUT").one().pins.map(pin => `${pin.symbolRef}:${pin.pinId}`)).toEqual(["R1:1"]);

    doc.pin("R1", "1").disconnect();
    expect(doc.pin("R1", "1").one().netName).toBeUndefined();
    expect(doc.getByLabel("OUT").count()).toBe(0);

    doc.pin("R1", "1").markNoConnect();
    expect(doc.pin("R1", "1").one().isNoConnect).toBe(true);
    doc.pin("R1", "1").markNoConnect();
    expect((doc.toString().match(/\(no_connect/g) || []).length).toBe(1);
    expect(doc.toString()).toContain("(no_connect");

    const reopened = SchematicDocument.parse(doc.toString());
    expect(reopened.pin("R1", "1").one().isNoConnect).toBe(true);
  });

  it("disconnects wired pins by removing directly attached wire segments", () => {
    const doc = SchematicDocument.open(TEMPLATE);

    expect(doc.pin("D1", "1").one().netName).toBe("NET_1");
    doc.pin("D1", "1").disconnect();

    expect(doc.pin("D1", "1").one().netName).toBeUndefined();
    expect(doc.pin("R1", "1").one().netName).toBeUndefined();
  });

  it("marks named nets driven with PWR_FLAG and updates net semantics", () => {
    const doc = SchematicDocument.parse(LABELLED_SCHEMATIC);

    expect(doc.getByLibraryId("power:PWR_FLAG").count()).toBe(0);
    doc.getByNet("SIG").markDriven();

    expect(doc.getByLibraryId("power:PWR_FLAG").count()).toBe(1);
    expect(doc.getByNet("SIG").one().isPower).toBe(true);

    doc.getByNet("SIG").markDriven();
    expect(doc.getByLibraryId("power:PWR_FLAG").count()).toBe(1);

    const reopened = SchematicDocument.parse(doc.toString());
    expect(reopened.getByLibraryId("power:PWR_FLAG").count()).toBe(1);
    expect(reopened.getByNet("SIG").one().isPower).toBe(true);
  });

  it("rolls back failed actions without partial mutation", () => {
    const doc = SchematicDocument.parse(LABELLED_SCHEMATIC);
    const before = doc.toString();

    expect(() => doc.pin("R1", "1").markNoConnect()).toThrow(/connected/i);
    expect(doc.toString()).toBe(before);

    expect(() => doc.getByRef("R1").duplicate({ ref: "R2" })).toThrow(/already exists/i);
    expect(doc.toString()).toBe(before);

    expect(() => doc.getByRef("R1").rotate(45)).toThrow(/Invalid rotation/);
    expect(doc.toString()).toBe(before);
  });
});
