import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { SchematicBuilder } from "../src/builder/SchematicBuilder.js";
import { SchematicDocument } from "../src/document/SchematicDocument.js";
import {
  createProjectFixture,
  defineProjectFixture,
  defineSchematicFixture,
} from "../src/fixtures/SchematicFixtures.js";
import {
  recordDocumentFixtureWorkflow,
  recordProjectFixtureWorkflow,
} from "../src/fixtures/SchematicRecorder.js";
import { SchematicProject } from "../src/project/SchematicProject.js";

const OUT_DIR = join(import.meta.dirname, "..", "test-output", "phase8-fixtures");

function createBoardDocument(): SchematicDocument {
  const builder = new SchematicBuilder({ title: "Phase 8 Fixture" });
  builder.addSymbol("Connector_Generic:Conn_01x04", { ref: "U1", value: "MCU", at: [40, 40] });
  builder.addSymbol("Connector_Generic:Conn_01x04", { ref: "U2", value: "Sensor", at: [90, 40] });
  builder.addSymbol("Regulator_Linear:LM7805_TO220", { ref: "U3", at: [60, 90] });
  builder.addSymbol("Connector_Generic:Conn_01x04", { ref: "J1", value: "USB", at: [20, 90] });
  return SchematicDocument.parse(builder.generate());
}

const DUPLICATE_CHILD_ROOT = `(kicad_sch
\t(version 20250114)
\t(generator "test")
\t(uuid "81000000-0000-0000-0000-000000000001")
\t(paper "A4")
\t(sheet
\t\t(at 20 20)
\t\t(size 30 20)
\t\t(stroke
\t\t\t(width 0.1524)
\t\t\t(type solid)
\t\t)
\t\t(fill
\t\t\t(color 0 0 0 0)
\t\t)
\t\t(uuid "81000000-0000-0000-0000-000000000002")
\t\t(property "Sheet name" "PowerA"
\t\t\t(at 20 19 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Sheet file" "power.kicad_sch"
\t\t\t(at 20 41 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t)
\t(sheet
\t\t(at 70 20)
\t\t(size 30 20)
\t\t(stroke
\t\t\t(width 0.1524)
\t\t\t(type solid)
\t\t)
\t\t(fill
\t\t\t(color 0 0 0 0)
\t\t)
\t\t(uuid "81000000-0000-0000-0000-000000000003")
\t\t(property "Sheet name" "PowerB"
\t\t\t(at 70 19 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Sheet file" "power.kicad_sch"
\t\t\t(at 70 41 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t)
\t(sheet_instances
\t\t(path "/" (page "1"))
\t)
\t(embedded_fonts no)
)
`;

const DUPLICATE_CHILD_SCHEMATIC = `(kicad_sch
\t(version 20250114)
\t(generator "test")
\t(uuid "82000000-0000-0000-0000-000000000001")
\t(paper "A4")
\t(symbol
\t\t(lib_id "Device:R")
\t\t(at 60 60 0)
\t\t(unit 1)
\t\t(exclude_from_sim no)
\t\t(in_bom yes)
\t\t(on_board yes)
\t\t(dnp no)
\t\t(uuid "82000000-0000-0000-0000-000000000002")
\t\t(property "Reference" "R2"
\t\t\t(at 56 56 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Value" "1k"
\t\t\t(at 56 64 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Footprint" ""
\t\t\t(at 60 60 0)
\t\t\t(effects (font (size 1.27 1.27)) (hide yes))
\t\t)
\t\t(pin "1" (uuid "82000000-0000-0000-0000-000000000003"))
\t\t(pin "2" (uuid "82000000-0000-0000-0000-000000000004"))
\t)
\t(sheet_instances
\t\t(path "/" (page "1"))
\t)
\t(embedded_fonts no)
)
`;

function writeDuplicateChildProject(): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const projectPath = join(OUT_DIR, "duplicate-child.kicad_pro");
  writeFileSync(projectPath, JSON.stringify({ meta: "phase8" }, null, 2), "utf-8");
  writeFileSync(join(OUT_DIR, "duplicate-child.kicad_sch"), DUPLICATE_CHILD_ROOT, "utf-8");
  writeFileSync(join(OUT_DIR, "power.kicad_sch"), DUPLICATE_CHILD_SCHEMATIC, "utf-8");
  return projectPath;
}

