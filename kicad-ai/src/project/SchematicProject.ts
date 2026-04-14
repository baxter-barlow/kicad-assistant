import { resolve, dirname } from "path";
import {
  type SchematicActionTraceEntry,
  SchematicDocument,
  type SchematicLocatorTrace,
  SchematicLocatorError,
  type SchematicNetMatch,
  type SchematicPinMatch,
  type SchematicSheetMatch,
} from "../document/SchematicDocument.js";

export interface SchematicProjectOptions {
  symbolsPath?: string;
}

export interface SchematicProjectOpenOptions extends SchematicProjectOptions {}

interface ProjectSheetRecord {
  name: string;
  path: string;
  document: SchematicDocument;
  parent?: ProjectSheetRecord;
  parentSheet?: SchematicSheetMatch;
}

export interface ProjectNetPinMatch {
  sheetName: string;
  pin: SchematicPinMatch;
}

export interface SchematicProjectNetMatch {
  name: string;
  aliases: readonly string[];
  isPower: boolean;
  sheetNames: readonly string[];
  pins: readonly ProjectNetPinMatch[];
}

export interface SchematicProjectActionTraceEntry extends SchematicActionTraceEntry {
  sheetName: string;
  sheetPath: string;
}

interface SchematicProjectAssertionErrorOptions {
  code: string;
  target: string;
  expected: string;
  actual: string;
  details?: string;
}

export class SchematicProjectAssertionError extends Error {
  readonly code: string;
  readonly target: string;
  readonly expected: string;
  readonly actual: string;
  readonly details?: string;

  constructor(options: SchematicProjectAssertionErrorOptions) {
    const detailSuffix = options.details ? `\n${options.details}` : "";
    super(`Expected ${options.target} to ${options.expected}, but ${options.actual}.${detailSuffix}`);
    this.name = "SchematicProjectAssertionError";
    this.code = options.code;
    this.target = options.target;
    this.expected = options.expected;
    this.actual = options.actual;
    this.details = options.details;
  }
}

export class SchematicProjectSheetHandle {
  constructor(private readonly record: ProjectSheetRecord) {}

  get name(): string {
    return this.record.name;
  }

  get path(): string {
    return this.record.path;
  }

  get document(): SchematicDocument {
    return this.record.document;
  }

  describe(): string {
    return `sheet "${this.record.name}" (${this.record.path})`;
  }

  getByRef(ref: string) {
    return this.record.document.getByRef(ref);
  }

  getByLibraryId(libraryId: string) {
    return this.record.document.getByLibraryId(libraryId);
  }

  getByValue(value: string) {
    return this.record.document.getByValue(value);
  }

  getByFootprint(footprint: string) {
    return this.record.document.getByFootprint(footprint);
  }

  getByLabel(name: string) {
    return this.record.document.getByLabel(name);
  }

  getByNet(name: string) {
    return this.record.document.getByNet(name);
  }

  pin(ref: string, pinId: string) {
    return this.record.document.pin(ref, pinId);
  }

  save(): string {
    return this.record.document.save();
  }
}

export class SchematicProjectSheetLocator {
  constructor(
    private readonly description: string,
    private readonly resolveSheets: () => SchematicProjectSheetHandle[],
    private readonly notFoundDetail?: () => string | undefined,
  ) {}

  count(): number {
    return this.resolveSheets().length;
  }

  trace(): SchematicLocatorTrace {
    const matches = this.resolveSheets();
    return {
      kind: "sheet",
      description: this.description,
      count: matches.length,
      matches: matches.map(match => `${match.name} (${match.path})`),
      detail: this.notFoundDetail?.(),
    };
  }

  all(): SchematicProjectSheetHandle[] {
    return [...this.resolveSheets()];
  }

  first(): SchematicProjectSheetHandle | undefined {
    return this.resolveSheets()[0];
  }

  one(): SchematicProjectSheetHandle {
    return expectSingleSheet(this.description, this.resolveSheets(), this.notFoundDetail);
  }

  nth(index: number): SchematicProjectSheetLocator {
    return new SchematicProjectSheetLocator(
      `${this.description}.nth(${index})`,
      () => nthItem(this.resolveSheets(), index),
      this.notFoundDetail,
    );
  }

