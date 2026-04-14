import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { SchematicBuilder } from "../src/builder/SchematicBuilder.js";
import { SchematicDocument } from "../src/document/SchematicDocument.js";
import { SchematicProject } from "../src/project/SchematicProject.js";
import {
  captureActionTrace,
  captureSemanticSnapshot,
  diffErcResults,
  diffSemanticSnapshots,
  formatActionTrace,
  formatErcDiff,
  formatLocatorTrace,
  formatSemanticDiff,
  traceLocator,
} from "../src/tooling/SchematicTooling.js";

const TEMPLATE = join(import.meta.dirname, "..", "template.kicad_sch");
const OUT_DIR = join(import.meta.dirname, "..", "test-output", "phase7-tooling");

const ROOT_PROJECT_SCHEMATIC = `(kicad_sch
\t(version 20250114)
\t(generator "test")
\t(uuid "70000000-0000-0000-0000-000000000001")
\t(paper "A4")
\t(symbol
\t\t(lib_id "Device:R")
\t\t(at 60 60 0)
\t\t(unit 1)
\t\t(exclude_from_sim no)
\t\t(in_bom yes)
\t\t(on_board yes)
\t\t(dnp no)
\t\t(uuid "70000000-0000-0000-0000-000000000002")
\t\t(property "Reference" "R1"
\t\t\t(at 56 56 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Value" "10k"
\t\t\t(at 56 64 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Footprint" ""
\t\t\t(at 60 60 0)
\t\t\t(effects (font (size 1.27 1.27)) (hide yes))
\t\t)
\t\t(pin "1" (uuid "70000000-0000-0000-0000-000000000003"))
\t\t(pin "2" (uuid "70000000-0000-0000-0000-000000000004"))
\t)
\t(label "CTRL"
\t\t(at 60 63.81 0)
\t\t(effects (font (size 1.27 1.27)))
\t)
\t(sheet
\t\t(at 90 40)
\t\t(size 40 30)
\t\t(stroke
\t\t\t(width 0.1524)
\t\t\t(type solid)
\t\t)
\t\t(fill
\t\t\t(color 0 0 0 0)
\t\t)
\t\t(uuid "70000000-0000-0000-0000-000000000006")
\t\t(property "Sheet name" "Power"
\t\t\t(at 90 39 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Sheet file" "power.kicad_sch"
\t\t\t(at 90 71 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(pin "CTRL" input
\t\t\t(at 90 63.81 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t\t(uuid "70000000-0000-0000-0000-000000000007")
\t\t)
\t)
\t(wire
\t\t(pts (xy 60 63.81) (xy 90 63.81))
\t\t(uuid "70000000-0000-0000-0000-000000000009")
\t)
\t(sheet_instances
\t\t(path "/" (page "1"))
\t)
\t(embedded_fonts no)
)
`;

const CHILD_PROJECT_SCHEMATIC = `(kicad_sch
\t(version 20250114)
\t(generator "test")
\t(uuid "80000000-0000-0000-0000-000000000001")
\t(paper "A4")
\t(symbol
\t\t(lib_id "Device:R")
\t\t(at 110 60 0)
\t\t(unit 1)
\t\t(exclude_from_sim no)
\t\t(in_bom yes)
\t\t(on_board yes)
\t\t(dnp no)
\t\t(uuid "80000000-0000-0000-0000-000000000002")
\t\t(property "Reference" "R2"
\t\t\t(at 106 56 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Value" "1k"
\t\t\t(at 106 64 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Footprint" ""
\t\t\t(at 110 60 0)
\t\t\t(effects (font (size 1.27 1.27)) (hide yes))
\t\t)
\t\t(pin "1" (uuid "80000000-0000-0000-0000-000000000003"))
\t\t(pin "2" (uuid "80000000-0000-0000-0000-000000000004"))
\t)
\t(hierarchical_label "CTRL"
\t\t(shape input)
\t\t(at 110 63.81 0)
\t\t(effects (font (size 1.27 1.27)))
\t\t(uuid "80000000-0000-0000-0000-000000000005")
\t)
\t(sheet_instances
\t\t(path "/" (page "2"))
\t)
\t(embedded_fonts no)
)
`;

