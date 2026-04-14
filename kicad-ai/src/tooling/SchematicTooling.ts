import type { ErcResult, ErcViolation } from "../utils/kicad-cli.js";
import {
  SchematicDocument,
  type SchematicActionTraceEntry,
  type SchematicLabelMatch,
  type SchematicLocatorTrace,
  type SchematicNetMatch,
  type SchematicSheetMatch,
  type SchematicSymbolMatch,
} from "../document/SchematicDocument.js";
import type { Point } from "../library/PinCalculator.js";
import {
  SchematicProject,
  type SchematicProjectActionTraceEntry,
  type SchematicProjectNetMatch,
  type SchematicProjectSheetHandle,
} from "../project/SchematicProject.js";

export interface SchematicSymbolSnapshot {
  key: string;
  ref?: string;
  libraryId?: string;
  value?: string;
  footprint?: string;
  at?: Point;
  rotation?: number;
  mirror?: "x" | "y";
}

export interface SchematicLabelSnapshot {
  key: string;
  kind: string;
  name: string;
  at?: Point;
  angle?: number;
}

export interface SchematicNetSnapshot {
  key: string;
  name: string;
  isPower: boolean;
  isGlobal: boolean;
  pins: readonly string[];
  labels: readonly string[];
  sheetPins: readonly string[];
}

export interface SchematicSheetSnapshot {
  key: string;
  name?: string;
  file?: string;
  at?: Point;
  size?: { width: number; height: number };
  pins: readonly string[];
}

export interface SchematicDocumentSemanticSnapshot {
  kind: "document";
  description: string;
  path?: string;
  symbols: readonly SchematicSymbolSnapshot[];
  labels: readonly SchematicLabelSnapshot[];
  nets: readonly SchematicNetSnapshot[];
  sheets: readonly SchematicSheetSnapshot[];
}

export interface SchematicProjectNetSnapshot {
  key: string;
  name: string;
  aliases: readonly string[];
  isPower: boolean;
  sheetNames: readonly string[];
  pins: readonly string[];
}

export interface SchematicProjectSheetSnapshot {
  key: string;
  name: string;
  path: string;
  document: SchematicDocumentSemanticSnapshot;
}

export interface SchematicProjectSemanticSnapshot {
  kind: "project";
  description: string;
  path: string;
  sheets: readonly SchematicProjectSheetSnapshot[];
  nets: readonly SchematicProjectNetSnapshot[];
}

export type SchematicSemanticSnapshot =
  | SchematicDocumentSemanticSnapshot
  | SchematicProjectSemanticSnapshot;

export interface SchematicDiffChange<T> {
  key: string;
  before?: T;
  after?: T;
}

export interface SchematicDiffCategory<T> {
  added: readonly T[];
  removed: readonly T[];
  changed: readonly SchematicDiffChange<T>[];
}

export interface SchematicSemanticDiff {
  kind: "document" | "project";
  summary: {
    added: number;
    removed: number;
    changed: number;
  };
  symbols?: SchematicDiffCategory<SchematicSymbolSnapshot>;
  labels?: SchematicDiffCategory<SchematicLabelSnapshot>;
  nets?: SchematicDiffCategory<SchematicNetSnapshot>;
  sheets?: SchematicDiffCategory<SchematicSheetSnapshot>;
  projectSheets?: SchematicDiffCategory<SchematicProjectSheetSnapshot>;
  projectNets?: SchematicDiffCategory<SchematicProjectNetSnapshot>;
}

export interface SchematicErcDiff {
  addedErrors: readonly ErcViolation[];
  removedErrors: readonly ErcViolation[];
  addedWarnings: readonly ErcViolation[];
  removedWarnings: readonly ErcViolation[];
}

export interface CapturedActionTrace<TTarget extends SchematicDocument | SchematicProject, TResult> {
  label: string;
  target: TTarget extends SchematicProject ? "project" : "document";
  before: TTarget extends SchematicProject ? SchematicProjectSemanticSnapshot : SchematicDocumentSemanticSnapshot;
  after: TTarget extends SchematicProject ? SchematicProjectSemanticSnapshot : SchematicDocumentSemanticSnapshot;
  diff: SchematicSemanticDiff;
  trace: readonly (SchematicActionTraceEntry | SchematicProjectActionTraceEntry)[];
  result: TResult;
}

