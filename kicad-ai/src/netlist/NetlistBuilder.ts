import { readFileSync, writeFileSync } from "fs";
import { Netlist, type NetlistSymbol } from "./Netlist.js";
import { SymbolLibrary } from "../library/SymbolLibrary.js";
import { SchematicBuilder, type SchematicBuilderOptions } from "../builder/SchematicBuilder.js";
import type { ErcResult } from "../utils/kicad-cli.js";
import { autoLayout, type LayoutPlacement, type LayoutResult } from "../layout/AutoLayout.js";
import { placeLabelsAndPower } from "../layout/LabelPlacer.js";
import { getAbsolutePinPosition, type Point } from "../library/PinCalculator.js";

export interface NetlistAddSymbolOptions {
  ref: string;
  value?: string;
  footprint?: string;
  rotation?: number;
  mirror?: "x" | "y";
  nets?: Record<string | number, string>;
  at?: [number, number];
}

export interface NetlistSymbolHandle {
  readonly ref: string;
  readonly libraryId: string;
  setNet(pin: string | number, netName: string): void;
  markNoConnect(pin: string | number): void;
}

interface NoConnectRequest {
  ref: string;
  pinId: string;
}

const POWER_FLAG_OFFSET = 7.62;

export class NetlistBuilder {
  private library: SymbolLibrary;
  private netlist: Netlist;
  private options: SchematicBuilderOptions;
  private symbolDefs = new Map<string, { libraryId: string; pinNames: Map<string, string> }>();
  private refCounters = new Map<string, number>();
  private powerFlagNets = new Set<string>();
  private noConnects: NoConnectRequest[] = [];

  constructor(options: SchematicBuilderOptions = {}) {
    this.options = options;
    this.library = new SymbolLibrary(options.symbolsPath);
    const powerNames = this.loadPowerSymbolNames();
    this.netlist = new Netlist(powerNames);
  }

  addSymbol(libraryId: string, opts: NetlistAddSymbolOptions): NetlistSymbolHandle {
    const symbolDef = this.library.resolve(libraryId);

    const pinNameToNumber = new Map<string, string>();
    for (const pin of symbolDef.pins) {
      if (pin.name) pinNameToNumber.set(pin.name, pin.number);
      pinNameToNumber.set(pin.number, pin.number);
    }

    const nets = new Map<string, string>();
    if (opts.nets) {
      for (const [pinRef, netName] of Object.entries(opts.nets)) {
        const pinNumber = pinNameToNumber.get(String(pinRef));
        if (!pinNumber) {
          throw new Error(
            `Pin "${pinRef}" not found on ${libraryId}. Available: ${[...pinNameToNumber.keys()].join(", ")}`
          );
        }
        nets.set(pinNumber, netName);
      }
    }

    const sym: NetlistSymbol = {
      libraryId,
      ref: opts.ref,
      value: opts.value ?? symbolDef.properties.find(p => p.key === "Value")?.value ?? "",
      footprint: opts.footprint ?? "",
      rotation: opts.rotation ?? 0,
      mirror: opts.mirror,
      nets,
      at: opts.at ? { x: opts.at[0], y: opts.at[1] } : undefined,
    };

    this.netlist.addSymbol(sym);
    this.symbolDefs.set(opts.ref, { libraryId, pinNames: pinNameToNumber });

    // Update ref counter so nextRef() doesn't generate a duplicate
    const refMatch = opts.ref.match(/^([A-Za-z]+)(\d+)$/);
    if (refMatch) {
      const prefix = refMatch[1];
      const num = parseInt(refMatch[2], 10);
      const current = this.refCounters.get(prefix) ?? 0;
      if (num > current) this.refCounters.set(prefix, num);
    }

    return {
      ref: opts.ref,
      libraryId,
      setNet: (pin: string | number, netName: string) => {
        const pinNumber = this.resolvePinNumber(opts.ref, pin, libraryId, pinNameToNumber);
        this.netlist.assignNet(opts.ref, pinNumber, netName);
      },
      markNoConnect: (pin: string | number) => {
        this.addNoConnect(opts.ref, pin);
      },
    };
  }

  addPowerFlag(netName: string): void {
    this.powerFlagNets.add(netName);
  }

  addNoConnect(ref: string, pin: string | number): void {
    const symbolDef = this.symbolDefs.get(ref);
    if (!symbolDef) {
      throw new Error(`Symbol "${ref}" not found in netlist`);
    }

    const pinId = this.resolvePinNumber(ref, pin, symbolDef.libraryId, symbolDef.pinNames);
    const key = `${ref}:${pinId}`;
    if (!this.noConnects.some(entry => `${entry.ref}:${entry.pinId}` === key)) {
      this.noConnects.push({ ref, pinId });
    }
  }

  nextRef(prefix: string): string {
    const count = (this.refCounters.get(prefix) ?? 0) + 1;
    this.refCounters.set(prefix, count);
    return `${prefix}${count}`;
  }

  getSymbolNets(ref: string): Map<string, string> | undefined {
    return this.netlist.symbols.get(ref)?.nets;
  }

  getSymbolLibraryId(ref: string): string | undefined {
    return this.netlist.symbols.get(ref)?.libraryId;
  }