describe("Phase 8 domain fixtures and recorder", () => {
  it("supports reusable board fixtures on top of document locators and actions", () => {
    const document = createBoardDocument();
    const buildSensorBoard = defineSchematicFixture(board => ({
      rails3v3: board.powerDomain("+3.3V"),
      ground: board.powerDomain("GND"),
      usb: board.usbConnector("J1", { vbus: "1", dMinus: "2", dPlus: "3", ground: "4" }),
      regulator: board.regulator("U3", { input: "1", ground: "2", output: "3" }),
      mcu: board.mcu("U1"),
      sensor: board.component("U2"),
      sensorBus: board.i2cBus("sensor", { scl: "I2C_SCL", sda: "I2C_SDA", power: "+3.3V", ground: "GND" }),
    }));

    const board = buildSensorBoard(document);

    board.usb
      .connectVbus("VBUS")
      .connectGround("GND")
      .connectData({ dPlus: "USB_DP", dMinus: "USB_DM" })
      .expectVbus("VBUS")
      .expectGround("GND")
      .expectData({ dPlus: "USB_DP", dMinus: "USB_DM" });

    board.regulator
      .connectInput("VBUS")
      .connectGround("GND")
      .connectOutput("+3.3V")
      .expectInput("VBUS")
      .expectGround("GND")
      .expectOutput("+3.3V");

    board.regulator.markOutputDriven().expectDriven().expectPin("U3", "3");

    board.mcu
      .connectPower("1", "+3.3V")
      .connectGround("4", "GND")
      .connectI2c(board.sensorBus, { scl: "2", sda: "3" })
      .expectI2c(board.sensorBus, { scl: "2", sda: "3" })
      .expectPinNet("1", "+3.3V")
      .expectPinNet("4", "GND");

    board.sensorBus
      .connectDevice(board.sensor, { scl: "1", sda: "2", power: "3", ground: "4" })
      .expectDevice(board.sensor, { scl: "1", sda: "2", power: "3", ground: "4" })
      .expectDevice("U1", { scl: "2", sda: "3" });

    board.rails3v3.expectDriven().expectPin("U1", "1").expectPin("U2", "3");
    board.ground.expectPin("J1", "4").expectPin("U2", "4");

    expect(document.getByNet("I2C_SCL").one().pins.map(pin => `${pin.symbolRef}:${pin.pinId}`)).toEqual([
      "U1:2",
      "U2:1",
    ]);
    expect(document.getByNet("+3.3V").one().isPower).toBe(true);
  });

  it("records document workflows and emits reusable fixture-based code", () => {
    const document = createBoardDocument();
    mkdirSync(OUT_DIR, { recursive: true });
    document.saveAs(join(OUT_DIR, "recordable-document.kicad_sch"));

    const recorded = recordDocumentFixtureWorkflow(document, "retune sensor board", board => {
      board.component("U2").setValue("SensorV2");
      board.component("U2").duplicate({ ref: "U4", offset: { x: 20, y: 0 } });
      board.powerDomain("+3.3V").connect("U1", "1").markDriven();
    });

    expect(recorded.trace.map(entry => entry.action)).toEqual(["setValue", "duplicate", "connectTo", "markDriven"]);
    expect(recorded.code).toContain('import { SchematicDocument, createSchematicFixture } from "schematic-agent";');
    expect(recorded.code).toContain("const document = SchematicDocument.open(");
    expect(recorded.code).toContain("const board = createSchematicFixture(document);");
    expect(recorded.code).toContain('board.component("U2").setValue("SensorV2");');
    expect(recorded.code).toContain('board.component("U2").duplicate({ ref: "U4", offset: { x: 20, y: 0 } });');
    expect(recorded.code).toContain('board.component("U1").connect("1", "+3.3V");');
    expect(recorded.code).toContain('board.powerDomain("+3.3V").markDriven();');
    expect(recorded.code).toContain("document.save();");
  });

  it("supports project fixtures and deduplicates action traces for reused child schematics", () => {
    const project = SchematicProject.open(writeDuplicateChildProject());
    const buildFixture = defineProjectFixture(board => ({
      powerA: board.sheet("PowerA"),
      powerB: board.sheet("PowerB"),
    }));
    const fixture = buildFixture(project);

    fixture.powerA.component("R2").setValue("2k").expectValue("2k");
    fixture.powerB.component("R2").expectValue("2k");

    const trace = project.getActionTrace();
    expect(trace).toHaveLength(1);
    expect(trace[0].sheetName).toBe("PowerA");

    const recorded = recordProjectFixtureWorkflow(project, "retune shared power sheet", board => {
      board.sheet("PowerA").component("R2").setValue("3k");
    });

    expect(recorded.trace).toHaveLength(1);
    expect(recorded.code).toContain('import { SchematicProject, createProjectFixture } from "schematic-agent";');
    expect(recorded.code).toContain("const project = SchematicProject.open(");
    expect(recorded.code).toContain("const board = createProjectFixture(project);");
    expect(recorded.code).toContain('board.sheet("PowerA").component("R2").setValue("3k");');
    expect(recorded.code).toContain("project.save();");
  });

  it("creates project fixtures directly from the public helper", () => {
    const project = SchematicProject.open(writeDuplicateChildProject());
    const board = createProjectFixture(project);

    board.sheet("PowerA").component("R2").expectValue("1k");
    board.sheet("PowerA").component("R2").setFootprint("Resistor_SMD:R_0603_1608Metric");

    expect(project.getByRef("R2", { sheet: "PowerA" }).one().footprint).toBe("Resistor_SMD:R_0603_1608Metric");
  });
});