export function captureSemanticSnapshot(target: SchematicDocument): SchematicDocumentSemanticSnapshot;
export function captureSemanticSnapshot(target: SchematicProject): SchematicProjectSemanticSnapshot;
export function captureSemanticSnapshot(target: SchematicDocument | SchematicProject): SchematicSemanticSnapshot {
  if (target instanceof SchematicDocument) {
    return captureDocumentSnapshot(target);
  }
  return captureProjectSnapshot(target);
}

export function diffSemanticSnapshots(
  before: SchematicDocument | SchematicProject | SchematicSemanticSnapshot,
  after: SchematicDocument | SchematicProject | SchematicSemanticSnapshot,
): SchematicSemanticDiff {
  const beforeSnapshot = normalizeSnapshot(before);
  const afterSnapshot = normalizeSnapshot(after);

  if (beforeSnapshot.kind !== afterSnapshot.kind) {
    throw new Error(`Cannot diff ${beforeSnapshot.kind} snapshot against ${afterSnapshot.kind} snapshot.`);
  }

  if (beforeSnapshot.kind === "document") {
    const beforeDocument = beforeSnapshot as SchematicDocumentSemanticSnapshot;
    const afterDocument = afterSnapshot as SchematicDocumentSemanticSnapshot;
    const symbols = diffCategory(beforeDocument.symbols, afterDocument.symbols);
    const labels = diffCategory(beforeDocument.labels, afterDocument.labels);
    const nets = diffCategory(beforeDocument.nets, afterDocument.nets);
    const sheets = diffCategory(beforeDocument.sheets, afterDocument.sheets);
    return {
      kind: "document",
      summary: summarizeChanges(symbols, labels, nets, sheets),
      symbols,
      labels,
      nets,
      sheets,
    };
  }

  const beforeProject = beforeSnapshot as SchematicProjectSemanticSnapshot;
  const afterProject = afterSnapshot as SchematicProjectSemanticSnapshot;
  const projectSheets = diffCategory(beforeProject.sheets, afterProject.sheets);
  const projectNets = diffCategory(beforeProject.nets, afterProject.nets);
  return {
    kind: "project",
    summary: summarizeChanges(projectSheets, projectNets),
    projectSheets,
    projectNets,
  };
}

export function diffErcResults(before: ErcResult, after: ErcResult): SchematicErcDiff {
  return {
    addedErrors: diffViolations(before.errors, after.errors),
    removedErrors: diffViolations(after.errors, before.errors),
    addedWarnings: diffViolations(before.warnings, after.warnings),
    removedWarnings: diffViolations(after.warnings, before.warnings),
  };
}

export function traceLocator(locator: { trace(): SchematicLocatorTrace }): SchematicLocatorTrace {
  return locator.trace();
}

export function captureActionTrace<TResult>(
  target: SchematicDocument,
  label: string,
  operation: () => TResult,
): CapturedActionTrace<SchematicDocument, TResult>;
export function captureActionTrace<TResult>(
  target: SchematicProject,
  label: string,
  operation: () => TResult,
): CapturedActionTrace<SchematicProject, TResult>;
export function captureActionTrace<TResult>(
  target: SchematicDocument | SchematicProject,
  label: string,
  operation: () => TResult,
): CapturedActionTrace<SchematicDocument | SchematicProject, TResult> {
  const before = captureSemanticSnapshot(target as never);
  const traceBefore = [...getActionTrace(target)];
  const result = operation();
  const after = captureSemanticSnapshot(target as never);
  const allTrace = getActionTrace(target);
  const trace = allTrace.slice(traceBefore.length);
  return {
    label,
    target: target instanceof SchematicProject ? "project" : "document",
    before: before as never,
    after: after as never,
    diff: diffSemanticSnapshots(before, after),
    trace,
    result,
  };
}

