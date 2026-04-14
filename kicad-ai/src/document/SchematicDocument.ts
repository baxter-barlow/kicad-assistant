import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { parseSExpr, findChild, findChildren, type SExpr } from "../sexpr/parser.js";
import { getAbsolutePinPosition, type Point } from "../library/PinCalculator.js";
import { SymbolLibrary } from "../library/SymbolLibrary.js";
import { generateUuid } from "../utils/uuid.js";
import { buildPointConnectivityGroups, pointKey } from "../connectivity/PointConnectivity.js";
import { exportSvg, runErc, type ErcResult } from "../utils/kicad-cli.js";
import { SchematicAssertionError } from "../assertions/SchematicAssertionError.js";

export interface SourceRange {
  start: number;
  end: number;
}

export type LabelKind = "label" | "global_label" | "hierarchical_label";

export interface SchematicPlacedPinNode {
  id: string;
  uuid?: string;
}

export type SchematicNodeKind =
  | "version"
  | "generator"
  | "generator_version"
  | "uuid"
  | "paper"
  | "title_block"
  | "lib_symbols"
  | "wire"
  | "label"
  | "junction"
  | "no_connect"
  | "symbol"
  | "sheet"
  | "sheet_instances"
  | "embedded_fonts"
  | "unknown";

export interface SchematicNodeBase {
  kind: SchematicNodeKind;
  leadingTrivia: string;
  raw: string;
  range: SourceRange;
  dirty: boolean;
}

export interface SchematicValueNode extends SchematicNodeBase {
  kind: "version" | "generator" | "generator_version" | "uuid" | "paper" | "embedded_fonts";
  value: string | number;
}

export interface TitleBlockNode extends SchematicNodeBase {
  kind: "title_block";
  title?: string;
  date?: string;
  rev?: string;
}

export interface SchematicWireNode extends SchematicNodeBase {
  kind: "wire";
  points: Point[];
}

export interface SchematicLabelNode extends SchematicNodeBase {
  kind: "label";
  labelKind: LabelKind;
  name: string;
  at?: Point;
  angle?: number;
}

export interface SchematicJunctionNode extends SchematicNodeBase {
  kind: "junction";
  at?: Point;
  uuid?: string;
}

export interface SchematicNoConnectNode extends SchematicNodeBase {
  kind: "no_connect";
  at?: Point;
}

export interface SchematicSheetPinNode {
  name: string;
  pinType?: string;
  at?: Point;
  angle?: number;
  uuid?: string;
}

export interface SchematicSheetNode extends SchematicNodeBase {
  kind: "sheet";
  name?: string;
  file?: string;
  at?: Point;
  size?: { width: number; height: number };
  uuid?: string;
  pins: SchematicSheetPinNode[];
}

export interface SchematicSymbolNode extends SchematicNodeBase {
  kind: "symbol";
  libraryId?: string;
  ref?: string;
  value?: string;
  footprint?: string;
  at?: Point;
  rotation?: number;
  mirror?: "x" | "y";
  uuid?: string;
  pins: SchematicPlacedPinNode[];
}

export interface SchematicOpaqueNode extends SchematicNodeBase {
  kind: "lib_symbols" | "sheet_instances" | "unknown";
}

export type SchematicNode =
  | SchematicValueNode
  | TitleBlockNode
  | SchematicWireNode
  | SchematicLabelNode
  | SchematicJunctionNode
  | SchematicNoConnectNode
  | SchematicSheetNode
  | SchematicSymbolNode
  | SchematicOpaqueNode;

export interface ParsedSchematicDocument {
  openingRaw: string;
  nodes: SchematicNode[];
  closingRaw: string;
}

export interface SchematicDocumentOptions {
  path?: string;
  symbolsPath?: string;
  library?: SymbolLibrary;
}

export interface DuplicateSymbolOptions {
  ref?: string;
  at?: Point;
  offset?: Point;
}

export interface SchematicSymbolMatch {
  node: SchematicSymbolNode;
  ref?: string;
  libraryId?: string;
  value?: string;
  footprint?: string;
  at?: Point;
  rotation?: number;
  mirror?: "x" | "y";
  uuid?: string;
}

export interface SchematicLabelMatch {
  node: SchematicLabelNode;
  name: string;
  labelKind: LabelKind;
  at?: Point;
  angle?: number;
}

export interface SchematicPinMatch {
  symbol: SchematicSymbolMatch;
  symbolRef?: string;
  symbolLibraryId?: string;
  pinId: string;
  pinName: string;
  pinType: string;
  position: Point;
  netName?: string;
  netIsPower: boolean;
  isNoConnect: boolean;
}

export interface SchematicNetMatch {
  name: string;
  isPower: boolean;
  isGlobal: boolean;
  pins: readonly SchematicPinMatch[];
  labels: readonly SchematicLabelMatch[];
  sheetPins: readonly SchematicSheetPinMatch[];
}

export interface SchematicLocatorTrace {
  kind: "symbol" | "label" | "pin" | "net" | "sheet";
  description: string;
  count: number;
  matches: readonly string[];
  detail?: string;
}

export type SchematicActionTarget =
  | { kind: "symbol"; ref: string }
  | { kind: "pin"; ref: string; pinId: string }
  | { kind: "net"; name: string };

export interface SchematicActionParameters {
  value?: string;
  footprint?: string;
  ref?: string;
  netName?: string;
  rotation?: number;
  at?: Point;
  offset?: Point;
}

export type SchematicActionName =
  | "setValue"
  | "setFootprint"
  | "move"
  | "rotate"
  | "delete"
  | "duplicate"
  | "connectTo"
  | "disconnect"
  | "markNoConnect"
  | "markDriven";

export interface SchematicActionTraceEntry {
  sequence: number;
  globalSequence: number;
  action: SchematicActionName;
  target: string;
  locator?: SchematicActionTarget;
  parameters?: SchematicActionParameters;
  before?: string;
  after?: string;
  details?: string;
}

export interface SchematicSheetPinMatch {
  node: SchematicSheetPinNode;
  name: string;
  pinType?: string;
  at?: Point;
  angle?: number;
  uuid?: string;
}

export interface SchematicSheetMatch {
  node: SchematicSheetNode;
  name?: string;
  file?: string;
  at?: Point;
  size?: { width: number; height: number };
  uuid?: string;
  pins: readonly SchematicSheetPinMatch[];
}

interface StructureSnapshot {
  symbols: SchematicSymbolMatch[];
  labels: SchematicLabelMatch[];
  wires: SchematicWireNode[];
  junctions: SchematicJunctionNode[];
  noConnects: SchematicNoConnectNode[];
  sheets: SchematicSheetMatch[];
}

interface ConnectivitySnapshot {
  pins: SchematicPinMatch[];
  nets: SchematicNetMatch[];
  unresolvedSymbols: Array<{ symbol: SchematicSymbolMatch; error: string }>;
  netByPoint: Map<string, SchematicNetMatch>;
}

let globalActionTraceSequence = 0;

type SymbolResolver = () => SchematicSymbolMatch[];
type PinResolver = () => SchematicPinMatch[];
type LabelResolver = () => SchematicLabelMatch[];
type NetResolver = () => SchematicNetMatch[];

interface SymbolLocatorActions {
  setValue(match: SchematicSymbolMatch, value: string, locatorDescription: string): SchematicSymbolMatch;
  setFootprint(match: SchematicSymbolMatch, footprint: string, locatorDescription: string): SchematicSymbolMatch;
  move(match: SchematicSymbolMatch, at: Point, locatorDescription: string): SchematicSymbolMatch;
  rotate(match: SchematicSymbolMatch, rotation: number, locatorDescription: string): SchematicSymbolMatch;
  delete(match: SchematicSymbolMatch, locatorDescription: string): void;
  duplicate(match: SchematicSymbolMatch, options: DuplicateSymbolOptions | undefined, locatorDescription: string): SchematicSymbolMatch;
}

interface PinLocatorActions {
  connectTo(match: SchematicPinMatch, netName: string, locatorDescription: string): SchematicPinMatch;
  disconnect(match: SchematicPinMatch, locatorDescription: string): SchematicPinMatch;
  markNoConnect(match: SchematicPinMatch, locatorDescription: string): SchematicPinMatch;
  markDriven(match: SchematicPinMatch, netName: string | undefined, locatorDescription: string): SchematicNetMatch;
}

interface NetLocatorActions {
  markDriven(match: SchematicNetMatch, locatorDescription: string): SchematicNetMatch;
}

type SymbolPinLocatorFactory = (
  resolveSymbols: SymbolResolver,
  pinId: string,
  description: string,
) => SchematicPinLocator;

export class SchematicLocatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchematicLocatorError";
  }
}

export class SchematicSymbolLocator {
  constructor(
    private readonly description: string,
    private readonly resolveSymbols: SymbolResolver,
    private readonly createPinLocator: SymbolPinLocatorFactory,
    private readonly notFoundDetail?: () => string | undefined,
    private readonly actions?: SymbolLocatorActions,
  ) {}

  describe(): string {
    return this.description;
  }

  trace(): SchematicLocatorTrace {
    const matches = this.resolveSymbols();
    return {
      kind: "symbol",
      description: this.description,
      count: matches.length,
      matches: matches.map(describeSymbol),
      detail: this.notFoundDetail?.(),
    };
  }

  count(): number {
    return this.resolveSymbols().length;
  }

  all(): SchematicSymbolMatch[] {
    return [...this.resolveSymbols()];
  }

  first(): SchematicSymbolMatch | undefined {
    return this.resolveSymbols()[0];
  }

  one(): SchematicSymbolMatch {
    return expectSingle("symbol", this.description, this.resolveSymbols(), describeSymbol, this.notFoundDetail);
  }

  nth(index: number): SchematicSymbolLocator {
    return new SchematicSymbolLocator(
      `${this.description}.nth(${index})`,
      () => nthItem(this.resolveSymbols(), index),
      this.createPinLocator,
      this.notFoundDetail,
      this.actions,
    );
  }

  filter(
    predicate: (symbol: SchematicSymbolMatch) => boolean,
    description: string = "custom filter",
  ): SchematicSymbolLocator {
    return new SchematicSymbolLocator(
      `${this.description}.filter(${description})`,
      () => this.resolveSymbols().filter(predicate),
      this.createPinLocator,
      this.notFoundDetail,
      this.actions,
    );
  }

  pin(pinId: string): SchematicPinLocator {
    return this.createPinLocator(this.resolveSymbols, pinId, `pin "${pinId}" within ${this.description}`);
  }

  setValue(value: string): SchematicSymbolMatch {
    if (!this.actions) throw new SchematicLocatorError(`setValue is not available for ${this.description}.`);
    return this.actions.setValue(this.one(), value, this.description);
  }

  setFootprint(footprint: string): SchematicSymbolMatch {
    if (!this.actions) throw new SchematicLocatorError(`setFootprint is not available for ${this.description}.`);
    return this.actions.setFootprint(this.one(), footprint, this.description);
  }

  move(at: Point): SchematicSymbolMatch {
    if (!this.actions) throw new SchematicLocatorError(`move is not available for ${this.description}.`);
    return this.actions.move(this.one(), at, this.description);
  }

  rotate(rotation: number): SchematicSymbolMatch {
    if (!this.actions) throw new SchematicLocatorError(`rotate is not available for ${this.description}.`);
    return this.actions.rotate(this.one(), rotation, this.description);
  }

  delete(): void {
    if (!this.actions) throw new SchematicLocatorError(`delete is not available for ${this.description}.`);
    this.actions.delete(this.one(), this.description);
  }

  duplicate(options?: DuplicateSymbolOptions): SchematicSymbolMatch {
    if (!this.actions) throw new SchematicLocatorError(`duplicate is not available for ${this.description}.`);
    return this.actions.duplicate(this.one(), options, this.description);
  }
}

export class SchematicLabelLocator {
  constructor(
    private readonly description: string,
    private readonly resolveLabels: LabelResolver,
    private readonly notFoundDetail?: () => string | undefined,
  ) {}

  describe(): string {
    return this.description;
  }

