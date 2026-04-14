import type { NetlistBuilder } from "../netlist/NetlistBuilder.js";
import type { SymbolLibrary } from "../library/SymbolLibrary.js";

// ============================================================
// Basic Patterns
// ============================================================

export interface VoltageDividerOptions {
  top: string; bottom: string; input: string; output: string; gnd: string; footprint?: string;
}

export interface BypassCapOptions {
  value: string; power: string; gnd: string; footprint?: string;
}

export interface PullupOptions {
  value: string; signal: string; power: string; footprint?: string;
}

export interface PulldownOptions {
  value: string; signal: string; gnd: string; footprint?: string;
}

export interface LedWithResistorOptions {
  led?: string; resistance: string; from: string; to: string; footprint?: string;
}

export function voltageDivider(
  builder: NetlistBuilder, opts: VoltageDividerOptions,
): { topRef: string; bottomRef: string } {
  const topRef = builder.nextRef("R");
  const bottomRef = builder.nextRef("R");
  builder.addSymbol("Device:R", { ref: topRef, value: opts.top, footprint: opts.footprint, nets: { 1: opts.input, 2: opts.output } });
  builder.addSymbol("Device:R", { ref: bottomRef, value: opts.bottom, footprint: opts.footprint, nets: { 1: opts.output, 2: opts.gnd } });
  return { topRef, bottomRef };
}

export function bypassCap(
  builder: NetlistBuilder, opts: BypassCapOptions,
): { capRef: string } {
  const capRef = builder.nextRef("C");
  builder.addSymbol("Device:C", { ref: capRef, value: opts.value, footprint: opts.footprint, nets: { 1: opts.power, 2: opts.gnd } });
  return { capRef };
}

export function pullup(
  builder: NetlistBuilder, opts: PullupOptions,
): { resistorRef: string } {
  const resistorRef = builder.nextRef("R");
  builder.addSymbol("Device:R", { ref: resistorRef, value: opts.value, footprint: opts.footprint, nets: { 1: opts.power, 2: opts.signal } });
  return { resistorRef };
}

export function pulldown(
  builder: NetlistBuilder, opts: PulldownOptions,
): { resistorRef: string } {
  const resistorRef = builder.nextRef("R");
  builder.addSymbol("Device:R", { ref: resistorRef, value: opts.value, footprint: opts.footprint, nets: { 1: opts.signal, 2: opts.gnd } });
  return { resistorRef };
}

export function ledWithResistor(
  builder: NetlistBuilder, opts: LedWithResistorOptions,
): { resistorRef: string; ledRef: string } {
  const resistorRef = builder.nextRef("R");
  const ledRef = builder.nextRef("D");
  const midNet = `${resistorRef}_${ledRef}`;
  builder.addSymbol("Device:R", { ref: resistorRef, value: opts.resistance, footprint: opts.footprint, nets: { 1: opts.from, 2: midNet } });
  builder.addSymbol("Device:LED", { ref: ledRef, value: opts.led ?? "LED", nets: { A: midNet, K: opts.to } });
  return { resistorRef, ledRef };
}

// ============================================================
// Smart Patterns
// ============================================================

/**
 * Crystal oscillator with load capacitors.
 * Places a crystal between two MCU oscillator pins with load caps to ground.
 */
export function crystalOscillator(builder: NetlistBuilder, opts: {
  in: string;
  out: string;
  gnd: string;
  frequency?: string;
  loadCap?: string;
}): { crystalRef: string; cap1Ref: string; cap2Ref: string } {
  const crystalRef = builder.nextRef("Y");
  const cap1Ref = builder.nextRef("C");
  const cap2Ref = builder.nextRef("C");

  builder.addSymbol("Device:Crystal", {
    ref: crystalRef,
    value: opts.frequency ?? "8MHz",
    nets: { 1: opts.in, 2: opts.out },
  });

  builder.addSymbol("Device:C", {
    ref: cap1Ref,
    value: opts.loadCap ?? "20p",
    nets: { 1: opts.in, 2: opts.gnd },
  });

  builder.addSymbol("Device:C", {
    ref: cap2Ref,
    value: opts.loadCap ?? "20p",
    nets: { 1: opts.out, 2: opts.gnd },
  });

  return { crystalRef, cap1Ref, cap2Ref };
}

/**
 * Automatically place bypass capacitors for an IC.
 * Reads the IC's power_in pins and places one cap per unique power/ground pair.
 *
 * The IC must already be added to the builder with net assignments on its power pins.
 */