export function formatLocatorTrace(trace: SchematicLocatorTrace): string {
  return [
    `${trace.kind} locator: ${trace.description}`,
    `matches: ${trace.count}`,
    `resolved: ${trace.matches.join(", ") || "<none>"}`,
    trace.detail ? `detail: ${trace.detail}` : "",
  ].filter(Boolean).join("\n");
}

export function formatActionTrace(entries: readonly (SchematicActionTraceEntry | SchematicProjectActionTraceEntry)[]): string {
  if (entries.length === 0) {
    return "No recorded actions.";
  }

  return entries.map(entry => {
    const sheetPrefix = "sheetName" in entry ? `[${entry.sheetName}] ` : "";
    const detailSuffix = entry.details ? ` (${entry.details})` : "";
    return `#${entry.sequence} ${sheetPrefix}${entry.action} ${entry.target}: ${entry.before ?? "<none>"} -> ${entry.after ?? "<none>"}${detailSuffix}`;
  }).join("\n");
}

export function formatSemanticDiff(diff: SchematicSemanticDiff): string {
  const sections: string[] = [];
  if (diff.kind === "document") {
    sections.push(formatCategory("symbols", diff.symbols));
    sections.push(formatCategory("labels", diff.labels));
    sections.push(formatCategory("nets", diff.nets));
    sections.push(formatCategory("sheets", diff.sheets));
  } else {
    sections.push(formatCategory("project sheets", diff.projectSheets));
    sections.push(formatCategory("project nets", diff.projectNets));
  }

  return [
    `added=${diff.summary.added} removed=${diff.summary.removed} changed=${diff.summary.changed}`,
    ...sections.filter(Boolean),
  ].join("\n");
}

export function formatErcDiff(diff: SchematicErcDiff): string {
  return [
    `added errors: ${diff.addedErrors.length}`,
    `removed errors: ${diff.removedErrors.length}`,
    `added warnings: ${diff.addedWarnings.length}`,
    `removed warnings: ${diff.removedWarnings.length}`,
  ].join("\n");
}

function captureDocumentSnapshot(document: SchematicDocument): SchematicDocumentSemanticSnapshot {
  return {
    kind: "document",
    description: document.describe(),
    path: document.path,
    symbols: document.getSymbols().map(snapshotSymbol).sort(compareByKey),
    labels: document.getLabels().map(snapshotLabel).sort(compareByKey),
    nets: document.getNets().map(snapshotNet).sort(compareByKey),
    sheets: document.getSheets().map(snapshotSheet).sort(compareByKey),
  };
}

function captureProjectSnapshot(project: SchematicProject): SchematicProjectSemanticSnapshot {
  return {
    kind: "project",
    description: project.describe(),
    path: project.path,
    sheets: project.getSheets().map(snapshotProjectSheet).sort(compareByKey),
    nets: project.getNets().map(snapshotProjectNet).sort(compareByKey),
  };
}

function snapshotSymbol(symbol: SchematicSymbolMatch): SchematicSymbolSnapshot {
  return {
    key: symbol.ref ?? symbol.uuid ?? symbol.libraryId ?? "<symbol>",
    ref: symbol.ref,
    libraryId: symbol.libraryId,
    value: symbol.value,
    footprint: symbol.footprint,
    at: symbol.at,
    rotation: symbol.rotation,
    mirror: symbol.mirror,
  };
}

function snapshotLabel(label: SchematicLabelMatch): SchematicLabelSnapshot {
  return {
    key: `${label.labelKind}:${label.name}@${formatPoint(label.at)}`,
    kind: label.labelKind,
    name: label.name,
    at: label.at,
    angle: label.angle,
  };
}

function snapshotNet(net: SchematicNetMatch): SchematicNetSnapshot {
  const pins = net.pins.map(pin => `${pin.symbolRef ?? "<no ref>"}:${pin.pinId}`).sort();
  const labels = net.labels.map(label => `${label.labelKind}:${label.name}@${formatPoint(label.at)}`).sort();
  const sheetPins = net.sheetPins.map(pin => `${pin.name}@${formatPoint(pin.at)}`).sort();
  return {
    key: isAutoNetName(net.name)
      ? `unnamed:${pins.join("|")}:${sheetPins.join("|")}:${labels.join("|")}`
      : net.name,
    name: net.name,
    isPower: net.isPower,
    isGlobal: net.isGlobal,
    pins,
    labels,
    sheetPins,
  };
}