  trace(): SchematicLocatorTrace {
    const matches = this.resolveLabels();
    return {
      kind: "label",
      description: this.description,
      count: matches.length,
      matches: matches.map(describeLabel),
      detail: this.notFoundDetail?.(),
    };
  }

  count(): number {
    return this.resolveLabels().length;
  }

  all(): SchematicLabelMatch[] {
    return [...this.resolveLabels()];
  }

  first(): SchematicLabelMatch | undefined {
    return this.resolveLabels()[0];
  }

  one(): SchematicLabelMatch {
    return expectSingle("label", this.description, this.resolveLabels(), describeLabel, this.notFoundDetail);
  }

  nth(index: number): SchematicLabelLocator {
    return new SchematicLabelLocator(
      `${this.description}.nth(${index})`,
      () => nthItem(this.resolveLabels(), index),
      this.notFoundDetail,
    );
  }

  filter(
    predicate: (label: SchematicLabelMatch) => boolean,
    description: string = "custom filter",
  ): SchematicLabelLocator {
    return new SchematicLabelLocator(
      `${this.description}.filter(${description})`,
      () => this.resolveLabels().filter(predicate),
      this.notFoundDetail,
    );
  }
}

export class SchematicPinLocator {
  constructor(
    private readonly description: string,
    private readonly resolvePins: PinResolver,
    private readonly notFoundDetail?: () => string | undefined,
    private readonly actions?: PinLocatorActions,
  ) {}

  describe(): string {
    return this.description;
  }

  trace(): SchematicLocatorTrace {
    const matches = this.resolvePins();
    return {
      kind: "pin",
      description: this.description,
      count: matches.length,
      matches: matches.map(describePin),
      detail: this.notFoundDetail?.(),
    };
  }

  count(): number {
    return this.resolvePins().length;
  }

  all(): SchematicPinMatch[] {
    return [...this.resolvePins()];
  }

  first(): SchematicPinMatch | undefined {
    return this.resolvePins()[0];
  }

  one(): SchematicPinMatch {
    return expectSingle("pin", this.description, this.resolvePins(), describePin, this.notFoundDetail);
  }

  nth(index: number): SchematicPinLocator {
    return new SchematicPinLocator(
      `${this.description}.nth(${index})`,
      () => nthItem(this.resolvePins(), index),
      this.notFoundDetail,
      this.actions,
    );
  }

  filter(
    predicate: (pin: SchematicPinMatch) => boolean,
    description: string = "custom filter",
  ): SchematicPinLocator {
    return new SchematicPinLocator(
      `${this.description}.filter(${description})`,
      () => this.resolvePins().filter(predicate),
      this.notFoundDetail,
      this.actions,
    );
  }

  connectTo(netName: string): SchematicPinMatch {
    if (!this.actions) throw new SchematicLocatorError(`connectTo is not available for ${this.description}.`);
    return this.actions.connectTo(this.one(), netName, this.description);
  }

  disconnect(): SchematicPinMatch {
    if (!this.actions) throw new SchematicLocatorError(`disconnect is not available for ${this.description}.`);
    return this.actions.disconnect(this.one(), this.description);
  }

  markNoConnect(): SchematicPinMatch {
    if (!this.actions) throw new SchematicLocatorError(`markNoConnect is not available for ${this.description}.`);
    return this.actions.markNoConnect(this.one(), this.description);
  }

  markDriven(netName?: string): SchematicNetMatch {
    if (!this.actions) throw new SchematicLocatorError(`markDriven is not available for ${this.description}.`);
    return this.actions.markDriven(this.one(), netName, this.description);
  }
}

export class SchematicNetLocator {
  constructor(
    private readonly description: string,
    private readonly resolveNets: NetResolver,
    private readonly notFoundDetail?: () => string | undefined,
    private readonly actions?: NetLocatorActions,
  ) {}

  describe(): string {
    return this.description;
  }

  trace(): SchematicLocatorTrace {
    const matches = this.resolveNets();
    return {
      kind: "net",
      description: this.description,
      count: matches.length,
      matches: matches.map(describeNet),
      detail: this.notFoundDetail?.(),
    };
  }

  count(): number {
    return this.resolveNets().length;
  }

  all(): SchematicNetMatch[] {
    return [...this.resolveNets()];
  }

  first(): SchematicNetMatch | undefined {
    return this.resolveNets()[0];
  }

  one(): SchematicNetMatch {
    return expectSingle("net", this.description, this.resolveNets(), describeNet, this.notFoundDetail);
  }

  nth(index: number): SchematicNetLocator {
    return new SchematicNetLocator(
      `${this.description}.nth(${index})`,
      () => nthItem(this.resolveNets(), index),
      this.notFoundDetail,
      this.actions,
    );
  }

  filter(
    predicate: (net: SchematicNetMatch) => boolean,
    description: string = "custom filter",
  ): SchematicNetLocator {
    return new SchematicNetLocator(
      `${this.description}.filter(${description})`,
      () => this.resolveNets().filter(predicate),
      this.notFoundDetail,
      this.actions,
    );
  }

  markDriven(): SchematicNetMatch {
    if (!this.actions) throw new SchematicLocatorError(`markDriven is not available for ${this.description}.`);
    return this.actions.markDriven(this.one(), this.description);
  }
}

export class SchematicDocument {
  private sourcePath?: string;
  private symbolsPath?: string;
  private symbolLibrary?: SymbolLibrary;
  private originalText: string;
  private openingRaw: string;
  private nodesInternal: SchematicNode[];
  private closingRaw: string;
  private dirty = false;
  private revision = 0;
  private structureSnapshotVersion = -1;
  private structureSnapshot?: StructureSnapshot;
  private connectivitySnapshotVersion = -1;
  private connectivitySnapshot?: ConnectivitySnapshot;
  private actionTrace: SchematicActionTraceEntry[] = [];
  private actionTraceSequence = 0;

  private readonly symbolLocatorActions: SymbolLocatorActions = {
    setValue: (match, value, locatorDescription) => this.setSymbolValue(match, value, locatorDescription),
    setFootprint: (match, footprint, locatorDescription) => this.setSymbolFootprint(match, footprint, locatorDescription),
    move: (match, at, locatorDescription) => this.moveSymbol(match, at, locatorDescription),
    rotate: (match, rotation, locatorDescription) => this.rotateSymbol(match, rotation, locatorDescription),
    delete: (match, locatorDescription) => this.deleteSymbol(match, locatorDescription),
    duplicate: (match, options, locatorDescription) => this.duplicateSymbol(match, options, locatorDescription),
  };

  private readonly pinLocatorActions: PinLocatorActions = {
    connectTo: (match, netName, locatorDescription) => this.connectPinToNet(match, netName, locatorDescription),
    disconnect: (match, locatorDescription) => this.disconnectPin(match, locatorDescription),
    markNoConnect: (match, locatorDescription) => this.markPinNoConnect(match, locatorDescription),
    markDriven: (match, netName, locatorDescription) => this.markPinDriven(match, netName, locatorDescription),
  };

  private readonly netLocatorActions: NetLocatorActions = {
    markDriven: (match, locatorDescription) => this.markNetDriven(match, locatorDescription),
  };

  private constructor(parsed: ParsedSchematicDocument, originalText: string, options: SchematicDocumentOptions = {}) {
    this.sourcePath = options.path;
    this.symbolsPath = options.symbolsPath;
    this.symbolLibrary = options.library;
    this.originalText = originalText;
    this.openingRaw = parsed.openingRaw;
    this.nodesInternal = parsed.nodes;
    this.closingRaw = parsed.closingRaw;
  }

  static open(path: string, options: Omit<SchematicDocumentOptions, "path"> = {}): SchematicDocument {
    const text = readFileSync(path, "utf-8");
    return new SchematicDocument(parseSchematicDocument(text), text, { ...options, path });
  }

  static parse(text: string, options: Omit<SchematicDocumentOptions, "path"> = {}): SchematicDocument {
    return new SchematicDocument(parseSchematicDocument(text), text, options);
  }

  get path(): string | undefined {
    return this.sourcePath;
  }

