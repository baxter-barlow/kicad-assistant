import { describe, it, expect } from "vitest";
import { NetlistBuilder } from "../src/netlist/NetlistBuilder.js";
import { SymbolLibrary } from "../src/library/SymbolLibrary.js";
import {
  voltageDivider, bypassCap, pullup, pulldown, ledWithResistor,
  crystalOscillator, decoupleIC, linearRegulator, resetCircuit, i2cBus,
} from "../src/circuits/CircuitPatterns.js";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";

const OUT_DIR = join(import.meta.dirname, "..", "test-output");

describe("Circuit patterns", () => {
  it("voltageDivider creates two resistors with correct nets", () => {
    const sch = new NetlistBuilder({ title: "VDiv Test" });
    const { topRef, bottomRef } = voltageDivider(sch, {
      top: "10k", bottom: "10k",
      input: "VIN", output: "VDIV", gnd: "GND",
    });

    expect(topRef).toBe("R1");
    expect(bottomRef).toBe("R2");

    const content = sch.generate();
    // VIN is a single-connection signal net -- gets a label
    expect(content).toContain('(label "VIN"');
    // VDIV connects top and bottom resistors -- wired or labeled
    expect(content.includes('(label "VDIV"') || content.includes('(wire')).toBe(true);
    expect(content).toContain('(lib_id "power:GND")');
  });

  it("bypassCap creates a capacitor", () => {
    const sch = new NetlistBuilder();
    const { capRef } = bypassCap(sch, { value: "100n", power: "+3.3V", gnd: "GND" });

    expect(capRef).toBe("C1");
    const content = sch.generate();
    expect(content).toContain('(lib_id "Device:C")');
  });

  it("pullup creates a resistor between power and signal", () => {
    const sch = new NetlistBuilder();
    const { resistorRef } = pullup(sch, { value: "4.7k", signal: "SDA", power: "+3.3V" });

    expect(resistorRef).toBe("R1");
    const content = sch.generate();
    expect(content).toContain('(label "SDA"');
  });

  it("pulldown creates a resistor between signal and ground", () => {
    const sch = new NetlistBuilder();
    const { resistorRef } = pulldown(sch, { value: "10k", signal: "EN", gnd: "GND" });

    expect(resistorRef).toBe("R1");
    const content = sch.generate();
    expect(content).toContain('(label "EN"');
  });

  it("ledWithResistor creates R + LED pair", () => {
    const sch = new NetlistBuilder();
    const { resistorRef, ledRef } = ledWithResistor(sch, {
      resistance: "330", from: "GPIO1", to: "GND",
    });

    expect(resistorRef).toBe("R1");
    expect(ledRef).toBe("D1");
    const content = sch.generate();
    expect(content).toContain('(lib_id "Device:R")');
    expect(content).toContain('(lib_id "Device:LED")');
  });

  it("generates a complex circuit with multiple patterns", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const sch = new NetlistBuilder({ title: "Multi-Pattern Circuit" });

    voltageDivider(sch, {
      top: "10k", bottom: "10k",
      input: "VIN", output: "VDIV", gnd: "GND",
    });
    bypassCap(sch, { value: "100n", power: "+3.3V", gnd: "GND" });
    pullup(sch, { value: "4.7k", signal: "I2C_SCL", power: "+3.3V" });
    pullup(sch, { value: "4.7k", signal: "I2C_SDA", power: "+3.3V" });
    ledWithResistor(sch, { resistance: "330", led: "PWR", from: "+3.3V", to: "GND" });

    const outPath = join(OUT_DIR, "multi-pattern.kicad_sch");
    sch.save(outPath);
    expect(existsSync(outPath)).toBe(true);

    // Validate with kicad-cli
    sch.export(outPath, join(OUT_DIR, "svg"));

    const content = readFileSync(outPath, "utf-8");
    // Should have R1-R5, C1, D1
    const refs = content.match(/\(reference "([^"]+)"\)/g);
    expect(refs).toBeTruthy();
    expect(refs!.length).toBeGreaterThanOrEqual(7);
  });
});

