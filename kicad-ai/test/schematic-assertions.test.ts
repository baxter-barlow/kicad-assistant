import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { SchematicBuilder } from "../src/builder/SchematicBuilder.js";
import { SchematicDocument } from "../src/document/SchematicDocument.js";
import {
  SchematicAssertionError,
  captureSvgSnapshot,
  captureTextSnapshot,
  expectErc,
  expectSchematic,
} from "../src/assertions/SchematicAssertions.js";

const TEMPLATE = join(import.meta.dirname, "..", "template.kicad_sch");
const OUT_DIR = join(import.meta.dirname, "..", "test-output");

function buildCleanLedDocument(): SchematicDocument {
  const sch = new SchematicBuilder({
    title: "Assertion Fixture",
    date: "2026-04-12",
    rev: "0.1",
  });

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

  sch.connect(vccFlag, 1, vcc, 1);
  sch.connect(vcc, 1, r1, 2);
  sch.connect(r1, 1, d1, "K");
  sch.connect(d1, "A", gnd, 1);
  sch.connect(gnd, 1, gndFlag, 1);

  return SchematicDocument.parse(sch.generate());
}

describe("Phase 5 assertions", () => {
  it("asserts existence, counts, and symbol properties through the public assertion API", () => {
    const doc = SchematicDocument.open(TEMPLATE);

    expectSchematic(doc.getByRef("R1")).toExist();
    expectSchematic(doc.getByLibraryId("Device:R")).toHaveCount(1);
    expectSchematic(doc.getByNet("VCC")).toHaveCount(1);
    expectSchematic(doc.getByRef("R1")).toHaveValue("330");
    expectSchematic(doc.getByRef("D1")).toHaveFootprint("LED_SMD:LED_0805_2012Metric");
  });

  it("asserts connectivity and driven-net semantics without using internal state", () => {
    const doc = SchematicDocument.open(TEMPLATE);

    expectSchematic(doc.pin("R1", "2")).toBeConnectedTo("VCC");
    expectSchematic(doc.pin("D1", "2")).toBeConnectedTo("GND");
    expectSchematic(doc.getByNet("VCC")).toContainPin("R1", "2");
    expectSchematic(doc.getByNet("GND")).toBeDriven();
  });

  it("throws structured assertion errors with query, expectation, and actual values", () => {
    const doc = SchematicDocument.open(TEMPLATE);

    let thrown: unknown;
    try {
      expectSchematic(doc.getByRef("R1")).toHaveValue("999");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SchematicAssertionError);
    const assertion = thrown as SchematicAssertionError;
    expect(assertion.code).toBe("symbol.value_mismatch");
    expect(assertion.target).toBe('ref "R1"');
    expect(assertion.expected).toBe('have value "999"');
    expect(assertion.actual).toBe('found value "330"');
    expect(assertion.message).toContain('Expected ref "R1" to have value "999"');
  });

  it("runs ERC assertions against the current in-memory document", () => {
    const cleanDoc = buildCleanLedDocument();
    const dirtyTemplate = SchematicDocument.open(TEMPLATE);

    expectErc(cleanDoc).toHaveNoErrors();
    expect(cleanDoc.expectErcClean().passed).toBe(true);

    expect(() => expectErc(dirtyTemplate).toHaveNoErrors()).toThrowError(SchematicAssertionError);
  });

  it("captures text and SVG snapshots from the current document state", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const doc = buildCleanLedDocument();
    doc.getByRef("R1").setValue("470");

    const textSnapshot = captureTextSnapshot(doc);
    expect(textSnapshot).toContain('(property "Value" "470"');

    const svgPath = join(OUT_DIR, "phase5-assertion-snapshot.svg");
    captureSvgSnapshot(doc, svgPath);

    expect(existsSync(svgPath)).toBe(true);
    expect(readFileSync(svgPath, "utf-8")).toContain("<svg");
  });
});