  describe(): string {
    return this.sourcePath ? `document "${this.sourcePath}"` : "in-memory document";
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  get nodes(): readonly SchematicNode[] {
    return this.nodesInternal;
  }

  getSymbols(): readonly SchematicSymbolMatch[] {
    return this.getStructureSnapshot().symbols;
  }

  getSheets(): readonly SchematicSheetMatch[] {
    return this.getStructureSnapshot().sheets;
  }

  getLabels(): readonly SchematicLabelMatch[] {
    return this.getStructureSnapshot().labels;
  }

  getNets(): readonly SchematicNetMatch[] {
    return this.getConnectivitySnapshot().nets;
  }

  getActionTrace(): readonly SchematicActionTraceEntry[] {
    return this.actionTrace;
  }

  clearActionTrace(): void {
    this.actionTrace = [];
    this.actionTraceSequence = 0;
  }

  findNetAtPoint(point: Point): SchematicNetMatch | undefined {
    return this.getConnectivitySnapshot().netByPoint.get(pointKey(point));
  }

  get titleBlock(): { title?: string; date?: string; rev?: string } {
    const node = this.nodesInternal.find((candidate): candidate is TitleBlockNode => candidate.kind === "title_block");
    if (!node) return {};
    return { title: node.title, date: node.date, rev: node.rev };
  }

  reload(): void {
    if (!this.sourcePath) {
      throw new Error("Cannot reload a document without a source path.");
    }
    const text = readFileSync(this.sourcePath, "utf-8");
    this.hydrate(parseSchematicDocument(text), text);
  }

  setTitle(title?: string): void {
    const node = this.getOrCreateTitleBlock();
    if (node.title === title) return;
    node.title = title;
    this.markDirty(node);
  }

  setDate(date?: string): void {
    const node = this.getOrCreateTitleBlock();
    if (node.date === date) return;
    node.date = date;
    this.markDirty(node);
  }

  setRevision(rev?: string): void {
    const node = this.getOrCreateTitleBlock();
    if (node.rev === rev) return;
    node.rev = rev;
    this.markDirty(node);
  }

  getByRef(ref: string): SchematicSymbolLocator {
    return new SchematicSymbolLocator(
      `ref "${ref}"`,
      () => this.getStructureSnapshot().symbols.filter(symbol => symbol.ref === ref),
      this.createSymbolPinLocator,
      () => listAvailable("Available refs", this.getStructureSnapshot().symbols.map(symbol => symbol.ref).filter(isNonEmptyString)),
      this.symbolLocatorActions,
    );
  }

  getByLibraryId(libraryId: string): SchematicSymbolLocator {
    return new SchematicSymbolLocator(
      `library ID "${libraryId}"`,
      () => this.getStructureSnapshot().symbols.filter(symbol => symbol.libraryId === libraryId),
      this.createSymbolPinLocator,
      () => listAvailable(
        "Available library IDs",
        this.getStructureSnapshot().symbols.map(symbol => symbol.libraryId).filter(isNonEmptyString),
      ),
      this.symbolLocatorActions,
    );
  }

  getByValue(value: string): SchematicSymbolLocator {
    return new SchematicSymbolLocator(
      `value "${value}"`,
      () => this.getStructureSnapshot().symbols.filter(symbol => symbol.value === value),
      this.createSymbolPinLocator,
      () => listAvailable(
        "Available values",
        this.getStructureSnapshot().symbols.map(symbol => symbol.value).filter(isNonEmptyString),
      ),
      this.symbolLocatorActions,
    );
  }

  getByFootprint(footprint: string): SchematicSymbolLocator {
    return new SchematicSymbolLocator(
      `footprint "${footprint}"`,
      () => this.getStructureSnapshot().symbols.filter(symbol => symbol.footprint === footprint),
      this.createSymbolPinLocator,
      () => listAvailable(
        "Available footprints",
        this.getStructureSnapshot().symbols.map(symbol => symbol.footprint).filter(isNonEmptyString),
      ),
      this.symbolLocatorActions,
    );
  }

  getByLabel(name: string): SchematicLabelLocator {
    return new SchematicLabelLocator(
      `label "${name}"`,
      () => this.getStructureSnapshot().labels.filter(label => label.name === name),
      () => listAvailable(
        "Available labels",
        this.getStructureSnapshot().labels.map(label => label.name).filter(isNonEmptyString),
      ),
    );
  }

  getByNet(name: string): SchematicNetLocator {
    return new SchematicNetLocator(
      `net "${name}"`,
      () => this.getConnectivitySnapshot().nets.filter(net => net.name === name),
      () => {
        const details = [
          listAvailable("Available named nets", this.getConnectivitySnapshot().nets.map(net => net.name)),
          this.describeUnresolvedSymbols(),
        ].filter(isNonEmptyString);
        return details.length > 0 ? details.join("\n") : undefined;
      },
      this.netLocatorActions,
    );
  }

  pin(ref: string, pinId: string): SchematicPinLocator {
    return new SchematicPinLocator(
      `pin "${pinId}" on ref "${ref}"`,
      () => this.getConnectivitySnapshot().pins.filter(pin => pin.symbolRef === ref && pin.pinId === pinId),
      () => this.describePinLookupFailure(ref, pinId),
      this.pinLocatorActions,
    );
  }

  save(): string {
    if (!this.sourcePath) {
      throw new Error("Cannot save a document without a source path. Use saveAs(path) instead.");
    }
    const text = this.toString();
    writeFileSync(this.sourcePath, text, "utf-8");
    this.originalText = text;
    this.clearDirtyState();
    return this.sourcePath;
  }

  saveAs(path: string): string {
    const text = this.toString();
    writeFileSync(path, text, "utf-8");
    this.sourcePath = path;
    this.originalText = text;
    this.clearDirtyState();
    return path;
  }

  snapshotText(): string {
    return this.toString();
  }

  snapshotSvg(outPath: string): string {
    const svgTempDir = mkdtempSync(join(tmpdir(), "schematic-agent-svg-"));
    try {
      return this.withPersistedSchematic(path => {
        exportSvg(path, svgTempDir);
        const emittedPath = findFirstSvgFile(svgTempDir);
        if (!emittedPath) {
          throw new Error(`SVG export did not produce an SVG file in ${svgTempDir}.`);
        }
        mkdirSync(dirname(outPath), { recursive: true });
        rmSync(outPath, { recursive: true, force: true });
        copyFileSync(emittedPath, outPath);
        return outPath;
      });
    } finally {
      rmSync(svgTempDir, { recursive: true, force: true });
    }
  }

  runErc(): ErcResult {
    return this.withPersistedSchematic(path => runErc(path));
  }

  expectErcClean(): ErcResult {
    const result = this.runErc();
    if (result.errors.length > 0) {
      throw new SchematicAssertionError({
        code: "erc.has_errors",
        target: `${this.describe()} ERC`,
        expected: "have no ERC errors",
        actual: `found ${result.errors.length} error(s)`,
        details: result.errors.slice(0, 3).map(error => error.message).join("\n"),
      });
    }
    return result;
  }

  toString(): string {
    if (!this.dirty) return this.originalText;

    const body = this.nodesInternal
      .map(node => node.leadingTrivia + serializeNode(node))
      .join("");
    return `${this.openingRaw}${body}${this.closingRaw}`;
  }

  private withPersistedSchematic<T>(callback: (path: string) => T): T {
    const tempDir = mkdtempSync(join(tmpdir(), "schematic-agent-"));
    const filename = this.sourcePath ? basename(this.sourcePath) : "document.kicad_sch";
    const tempPath = join(tempDir, filename.endsWith(".kicad_sch") ? filename : `${filename}.kicad_sch`);
    writeFileSync(tempPath, this.toString(), "utf-8");
    try {
      return callback(tempPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private setSymbolValue(match: SchematicSymbolMatch, value: string, locatorDescription: string): SchematicSymbolMatch {
    return this.runTransaction(() => {
      const node = this.requireSymbolNode(match);
      const raw = updateSymbolPropertyValueRaw(node.raw, "Value", value, node.at, node.rotation ?? 0, false);
      const updated = replaceSymbolRaw(node, raw);
      this.replaceNode(node, updated);
      const result = this.getByRef(updated.ref ?? match.ref ?? "").one();
      this.recordAction(
        "setValue",
        locatorDescription,
        symbolActionTarget(match),
        { value },
        describeSymbol(match),
        describeSymbol(result),
        `value -> ${formatTraceString(value)}`,
      );
      return result;
    });
  }

  private setSymbolFootprint(match: SchematicSymbolMatch, footprint: string, locatorDescription: string): SchematicSymbolMatch {
    return this.runTransaction(() => {
      const node = this.requireSymbolNode(match);
      const raw = updateSymbolPropertyValueRaw(node.raw, "Footprint", footprint, node.at, node.rotation ?? 0, true);
      const updated = replaceSymbolRaw(node, raw);
      this.replaceNode(node, updated);
      const result = this.getByRef(updated.ref ?? match.ref ?? "").one();
      this.recordAction(
        "setFootprint",
        locatorDescription,
        symbolActionTarget(match),
        { footprint },
        describeSymbol(match),
        describeSymbol(result),
        `footprint -> ${formatTraceString(footprint)}`,
      );
      return result;
    });
  }

  private moveSymbol(match: SchematicSymbolMatch, at: Point, locatorDescription: string): SchematicSymbolMatch {
    return this.runTransaction(() => {
      const node = this.requireSymbolNode(match);
      const oldPins = this.getPinPositionsForSymbol(node);
      const delta = {
        x: roundPoint(at.x - (node.at?.x ?? 0)),
        y: roundPoint(at.y - (node.at?.y ?? 0)),
      };

      const movedRaw = moveSymbolRaw(node.raw, at, delta);
      const updated = replaceSymbolRaw(node, movedRaw);
      this.replaceNode(node, updated);

      const newPins = this.getPinPositionsForSymbol(updated);
      this.retargetAttachments(oldPins, newPins);
      const result = this.getByRef(updated.ref ?? match.ref ?? "").one();
      this.recordAction(
        "move",
        locatorDescription,
        symbolActionTarget(match),
        { at },
        describeSymbol(match),
        describeSymbol(result),
        `at -> (${at.x}, ${at.y})`,
      );
      return result;
    });
  }

  private rotateSymbol(match: SchematicSymbolMatch, rotation: number, locatorDescription: string): SchematicSymbolMatch {
    return this.runTransaction(() => {
      if (![0, 90, 180, 270].includes(rotation)) {
        throw new Error(`Invalid rotation: ${rotation}. Must be 0, 90, 180, or 270.`);
      }

      const node = this.requireSymbolNode(match);
      const oldPins = this.getPinPositionsForSymbol(node);
      const oldRotation = node.rotation ?? 0;
      const deltaRotation = normalizeRotation(rotation - oldRotation);

      const rotatedRaw = rotateSymbolRaw(node.raw, node.at ?? { x: 0, y: 0 }, rotation, deltaRotation);
      const updated = replaceSymbolRaw(node, rotatedRaw);
      this.replaceNode(node, updated);

      const newPins = this.getPinPositionsForSymbol(updated);
      this.retargetAttachments(oldPins, newPins);
      const result = this.getByRef(updated.ref ?? match.ref ?? "").one();
      this.recordAction(
        "rotate",
        locatorDescription,
        symbolActionTarget(match),
        { rotation },
        describeSymbol(match),
        describeSymbol(result),
        `rotation -> ${rotation}`,
      );
      return result;
    });
  }

  private deleteSymbol(match: SchematicSymbolMatch, locatorDescription: string): void {
    this.runTransaction(() => {
      const node = this.requireSymbolNode(match);
      const pinKeys = [...this.getPinPositionsForSymbol(node).values()].map(pointKey);

      this.nodesInternal = this.nodesInternal.filter(candidate => {
        if (candidate === node) return false;
        if (candidate.kind === "no_connect" && candidate.at && pinKeys.includes(pointKey(candidate.at))) {
          return false;
        }
        return true;
      });
      this.touch();
      this.recordAction(
        "delete",
        locatorDescription,
        symbolActionTarget(match),
        undefined,
        describeSymbol(match),
        undefined,
      );
    });
  }

  private duplicateSymbol(
    match: SchematicSymbolMatch,
    options: DuplicateSymbolOptions = {},
    locatorDescription: string,
  ): SchematicSymbolMatch {
    return this.runTransaction(() => {
      const node = this.requireSymbolNode(match);
      const targetAt = options.at ?? (
        options.offset && node.at
          ? { x: roundPoint(node.at.x + options.offset.x), y: roundPoint(node.at.y + options.offset.y) }
          : node.at
      );
      const ref = options.ref ?? this.nextReferenceFor(node.ref);

      if (!targetAt) {
        throw new Error(`Cannot duplicate ${describeSymbol(match)} because it has no position.`);
      }

      if (this.getStructureSnapshot().symbols.some(symbol => symbol.ref === ref)) {
        throw new Error(`Duplicate ref "${ref}" already exists.`);
      }

      let raw = cloneSymbolRaw(node.raw);
      raw = setRootUuidRaw(raw, generateUuid());
      raw = setPlacedPinUuidsRaw(raw);
      raw = setSymbolReferenceRaw(raw, ref);
      raw = setInstancesReferenceRaw(raw, ref);
      raw = moveSymbolRaw(raw, targetAt, {
        x: roundPoint(targetAt.x - (node.at?.x ?? 0)),
        y: roundPoint(targetAt.y - (node.at?.y ?? 0)),
      });

      const duplicate = replaceSymbolRaw(node, raw, { start: -1, end: -1 });
      duplicate.leadingTrivia = node.leadingTrivia;
      this.insertNodeAfter(node, duplicate);
      const result = this.getByRef(ref).one();
      this.recordAction(
        "duplicate",
        locatorDescription,
        symbolActionTarget(match),
        { ref: result.ref, at: result.at, offset: options.offset },
        describeSymbol(match),
        describeSymbol(result),
        describeDuplicateOptions(options, result),
      );
      return result;
    });
  }

  private connectPinToNet(match: SchematicPinMatch, netName: string, locatorDescription: string): SchematicPinMatch {
    return this.runTransaction(() => {
      if (!netName || !netName.trim()) {
        throw new Error("connectTo(netName) requires a non-empty net name.");
      }

      const current = this.requirePinMatch(match);
      if (current.netName && current.netName !== netName && !current.netName.startsWith("NET_")) {
        throw new Error(
          `Pin ${describePin(current)} is already connected to named net "${current.netName}". Disconnect it before connecting to "${netName}".`,
        );
      }

      this.removeNoConnectAt(current.position);
      if (current.netName === netName) {
        const result = this.pin(current.symbolRef ?? "", current.pinId).one();
        this.recordAction(
          "connectTo",
          locatorDescription,
          pinActionTarget(current),
          { netName },
          describePin(current),
          describePin(result),
          `net already ${formatTraceString(netName)}`,
        );
        return result;
      }

      this.ensureLabelAt(current.position, netName);
      const result = this.pin(current.symbolRef ?? "", current.pinId).one();
      this.recordAction(
        "connectTo",
        locatorDescription,
        pinActionTarget(current),
        { netName },
        describePin(current),
        describePin(result),
        `net -> ${formatTraceString(netName)}`,
      );
      return result;
    });
  }

  private disconnectPin(match: SchematicPinMatch, locatorDescription: string): SchematicPinMatch {
    return this.runTransaction(() => {
      const current = this.requirePinMatch(match);
      const key = pointKey(current.position);

      this.nodesInternal = this.nodesInternal.filter(node => {
        if (node.kind === "label" && node.at && pointKey(node.at) === key) return false;
        if (node.kind === "no_connect" && node.at && pointKey(node.at) === key) return false;
        if (node.kind === "wire" && wireTouchesPoint(node, current.position)) return false;
        if (node.kind === "symbol" && isInfrastructureRef(node.ref)) {
          const pins = this.getPinPositionsForSymbol(node);
          return ![...pins.values()].some(point => pointKey(point) === key);
        }
        return true;
      });

      this.touch();
      const result = this.pin(current.symbolRef ?? "", current.pinId).one();
      this.recordAction(
        "disconnect",
        locatorDescription,
        pinActionTarget(current),
        undefined,
        describePin(current),
        describePin(result),
      );
      return result;
    });
  }

  private markPinNoConnect(match: SchematicPinMatch, locatorDescription: string): SchematicPinMatch {
    return this.runTransaction(() => {
      const current = this.requirePinMatch(match);
      if (current.netName) {
        throw new Error(`Pin ${describePin(current)} is connected and cannot be marked no-connect.`);
      }
      this.ensureNoConnectAt(current.position);
      const result = this.pin(current.symbolRef ?? "", current.pinId).one();
      this.recordAction(
        "markNoConnect",
        locatorDescription,
        pinActionTarget(current),
        undefined,
        describePin(current),
        describePin(result),
      );
      return result;
    });
  }

  private markPinDriven(match: SchematicPinMatch, netName: string | undefined, locatorDescription: string): SchematicNetMatch {
    return this.runTransaction(() => {
      const current = this.requirePinMatch(match);
      const targetNet = netName ?? current.netName;
      if (!targetNet || targetNet.startsWith("NET_")) {
        throw new Error(`Pin ${describePin(current)} is not on a named net and cannot be marked driven.`);
      }
      if (!current.netName) {
        this.ensureLabelAt(current.position, targetNet);
      }
      const result = this.markNetDrivenByName(targetNet);
      this.recordAction(
        "markDriven",
        locatorDescription,
        pinActionTarget(current),
        { netName: targetNet },
        describePin(current),
        describeNet(result),
        `net -> ${formatTraceString(targetNet)}`,
      );
      return result;
    });
  }

  private markNetDriven(match: SchematicNetMatch, locatorDescription: string): SchematicNetMatch {
    return this.runTransaction(() => {
      const result = this.markNetDrivenByName(match.name);
      this.recordAction(
        "markDriven",
        locatorDescription,
        netActionTarget(match),
        { netName: match.name },
        describeNet(match),
        describeNet(result),
        `net -> ${formatTraceString(match.name)}`,
      );
      return result;
    });
  }

  private markNetDrivenByName(netName: string): SchematicNetMatch {
    if (!netName || netName.startsWith("NET_")) {
      throw new Error(`Cannot mark unnamed net "${netName}" driven. Name the net first.`);
    }
    const existing = this.getByNet(netName).one();
    if (existing.isPower) {
      return existing;
    }

    this.ensureLibrarySymbolLoaded("power:PWR_FLAG");

    const flagRef = this.nextInfrastructureReference("#FLG");
    const anchor = this.pickFlagPlacement(netName);
    this.ensureLabelAt(anchor, netName);
    const flagNode = createNodeFromRaw(
      buildPowerFlagRaw(flagRef, "PWR_FLAG", anchor, this.documentProjectName()),
      "\n\t",
    );

    this.insertNodeBeforeSheets(flagNode);
    this.touch();
    return this.getByNet(netName).one();
  }

  private readonly createSymbolPinLocator: SymbolPinLocatorFactory = (
    resolveSymbols,
    pinId,
    description,
  ) => new SchematicPinLocator(
    description,
    () => {
      const refs = new Set(resolveSymbols().map(symbol => symbol.ref).filter(isNonEmptyString));
      return this.getConnectivitySnapshot().pins.filter(
        pin => isNonEmptyString(pin.symbolRef) && refs.has(pin.symbolRef) && pin.pinId === pinId,
      );
    },
    () => this.describeSymbolPinLookupFailure(resolveSymbols()),
    this.pinLocatorActions,
  );

  private hydrate(parsed: ParsedSchematicDocument, originalText: string): void {
    this.originalText = originalText;
    this.openingRaw = parsed.openingRaw;
    this.nodesInternal = parsed.nodes;
    this.closingRaw = parsed.closingRaw;
    this.dirty = false;
    this.revision++;
    this.invalidateSnapshots();
  }

  private getOrCreateTitleBlock(): TitleBlockNode {
    const existing = this.nodesInternal.find((node): node is TitleBlockNode => node.kind === "title_block");
    if (existing) return existing;

    const insertAfterKinds: SchematicNodeKind[] = ["paper", "uuid", "generator_version", "generator", "version"];
    let insertAt = 0;
    for (let index = 0; index < this.nodesInternal.length; index++) {
      if (insertAfterKinds.includes(this.nodesInternal[index].kind)) {
        insertAt = index + 1;
      }
    }

    const newNode: TitleBlockNode = {
      kind: "title_block",
      title: undefined,
      date: undefined,
      rev: undefined,
      leadingTrivia: "\n\t",
      raw: "(title_block\n\t)",
      range: { start: -1, end: -1 },
      dirty: true,
    };
    this.nodesInternal.splice(insertAt, 0, newNode);
    this.touch();
    return newNode;
  }

  private markDirty(node: SchematicNode): void {
    if (node.dirty && this.dirty) return;
    node.dirty = true;
    this.touch();
  }

  private touch(): void {
    this.dirty = true;
    this.revision++;
    this.invalidateSnapshots();
  }

  private clearDirtyState(): void {
    this.dirty = false;
    for (const node of this.nodesInternal) {
      node.raw = serializeNode(node);
      node.dirty = false;
    }
  }

  private recordAction(
    action: SchematicActionName,
    target: string,
    locator?: SchematicActionTarget,
    parameters?: SchematicActionParameters,
    before?: string,
    after?: string,
    details?: string,
  ): void {
    this.actionTraceSequence += 1;
    this.actionTrace.push({
      sequence: this.actionTraceSequence,
      globalSequence: ++globalActionTraceSequence,
      action,
      target,
      locator,
      parameters,
      before,
      after,
      details,
    });
  }

  private invalidateSnapshots(): void {
    this.structureSnapshot = undefined;
    this.connectivitySnapshot = undefined;
    this.structureSnapshotVersion = -1;
    this.connectivitySnapshotVersion = -1;
  }

  private getStructureSnapshot(): StructureSnapshot {
    if (this.structureSnapshot && this.structureSnapshotVersion === this.revision) {
      return this.structureSnapshot;
    }

    const symbols = this.nodesInternal
      .filter((node): node is SchematicSymbolNode => node.kind === "symbol")
      .map(node => ({
        node,
        ref: node.ref,
        libraryId: node.libraryId,
        value: node.value,
        footprint: node.footprint,
        at: node.at,
        rotation: node.rotation,
        mirror: node.mirror,
        uuid: node.uuid,
      }));

    const labels = this.nodesInternal
      .filter((node): node is SchematicLabelNode => node.kind === "label")
      .map(node => ({
        node,
        name: node.name,
        labelKind: node.labelKind,
        at: node.at,
        angle: node.angle,
      }));

    const wires = this.nodesInternal.filter((node): node is SchematicWireNode => node.kind === "wire");
    const junctions = this.nodesInternal.filter((node): node is SchematicJunctionNode => node.kind === "junction");
    const noConnects = this.nodesInternal.filter((node): node is SchematicNoConnectNode => node.kind === "no_connect");
    const sheets = this.nodesInternal
      .filter((node): node is SchematicSheetNode => node.kind === "sheet")
      .map(node => ({
        node,
        name: node.name,
        file: node.file,
        at: node.at,
        size: node.size,
        uuid: node.uuid,
        pins: node.pins.map(pin => ({
          node: pin,
          name: pin.name,
          pinType: pin.pinType,
          at: pin.at,
          angle: pin.angle,
          uuid: pin.uuid,
        })),
      }));

    this.structureSnapshot = { symbols, labels, wires, junctions, noConnects, sheets };
    this.structureSnapshotVersion = this.revision;
    return this.structureSnapshot;
  }

  private getConnectivitySnapshot(): ConnectivitySnapshot {
    if (this.connectivitySnapshot && this.connectivitySnapshotVersion === this.revision) {
      return this.connectivitySnapshot;
    }

    const snapshot = buildConnectivitySnapshot(this.getStructureSnapshot(), this.getSymbolLibrary());
    this.connectivitySnapshot = snapshot;
    this.connectivitySnapshotVersion = this.revision;
    return snapshot;
  }

  private getSymbolLibrary(): SymbolLibrary {
    if (!this.symbolLibrary) {
      this.symbolLibrary = new SymbolLibrary(this.symbolsPath);
    }
    return this.symbolLibrary;
  }

  private describePinLookupFailure(ref: string, pinId: string): string | undefined {
    const structure = this.getStructureSnapshot();
    const symbol = structure.symbols.find(candidate => candidate.ref === ref);
    if (!symbol) {
      return listAvailable("Available refs", structure.symbols.map(candidate => candidate.ref).filter(isNonEmptyString));
    }

    const connectivity = this.getConnectivitySnapshot();
    const unresolved = connectivity.unresolvedSymbols.find(candidate => candidate.symbol.ref === ref);
    if (unresolved) {
      return `Cannot resolve pins for ref "${ref}" because ${describeSymbol(symbol)} failed to load: ${unresolved.error}`;
    }

    const availablePins = connectivity.pins
      .filter(pin => pin.symbolRef === ref)
      .map(pin => pin.pinId);
    if (availablePins.length > 0) {
      return `No pin "${pinId}" exists on ref "${ref}". Available pins: ${uniqueStrings(availablePins).join(", ")}`;
    }

    return `Ref "${ref}" has no resolved pins in the current document for pin "${pinId}" lookup.`;
  }

  private describeSymbolPinLookupFailure(symbols: SchematicSymbolMatch[]): string | undefined {
    if (symbols.length === 0) return undefined;

    const refs = symbols.map(symbol => symbol.ref).filter(isNonEmptyString);
    const connectivity = this.getConnectivitySnapshot();
    const unresolved = connectivity.unresolvedSymbols.filter(
      candidate => isNonEmptyString(candidate.symbol.ref) && refs.includes(candidate.symbol.ref),
    );

    const details: string[] = [];
    if (unresolved.length > 0) {
      details.push(
        unresolved
          .map(candidate => `${describeSymbol(candidate.symbol)} failed to load: ${candidate.error}`)
          .join("\n"),
      );
    }

    const pinLists = symbols.map(symbol => {
      const symbolRef = symbol.ref ?? "<unknown ref>";
      const pins = connectivity.pins
        .filter(pin => pin.symbolRef === symbol.ref)
        .map(pin => pin.pinId);
      return pins.length > 0
        ? `${symbolRef}: ${uniqueStrings(pins).join(", ")}`
        : `${symbolRef}: no resolved pins`;
    });

    if (pinLists.length > 0) {
      details.push(`Available pins on matching symbols:\n${pinLists.join("\n")}`);
    }

    return details.length > 0 ? details.join("\n") : undefined;
  }

  private describeUnresolvedSymbols(): string | undefined {
    const unresolved = this.getConnectivitySnapshot().unresolvedSymbols;
    if (unresolved.length === 0) return undefined;
    const lines = unresolved
      .slice(0, 5)
      .map(candidate => `${describeSymbol(candidate.symbol)} failed to load: ${candidate.error}`);
    const suffix = unresolved.length > 5 ? `\n...and ${unresolved.length - 5} more` : "";
    return `Unresolved symbol definitions:\n${lines.join("\n")}${suffix}`;
  }

  private runTransaction<T>(operation: () => T): T {
    const checkpoint = {
      text: this.toString(),
      originalText: this.originalText,
      dirty: this.dirty,
      path: this.sourcePath,
      symbolsPath: this.symbolsPath,
      library: this.symbolLibrary,
    };

    try {
      return operation();
    } catch (error) {
      const parsed = parseSchematicDocument(checkpoint.text);
      this.openingRaw = parsed.openingRaw;
      this.nodesInternal = parsed.nodes;
      this.closingRaw = parsed.closingRaw;
      this.originalText = checkpoint.originalText;
      this.dirty = checkpoint.dirty;
      this.sourcePath = checkpoint.path;
      this.symbolsPath = checkpoint.symbolsPath;
      this.symbolLibrary = checkpoint.library;
      this.revision++;
      this.invalidateSnapshots();
      throw error;
    }
  }

  private requireSymbolNode(match: SchematicSymbolMatch): SchematicSymbolNode {
    if (match.node.kind !== "symbol") {
      throw new Error(`Expected a symbol node, got "${match.node.kind}".`);
    }
    return match.node;
  }

  private requirePinMatch(match: SchematicPinMatch): SchematicPinMatch {
    if (!match.symbolRef) {
      throw new Error("Pin action requires a symbol reference.");
    }
    return this.pin(match.symbolRef, match.pinId).one();
  }

  private replaceNode(oldNode: SchematicNode, newNode: SchematicNode): void {
    const index = this.nodesInternal.indexOf(oldNode);
    if (index < 0) {
      throw new Error("Failed to locate node for replacement.");
    }
    this.nodesInternal[index] = newNode;
    this.touch();
  }

  private insertNodeAfter(anchor: SchematicNode, newNode: SchematicNode): void {
    const index = this.nodesInternal.indexOf(anchor);
    if (index < 0) {
      throw new Error("Failed to locate anchor node for insertion.");
    }
    this.nodesInternal.splice(index + 1, 0, newNode);
    this.touch();
  }

  private insertNodeBeforeSheets(newNode: SchematicNode): void {
    const sheetIndex = this.nodesInternal.findIndex(node => node.kind === "sheet_instances" || node.kind === "embedded_fonts");
    const insertAt = sheetIndex >= 0 ? sheetIndex : this.nodesInternal.length;
    this.nodesInternal.splice(insertAt, 0, newNode);
  }

  private getPinPositionsForSymbol(node: SchematicSymbolNode): Map<string, Point> {
    if (!node.libraryId || !node.at) {
      return new Map();
    }

    const def = this.getSymbolLibrary().resolve(node.libraryId);
    const positions = new Map<string, Point>();
    for (const pin of def.pins) {
      positions.set(
        pin.number,
        getAbsolutePinPosition(node.at, { x: pin.x, y: pin.y }, node.rotation ?? 0, node.mirror),
      );
    }
    return positions;
  }

  private retargetAttachments(oldPins: Map<string, Point>, newPins: Map<string, Point>): void {
    for (const [pinId, oldPoint] of oldPins) {
      const newPoint = newPins.get(pinId);
      if (!newPoint) continue;

      for (let index = 0; index < this.nodesInternal.length; index++) {
        const node = this.nodesInternal[index];
        if (node.kind === "wire" && wireTouchesPoint(node, oldPoint)) {
          this.nodesInternal[index] = replaceWireRaw(node, moveWirePointRaw(node.raw, oldPoint, newPoint));
          continue;
        }

        if (node.kind === "label" && node.at && pointKey(node.at) === pointKey(oldPoint)) {
          this.nodesInternal[index] = replaceLabelRaw(node, movePointChildRaw(node.raw, newPoint, node.angle ?? 0));
          continue;
        }

        if (node.kind === "no_connect" && node.at && pointKey(node.at) === pointKey(oldPoint)) {
          this.nodesInternal[index] = replaceNoConnectRaw(node, movePointChildRaw(node.raw, newPoint));
        }
      }
    }

    this.touch();
  }

  private removeNoConnectAt(position: Point): void {
    const key = pointKey(position);
    const originalLength = this.nodesInternal.length;
    this.nodesInternal = this.nodesInternal.filter(
      node => !(node.kind === "no_connect" && node.at && pointKey(node.at) === key),
    );
    if (this.nodesInternal.length !== originalLength) {
      this.touch();
    }
  }

  private ensureNoConnectAt(position: Point): void {
    const key = pointKey(position);
    const exists = this.nodesInternal.some(
      node => node.kind === "no_connect" && node.at && pointKey(node.at) === key,
    );
    if (exists) return;
    this.insertNodeBeforeSheets(createNodeFromRaw(buildNoConnectRaw(position), "\n\t"));
    this.touch();
  }

  private ensureLabelAt(position: Point, name: string): void {
    const key = pointKey(position);
    const exists = this.nodesInternal.some(
      node => node.kind === "label" && node.at && pointKey(node.at) === key && node.name === name,
    );
    if (exists) return;
    this.insertNodeBeforeSheets(createNodeFromRaw(buildLabelRaw(name, position, 0), "\n\t"));
    this.touch();
  }

  private ensureLibrarySymbolLoaded(libraryId: string): void {
    const existing = this.nodesInternal.find((node): node is SchematicOpaqueNode => node.kind === "lib_symbols");
    if (!existing) {
      const raw = `(lib_symbols\n${indentMultiline(this.getSymbolLibrary().getRawSymbolText(libraryId), "\t")}\n)`;
      const node = createNodeFromRaw(raw, "\n\t");
      const insertAt = this.nodesInternal.findIndex(node => node.kind !== "version" && node.kind !== "generator" && node.kind !== "generator_version" && node.kind !== "uuid" && node.kind !== "paper" && node.kind !== "title_block");
      if (insertAt >= 0) {
        this.nodesInternal.splice(insertAt, 0, node);
      } else {
        this.nodesInternal.push(node);
      }
      this.touch();
      return;
    }

    if (libSymbolsContains(existing.raw, libraryId)) return;
    const updatedRaw = appendLibSymbolRaw(existing.raw, this.getSymbolLibrary().getRawSymbolText(libraryId));
    const updated = replaceOpaqueRaw(existing, updatedRaw);
    this.replaceNode(existing, updated);
  }

  private pickFlagPlacement(netName: string): Point {
    const net = this.getByNet(netName).one();
    const anchor = net.labels[0]?.at ?? net.pins[0]?.position ?? { x: 100, y: 100 };
    return { x: roundPoint(anchor.x + 10), y: anchor.y };
  }

  private documentProjectName(): string {
    return this.sourcePath
      ? basenameWithoutExtension(this.sourcePath)
      : "schematic";
  }

  private nextReferenceFor(ref?: string): string {
    if (!ref) {
      throw new Error("Cannot derive duplicate ref from an empty reference.");
    }
    const match = ref.match(/^([A-Za-z#]+)(\d+)$/);
    if (!match) {
      throw new Error(`Cannot auto-increment ref "${ref}".`);
    }
    const prefix = match[1];
    const existing = this.getStructureSnapshot().symbols
      .map(symbol => symbol.ref)
      .filter((value): value is string => Boolean(value?.startsWith(prefix)))
      .map(value => {
        const candidate = value.slice(prefix.length);
        return /^\d+$/.test(candidate) ? Number(candidate) : 0;
      });
    const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
    return `${prefix}${next}`;
  }

  private nextInfrastructureReference(prefix: "#FLG" | "#PWR"): string {
    const existing = this.getStructureSnapshot().symbols
      .map(symbol => symbol.ref)
      .filter((value): value is string => Boolean(value?.startsWith(prefix)))
      .map(value => Number(value.slice(prefix.length)) || 0);
    const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
    return `${prefix}${String(next).padStart(2, "0")}`;
  }
}

export function parseSchematicDocument(text: string): ParsedSchematicDocument {
  let pos = 0;

  const skipWhitespace = () => {
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        pos++;
      } else {
        break;
      }
    }
  };

  const parseString = () => {
    pos++;
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === "\\") {
        pos += 2;
      } else if (ch === '"') {
        pos++;
        return;
      } else {
        pos++;
      }
    }
  };

  const parseList = () => {
    pos++;
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === '"') {
        parseString();
        continue;
      }
      if (ch === "(") {
        parseList();
        continue;
      }
      pos++;
      if (ch === ")") {
        return;
      }
    }
  };

  skipWhitespace();
  if (text[pos] !== "(") {
    throw new Error("Expected schematic to start with an S-expression.");
  }
  pos++;

  const tokenStart = pos;
  while (pos < text.length && !/[\s()]/.test(text[pos])) {
    pos++;
  }
  const rootToken = text.slice(tokenStart, pos);
  if (rootToken !== "kicad_sch") {
    throw new Error(`Expected root expression "kicad_sch", got "${rootToken || "<empty>"}".`);
  }

  const openingRaw = text.slice(0, pos);
  const nodes: SchematicNode[] = [];

  while (pos < text.length) {
    const triviaStart = pos;
    skipWhitespace();
    const leadingTrivia = text.slice(triviaStart, pos);

    if (text[pos] === ")") {
      const closingRaw = text.slice(triviaStart);
      return { openingRaw, nodes, closingRaw };
    }

    const nodeStart = pos;
    if (text[pos] !== "(") {
      throw new Error(`Expected top-level list at character ${pos}.`);
    }
    parseList();
    const nodeEnd = pos;
    const raw = text.slice(nodeStart, nodeEnd);
    nodes.push(parseTopLevelNode(raw, leadingTrivia, { start: nodeStart, end: nodeEnd }));
  }

  throw new Error("Unexpected end of schematic while parsing root expression.");
}

function parseTopLevelNode(raw: string, leadingTrivia: string, range: SourceRange): SchematicNode {
  const parsed = parseSExpr(raw);
  if (parsed.length === 0 || !Array.isArray(parsed[0])) {
    return createOpaqueNode("unknown", leadingTrivia, raw, range);
  }

  const expr = parsed[0] as SExpr[];
  const token = typeof expr[0] === "string" ? expr[0] : "unknown";

  switch (token) {
    case "version":
    case "generator":
    case "generator_version":
    case "uuid":
    case "paper":
    case "embedded_fonts":
      return {
        kind: token,
        value: expr[1] as string | number,
        leadingTrivia,
        raw,
        range,
        dirty: false,
      };
    case "title_block":
      return {
        kind: "title_block",
        title: readStringChild(expr, "title"),
        date: readStringChild(expr, "date"),
        rev: readStringChild(expr, "rev"),
        leadingTrivia,
        raw,
        range,
        dirty: false,
      };
    case "wire":
      return {
        kind: "wire",
        points: readPoints(expr),
        leadingTrivia,
        raw,
        range,
        dirty: false,
      };
    case "label":
    case "global_label":
    case "hierarchical_label": {
      const atExpr = findChild(expr, "at");
      return {
        kind: "label",
        labelKind: token,
        name: typeof expr[1] === "string" ? expr[1] : "",
        at: atExpr ? readPoint(atExpr, 1, 2) : undefined,
        angle: atExpr && typeof atExpr[3] === "number" ? atExpr[3] : undefined,
        leadingTrivia,
        raw,
        range,
        dirty: false,
      };
    }
    case "junction": {
      const atExpr = findChild(expr, "at");
      return {
        kind: "junction",
        at: atExpr ? readPoint(atExpr, 1, 2) : undefined,
        uuid: readStringChild(expr, "uuid"),
        leadingTrivia,
        raw,
        range,
        dirty: false,
      };
    }
    case "no_connect": {
      const atExpr = findChild(expr, "at");
      return {
        kind: "no_connect",
        at: atExpr ? readPoint(atExpr, 1, 2) : undefined,
        leadingTrivia,
        raw,
        range,
        dirty: false,
      };
    }
    case "symbol": {
      const libIdExpr = findChild(expr, "lib_id");
      const atExpr = findChild(expr, "at");
      const mirrorExpr = findChild(expr, "mirror");
      return {
        kind: "symbol",
        libraryId: libIdExpr && typeof libIdExpr[1] === "string" ? libIdExpr[1] : undefined,
        ref: readProperty(expr, "Reference"),
        value: readProperty(expr, "Value"),
        footprint: readProperty(expr, "Footprint"),
        at: atExpr ? readPoint(atExpr, 1, 2) : undefined,
        rotation: atExpr && typeof atExpr[3] === "number" ? atExpr[3] : undefined,
        mirror: mirrorExpr && typeof mirrorExpr[1] === "string" ? readMirror(mirrorExpr[1]) : undefined,
        uuid: readStringChild(expr, "uuid"),
        pins: findChildren(expr, "pin").map(pinExpr => ({
          id: typeof pinExpr[1] === "string" ? pinExpr[1] : String(pinExpr[1] ?? ""),
          uuid: readStringChild(pinExpr, "uuid"),
        })),
        leadingTrivia,
        raw,
        range,
        dirty: false,
      };
    }
    case "sheet": {
      const atExpr = findChild(expr, "at");
      const sizeExpr = findChild(expr, "size");
      return {
        kind: "sheet",
        name: readSheetProperty(expr, ["Sheet name", "Sheetname"]),
        file: readSheetProperty(expr, ["Sheet file", "Sheetfile"]),
        at: atExpr ? readPoint(atExpr, 1, 2) : undefined,
        size: sizeExpr
          ? {
              width: typeof sizeExpr[1] === "number" ? sizeExpr[1] : 0,
              height: typeof sizeExpr[2] === "number" ? sizeExpr[2] : 0,
            }
          : undefined,
        uuid: readStringChild(expr, "uuid"),
        pins: findChildren(expr, "pin").map(pinExpr => {
          const pinAtExpr = findChild(pinExpr, "at");
          return {
            name: typeof pinExpr[1] === "string" ? pinExpr[1] : "",
            pinType: typeof pinExpr[2] === "string" ? pinExpr[2] : undefined,
            at: pinAtExpr ? readPoint(pinAtExpr, 1, 2) : undefined,
            angle: pinAtExpr && typeof pinAtExpr[3] === "number" ? pinAtExpr[3] : undefined,
            uuid: readStringChild(pinExpr, "uuid"),
          };
        }),
        leadingTrivia,
        raw,
        range,
        dirty: false,
      };
    }
    case "lib_symbols":
    case "sheet_instances":
      return createOpaqueNode(token, leadingTrivia, raw, range);
    default:
      return createOpaqueNode("unknown", leadingTrivia, raw, range);
  }
}

function createOpaqueNode(
  kind: "lib_symbols" | "sheet_instances" | "unknown",
  leadingTrivia: string,
  raw: string,
  range: SourceRange,
): SchematicOpaqueNode {
  return {
    kind,
    leadingTrivia,
    raw,
    range,
    dirty: false,
  };
}

function readMirror(value: string): "x" | "y" | undefined {
  if (value === "x" || value === "y") return value;
  return undefined;
}

function readStringChild(expr: SExpr[], token: string): string | undefined {
  const child = findChild(expr, token);
  return child && typeof child[1] === "string" ? child[1] : undefined;
}

function readProperty(expr: SExpr[], key: string): string | undefined {
  for (const property of findChildren(expr, "property")) {
    if (property[1] === key && typeof property[2] === "string") {
      return property[2];
    }
  }
  return undefined;
}

function readSheetProperty(expr: SExpr[], keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readProperty(expr, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readPoints(expr: SExpr[]): Point[] {
  const ptsExpr = findChild(expr, "pts");
  if (!ptsExpr) return [];
  return findChildren(ptsExpr, "xy").map(point => readPoint(point, 1, 2));
}

function readPoint(expr: SExpr[], xIndex: number, yIndex: number): Point {
  return {
    x: typeof expr[xIndex] === "number" ? expr[xIndex] : 0,
    y: typeof expr[yIndex] === "number" ? expr[yIndex] : 0,
  };
}

function serializeNode(node: SchematicNode): string {
  if (!node.dirty) return node.raw;

  switch (node.kind) {
    case "title_block":
      return serializeTitleBlock(node);
    default:
      return node.raw;
  }
}

function serializeTitleBlock(node: TitleBlockNode): string {
  if (node.range.start < 0) {
    return buildTitleBlock(node);
  }

  const originalLines = node.raw.split("\n");
  const childIndent = inferTitleBlockChildIndent(originalLines, node.leadingTrivia);
  let lines = originalLines;

  lines = upsertTitleBlockField(lines, "title", node.title, childIndent);
  lines = upsertTitleBlockField(lines, "date", node.date, childIndent);
  lines = upsertTitleBlockField(lines, "rev", node.rev, childIndent);

  return lines.join("\n");
}

function buildTitleBlock(node: TitleBlockNode): string {
  const outerIndent = getIndent(node.leadingTrivia);
  const innerIndent = `${outerIndent}\t`;
  const lines = ["(title_block"];

  if (node.title !== undefined) lines.push(`${innerIndent}(title "${escapeString(node.title)}")`);
  if (node.date !== undefined) lines.push(`${innerIndent}(date "${escapeString(node.date)}")`);
  if (node.rev !== undefined) lines.push(`${innerIndent}(rev "${escapeString(node.rev)}")`);

  lines.push(`${outerIndent})`);
  return lines.join("\n");
}

function inferTitleBlockChildIndent(lines: string[], leadingTrivia: string): string {
  for (let index = 1; index < lines.length; index++) {
    const match = lines[index].match(/^(\s*)\(/);
    if (match) return match[1];
  }
  return `${getIndent(leadingTrivia)}\t`;
}

function upsertTitleBlockField(lines: string[], field: "title" | "date" | "rev", value: string | undefined, indent: string): string[] {
  const pattern = new RegExp(`^\\s*\\(${field}\\s+"`);
  const existingIndex = lines.findIndex(line => pattern.test(line));

  if (value === undefined) {
    if (existingIndex >= 0) {
      return lines.filter((_, index) => index !== existingIndex);
    }
    return lines;
  }

  const fieldLine = `${indent}(${field} "${escapeString(value)}")`;
  if (existingIndex >= 0) {
    return lines.map((line, index) => index === existingIndex ? fieldLine : line);
  }

  const closingIndex = lines.length > 0 ? lines.length - 1 : 0;
  return [
    ...lines.slice(0, closingIndex),
    fieldLine,
    ...lines.slice(closingIndex),
  ];
}

function getIndent(leadingTrivia: string): string {
  const newline = leadingTrivia.lastIndexOf("\n");
  return newline >= 0 ? leadingTrivia.slice(newline + 1) : "";
}

function escapeString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function createNodeFromRaw(raw: string, leadingTrivia: string): SchematicNode {
  return parseTopLevelNode(raw, leadingTrivia, { start: -1, end: -1 });
}

function replaceSymbolRaw(node: SchematicSymbolNode, raw: string, range: SourceRange = node.range): SchematicSymbolNode {
  const parsed = parseTopLevelNode(raw, node.leadingTrivia, range);
  if (parsed.kind !== "symbol") {
    throw new Error("Expected updated node to remain a symbol.");
  }
  return parsed;
}

function replaceLabelRaw(node: SchematicLabelNode, raw: string, range: SourceRange = node.range): SchematicLabelNode {
  const parsed = parseTopLevelNode(raw, node.leadingTrivia, range);
  if (parsed.kind !== "label") {
    throw new Error("Expected updated node to remain a label.");
  }
  return parsed;
}

function replaceNoConnectRaw(
  node: SchematicNoConnectNode,
  raw: string,
  range: SourceRange = node.range,
): SchematicNoConnectNode {
  const parsed = parseTopLevelNode(raw, node.leadingTrivia, range);
  if (parsed.kind !== "no_connect") {
    throw new Error("Expected updated node to remain a no_connect marker.");
  }
  return parsed;
}

function replaceWireRaw(node: SchematicWireNode, raw: string, range: SourceRange = node.range): SchematicWireNode {
  const parsed = parseTopLevelNode(raw, node.leadingTrivia, range);
  if (parsed.kind !== "wire") {
    throw new Error("Expected updated node to remain a wire.");
  }
  return parsed;
}

function replaceOpaqueRaw(node: SchematicOpaqueNode, raw: string, range: SourceRange = node.range): SchematicOpaqueNode {
  const parsed = parseTopLevelNode(raw, node.leadingTrivia, range);
  if (parsed.kind !== node.kind) {
    throw new Error(`Expected updated node to remain "${node.kind}".`);
  }
  return parsed as SchematicOpaqueNode;
}

interface ImmediateChildSpan {
  token: string;
  start: number;
  end: number;
  raw: string;
}

function findImmediateChildSpans(raw: string): ImmediateChildSpan[] {
  const spans: ImmediateChildSpan[] = [];
  let pos = 0;

  if (raw[pos] !== "(") {
    return spans;
  }
  pos++;
  while (pos < raw.length && !/[\s()]/.test(raw[pos])) pos++;

  while (pos < raw.length) {
    while (pos < raw.length && /\s/.test(raw[pos])) pos++;
    if (pos >= raw.length || raw[pos] === ")") break;
    if (raw[pos] !== "(") {
      pos++;
      continue;
    }

    const start = pos;
    const tokenStart = pos + 1;
    let tokenEnd = tokenStart;
    while (tokenEnd < raw.length && !/[\s()]/.test(raw[tokenEnd])) tokenEnd++;
    const token = raw.slice(tokenStart, tokenEnd);
    const end = findListEnd(raw, start);
    spans.push({ token, start, end, raw: raw.slice(start, end) });
    pos = end;
  }

  return spans;
}

function findListEnd(raw: string, start: number): number {
  let pos = start;
  let depth = 0;
  while (pos < raw.length) {
    const ch = raw[pos];
    if (ch === '"') {
      pos++;
      while (pos < raw.length) {
        if (raw[pos] === "\\") {
          pos += 2;
          continue;
        }
        if (raw[pos] === '"') {
          pos++;
          break;
        }
        pos++;
      }
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      pos++;
      if (depth === 0) {
        return pos;
      }
      continue;
    }
    pos++;
  }
  throw new Error("Unbalanced S-expression while locating child span.");
}

function replaceSpan(raw: string, span: ImmediateChildSpan, replacement: string): string {
  return `${raw.slice(0, span.start)}${replacement}${raw.slice(span.end)}`;
}

function inferChildIndent(raw: string): string {
  const match = raw.match(/\n([ \t]*)\(/);
  return match ? match[1] : "\t";
}

function buildAtRaw(point: Point, angle?: number): string {
  return angle === undefined
    ? `(at ${point.x} ${point.y})`
    : `(at ${point.x} ${point.y} ${angle})`;
}

function readAtFromRaw(raw: string): { point: Point; angle?: number } | undefined {
  const spans = findImmediateChildSpans(raw);
  const atSpan = spans.find(span => span.token === "at");
  if (!atSpan) return undefined;
  const parsed = parseSExpr(atSpan.raw);
  if (parsed.length === 0 || !Array.isArray(parsed[0])) return undefined;
  const expr = parsed[0] as SExpr[];
  return {
    point: {
      x: typeof expr[1] === "number" ? expr[1] : 0,
      y: typeof expr[2] === "number" ? expr[2] : 0,
    },
    angle: typeof expr[3] === "number" ? expr[3] : undefined,
  };
}

function replaceAtRaw(raw: string, point: Point, angle?: number): string {
  const spans = findImmediateChildSpans(raw);
  const atSpan = spans.find(span => span.token === "at");
  if (!atSpan) {
    return insertChildRaw(raw, buildAtRaw(point, angle));
  }
  return replaceSpan(raw, atSpan, buildAtRaw(point, angle));
}

function insertChildRaw(raw: string, childRaw: string, beforeTokens?: string[]): string {
  const childIndent = inferChildIndent(raw);
  const spans = findImmediateChildSpans(raw);
  const before = beforeTokens
    ? spans.find(span => beforeTokens.includes(span.token))
    : undefined;
  const insertAt = before ? before.start : raw.lastIndexOf(")");
  return `${raw.slice(0, insertAt)}\n${childIndent}${childRaw}${raw.slice(insertAt)}`;
}

function readPropertyKeyFromRaw(raw: string): string | undefined {
  const parsed = parseSExpr(raw);
  if (parsed.length === 0 || !Array.isArray(parsed[0])) return undefined;
  const expr = parsed[0] as SExpr[];
  return typeof expr[1] === "string" ? expr[1] : undefined;
}

function replacePropertyValueRaw(raw: string, key: string, value: string): string {
  const pattern = new RegExp(`^(\\(property\\s+"${escapeRegex(key)}"\\s+")((?:[^"\\\\]|\\\\.)*)(")`, "s");
  return raw.replace(pattern, `$1${escapeString(value)}$3`);
}

function buildPropertyRaw(
  key: string,
  value: string,
  at: Point,
  angle: number,
  hide: boolean,
  childIndent: string,
): string {
  const nestedIndent = `${childIndent}\t`;
  const fontIndent = `${nestedIndent}\t`;
  const sizeIndent = `${fontIndent}\t`;
  const hideLine = hide ? `\n${fontIndent}(hide yes)` : "";
  return [
    `(property "${escapeString(key)}" "${escapeString(value)}"`,
    `${nestedIndent}(at ${at.x} ${at.y} ${angle})`,
    `${nestedIndent}(effects`,
    `${fontIndent}(font`,
    `${sizeIndent}(size 1.27 1.27)`,
    `${fontIndent})${hideLine}`,
    `${nestedIndent})`,
    `)`,
  ].join("\n");
}

function updateSymbolPropertyValueRaw(
  raw: string,
  key: string,
  value: string,
  symbolAt?: Point,
  rotation: number = 0,
  hide: boolean = false,
): string {
  const spans = findImmediateChildSpans(raw);
  const propertySpan = spans.find(span => span.token === "property" && readPropertyKeyFromRaw(span.raw) === key);
  if (propertySpan) {
    return replaceSpan(raw, propertySpan, replacePropertyValueRaw(propertySpan.raw, key, value));
  }

  const insertionPoint = symbolAt ?? { x: 0, y: 0 };
  return insertChildRaw(
    raw,
    buildPropertyRaw(key, value, insertionPoint, rotation, hide, inferChildIndent(raw)),
    ["pin", "instances"],
  );
}

function movePropertyAtRaw(raw: string, point: Point, angle?: number): string {
  return replaceAtRaw(raw, point, angle);
}

function moveSymbolRaw(raw: string, at: Point, delta: Point): string {
  const currentAt = readAtFromRaw(raw);
  const nextRotation = currentAt?.angle ?? 0;
  let updated = replaceAtRaw(raw, at, nextRotation);

  const spans = findImmediateChildSpans(updated);
  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index];
    if (span.token !== "property") continue;
    const propertyAt = readAtFromRaw(span.raw);
    if (!propertyAt) continue;
    const moved = {
      x: roundPoint(propertyAt.point.x + delta.x),
      y: roundPoint(propertyAt.point.y + delta.y),
    };
    updated = replaceSpan(updated, span, movePropertyAtRaw(span.raw, moved, propertyAt.angle));
  }

  return updated;
}

function rotateSymbolRaw(raw: string, origin: Point, rotation: number, deltaRotation: number): string {
  let updated = replaceAtRaw(raw, origin, rotation);
  const spans = findImmediateChildSpans(updated);
  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index];
    if (span.token !== "property") continue;
    const propertyAt = readAtFromRaw(span.raw);
    if (!propertyAt) continue;
    const rotatedPoint = rotatePointAround(propertyAt.point, origin, deltaRotation);
    const rotatedAngle = propertyAt.angle === undefined
      ? undefined
      : normalizeRotation(propertyAt.angle + deltaRotation);
    updated = replaceSpan(updated, span, movePropertyAtRaw(span.raw, rotatedPoint, rotatedAngle));
  }
  return updated;
}

function setRootUuidRaw(raw: string, uuid: string): string {
  const spans = findImmediateChildSpans(raw);
  const uuidSpan = spans.find(span => span.token === "uuid");
  if (!uuidSpan) {
    return insertChildRaw(raw, `(uuid "${uuid}")`);
  }
  return replaceSpan(raw, uuidSpan, `(uuid "${uuid}")`);
}

function setPlacedPinUuidsRaw(raw: string): string {
  let updated = raw;
  const spans = findImmediateChildSpans(updated);
  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index];
    if (span.token !== "pin") continue;
    const uuidSpan = findImmediateChildSpans(span.raw).find(child => child.token === "uuid");
    if (!uuidSpan) continue;
    const pinRaw = replaceSpan(span.raw, uuidSpan, `(uuid "${generateUuid()}")`);
    updated = replaceSpan(updated, span, pinRaw);
  }
  return updated;
}