function buildCleanLedDocument(): SchematicDocument {
  const sch = new SchematicBuilder({
    title: "Phase 7 Fixture",
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

function writeProjectFixture(): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const projectPath = join(OUT_DIR, "tooling-project.kicad_pro");
  writeFileSync(projectPath, JSON.stringify({ meta: "phase7" }, null, 2), "utf-8");
  writeFileSync(join(OUT_DIR, "tooling-project.kicad_sch"), ROOT_PROJECT_SCHEMATIC, "utf-8");
  writeFileSync(join(OUT_DIR, "power.kicad_sch"), CHILD_PROJECT_SCHEMATIC, "utf-8");
  return projectPath;
}

describe("Phase 7 tooling", () => {
  it("captures locator traces with resolved matches and lookup details", () => {
    const doc = SchematicDocument.open(TEMPLATE);

    const hitTrace = traceLocator(doc.getByRef("R1"));
    expect(hitTrace.kind).toBe("symbol");
    expect(hitTrace.description).toBe('ref "R1"');
    expect(hitTrace.count).toBe(1);
    expect(hitTrace.matches[0]).toContain("R1");
    expect(formatLocatorTrace(hitTrace)).toContain('symbol locator: ref "R1"');

    const missTrace = traceLocator(doc.getByRef("MISSING"));
    expect(missTrace.count).toBe(0);
    expect(missTrace.detail).toContain("Available refs");
  });

  it("captures semantic snapshots and diffs value changes without raw file diffing", () => {
    const doc = SchematicDocument.open(TEMPLATE);
    const before = captureSemanticSnapshot(doc);

    doc.getByRef("R1").setValue("470");
    const after = captureSemanticSnapshot(doc);
    const diff = diffSemanticSnapshots(before, after);

    expect(diff.kind).toBe("document");
    expect(diff.summary.changed).toBeGreaterThan(0);
    expect(diff.symbols?.changed.some(change => change.key === "R1" && change.after?.value === "470")).toBe(true);
    expect(formatSemanticDiff(diff)).toContain("symbols:");
  });

  it("captures action traces with before/after snapshots for document edits", () => {
    const doc = SchematicDocument.open(TEMPLATE);
    doc.clearActionTrace();

    const captured = captureActionTrace(doc, "retune resistor", () => doc.getByRef("R1").setValue("680"));

    expect(captured.target).toBe("document");
    expect(captured.trace).toHaveLength(1);
    expect(captured.trace[0].action).toBe("setValue");
    expect(captured.trace[0].target).toBe('ref "R1"');
    expect(captured.diff.summary.changed).toBeGreaterThan(0);
    expect(formatActionTrace(captured.trace)).toContain('setValue ref "R1"');
  });

  it("diffs ERC results so validation regressions are inspectable", () => {
    const dirtyTemplate = SchematicDocument.open(TEMPLATE);
    const cleanDoc = buildCleanLedDocument();

    const diff = diffErcResults(dirtyTemplate.runErc(), cleanDoc.runErc());

    expect(diff.removedErrors.length).toBeGreaterThan(0);
    expect(diff.addedErrors).toHaveLength(0);
    expect(formatErcDiff(diff)).toContain("removed errors:");
  });

  it("captures project-level snapshots and action traces across sheets", () => {
    const project = SchematicProject.open(writeProjectFixture());
    project.clearActionTrace();

    const before = captureSemanticSnapshot(project);
    const captured = captureActionTrace(project, "update child value", () =>
      project.sheet("Power").one().getByRef("R2").setValue("4.7k")
    );
    const after = captureSemanticSnapshot(project);
    const diff = diffSemanticSnapshots(before, after);

    expect(before.kind).toBe("project");
    expect(after.kind).toBe("project");
    expect(captured.target).toBe("project");
    expect(captured.trace).toHaveLength(1);
    expect("sheetName" in captured.trace[0] && captured.trace[0].sheetName).toBe("Power");
    expect(diff.kind).toBe("project");
    expect(diff.projectSheets?.changed.some(change => change.after?.name === "Power")).toBe(true);

    const sheetTrace = traceLocator(project.sheet("Power"));
    expect(sheetTrace.kind).toBe("sheet");
    expect(sheetTrace.count).toBe(1);
  });
});