  filter(
    predicate: (sheet: SchematicProjectSheetHandle) => boolean,
    description: string = "custom filter",
  ): SchematicProjectSheetLocator {
    return new SchematicProjectSheetLocator(
      `${this.description}.filter(${description})`,
      () => this.resolveSheets().filter(predicate),
      this.notFoundDetail,
    );
  }
}

class ProjectNetAssertions {
  constructor(
    private readonly netName: string,
    private readonly resolveNets: () => SchematicProjectNetMatch[],
  ) {}

  toSpanSheets(expectedSheets: string[]): void {
    const net = this.requireSingle();
    const actualSheets = [...net.sheetNames].sort();
    const normalizedExpected = [...new Set(expectedSheets)].sort();
    if (actualSheets.join("\u0000") !== normalizedExpected.join("\u0000")) {
      throw new SchematicProjectAssertionError({
        code: "project.net.sheet_span_mismatch",
        target: `project net "${this.netName}"`,
        expected: `span sheets ${normalizedExpected.join(", ")}`,
        actual: `spans sheets ${actualSheets.join(", ") || "<none>"}`,
        details: describeProjectNet(net),
      });
    }
  }

  toContainPin(sheetName: string, ref: string, pinId: string): void {
    const net = this.requireSingle();
    const hasPin = net.pins.some(pin => pin.sheetName === sheetName && pin.pin.symbolRef === ref && pin.pin.pinId === pinId);
    if (!hasPin) {
      throw new SchematicProjectAssertionError({
        code: "project.net.missing_pin",
        target: `project net "${this.netName}"`,
        expected: `contain pin ${sheetName}/${ref}:${pinId}`,
        actual: "pin was not present on the project net",
        details: describeProjectNet(net),
      });
    }
  }

  private requireSingle(): SchematicProjectNetMatch {
    const nets = this.resolveNets();
    if (nets.length === 1) return nets[0];

    if (nets.length === 0) {
      throw new SchematicProjectAssertionError({
        code: "project.net.missing",
        target: `project net "${this.netName}"`,
        expected: "exist",
        actual: "found 0 matching project nets",
      });
    }

    throw new SchematicProjectAssertionError({
      code: "project.net.ambiguous",
      target: `project net "${this.netName}"`,
      expected: "resolve to exactly 1 project net",
      actual: `found ${nets.length} disconnected project nets`,
      details: nets.map(describeProjectNet).join("\n---\n"),
    });
  }
}

export class SchematicProject {
  readonly path: string;
  readonly rootSheet: SchematicProjectSheetHandle;
  private readonly sheetRecords: ProjectSheetRecord[];

  private constructor(path: string, sheetRecords: ProjectSheetRecord[]) {
    this.path = path;
    this.sheetRecords = sheetRecords;
    const rootRecord = sheetRecords.find(record => record.name === "root");
    if (!rootRecord) {
      throw new Error("Failed to initialize project without a root sheet.");
    }
    this.rootSheet = new SchematicProjectSheetHandle(rootRecord);
  }

  static open(path: string, options: SchematicProjectOpenOptions = {}): SchematicProject {
    const projectPath = resolve(path);
    const rootSchematicPath = resolveRootSchematicPath(projectPath);
    const documentCache = new Map<string, SchematicDocument>();
    const sheetRecords: ProjectSheetRecord[] = [];

    const loadSheet = (
      name: string,
      schematicPath: string,
      parent?: ProjectSheetRecord,
      parentSheet?: SchematicSheetMatch,
    ): ProjectSheetRecord => {
      const resolvedPath = resolve(schematicPath);
      let document = documentCache.get(resolvedPath);
      if (!document) {
        document = SchematicDocument.open(resolvedPath, { symbolsPath: options.symbolsPath });
        documentCache.set(resolvedPath, document);
      }

      const record: ProjectSheetRecord = { name, path: resolvedPath, document, parent, parentSheet };
      sheetRecords.push(record);

      for (const childSheet of document.getSheets()) {
        if (!childSheet.file) continue;
        const childPath = resolve(dirname(resolvedPath), childSheet.file);
        const childName = childSheet.name ?? basenameWithoutExtension(childPath);
        loadSheet(childName, childPath, record, childSheet);
      }

      return record;
    };

    loadSheet("root", rootSchematicPath);
    return new SchematicProject(projectPath, sheetRecords);
  }