function setSymbolReferenceRaw(raw: string, ref: string): string {
  return updateSymbolPropertyValueRaw(raw, "Reference", ref);
}

function setInstancesReferenceRaw(raw: string, ref: string): string {
  const spans = findImmediateChildSpans(raw);
  const instancesSpan = spans.find(span => span.token === "instances");
  if (!instancesSpan) return raw;
  const updatedInstances = instancesSpan.raw.replace(
    /(\(reference\s+")((?:[^"\\]|\\.)*)(")/,
    `$1${escapeString(ref)}$3`,
  );
  return replaceSpan(raw, instancesSpan, updatedInstances);
}

function cloneSymbolRaw(raw: string): string {
  return raw;
}

function movePointChildRaw(raw: string, point: Point, angle?: number): string {
  const currentAt = readAtFromRaw(raw);
  return replaceAtRaw(raw, point, angle ?? currentAt?.angle);
}

function moveWirePointRaw(raw: string, from: Point, to: Point): string {
  const spans = findImmediateChildSpans(raw);
  const ptsSpan = spans.find(span => span.token === "pts");
  if (!ptsSpan) return raw;

  const parsed = parseSExpr(ptsSpan.raw);
  if (parsed.length === 0 || !Array.isArray(parsed[0])) return raw;
  const expr = parsed[0] as SExpr[];
  const points = findChildren(expr, "xy").map(point => ({
    x: typeof point[1] === "number" ? point[1] : 0,
    y: typeof point[2] === "number" ? point[2] : 0,
  }));

  const updatedPoints = points.map(point => pointKey(point) === pointKey(from) ? to : point);
  const ptsRaw = buildPtsRaw(updatedPoints, inferChildIndent(raw));
  return replaceSpan(raw, ptsSpan, ptsRaw);
}

