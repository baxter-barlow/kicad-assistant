import { writeFileSync } from "fs";
import { SymbolLibrary, type SymbolDef } from "../library/SymbolLibrary.js";
import { getAbsolutePinPosition, type Point } from "../library/PinCalculator.js";
import { route, type WireSegment } from "./WireRouter.js";
import { runErc, exportSvg, type ErcResult } from "../utils/kicad-cli.js";
import { generateUuid } from "../utils/uuid.js";
import { computeBoundingBox } from "../layout/BoundingBox.js";

export interface PlacedSymbol {
  /** Reference designator, e.g. "R1" */
  ref: string;
  /** Library ID, e.g. "Device:R" */
  libraryId: string;
  /** Position on the schematic */
  at: Point;
  /** Rotation in degrees */
  rotation: number;
  /** Mirror mode */
  mirror?: "x" | "y";
  /** Component value, e.g. "330" */
  value: string;
  /** Footprint, e.g. "Resistor_SMD:R_0805_2012Metric" */
  footprint: string;
  /** UUID for this instance */
  uuid: string;
  /** Resolved symbol definition */
  symbolDef: SymbolDef;
  /** Computed absolute pin positions */
  pinPositions: Map<string, Point>;
}

export interface AddSymbolOptions {
  ref: string;
  value?: string;
  at: [number, number] | Point;
  rotation?: number;
  mirror?: "x" | "y";
  footprint?: string;
}

export interface SchematicBuilderOptions {
  title?: string;
  date?: string;
  rev?: string;
  paper?: string;
  projectName?: string;
  symbolsPath?: string;
}

interface LabelEntry {
  name: string;
  at: Point;
  angle: number;
}

interface NoConnectEntry {
  at: Point;
}

export class SchematicBuilder {
  private library: SymbolLibrary;
  private symbols: PlacedSymbol[] = [];
  private wires: WireSegment[] = [];
  private labels: LabelEntry[] = [];
  private noConnects: NoConnectEntry[] = [];
  private libSymbolIds = new Set<string>();
  private options: SchematicBuilderOptions;
  private schUuid: string;

  constructor(options: SchematicBuilderOptions = {}) {
    this.options = options;
    this.library = new SymbolLibrary(options.symbolsPath);
    this.schUuid = generateUuid();
  }

  /**
   * Place a symbol on the schematic.
   */
  addSymbol(libraryId: string, opts: AddSymbolOptions): PlacedSymbol {
    if (!libraryId.includes(":")) {
      throw new Error(`Invalid library ID "${libraryId}". Expected "Library:Symbol" format (e.g. "Device:R").`);
    }
    if (!opts.ref || typeof opts.ref !== "string") {
      throw new Error("ref is required and must be a non-empty string.");
    }
    const at: Point = Array.isArray(opts.at)
      ? { x: opts.at[0], y: opts.at[1] }
      : opts.at;
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
      throw new Error(`Invalid coordinates: (${at.x}, ${at.y}). Must be finite numbers.`);
    }
    const rotation = opts.rotation ?? 0;
    if (![0, 90, 180, 270].includes(rotation)) {
      throw new Error(`Invalid rotation: ${rotation}. Must be 0, 90, 180, or 270.`);
    }
    const mirror = opts.mirror;

    const symbolDef = this.library.resolve(libraryId);

    // Compute absolute pin positions
    const pinPositions = new Map<string, Point>();
    for (const pin of symbolDef.pins) {
      const absPos = getAbsolutePinPosition(
        at,
        { x: pin.x, y: pin.y },
        rotation,
        mirror
      );
      // Index by both pin number and pin name
      pinPositions.set(pin.number, absPos);
      if (pin.name) {
        pinPositions.set(pin.name, absPos);
      }
    }

    const placed: PlacedSymbol = {
      ref: opts.ref,
      libraryId,
      at,
      rotation,
      mirror,
      value: opts.value ?? symbolDef.properties.find(p => p.key === "Value")?.value ?? "",
      footprint: opts.footprint ?? "",
      uuid: generateUuid(),
      symbolDef,
      pinPositions,
    };