describe("Smart circuit patterns", () => {
  it("crystalOscillator creates crystal + 2 load caps", () => {
    const sch = new NetlistBuilder();
    const { crystalRef, cap1Ref, cap2Ref } = crystalOscillator(sch, {
      in: "OSC_IN", out: "OSC_OUT", gnd: "GND", frequency: "8MHz",
    });

    expect(crystalRef).toBe("Y1");
    expect(cap1Ref).toBe("C1");
    expect(cap2Ref).toBe("C2");

    const content = sch.generate();
    expect(content).toContain('(lib_id "Device:Crystal")');
    expect(content).toContain('"8MHz"');
  });

  it("decoupleIC auto-places bypass caps for STM32", () => {
    const sch = new NetlistBuilder();
    const lib = new SymbolLibrary();

    sch.addSymbol("MCU_ST_STM32F1:STM32F103C8Tx", {
      ref: "U1",
      nets: {
        "24": "+3.3V", "48": "+3.3V", "36": "+3.3V",
        "23": "GND", "47": "GND", "35": "GND",
        "9": "+3.3V", "8": "GND", "1": "+3.3V",
      },
    });

    const { capRefs } = decoupleIC(sch, lib, { ref: "U1" });

    // STM32 has VDD (+3.3V) and VDDA (+3.3V) and VBAT (+3.3V) as power rails
    // All assigned to "+3.3V", so should deduplicate to 1 cap
    expect(capRefs.length).toBeGreaterThanOrEqual(1);

    const content = sch.generate();
    for (const ref of capRefs) {
      expect(content).toContain(`"${ref}"`);
    }
  });

  it("linearRegulator creates regulator + 2 caps", () => {
    const sch = new NetlistBuilder();
    const { regulatorRef, inputCapRef, outputCapRef } = linearRegulator(sch, {
      input: "+5V", output: "+3.3V", gnd: "GND",
    });

    expect(regulatorRef).toBe("U1");
    expect(inputCapRef).toBe("C1");
    expect(outputCapRef).toBe("C2");

    const content = sch.generate();
    expect(content).toContain('(lib_id "Regulator_Linear:AMS1117-3.3")');
    expect(content).toContain('"10u"');
  });

  it("resetCircuit creates pullup + cap", () => {
    const sch = new NetlistBuilder();
    const { resistorRef, capRef, buttonRef } = resetCircuit(sch, {
      reset: "NRST", power: "+3.3V", gnd: "GND",
    });

    expect(resistorRef).toBe("R1");
    expect(capRef).toBe("C1");
    expect(buttonRef).toBeUndefined();

    const content = sch.generate();
    expect(content).toContain('(lib_id "Device:R")');
    expect(content).toContain('(lib_id "Device:C")');
  });

  it("resetCircuit with button adds SW_Push", () => {
    const sch = new NetlistBuilder();
    const { buttonRef } = resetCircuit(sch, {
      reset: "NRST", power: "+3.3V", gnd: "GND", withButton: true,
    });

    expect(buttonRef).toBe("SW1");

    const content = sch.generate();
    expect(content).toContain('(lib_id "Switch:SW_Push")');
  });

  it("i2cBus creates 2 pullups", () => {
    const sch = new NetlistBuilder();
    const { sdaPullupRef, sclPullupRef, connectorRef } = i2cBus(sch, {
      sda: "I2C_SDA", scl: "I2C_SCL", power: "+3.3V",
    });

    expect(sdaPullupRef).toBeTruthy();
    expect(sclPullupRef).toBeTruthy();
    expect(connectorRef).toBeUndefined();
  });

  it("i2cBus with connector adds 4-pin header", () => {
    const sch = new NetlistBuilder();
    const { connectorRef } = i2cBus(sch, {
      sda: "I2C_SDA", scl: "I2C_SCL", power: "+3.3V", withConnector: true,
    });

    expect(connectorRef).toBe("J1");

    const content = sch.generate();
    expect(content).toContain('(lib_id "Connector_Generic:Conn_01x04")');
  });

  it("generates full MCU board with smart patterns", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const sch = new NetlistBuilder({ title: "Smart Pattern MCU Board" });
    const lib = new SymbolLibrary();

    sch.addSymbol("MCU_ST_STM32F1:STM32F103C8Tx", {
      ref: "U1",
      nets: {
        "24": "+3.3V", "48": "+3.3V", "36": "+3.3V",
        "23": "GND", "47": "GND", "35": "GND",
        "9": "+3.3V", "8": "GND", "1": "+3.3V",
        "42": "I2C_SCL", "43": "I2C_SDA",
        "5": "OSC_IN", "6": "OSC_OUT",
        "7": "NRST", "15": "LED_GPIO",
      },
    });

    decoupleIC(sch, lib, { ref: "U1" });
    crystalOscillator(sch, { in: "OSC_IN", out: "OSC_OUT", gnd: "GND" });
    resetCircuit(sch, { reset: "NRST", power: "+3.3V", gnd: "GND", withButton: true });
    i2cBus(sch, { sda: "I2C_SDA", scl: "I2C_SCL", power: "+3.3V", withConnector: true });
    ledWithResistor(sch, { resistance: "330", from: "LED_GPIO", to: "GND" });

    const outPath = join(OUT_DIR, "smart-mcu-board.kicad_sch");
    sch.save(outPath);
    expect(existsSync(outPath)).toBe(true);

    sch.export(outPath, join(OUT_DIR, "svg"));
  });
});