function buildPtsRaw(points: Point[], childIndent: string): string {
  return [
    `(pts`,
    `${childIndent}\t${points.map(point => `(xy ${point.x} ${point.y})`).join(" ")}`,
    `${childIndent})`,
  ].join("\n");
}

function wireTouchesPoint(node: SchematicWireNode, point: Point): boolean {
  return node.points.some(candidate => pointKey(candidate) === pointKey(point));
}

function buildLabelRaw(name: string, at: Point, angle: number): string {
  return [
    `(label "${escapeString(name)}"`,
    `\t(at ${at.x} ${at.y} ${angle})`,
    `\t(effects`,
    `\t\t(font`,
    `\t\t\t(size 1.27 1.27)`,
    `\t\t)`,
    `\t)`,
    `\t(uuid "${generateUuid()}")`,
    `)`,
  ].join("\n");
}

function buildNoConnectRaw(at: Point): string {
  return [
    `(no_connect`,
    `\t(at ${at.x} ${at.y})`,
    `\t(uuid "${generateUuid()}")`,
    `)`,
  ].join("\n");
}

function buildPowerFlagRaw(ref: string, value: string, at: Point, projectName: string): string {
  const uuid = generateUuid();
  const pinUuid = generateUuid();
  const pathUuid = generateUuid();
  return [
    `(symbol`,
    `\t(lib_id "power:PWR_FLAG")`,
    `\t(at ${at.x} ${at.y} 0)`,
    `\t(unit 1)`,
    `\t(exclude_from_sim no)`,
    `\t(in_bom yes)`,
    `\t(on_board yes)`,
    `\t(dnp no)`,
    `\t(uuid "${uuid}")`,
    `\t(property "Reference" "${escapeString(ref)}"`,
    `\t\t(at ${at.x} ${roundPoint(at.y + 3.81)} 0)`,
    `\t\t(effects`,
    `\t\t\t(font`,
    `\t\t\t\t(size 1.27 1.27)`,
    `\t\t\t)`,
    `\t\t\t(hide yes)`,
    `\t\t)`,
    `\t)`,
    `\t(property "Value" "${escapeString(value)}"`,
    `\t\t(at ${at.x} ${roundPoint(at.y - 3.81)} 0)`,
    `\t\t(effects`,
    `\t\t\t(font`,
    `\t\t\t\t(size 1.27 1.27)`,
    `\t\t\t)`,
    `\t\t)`,
    `\t)`,
    `\t(property "Footprint" ""`,
    `\t\t(at ${at.x} ${at.y} 0)`,
    `\t\t(effects`,
    `\t\t\t(font`,
    `\t\t\t\t(size 1.27 1.27)`,
    `\t\t\t)`,
    `\t\t\t(hide yes)`,
    `\t\t)`,
    `\t)`,
    `\t(property "Datasheet" "~"`,
    `\t\t(at ${at.x} ${at.y} 0)`,
    `\t\t(effects`,
    `\t\t\t(font`,
    `\t\t\t\t(size 1.27 1.27)`,
    `\t\t\t)`,
    `\t\t\t(hide yes)`,
    `\t\t)`,
    `\t)`,
    `\t(property "Description" "Power flag"`,
    `\t\t(at ${at.x} ${at.y} 0)`,
    `\t\t(effects`,
    `\t\t\t(font`,
    `\t\t\t\t(size 1.27 1.27)`,
    `\t\t\t)`,
    `\t\t\t(hide yes)`,
    `\t\t)`,
    `\t)`,
    `\t(pin "1"`,
    `\t\t(uuid "${pinUuid}")`,
    `\t)`,
    `\t(instances`,
    `\t\t(project "${escapeString(projectName)}"`,
    `\t\t\t(path "/${pathUuid}"`,
    `\t\t\t\t(reference "${escapeString(ref)}")`,
    `\t\t\t\t(unit 1)`,
    `\t\t\t)`,
    `\t\t)`,
    `\t)`,
    `)`,
  ].join("\n");
}