    this.symbols.push(placed);
    this.libSymbolIds.add(libraryId);
    return placed;
  }

  /**
   * Place a power symbol (VCC, GND, +3.3V, etc.).
   * Power symbols are in the "power" library.
   */
  addPower(name: string, opts: Omit<AddSymbolOptions, "value"> & { ref?: string }): PlacedSymbol {
    const libraryId = `power:${name}`;
    const ref = opts.ref ?? `#PWR0${this.symbols.filter(s => s.ref.startsWith("#PWR")).length + 1}`;
    return this.addSymbol(libraryId, {
      ...opts,
      ref,
      value: name,
    });
  }

  /**
   * Place a PWR_FLAG marker to satisfy ERC power-drive checks.
   * The flag must be placed directly on the target net.
   */
  addPowerFlag(opts: Omit<AddSymbolOptions, "value"> & { ref?: string }): PlacedSymbol {
    const ref = opts.ref ?? `#FLG0${this.symbols.filter(s => s.ref.startsWith("#FLG")).length + 1}`;
    return this.addSymbol("power:PWR_FLAG", {
      ...opts,
      ref,
      value: "PWR_FLAG",
    });
  }

  /**
   * Connect two pins with auto-routed wires.
   * Pin can be identified by number (string/number) or name (string).
   */
  connect(
    fromSymbol: PlacedSymbol, fromPin: string | number,
    toSymbol: PlacedSymbol, toPin: string | number,
  ): void {
    const fromPos = fromSymbol.pinPositions.get(String(fromPin));
    const toPos = toSymbol.pinPositions.get(String(toPin));

    if (!fromPos) {
      throw new Error(`Pin "${fromPin}" not found on ${fromSymbol.ref} (${fromSymbol.libraryId}). Available: ${[...fromSymbol.pinPositions.keys()].join(", ")}`);
    }
    if (!toPos) {
      throw new Error(`Pin "${toPin}" not found on ${toSymbol.ref} (${toSymbol.libraryId}). Available: ${[...toSymbol.pinPositions.keys()].join(", ")}`);
    }

    const segments = route(fromPos, toPos);
    this.wires.push(...segments);
  }

  /**
   * Add a wire directly between two points.
   */
  addWire(from: [number, number] | Point, to: [number, number] | Point): void {
    const fromPt: Point = Array.isArray(from) ? { x: from[0], y: from[1] } : from;
    const toPt: Point = Array.isArray(to) ? { x: to[0], y: to[1] } : to;
    this.wires.push({ from: fromPt, to: toPt });
  }

  /**
   * Add a net label at a position.
   */
  addLabel(name: string, at: Point, angle: number = 0): void {
    this.labels.push({ name, at, angle });
  }

  /**
   * Mark a pin as intentionally not connected for ERC.
   */
  addNoConnect(at: [number, number] | Point): void {
    const atPt: Point = Array.isArray(at) ? { x: at[0], y: at[1] } : at;
    this.noConnects.push({ at: atPt });
  }

  /**
   * Generate the .kicad_sch file content.
   */
  generate(): string {
    const lines: string[] = [];

    lines.push(`(kicad_sch`);
    lines.push(`\t(version 20250114)`);
    lines.push(`\t(generator "schematic-agent")`);
    lines.push(`\t(generator_version "0.1")`);
    lines.push(`\t(uuid "${this.schUuid}")`);
    lines.push(`\t(paper "${this.options.paper ?? "A4"}")`);

    // Title block
    lines.push(`\t(title_block`);
    if (this.options.title) lines.push(`\t\t(title "${this.options.title}")`);
    if (this.options.date) lines.push(`\t\t(date "${this.options.date}")`);
    if (this.options.rev) lines.push(`\t\t(rev "${this.options.rev}")`);
    lines.push(`\t)`);

    // lib_symbols
    lines.push(`\t(lib_symbols`);
    for (const libId of this.libSymbolIds) {
      const rawText = this.library.getRawSymbolText(libId);
      const indented = rawText.split("\n").map(l => {
        const stripped = l.startsWith("\t") ? l.slice(1) : l;
        return "\t\t" + stripped;
      }).join("\n");
      lines.push(indented);
    }
    lines.push(`\t)`);

    // Wires
    for (const wire of this.wires) {
      lines.push(`\t(wire`);
      lines.push(`\t\t(pts`);
      lines.push(`\t\t\t(xy ${wire.from.x} ${wire.from.y}) (xy ${wire.to.x} ${wire.to.y})`);
      lines.push(`\t\t)`);
      lines.push(`\t\t(stroke`);
      lines.push(`\t\t\t(width 0)`);
      lines.push(`\t\t\t(type solid)`);
      lines.push(`\t\t)`);
      lines.push(`\t\t(uuid "${generateUuid()}")`);
      lines.push(`\t)`);
    }

    // Labels
    for (const label of this.labels) {
      lines.push(`\t(label "${label.name}"`);
      lines.push(`\t\t(at ${label.at.x} ${label.at.y} ${label.angle})`);
      lines.push(`\t\t(effects`);
      lines.push(`\t\t\t(font`);
      lines.push(`\t\t\t\t(size 1.27 1.27)`);
      lines.push(`\t\t\t)`);
      lines.push(`\t\t)`);
      lines.push(`\t\t(uuid "${generateUuid()}")`);
      lines.push(`\t)`);
    }

    for (const marker of this.noConnects) {
      lines.push(`\t(no_connect`);
      lines.push(`\t\t(at ${marker.at.x} ${marker.at.y})`);
      lines.push(`\t\t(uuid "${generateUuid()}")`);
      lines.push(`\t)`);
    }

    // Symbol instances
    for (const sym of this.symbols) {
      lines.push(this.generateSymbolInstance(sym));
    }

    // Sheet instances
    lines.push(`\t(sheet_instances`);
    lines.push(`\t\t(path "/"`);
    lines.push(`\t\t\t(page "1")`);
    lines.push(`\t\t)`);
    lines.push(`\t)`);

    lines.push(`\t(embedded_fonts no)`);
    lines.push(`)`);

    return lines.join("\n") + "\n";
  }

  private generateSymbolInstance(sym: PlacedSymbol): string {
    const lines: string[] = [];
    const atStr = `(at ${sym.at.x} ${sym.at.y} ${sym.rotation})`;

    lines.push(`\t(symbol`);
    lines.push(`\t\t(lib_id "${sym.libraryId}")`);
    lines.push(`\t\t${atStr}`);
    if (sym.mirror) {
      lines.push(`\t\t(mirror ${sym.mirror})`);
    }
    lines.push(`\t\t(unit 1)`);
    lines.push(`\t\t(exclude_from_sim no)`);
    lines.push(`\t\t(in_bom yes)`);
    lines.push(`\t\t(on_board yes)`);
    lines.push(`\t\t(dnp no)`);
    lines.push(`\t\t(uuid "${sym.uuid}")`);

    // Properties -- place Reference and Value clear of the symbol body.
    // Power symbols (#PWR): hide both since the graphic shows the net name.
    // Non-power: ref above-right, value below-right of the body.
    const bbox = computeBoundingBox(sym.symbolDef);
    const isInfrastructure = sym.ref.startsWith("#PWR") || sym.ref.startsWith("#FLG");

    // Position text to the right and above/below the body so it doesn't
    // overlap pin names, pin numbers, or adjacent components.
    const textX = sym.at.x + bbox.maxX + 2.54;
    const refY = sym.at.y + bbox.minY;
    const valY = sym.at.y + bbox.maxY;

    const refProp = this.generateProperty("Reference", sym.ref,
      { x: textX, y: refY }, isInfrastructure);
    const valProp = this.generateProperty("Value", sym.value,
      { x: textX, y: valY }, isInfrastructure);
    const fpProp = this.generateProperty("Footprint", sym.footprint, sym.at, true);
    const dsProp = this.generateProperty("Datasheet", "~", sym.at, true);
    const descProp = this.generateProperty("Description", "", sym.at, true);

    lines.push(refProp);
    lines.push(valProp);
    lines.push(fpProp);
    lines.push(dsProp);
    lines.push(descProp);

    // Pin UUIDs
    for (const pin of sym.symbolDef.pins) {
      lines.push(`\t\t(pin "${pin.number}"`);
      lines.push(`\t\t\t(uuid "${generateUuid()}")`);
      lines.push(`\t\t)`);
    }

    // Instances
    lines.push(`\t\t(instances`);
    lines.push(`\t\t\t(project "${this.options.projectName ?? "schematic"}"`);
    lines.push(`\t\t\t\t(path "/${this.schUuid}"`);
    lines.push(`\t\t\t\t\t(reference "${sym.ref}")`);
    lines.push(`\t\t\t\t\t(unit 1)`);
    lines.push(`\t\t\t\t)`);
    lines.push(`\t\t\t)`);
    lines.push(`\t\t)`);

    lines.push(`\t)`);
    return lines.join("\n");
  }

  private generateProperty(key: string, value: string, symAt: Point, hide: boolean): string {
    const lines: string[] = [];
    lines.push(`\t\t(property "${key}" "${value}"`);
    lines.push(`\t\t\t(at ${symAt.x} ${symAt.y} 0)`);
    lines.push(`\t\t\t(effects`);
    lines.push(`\t\t\t\t(font`);
    lines.push(`\t\t\t\t\t(size 1.27 1.27)`);
    lines.push(`\t\t\t\t)`);
    if (hide) {
      lines.push(`\t\t\t\t(hide yes)`);
    }
    lines.push(`\t\t\t)`);
    lines.push(`\t\t)`);
    return lines.join("\n");
  }

  /**
   * Save the schematic to a file.
   */
  save(path: string): string {
    const content = this.generate();
    writeFileSync(path, content, "utf-8");
    return path;
  }

  /**
   * Run ERC validation on the saved schematic.
   */
  validate(schPath: string): ErcResult {
    return runErc(schPath);
  }

  /**
   * Export the schematic to SVG.
   */
  export(schPath: string, svgPath: string): string {
    return exportSvg(schPath, svgPath);
  }
}
