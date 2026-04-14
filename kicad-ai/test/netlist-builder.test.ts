import { describe, it, expect } from "vitest";
import { NetlistBuilder } from "../src/netlist/NetlistBuilder.js";
import { Netlist } from "../src/netlist/Netlist.js";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const OUT_DIR = join(import.meta.dirname, "..", "test-output");

describe("Netlist data model", () => {
  it("detects power nets from symbol names", () => {
    const builder = new NetlistBuilder();
    builder.addSymbol("Device:R", {
      ref: "R1", value: "330",
      nets: { 1: "VCC", 2: "LED_K" },
    });
    // Access internal netlist for testing
    const netlist = (builder as any).netlist as Netlist;
    expect(netlist.nets.get("VCC")?.isPower).toBe(true);
    expect(netlist.nets.get("LED_K")?.isPower).toBe(false);
  });

  it("rejects duplicate refs", () => {
    const builder = new NetlistBuilder();
    builder.addSymbol("Device:R", { ref: "R1", at: [0, 0] });
    expect(() => builder.addSymbol("Device:R", { ref: "R1", at: [10, 0] }))
      .toThrow("Duplicate");
  });

  it("validates single-connection nets", () => {
    const builder = new NetlistBuilder();
    builder.addSymbol("Device:R", {
      ref: "R1",
      nets: { 1: "VCC", 2: "FLOATING_NET" },
    });
    const netlist = (builder as any).netlist as Netlist;
    const errors = netlist.validate();
    expect(errors.some(e => e.includes("FLOATING_NET"))).toBe(true);
  });

  it("allows net assignment by pin name", () => {
    const builder = new NetlistBuilder();
    builder.addSymbol("Device:LED", {
      ref: "D1",
      nets: { K: "LED_K", A: "GND" },
    });
    const netlist = (builder as any).netlist as Netlist;
    // LED pins: K=pin 1, A=pin 2
    expect(netlist.nets.get("LED_K")?.connections[0].pinId).toBe("1");
    expect(netlist.nets.get("GND")?.connections[0].pinId).toBe("2");
  });

  it("auto-increments refs with nextRef", () => {
    const builder = new NetlistBuilder();
    expect(builder.nextRef("R")).toBe("R1");
    expect(builder.nextRef("R")).toBe("R2");
    expect(builder.nextRef("C")).toBe("C1");
    expect(builder.nextRef("R")).toBe("R3");
  });
});

describe("NetlistBuilder generates valid schematics", () => {
  it("builds LED circuit with net-based API and exports a loadable schematic", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const sch = new NetlistBuilder({ title: "Net-Based LED Circuit" });

    sch.addSymbol("Device:R", {
      ref: "R1", value: "330",
      nets: { 1: "VCC", 2: "LED_K" },
      at: [127, 77.47],
    });
    sch.addSymbol("Device:LED", {
      ref: "D1", value: "Red",
      nets: { K: "LED_K", A: "GND" },
      at: [134.62, 86.36],
    });

    const outPath = join(OUT_DIR, "netlist-led.kicad_sch");
    sch.save(outPath);
    expect(existsSync(outPath)).toBe(true);

    sch.export(outPath, join(OUT_DIR, "svg"));
    expect(existsSync(join(OUT_DIR, "svg", "netlist-led.svg"))).toBe(true);
  });

  it("passes ERC when driven rails are marked with power flags", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const sch = new NetlistBuilder({ title: "Flagged Net-Based LED Circuit" });

    sch.addSymbol("Device:R", {
      ref: "R1", value: "330",
      nets: { 1: "VCC", 2: "LED_K" },
      at: [127, 77.47],
    });
    sch.addSymbol("Device:LED", {
      ref: "D1", value: "Red",
      nets: { K: "LED_K", A: "GND" },
      at: [134.62, 86.36],
    });
    sch.addPowerFlag("VCC");
    sch.addPowerFlag("GND");

    const outPath = join(OUT_DIR, "netlist-led-flagged.kicad_sch");
    sch.save(outPath);

    const content = readFileSync(outPath, "utf-8");
    expect(content).toContain('(lib_id "power:PWR_FLAG")');

    const erc = sch.validate(outPath);
    expect(erc.passed).toBe(true);
    expect(erc.errors).toHaveLength(0);
    expect(erc.warnings).toHaveLength(0);
  });

  it("emits no-connect markers for intentionally floating pins", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const sch = new NetlistBuilder({ title: "No Connect Test" });
    const resistor = sch.addSymbol("Device:R", {
      ref: "R9",
      value: "1k",
      at: [100, 100],
    });
    resistor.markNoConnect(1);
    resistor.markNoConnect(2);

    const outPath = join(OUT_DIR, "netlist-no-connect.kicad_sch");
    sch.save(outPath);

    const content = readFileSync(outPath, "utf-8");
    expect((content.match(/\(no_connect/g) || []).length).toBe(2);

    const erc = sch.validate(outPath);
    expect(erc.passed).toBe(true);
    expect(erc.errors).toHaveLength(0);
    expect(erc.warnings.every(w => w.message.includes("off connection grid"))).toBe(true);
  });

  it("generates schematic with labels for local nets", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const sch = new NetlistBuilder({ title: "Label Test" });

    sch.addSymbol("Device:R", {
      ref: "R1", value: "1k",
      nets: { 1: "SIG_IN", 2: "SIG_OUT" },
      at: [100, 80],
    });
    sch.addSymbol("Device:R", {
      ref: "R2", value: "2.2k",
      nets: { 1: "SIG_OUT", 2: "GND" },
      at: [100, 110],
    });

    const content = sch.generate();
    // SIG_OUT connects R1 and R2 -- should be wired or labeled depending on distance
    // Either way, both should appear in the schematic
    expect(content).toContain('(lib_id "Device:R")');
    // GND is a power net -- gets a power symbol
    expect(content).toContain('(lib_id "power:GND")');
  });

  it("builds circuit without explicit coordinates (auto-layout fallback)", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const sch = new NetlistBuilder({ title: "Auto-Position Test" });

    sch.addSymbol("Device:R", {
      ref: "R1", value: "330",
      nets: { 1: "VCC", 2: "LED_K" },
    });
    sch.addSymbol("Device:LED", {
      ref: "D1", value: "Red",
      nets: { K: "LED_K", A: "GND" },
    });

    const outPath = join(OUT_DIR, "netlist-auto.kicad_sch");
    sch.save(outPath);
    expect(existsSync(outPath)).toBe(true);

    // Should export to SVG without errors (valid file structure)
    sch.export(outPath, join(OUT_DIR, "svg"));
  });
});