  sheet(name: string): SchematicProjectSheetLocator {
    return new SchematicProjectSheetLocator(
      `sheet "${name}"`,
      () => this.sheetRecords.filter(record => record.name === name).map(record => new SchematicProjectSheetHandle(record)),
      () => {
        const available = uniqueStrings(this.sheetRecords.map(record => record.name));
        return available.length > 0 ? `Available sheets: ${available.join(", ")}` : undefined;
      },
    );
  }

  describe(): string {
    return `project "${this.path}"`;
  }

  getSheets(): readonly SchematicProjectSheetHandle[] {
    return this.sheetRecords.map(record => new SchematicProjectSheetHandle(record));
  }

  getNets(): readonly SchematicProjectNetMatch[] {
    return this.collectProjectNets();
  }

  getActionTrace(): readonly SchematicProjectActionTraceEntry[] {
    const seen = new Set<string>();
    const entries: SchematicProjectActionTraceEntry[] = [];

    for (const record of this.sheetRecords) {
      if (seen.has(record.path)) continue;
      seen.add(record.path);
      entries.push(...record.document.getActionTrace().map(entry => ({
        ...entry,
        sheetName: record.name,
        sheetPath: record.path,
      })));
    }

    return entries.sort((left, right) => left.globalSequence - right.globalSequence);
  }

  clearActionTrace(): void {
    const seen = new Set<string>();
    for (const record of this.sheetRecords) {
      if (seen.has(record.path)) continue;
      seen.add(record.path);
      record.document.clearActionTrace();
    }
  }

  getByRef(ref: string, options: { sheet?: string } = {}) {
    if (options.sheet) {
      return this.sheet(options.sheet).one().getByRef(ref);
    }

    const matches = this.sheetRecords.filter(record => record.document.getByRef(ref).count() > 0);
    if (matches.length === 1) {
      return matches[0].document.getByRef(ref);
    }
    if (matches.length === 0) {
      throw new SchematicLocatorError(`Expected ref "${ref}" to exist in project "${this.path}", found 0.`);
    }

    throw new SchematicLocatorError(
      `Ref "${ref}" exists in multiple sheets (${matches.map(record => record.name).join(", ")}). Specify { sheet } to disambiguate.`,
    );
  }

  expectNet(name: string): ProjectNetAssertions {
    return new ProjectNetAssertions(name, () => this.resolveProjectNets(name));
  }

  save(): void {
    const seen = new Set<string>();
    for (const record of this.sheetRecords) {
      if (seen.has(record.path)) continue;
      seen.add(record.path);
      record.document.save();
    }
  }

  reload(): void {
    const seen = new Set<string>();
    for (const record of this.sheetRecords) {
      if (seen.has(record.path)) continue;
      seen.add(record.path);
      record.document.reload();
    }
  }

  private resolveProjectNets(name: string): SchematicProjectNetMatch[] {
    return this.collectProjectNets().filter(net => net.aliases.includes(name));
  }