export function decoupleIC(
  builder: NetlistBuilder,
  library: SymbolLibrary,
  opts: { ref: string; value?: string },
): { capRefs: string[] } {
  const libraryId = builder.getSymbolLibraryId(opts.ref);
  if (!libraryId) throw new Error(`Symbol "${opts.ref}" not found in builder`);

  const nets = builder.getSymbolNets(opts.ref);
  if (!nets) throw new Error(`No net assignments for "${opts.ref}"`);

  const def = library.resolve(libraryId);
  const capValue = opts.value ?? "100n";

  // Find all power_in pins and their assigned nets
  const powerNets = new Set<string>();
  const groundNets = new Set<string>();

  for (const pin of def.pins) {
    if (pin.type !== "power_in") continue;
    const netName = nets.get(pin.number);
    if (!netName) continue;

    const nameLower = pin.name.toLowerCase();
    if (nameLower.includes("vss") || nameLower.includes("gnd") || nameLower.includes("vssa")) {
      groundNets.add(netName);
    } else {
      powerNets.add(netName);
    }
  }

  // Place one cap per power rail, connecting to the first ground net
  const gnd = [...groundNets][0] ?? "GND";
  const capRefs: string[] = [];

  for (const powerNet of powerNets) {
    const capRef = builder.nextRef("C");
    builder.addSymbol("Device:C", {
      ref: capRef,
      value: capValue,
      nets: { 1: powerNet, 2: gnd },
    });
    capRefs.push(capRef);
  }

  return { capRefs };
}

/**
 * Linear voltage regulator with input and output capacitors.
 * Default uses AMS1117-3.3 (pins: GND=1, VO=2, VI=3).
 */
export function linearRegulator(builder: NetlistBuilder, opts: {
  input: string;
  output: string;
  gnd: string;
  regulator?: string;
  inputCap?: string;
  outputCap?: string;
}): { regulatorRef: string; inputCapRef: string; outputCapRef: string } {
  const regulatorRef = builder.nextRef("U");
  const inputCapRef = builder.nextRef("C");
  const outputCapRef = builder.nextRef("C");

  const regLibId = opts.regulator ?? "Regulator_Linear:AMS1117-3.3";

  builder.addSymbol(regLibId, {
    ref: regulatorRef,
    nets: { GND: opts.gnd, VO: opts.output, VI: opts.input },
  });

  builder.addSymbol("Device:C", {
    ref: inputCapRef,
    value: opts.inputCap ?? "10u",
    nets: { 1: opts.input, 2: opts.gnd },
  });

  builder.addSymbol("Device:C", {
    ref: outputCapRef,
    value: opts.outputCap ?? "10u",
    nets: { 1: opts.output, 2: opts.gnd },
  });

  return { regulatorRef, inputCapRef, outputCapRef };
}

/**
 * MCU reset circuit: pullup resistor + filter capacitor + optional push button.
 */
export function resetCircuit(builder: NetlistBuilder, opts: {
  reset: string;
  power: string;
  gnd: string;
  resistor?: string;
  cap?: string;
  withButton?: boolean;
}): { resistorRef: string; capRef: string; buttonRef?: string } {
  const resistorRef = builder.nextRef("R");
  const capRef = builder.nextRef("C");

  builder.addSymbol("Device:R", {
    ref: resistorRef,
    value: opts.resistor ?? "10k",
    nets: { 1: opts.power, 2: opts.reset },
  });

  builder.addSymbol("Device:C", {
    ref: capRef,
    value: opts.cap ?? "100n",
    nets: { 1: opts.reset, 2: opts.gnd },
  });

  let buttonRef: string | undefined;
  if (opts.withButton) {
    buttonRef = builder.nextRef("SW");
    builder.addSymbol("Switch:SW_Push", {
      ref: buttonRef,
      value: "RESET",
      nets: { 1: opts.reset, 2: opts.gnd },
    });
  }

  return { resistorRef, capRef, buttonRef };
}

/**
 * I2C bus support: 2 pullup resistors + optional 4-pin connector (VCC, GND, SDA, SCL).
 */
export function i2cBus(builder: NetlistBuilder, opts: {
  sda: string;
  scl: string;
  power: string;
  pullupValue?: string;
  withConnector?: boolean;
  gnd?: string;
}): { sdaPullupRef: string; sclPullupRef: string; connectorRef?: string } {
  const val = opts.pullupValue ?? "4.7k";
  const { resistorRef: sclPullupRef } = pullup(builder, { value: val, signal: opts.scl, power: opts.power });
  const { resistorRef: sdaPullupRef } = pullup(builder, { value: val, signal: opts.sda, power: opts.power });

  let connectorRef: string | undefined;
  if (opts.withConnector) {
    connectorRef = builder.nextRef("J");
    const gnd = opts.gnd ?? "GND";
    builder.addSymbol("Connector_Generic:Conn_01x04", {
      ref: connectorRef,
      value: "I2C",
      nets: { 1: opts.power, 2: gnd, 3: opts.sda, 4: opts.scl },
    });
  }

  return { sdaPullupRef, sclPullupRef, connectorRef };
}