function appendLibSymbolRaw(raw: string, symbolRaw: string): string {
  const childIndent = inferChildIndent(raw);
  const indented = indentMultiline(symbolRaw, childIndent);
  const insertAt = raw.lastIndexOf(")");
  return `${raw.slice(0, insertAt)}\n${indented}${raw.slice(insertAt)}`;
}

function libSymbolsContains(raw: string, libraryId: string): boolean {
  const parsed = parseSExpr(raw);
  if (parsed.length === 0 || !Array.isArray(parsed[0])) return false;
  const expr = parsed[0] as SExpr[];
  return findChildren(expr, "symbol").some(symbol => symbol[1] === libraryId);
}

function indentMultiline(text: string, prefix: string): string {
  return text.split("\n").map(line => `${prefix}${line}`).join("\n");
}

function basenameWithoutExtension(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return basename.replace(/\.[^.]+$/, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function roundPoint(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeRotation(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function rotatePointAround(point: Point, origin: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: roundPoint(origin.x + dx * Math.cos(radians) - dy * Math.sin(radians)),
    y: roundPoint(origin.y + dx * Math.sin(radians) + dy * Math.cos(radians)),
  };
}

function buildConnectivitySnapshot(structure: StructureSnapshot, library: SymbolLibrary): ConnectivitySnapshot {
  const pinAtPoint = new Map<string, SchematicPinMatch[]>();
  const labelAtPoint = new Map<string, SchematicLabelMatch[]>();
  const sheetPinAtPoint = new Map<string, SchematicSheetPinMatch[]>();
  const powerAtPoint = new Map<string, string[]>();
  const drivenAtPoint = new Set<string>();
  const noConnectKeys = new Set(
    structure.noConnects
      .map(node => node.at)
      .filter((point): point is Point => point !== undefined)
      .map(pointKey),
  );

  const pins: SchematicPinMatch[] = [];
  const unresolvedSymbols: Array<{ symbol: SchematicSymbolMatch; error: string }> = [];
  const candidatePoints: Point[] = [];

  for (const symbol of structure.symbols) {
    if (!symbol.libraryId || !symbol.at) continue;

    let resolved;
    try {
      resolved = library.resolve(symbol.libraryId);
    } catch (error) {
      unresolvedSymbols.push({
        symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const isPowerSymbol = Boolean(symbol.ref?.startsWith("#PWR"));
    const isFlagSymbol = Boolean(symbol.ref?.startsWith("#FLG"));
    for (const pin of resolved.pins) {
      const position = getAbsolutePinPosition(
        symbol.at,
        { x: pin.x, y: pin.y },
        symbol.rotation ?? 0,
        symbol.mirror,
      );
      const key = pointKey(position);

      const match: SchematicPinMatch = {
        symbol,
        symbolRef: symbol.ref,
        symbolLibraryId: symbol.libraryId,
        pinId: pin.number,
        pinName: pin.name,
        pinType: pin.type,
        position,
        netName: undefined,
        netIsPower: false,
        isNoConnect: noConnectKeys.has(key),
      };

      pins.push(match);
      candidatePoints.push(position);
      if (!pinAtPoint.has(key)) pinAtPoint.set(key, []);
      pinAtPoint.get(key)!.push(match);

      if (isPowerSymbol && isNonEmptyString(symbol.value)) {
        if (!powerAtPoint.has(key)) powerAtPoint.set(key, []);
        powerAtPoint.get(key)!.push(symbol.value);
      }
      if (isFlagSymbol) {
        drivenAtPoint.add(key);
      }
    }
  }

  for (const label of structure.labels) {
    if (!label.at) continue;
    const key = pointKey(label.at);
    candidatePoints.push(label.at);
    if (!labelAtPoint.has(key)) labelAtPoint.set(key, []);
    labelAtPoint.get(key)!.push(label);
  }

  for (const junction of structure.junctions) {
    if (junction.at) candidatePoints.push(junction.at);
  }

  for (const wire of structure.wires) {
    if (wire.points.length < 2) continue;
    candidatePoints.push(...wire.points);
  }

  for (const sheet of structure.sheets) {
    for (const pin of sheet.pins) {
      if (!pin.at) continue;
      const key = pointKey(pin.at);
      candidatePoints.push(pin.at);
      if (!sheetPinAtPoint.has(key)) sheetPinAtPoint.set(key, []);
      sheetPinAtPoint.get(key)!.push(pin);
    }
  }

  const groupedPinsByName = new Map<string, SchematicPinMatch[]>();
  const groupedLabelsByName = new Map<string, SchematicLabelMatch[]>();
  const groupedSheetPinsByName = new Map<string, SchematicSheetPinMatch[]>();
  const groupedDrivenByName = new Map<string, boolean>();
  const groupedGlobalByName = new Map<string, boolean>();
  const groupedPointKeysByName = new Map<string, string[]>();
  const unnamedNetEntries: Array<{ net: SchematicNetMatch; pointKeys: string[] }> = [];
  let autoNetCount = 0;

  const groups = buildPointConnectivityGroups(candidatePoints, structure.wires);

  for (const members of groups.values()) {
    const groupPins: SchematicPinMatch[] = [];
    const groupLabels: SchematicLabelMatch[] = [];
    const groupSheetPins: SchematicSheetPinMatch[] = [];
    const groupPowerNames: string[] = [];
    let groupDriven = false;

    for (const key of members) {
      const pinsHere = pinAtPoint.get(key);
      if (pinsHere) groupPins.push(...pinsHere);

      const labelsHere = labelAtPoint.get(key);
      if (labelsHere) groupLabels.push(...labelsHere);

      const sheetPinsHere = sheetPinAtPoint.get(key);
      if (sheetPinsHere) groupSheetPins.push(...sheetPinsHere);

      const powerNames = powerAtPoint.get(key);
      if (powerNames) groupPowerNames.push(...powerNames);
      if (drivenAtPoint.has(key)) groupDriven = true;
    }

    const userPins = groupPins.filter(pin => !isInfrastructureRef(pin.symbolRef));
    const effectivePins = userPins.length > 0 ? userPins : groupPins;
    const namedNet = groupPowerNames[0] ?? groupLabels[0]?.name;
    const isPower = groupPowerNames.length > 0 || groupDriven;
    const isGlobal = groupPowerNames.length > 0 || groupLabels.some(label => label.labelKind === "global_label");
    const allowNoConnectPins = members.length > 1 || groupLabels.length > 0 || groupPowerNames.length > 0 || groupSheetPins.length > 0;
    const connectedPins = effectivePins.filter(pin => !pin.isNoConnect || allowNoConnectPins);
    const hasMeaningfulNamedContent = connectedPins.length > 0 || groupLabels.length > 0 || groupPowerNames.length > 0 || groupSheetPins.length > 0;

    if (namedNet) {
      if (!hasMeaningfulNamedContent) {
        continue;
      }
      const pinsBucket = groupedPinsByName.get(namedNet) ?? [];
      pinsBucket.push(...connectedPins);
      groupedPinsByName.set(namedNet, pinsBucket);

      const labelsBucket = groupedLabelsByName.get(namedNet) ?? [];
      labelsBucket.push(...groupLabels.filter(label => label.name === namedNet));
      groupedLabelsByName.set(namedNet, labelsBucket);

      const sheetPinBucket = groupedSheetPinsByName.get(namedNet) ?? [];
      sheetPinBucket.push(...groupSheetPins);
      groupedSheetPinsByName.set(namedNet, sheetPinBucket);

      const pointBucket = groupedPointKeysByName.get(namedNet) ?? [];
      pointBucket.push(...members);
      groupedPointKeysByName.set(namedNet, pointBucket);

      if (isPower) groupedDrivenByName.set(namedNet, true);
      if (isGlobal) groupedGlobalByName.set(namedNet, true);
      continue;
    }

    if (connectedPins.length === 0) {
      continue;
    }

    if (connectedPins.length === 1 && groupSheetPins.length === 0) {
      continue;
    }

    autoNetCount++;
    unnamedNetEntries.push({
      net: {
        name: `NET_${autoNetCount}`,
        isPower,
        isGlobal: false,
        pins: dedupePins(connectedPins),
        labels: [],
        sheetPins: dedupeSheetPins(groupSheetPins),
      },
      pointKeys: [...members],
    });
  }

  const namedNets: SchematicNetMatch[] = [];
  const netByPoint = new Map<string, SchematicNetMatch>();
  for (const [name, netPins] of groupedPinsByName) {
    const net: SchematicNetMatch = {
      name,
      isPower: groupedDrivenByName.get(name) === true
        || netPins.some(pin => pin.symbolRef?.startsWith("#PWR") || pin.symbolRef?.startsWith("#FLG")),
      isGlobal: groupedGlobalByName.get(name) === true,
      pins: dedupePins(netPins),
      labels: dedupeLabels(groupedLabelsByName.get(name) ?? []),
      sheetPins: dedupeSheetPins(groupedSheetPinsByName.get(name) ?? []),
    };
    namedNets.push(net);
    for (const memberKey of uniqueStrings(groupedPointKeysByName.get(name) ?? [])) {
      netByPoint.set(memberKey, net);
    }
  }

  const unnamedNets = unnamedNetEntries.map(entry => entry.net);
  for (const entry of unnamedNetEntries) {
    for (const memberKey of uniqueStrings(entry.pointKeys)) {
      netByPoint.set(memberKey, entry.net);
    }
  }

  const nets = [...namedNets, ...unnamedNets];
  for (const net of nets) {
    for (const pin of net.pins) {
      pin.netName = net.name;
      pin.netIsPower = net.isPower;
    }
  }

  return { pins, nets, unresolvedSymbols, netByPoint };
}

function dedupePins(pins: SchematicPinMatch[]): SchematicPinMatch[] {
  const seen = new Set<string>();
  const result: SchematicPinMatch[] = [];
  for (const pin of pins) {
    const key = `${pin.symbolRef ?? ""}:${pin.pinId}:${pointKey(pin.position)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(pin);
  }
  return result;
}

function dedupeSheetPins(pins: SchematicSheetPinMatch[]): SchematicSheetPinMatch[] {
  const seen = new Set<string>();
  const result: SchematicSheetPinMatch[] = [];
  for (const pin of pins) {
    const key = `${pin.name}:${pin.uuid ?? ""}:${pin.at ? pointKey(pin.at) : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(pin);
  }
  return result;
}

function dedupeLabels(labels: SchematicLabelMatch[]): SchematicLabelMatch[] {
  const seen = new Set<string>();
  const result: SchematicLabelMatch[] = [];
  for (const label of labels) {
    const key = `${label.name}:${label.labelKind}:${label.node.range.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

function isInfrastructureRef(ref?: string): boolean {
  return Boolean(ref && (ref.startsWith("#PWR") || ref.startsWith("#FLG")));
}

function findFirstSvgFile(root: string): string | undefined {
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry);
    const stats = statSync(candidate);
    if (stats.isDirectory()) {
      const nested = findFirstSvgFile(candidate);
      if (nested) return nested;
      continue;
    }
    if (stats.isFile() && candidate.endsWith(".svg")) return candidate;
  }
  return undefined;
}

function expectSingle<T>(
  kind: string,
  description: string,
  matches: T[],
  describeItem: (item: T) => string,
  notFoundDetail?: () => string | undefined,
): T {
  if (matches.length === 1) return matches[0];

  if (matches.length === 0) {
    const detail = notFoundDetail?.();
    throw new SchematicLocatorError(
      detail
        ? `Expected exactly 1 ${kind} matching ${description}, found 0.\n${detail}`
        : `Expected exactly 1 ${kind} matching ${description}, found 0.`,
    );
  }

  const sample = matches.slice(0, 5).map(describeItem).join(", ");
  const suffix = matches.length > 5 ? `, ...and ${matches.length - 5} more` : "";
  throw new SchematicLocatorError(
    `Expected exactly 1 ${kind} matching ${description}, found ${matches.length}: ${sample}${suffix}`,
  );
}

function nthItem<T>(items: T[], index: number): T[] {
  if (index < 0 || index >= items.length) return [];
  return [items[index]];
}

function describeSymbol(symbol: SchematicSymbolMatch): string {
  return symbol.ref
    ? `${symbol.ref} (${symbol.libraryId ?? "unknown library"})`
    : symbol.libraryId ?? "<symbol without ref>";
}

function describeLabel(label: SchematicLabelMatch): string {
  if (!label.at) return `${label.labelKind} "${label.name}"`;
  return `${label.labelKind} "${label.name}" @ (${label.at.x}, ${label.at.y})`;
}

function describePin(pin: SchematicPinMatch): string {
  const ref = pin.symbolRef ?? "<unknown ref>";
  const net = pin.netName ? ` on ${pin.netName}` : "";
  return `${ref}:${pin.pinId}${net}`;
}

function describeNet(net: SchematicNetMatch): string {
  return `${net.name} (${net.pins.length} pins)`;
}

function symbolActionTarget(symbol: SchematicSymbolMatch): SchematicActionTarget | undefined {
  if (!symbol.ref) return undefined;
  return { kind: "symbol", ref: symbol.ref };
}

function pinActionTarget(pin: SchematicPinMatch): SchematicActionTarget | undefined {
  if (!pin.symbolRef) return undefined;
  return { kind: "pin", ref: pin.symbolRef, pinId: pin.pinId };
}

function netActionTarget(net: SchematicNetMatch): SchematicActionTarget {
  return { kind: "net", name: net.name };
}

function describeDuplicateOptions(options: DuplicateSymbolOptions, result: SchematicSymbolMatch): string | undefined {
  const details: string[] = [];
  if (options.ref) details.push(`ref -> ${formatTraceString(options.ref)}`);
  if (options.at) details.push(`at -> (${options.at.x}, ${options.at.y})`);
  if (options.offset) details.push(`offset -> (${options.offset.x}, ${options.offset.y})`);
  if (details.length === 0 && result.ref) details.push(`ref -> ${formatTraceString(result.ref)}`);
  return details.length > 0 ? details.join(", ") : undefined;
}

function formatTraceString(value: string): string {
  return JSON.stringify(value);
}

function listAvailable(label: string, values: Array<string | undefined>, limit: number = 10): string | undefined {
  const unique = uniqueStrings(values.filter(isNonEmptyString));
  if (unique.length === 0) return undefined;
  const visible = unique.slice(0, limit);
  const suffix = unique.length > limit ? `, ...and ${unique.length - limit} more` : "";
  return `${label}: ${visible.join(", ")}${suffix}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