  generate(): string {
    // Determine symbol placements
    const layoutResult = this.computeLayout();

    // Build the low-level schematic
    const builder = new SchematicBuilder(this.options);
    const placedSymbols = new Map<string, ReturnType<SchematicBuilder["addSymbol"]>>();

    // Place symbols
    for (const [ref, sym] of this.netlist.symbols) {
      const placement = layoutResult.placements.get(ref)!;
      const placed = builder.addSymbol(sym.libraryId, {
        ref: sym.ref,
        value: sym.value,
        at: [placement.at.x, placement.at.y],
        rotation: placement.rotation,
        mirror: sym.mirror,
        footprint: sym.footprint,
      });
      placedSymbols.set(ref, placed);
    }

    // Place power symbols, labels, and wires
    const { powerPlacements, labelPlacements, wirePlacements } = placeLabelsAndPower(
      this.netlist, this.library, layoutResult.placements, layoutResult.levels,
    );

    for (const pwr of powerPlacements) {
      builder.addPower(pwr.netName, {
        at: [pwr.at.x, pwr.at.y],
        ref: pwr.ref,
      });
    }

    for (const label of labelPlacements) {
      builder.addLabel(label.netName, label.at, label.angle);
    }

    for (const wire of wirePlacements) {
      builder.addWire(wire.from, wire.to);
    }

    let powerFlagCount = 0;
    for (const netName of this.powerFlagNets) {
      const net = this.netlist.nets.get(netName);
      if (!net || net.connections.length === 0) {
        throw new Error(`Cannot place power flag on net "${netName}" because it has no connections.`);
      }

      const anchor = net.connections[0];
      const anchorPos = this.getPlacedPinPosition(anchor.symbolRef, anchor.pinId, layoutResult.placements);
      const anchorSymbol = placedSymbols.get(anchor.symbolRef);
      if (!anchorSymbol) {
        throw new Error(`Cannot place power flag for net "${netName}" because symbol "${anchor.symbolRef}" was not placed.`);
      }

      powerFlagCount++;
      const isGnd = netName === "GND" || netName.startsWith("-");
      const flag = builder.addPowerFlag({
        at: [anchorPos.x, anchorPos.y + (isGnd ? POWER_FLAG_OFFSET : -POWER_FLAG_OFFSET)],
        ref: `#FLG0${powerFlagCount}`,
      });
      builder.connect(flag, 1, anchorSymbol, anchor.pinId);
    }

    for (const request of this.noConnects) {
      const sym = this.netlist.symbols.get(request.ref);
      if (!sym) {
        throw new Error(`Cannot place no-connect marker for missing symbol "${request.ref}".`);
      }
      if (sym.nets.has(request.pinId)) {
        throw new Error(
          `Pin "${request.pinId}" on ${request.ref} is connected to net "${sym.nets.get(request.pinId)}" and cannot be marked no-connect.`
        );
      }

      builder.addNoConnect(this.getPlacedPinPosition(request.ref, request.pinId, layoutResult.placements));
    }

    return builder.generate();
  }

  save(path: string): string {
    const content = this.generate();
    writeFileSync(path, content, "utf-8");
    return path;
  }

  validate(schPath: string): ErcResult {
    const builder = new SchematicBuilder(this.options);
    return builder.validate(schPath);
  }

  export(schPath: string, svgPath: string): string {
    const builder = new SchematicBuilder(this.options);
    return builder.export(schPath, svgPath);
  }

  private computeLayout(): LayoutResult {
    const allExplicit = [...this.netlist.symbols.values()].every(s => s.at !== undefined);

    if (allExplicit) {
      const placements = new Map<string, LayoutPlacement>();
      for (const [ref, sym] of this.netlist.symbols) {
        placements.set(ref, { at: sym.at!, rotation: sym.rotation });
      }
      return { placements, powerPlacements: [], labelPlacements: [], levels: new Map() };
    }

    const layoutResult = autoLayout(this.netlist, this.library);

    for (const [ref, sym] of this.netlist.symbols) {
      if (sym.at) {
        layoutResult.placements.set(ref, { at: sym.at, rotation: sym.rotation });
      }
    }

    return layoutResult;
  }

  private loadPowerSymbolNames(): Set<string> {
    const names = new Set<string>();
    try {
      const symPath = this.library.basePath;
      const text = readFileSync(`${symPath}/power.kicad_sym`, "utf-8");
      const regex = /\n\t\(symbol "([^"]+)"/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        names.add(match[1]);
      }
    } catch {
      for (const name of ["VCC", "GND", "+3.3V", "+5V", "+12V", "-12V", "+3V3", "+1V8"]) {
        names.add(name);
      }
    }
    return names;
  }

  private resolvePinNumber(
    ref: string,
    pin: string | number,
    libraryId: string,
    pinNameToNumber: Map<string, string>,
  ): string {
    const pinNumber = pinNameToNumber.get(String(pin));
    if (!pinNumber) {
      throw new Error(`Pin "${pin}" not found on ${ref} (${libraryId})`);
    }
    return pinNumber;
  }

  private getPlacedPinPosition(
    ref: string,
    pinId: string,
    placements: Map<string, LayoutPlacement>,
  ): Point {
    const sym = this.netlist.symbols.get(ref);
    const placement = placements.get(ref);

    if (!sym || !placement) {
      throw new Error(`Symbol "${ref}" has no placement.`);
    }

    const symbolDef = this.library.resolve(sym.libraryId);

    const pinDef = symbolDef.pins.find(pin => pin.number === pinId);
    if (!pinDef) {
      throw new Error(`Pin "${pinId}" not found on ${ref} (${sym.libraryId}).`);
    }

    return getAbsolutePinPosition(
      placement.at,
      { x: pinDef.x, y: pinDef.y },
      placement.rotation,
      sym.mirror,
    );
  }
}