  private collectProjectNets(): SchematicProjectNetMatch[] {
    interface LocalNetRecord {
      index: number;
      sheet: ProjectSheetRecord;
      net: SchematicNetMatch;
      aliases: Set<string>;
    }

    const indexed: LocalNetRecord[] = this.sheetRecords.flatMap(sheet =>
      sheet.document.getNets().map((net, indexOffset) => ({
        index: indexOffset,
        sheet,
        net,
        aliases: new Set(isAutoNetName(net.name) ? [] : [net.name]),
      })),
    );

    indexed.forEach((record, index) => {
      record.index = index;
    });

    if (indexed.length === 0) return [];

    const union = new UnionFind(indexed.length);
    const netRecordByKey = new Map<string, LocalNetRecord>();
    const projectWideByName = new Map<string, LocalNetRecord[]>();

    for (const record of indexed) {
      netRecordByKey.set(localNetKey(record.sheet, record.net.name), record);
      if (!isProjectWideNet(record.net) || isAutoNetName(record.net.name)) continue;
      const bucket = projectWideByName.get(record.net.name) ?? [];
      bucket.push(record);
      projectWideByName.set(record.net.name, bucket);
    }

    for (const records of projectWideByName.values()) {
      if (records.length < 2) continue;
      const [first, ...rest] = records;
      for (const record of rest) {
        union.union(first.index, record.index);
      }
    }

    for (const record of this.sheetRecords) {
      if (!record.parent || !record.parentSheet) continue;

      for (const parentSheetPin of record.parentSheet.pins) {
        if (!parentSheetPin.at || !parentSheetPin.name) continue;

        const childNet = record.document.getNets().find(net =>
          net.name === parentSheetPin.name
          && net.labels.some(label => label.labelKind === "hierarchical_label" && label.name === parentSheetPin.name),
        );
        if (!childNet) continue;

        const parentNet = record.parent.document.findNetAtPoint(parentSheetPin.at);
        if (!parentNet) continue;

        const childRecord = netRecordByKey.get(localNetKey(record, childNet.name));
        const parentRecord = netRecordByKey.get(localNetKey(record.parent, parentNet.name));
        if (!childRecord || !parentRecord) continue;

        childRecord.aliases.add(parentSheetPin.name);
        parentRecord.aliases.add(parentSheetPin.name);
        union.union(childRecord.index, parentRecord.index);
      }
    }

    const grouped = new Map<number, LocalNetRecord[]>();
    for (const record of indexed) {
      const root = union.find(record.index);
      const bucket = grouped.get(root) ?? [];
      bucket.push(record);
      grouped.set(root, bucket);
    }

    const projectNets: SchematicProjectNetMatch[] = [];
    for (const group of grouped.values()) {
      const aliases = new Set<string>();
      const pins: ProjectNetPinMatch[] = [];
      const sheetNames: string[] = [];
      let isPower = false;

      for (const record of group) {
        isPower = isPower || record.net.isPower;
        sheetNames.push(record.sheet.name);
        for (const alias of record.aliases) aliases.add(alias);
        if (!isAutoNetName(record.net.name)) aliases.add(record.net.name);
        for (const pin of record.net.pins) {
          pins.push({ sheetName: record.sheet.name, pin });
        }
      }

      const aliasList = [...aliases].sort();
      if (aliasList.length === 0) {
        aliasList.push(group[0].net.name);
      }
      projectNets.push({
        name: aliasList[0],
        aliases: aliasList,
        isPower,
        sheetNames: uniqueStrings(sheetNames),
        pins,
      });
    }

    return projectNets;
  }
}

function resolveRootSchematicPath(path: string): string {
  if (path.endsWith(".kicad_sch")) return path;
  if (path.endsWith(".kicad_pro")) {
    return resolve(dirname(path), `${basenameWithoutExtension(path)}.kicad_sch`);
  }
  return resolve(dirname(path), `${basenameWithoutExtension(path)}.kicad_sch`);
}

function basenameWithoutExtension(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return basename.replace(/\.[^.]+$/, "");
}

function isProjectWideNet(net: SchematicNetMatch): boolean {
  return net.isGlobal;
}

function isAutoNetName(name: string): boolean {
  return /^NET_\d+$/.test(name);
}

function localNetKey(sheet: ProjectSheetRecord, netName: string): string {
  return `${sheet.path}\u0000${sheet.name}\u0000${netName}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function nthItem<T>(items: T[], index: number): T[] {
  if (index < 0 || index >= items.length) return [];
  return [items[index]];
}

function expectSingleSheet(
  description: string,
  matches: SchematicProjectSheetHandle[],
  notFoundDetail?: () => string | undefined,
): SchematicProjectSheetHandle {
  if (matches.length === 1) return matches[0];

  if (matches.length === 0) {
    const detail = notFoundDetail?.();
    throw new SchematicLocatorError(
      detail
        ? `Expected exactly 1 sheet matching ${description}, found 0.\n${detail}`
        : `Expected exactly 1 sheet matching ${description}, found 0.`,
    );
  }

  throw new SchematicLocatorError(
    `Expected exactly 1 sheet matching ${description}, found ${matches.length}: ${matches.map(match => match.name).join(", ")}`,
  );
}

function describeProjectNet(net: SchematicProjectNetMatch): string {
  const pinList = net.pins.map(pin => `${pin.sheetName}/${pin.pin.symbolRef}:${pin.pin.pinId}`);
  return [
    `Aliases: ${net.aliases.join(", ") || "<none>"}`,
    `Sheets: ${net.sheetNames.join(", ") || "<none>"}`,
    `Pins: ${pinList.join(", ") || "<none>"}`,
  ].join("\n");
}

class UnionFind {
  private readonly parent = new Map<number, number>();

  constructor(size: number) {
    for (let index = 0; index < size; index++) {
      this.parent.set(index, index);
    }
  }

  find(value: number): number {
    const parent = this.parent.get(value);
    if (parent === undefined || parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parent.set(leftRoot, rightRoot);
    }
  }
}