function snapshotSheet(sheet: SchematicSheetMatch): SchematicSheetSnapshot {
  return {
    key: sheet.uuid ?? sheet.file ?? sheet.name ?? `<sheet:${formatPoint(sheet.at)}>`,
    name: sheet.name,
    file: sheet.file,
    at: sheet.at,
    size: sheet.size,
    pins: sheet.pins.map(pin => `${pin.name}@${formatPoint(pin.at)}`).sort(),
  };
}

function snapshotProjectNet(net: SchematicProjectNetMatch): SchematicProjectNetSnapshot {
  return {
    key: net.aliases.join("|"),
    name: net.name,
    aliases: [...net.aliases].sort(),
    isPower: net.isPower,
    sheetNames: [...net.sheetNames].sort(),
    pins: net.pins.map(pin => `${pin.sheetName}/${pin.pin.symbolRef ?? "<no ref>"}:${pin.pin.pinId}`).sort(),
  };
}

function snapshotProjectSheet(sheet: SchematicProjectSheetHandle): SchematicProjectSheetSnapshot {
  return {
    key: `${sheet.name}:${sheet.path}`,
    name: sheet.name,
    path: sheet.path,
    document: captureDocumentSnapshot(sheet.document),
  };
}

function normalizeSnapshot(target: SchematicDocument | SchematicProject | SchematicSemanticSnapshot): SchematicSemanticSnapshot {
  if (target instanceof SchematicDocument || target instanceof SchematicProject) {
    return captureSemanticSnapshot(target as never);
  }
  return target;
}

function diffCategory<T extends { key: string }>(
  beforeItems: readonly T[],
  afterItems: readonly T[],
): SchematicDiffCategory<T> {
  const beforeMap = new Map(beforeItems.map(item => [item.key, item]));
  const afterMap = new Map(afterItems.map(item => [item.key, item]));

  const added = afterItems.filter(item => !beforeMap.has(item.key));
  const removed = beforeItems.filter(item => !afterMap.has(item.key));
  const changed: SchematicDiffChange<T>[] = [];

  for (const item of beforeItems) {
    const next = afterMap.get(item.key);
    if (!next) continue;
    if (JSON.stringify(item) !== JSON.stringify(next)) {
      changed.push({ key: item.key, before: item, after: next });
    }
  }

  return { added, removed, changed };
}

function summarizeChanges(...categories: Array<SchematicDiffCategory<{ key: string }> | undefined>): { added: number; removed: number; changed: number } {
  return categories.reduce(
    (summary, category) => ({
      added: summary.added + (category?.added.length ?? 0),
      removed: summary.removed + (category?.removed.length ?? 0),
      changed: summary.changed + (category?.changed.length ?? 0),
    }),
    { added: 0, removed: 0, changed: 0 },
  );
}

function diffViolations(before: readonly ErcViolation[], after: readonly ErcViolation[]): ErcViolation[] {
  const beforeKeys = new Set(before.map(violationKey));
  return after.filter(violation => !beforeKeys.has(violationKey(violation)));
}

function violationKey(violation: ErcViolation): string {
  return `${violation.severity}:${violation.message}`;
}

function formatCategory<T extends { key: string }>(name: string, category?: SchematicDiffCategory<T>): string {
  if (!category) return "";
  return `${name}: +${category.added.length} -${category.removed.length} ~${category.changed.length}`;
}

function compareByKey<T extends { key: string }>(left: T, right: T): number {
  return left.key.localeCompare(right.key);
}

function formatPoint(point?: Point): string {
  return point ? `${point.x},${point.y}` : "<none>";
}

function getActionTrace(target: SchematicDocument | SchematicProject): readonly (SchematicActionTraceEntry | SchematicProjectActionTraceEntry)[] {
  return target.getActionTrace();
}

function isAutoNetName(name: string): boolean {
  return /^NET_\d+$/.test(name);
}
