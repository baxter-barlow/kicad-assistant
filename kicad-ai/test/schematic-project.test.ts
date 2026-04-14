import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { SchematicProject, SchematicProjectAssertionError } from "../src/project/SchematicProject.js";

const OUT_DIR = join(import.meta.dirname, "..", "test-output", "project-fixture");

const ROOT_SCHEMATIC = `(kicad_sch
\t(version 20250114)
\t(generator "test")
\t(uuid "50000000-0000-0000-0000-000000000001")
\t(paper "A4")
\t(symbol
\t\t(lib_id "Device:R")
\t\t(at 60 60 0)
\t\t(unit 1)
\t\t(exclude_from_sim no)
\t\t(in_bom yes)
\t\t(on_board yes)
\t\t(dnp no)
\t\t(uuid "50000000-0000-0000-0000-000000000002")
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
\t\t(pin "1" (uuid "50000000-0000-0000-0000-000000000003"))
\t\t(pin "2" (uuid "50000000-0000-0000-0000-000000000004"))
\t)
\t(label "CTRL"
\t\t(at 60 63.81 0)
\t\t(effects (font (size 1.27 1.27)))
\t)
\t(global_label "GND"
\t\t(shape input)
\t\t(at 40 80 0)
\t\t(effects (font (size 1.27 1.27)))
\t\t(uuid "50000000-0000-0000-0000-000000000005")
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
\t\t(uuid "50000000-0000-0000-0000-000000000006")
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
\t\t\t(uuid "50000000-0000-0000-0000-000000000007")
\t\t)
\t\t(pin "GND" input
\t\t\t(at 90 80 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t\t(uuid "50000000-0000-0000-0000-000000000008")
\t\t)
\t)
\t(wire
\t\t(pts (xy 60 63.81) (xy 90 63.81))
\t\t(uuid "50000000-0000-0000-0000-000000000009")
\t)
\t(wire
\t\t(pts (xy 40 80) (xy 90 80))
\t\t(uuid "50000000-0000-0000-0000-000000000010")
\t)
\t(sheet_instances
\t\t(path "/" (page "1"))
\t)
\t(embedded_fonts no)
)
`;

const CHILD_SCHEMATIC = `(kicad_sch
\t(version 20250114)
\t(generator "test")
\t(uuid "60000000-0000-0000-0000-000000000001")
\t(paper "A4")
\t(symbol
\t\t(lib_id "Device:R")
\t\t(at 110 60 0)
\t\t(unit 1)
\t\t(exclude_from_sim no)
\t\t(in_bom yes)
\t\t(on_board yes)
\t\t(dnp no)
\t\t(uuid "60000000-0000-0000-0000-000000000002")
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
\t\t(pin "1" (uuid "60000000-0000-0000-0000-000000000003"))
\t\t(pin "2" (uuid "60000000-0000-0000-0000-000000000004"))
\t)
\t(hierarchical_label "CTRL"
\t\t(shape input)
\t\t(at 110 63.81 0)
\t\t(effects (font (size 1.27 1.27)))
\t\t(uuid "60000000-0000-0000-0000-000000000005")
\t)
\t(global_label "GND"
\t\t(shape input)
\t\t(at 110 56.19 0)
\t\t(effects (font (size 1.27 1.27)))
\t\t(uuid "60000000-0000-0000-0000-000000000006")
\t)
\t(sheet_instances
\t\t(path "/" (page "2"))
\t)
\t(embedded_fonts no)
)
`;

const ROOT_SCHEMATIC_UNNAMED_PARENT = ROOT_SCHEMATIC.replace(
  '\t(label "CTRL"\n\t\t(at 60 63.81 0)\n\t\t(effects (font (size 1.27 1.27)))\n\t)\n',
  "",
);

function writeProjectFixture(
  rootSchematic: string = ROOT_SCHEMATIC,
  childSchematic: string = CHILD_SCHEMATIC,
): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const projectPath = join(OUT_DIR, "multi-sheet.kicad_pro");
  const rootPath = join(OUT_DIR, "multi-sheet.kicad_sch");
  const childPath = join(OUT_DIR, "power.kicad_sch");

  writeFileSync(projectPath, JSON.stringify({ meta: "fixture" }, null, 2), "utf-8");
  writeFileSync(rootPath, rootSchematic, "utf-8");
  writeFileSync(childPath, childSchematic, "utf-8");
  return projectPath;
}

describe("Phase 6 project runtime", () => {
  it("opens a KiCad project and locates sheets by name", () => {
    const project = SchematicProject.open(writeProjectFixture());

    expect(project.rootSheet.name).toBe("root");
    expect(project.sheet("Power").one().path.endsWith("power.kicad_sch")).toBe(true);
    expect(project.sheet("Power").one().getByRef("R2").one().value).toBe("1k");
  });

  it("supports sheet-scoped locators and hierarchical edits", () => {
    const projectPath = writeProjectFixture();
    const project = SchematicProject.open(projectPath);

    project.sheet("Power").one().getByRef("R2").setValue("4.7k");
    expect(project.getByRef("R2", { sheet: "Power" }).one().value).toBe("4.7k");

    project.save();
    const reopened = SchematicProject.open(projectPath);
    expect(reopened.getByRef("R2", { sheet: "Power" }).one().value).toBe("4.7k");
    expect(readFileSync(join(OUT_DIR, "power.kicad_sch"), "utf-8")).toContain('(property "Value" "4.7k"');
  });

  it("asserts cross-sheet nets through hierarchical and global connectivity", () => {
    const project = SchematicProject.open(writeProjectFixture());

    project.expectNet("CTRL").toSpanSheets(["root", "Power"]);
    project.expectNet("CTRL").toContainPin("root", "R1", "1");
    project.expectNet("CTRL").toContainPin("Power", "R2", "1");

    project.expectNet("GND").toSpanSheets(["root", "Power"]);
    project.expectNet("GND").toContainPin("Power", "R2", "2");
  });

  it("links unnamed parent nets through sheet pins into named child hierarchical nets", () => {
    const project = SchematicProject.open(writeProjectFixture(ROOT_SCHEMATIC_UNNAMED_PARENT));

    project.expectNet("CTRL").toSpanSheets(["root", "Power"]);
    project.expectNet("CTRL").toContainPin("root", "R1", "1");
    project.expectNet("CTRL").toContainPin("Power", "R2", "1");
  });

  it("reports structured project assertion failures", () => {
    const project = SchematicProject.open(writeProjectFixture());

    let thrown: unknown;
    try {
      project.expectNet("CTRL").toSpanSheets(["Power", "Missing"]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SchematicProjectAssertionError);
    const assertion = thrown as SchematicProjectAssertionError;
    expect(assertion.code).toBe("project.net.sheet_span_mismatch");
    expect(assertion.target).toBe('project net "CTRL"');
    expect(assertion.expected).toContain("span sheets");
  });
});
