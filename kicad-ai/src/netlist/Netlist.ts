import type { Point } from "../library/PinCalculator.js";

export interface NetConnection {
  symbolRef: string;
  pinId: string;
}

export interface Net {
  name: string;
  isPower: boolean;
  connections: NetConnection[];
}

export interface NetlistSymbol {
  libraryId: string;
  ref: string;
  value: string;
  footprint: string;
  rotation: number;
  mirror?: "x" | "y";
  nets: Map<string, string>;  // pinId -> netName
  at?: Point;                 // optional manual position override
}

export class Netlist {
  symbols = new Map<string, NetlistSymbol>();
  nets = new Map<string, Net>();
  private powerSymbolNames: Set<string>;

  constructor(powerSymbolNames: Set<string>) {
    this.powerSymbolNames = powerSymbolNames;
  }

  addSymbol(sym: NetlistSymbol): void {
    if (this.symbols.has(sym.ref)) {
      throw new Error(`Duplicate symbol reference: "${sym.ref}"`);
    }
    this.symbols.set(sym.ref, sym);

    for (const [pinId, netName] of sym.nets) {
      this.assignNet(sym.ref, pinId, netName);
    }
  }

  assignNet(ref: string, pinId: string, netName: string): void {
    const sym = this.symbols.get(ref);
    if (!sym) {
      throw new Error(`Symbol "${ref}" not found in netlist`);
    }
    sym.nets.set(pinId, netName);

    let net = this.nets.get(netName);
    if (!net) {
      net = {
        name: netName,
        isPower: this.powerSymbolNames.has(netName),
        connections: [],
      };
      this.nets.set(netName, net);
    }

    const exists = net.connections.some(
      c => c.symbolRef === ref && c.pinId === pinId
    );
    if (!exists) {
      net.connections.push({ symbolRef: ref, pinId });
    }
  }

  validate(): string[] {
    const errors: string[] = [];

    // Check for nets with only 1 connection (likely unfinished wiring)
    for (const [name, net] of this.nets) {
      if (net.connections.length === 1) {
        const c = net.connections[0];
        errors.push(`Net "${name}" has only 1 connection (${c.symbolRef} pin ${c.pinId})`);
      }
    }

    return errors;
  }
}
