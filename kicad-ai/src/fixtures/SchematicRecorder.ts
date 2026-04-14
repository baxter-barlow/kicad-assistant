import { SchematicDocument, type SchematicActionTraceEntry } from "../document/SchematicDocument.js";
import { SchematicProject, type SchematicProjectActionTraceEntry } from "../project/SchematicProject.js";
import { captureActionTrace, type CapturedActionTrace } from "../tooling/SchematicTooling.js";
import {
  createProjectFixture,
  createSchematicFixture,
  type SchematicBoardFixture,
  type SchematicProjectFixture,
} from "./SchematicFixtures.js";

export interface RecorderCodegenOptions {
  targetName?: string;
  fixtureName?: string;
  includeImports?: boolean;
  includeSave?: boolean;
  functionName?: string;
}

export interface RecordedDocumentFixtureWorkflow<TResult> extends CapturedActionTrace<SchematicDocument, TResult> {
  fixture: SchematicBoardFixture<SchematicDocument>;
  code: string;
}

export interface RecordedProjectFixtureWorkflow<TResult> extends CapturedActionTrace<SchematicProject, TResult> {
  fixture: SchematicProjectFixture;
  code: string;
}

export function recordDocumentFixtureWorkflow<TResult>(
  document: SchematicDocument,
  label: string,
  operation: (fixture: SchematicBoardFixture<SchematicDocument>) => TResult,
  options: RecorderCodegenOptions = {},
): RecordedDocumentFixtureWorkflow<TResult> {
  const fixture = createSchematicFixture(document);
  const captured = captureActionTrace(document, label, () => operation(fixture));
  return {
    ...captured,
    fixture,
    code: generateDocumentWorkflowCode(document, captured.trace, {
      ...options,
      functionName: options.functionName ?? slugify(label),
    }),
  };
}

export function recordProjectFixtureWorkflow<TResult>(
  project: SchematicProject,
  label: string,
  operation: (fixture: SchematicProjectFixture) => TResult,
  options: RecorderCodegenOptions = {},
): RecordedProjectFixtureWorkflow<TResult> {
  const fixture = createProjectFixture(project);
  const captured = captureActionTrace(project, label, () => operation(fixture)) as CapturedActionTrace<SchematicProject, TResult>;
  return {
    ...captured,
    fixture,
    code: generateProjectWorkflowCode(project, captured.trace as readonly SchematicProjectActionTraceEntry[], {
      ...options,
      functionName: options.functionName ?? slugify(label),
    }),
  };
}

export function generateDocumentWorkflowCode(
  document: SchematicDocument,
  trace: readonly SchematicActionTraceEntry[],
  options: RecorderCodegenOptions = {},
): string {
  const targetName = options.targetName ?? "document";
  const fixtureName = options.fixtureName ?? "board";
  const includeImports = options.includeImports ?? true;
  const includeSave = options.includeSave ?? Boolean(document.path);
  const statements = generateStatements(trace, {
    kind: "document",
    targetName,
    fixtureName,
  });

  if (document.path) {
    const lines: string[] = [];
    if (includeImports) {
      lines.push('import { SchematicDocument, createSchematicFixture } from "schematic-agent";', "");
    }
    lines.push(`const ${targetName} = SchematicDocument.open(${quote(document.path)});`);
    lines.push(`const ${fixtureName} = createSchematicFixture(${targetName});`);
    if (statements.length > 0) lines.push("", ...statements);
    if (includeSave) lines.push("", `${targetName}.save();`);
    return lines.join("\n");
  }

  const functionName = options.functionName ?? "applyRecordedDocumentWorkflow";
  const lines: string[] = [];
  if (includeImports) {
    lines.push('import { SchematicDocument, createSchematicFixture } from "schematic-agent";', "");
  }
  lines.push(`export function ${functionName}(${targetName}: SchematicDocument): void {`);
  lines.push(`  const ${fixtureName} = createSchematicFixture(${targetName});`);
  for (const statement of statements) {
    lines.push(statement ? `  ${statement}` : "");
  }
  if (includeSave) lines.push(`  ${targetName}.save();`);
  lines.push("}");
  return lines.join("\n");
}

export function generateProjectWorkflowCode(
  project: SchematicProject,
  trace: readonly SchematicProjectActionTraceEntry[],
  options: RecorderCodegenOptions = {},
): string {
  const targetName = options.targetName ?? "project";
  const fixtureName = options.fixtureName ?? "board";
  const includeImports = options.includeImports ?? true;
  const includeSave = options.includeSave ?? Boolean(project.path);
  const statements = generateStatements(trace, {
    kind: "project",
    targetName,
    fixtureName,
  });

  if (project.path) {
    const lines: string[] = [];
    if (includeImports) {
      lines.push('import { SchematicProject, createProjectFixture } from "schematic-agent";', "");
    }
    lines.push(`const ${targetName} = SchematicProject.open(${quote(project.path)});`);
    lines.push(`const ${fixtureName} = createProjectFixture(${targetName});`);
    if (statements.length > 0) lines.push("", ...statements);
    if (includeSave) lines.push("", `${targetName}.save();`);
    return lines.join("\n");
  }

  const functionName = options.functionName ?? "applyRecordedProjectWorkflow";
  const lines: string[] = [];
  if (includeImports) {
    lines.push('import { SchematicProject, createProjectFixture } from "schematic-agent";', "");
  }
  lines.push(`export function ${functionName}(${targetName}: SchematicProject): void {`);
  lines.push(`  const ${fixtureName} = createProjectFixture(${targetName});`);
  for (const statement of statements) {
    lines.push(statement ? `  ${statement}` : "");
  }
  if (includeSave) lines.push(`  ${targetName}.save();`);
  lines.push("}");
  return lines.join("\n");
}

type AnyTraceEntry = SchematicActionTraceEntry | SchematicProjectActionTraceEntry;

interface StatementContext {
  kind: "document" | "project";
  targetName: string;
  fixtureName: string;
}

function generateStatements(entries: readonly AnyTraceEntry[], context: StatementContext): string[] {
  return entries.map(entry => generateStatement(entry, context));
}

function generateStatement(entry: AnyTraceEntry, context: StatementContext): string {
  const fixtureRoot = getFixtureRoot(entry, context);
  const rawRoot = getRawRoot(entry, context);
  const pinTarget = parsePinTarget(entry.target);
  const refTarget = parseRefTarget(entry.target);
  const netTarget = parseNetTarget(entry.target);

  if (refTarget) {
    const component = `${fixtureRoot}.component(${quote(refTarget.ref)})`;
    switch (entry.action) {
      case "setValue":
        return `${component}.setValue(${quote(requiredTraceString(entry.details, "value"))});`;
      case "setFootprint":
        return `${component}.setFootprint(${quote(requiredTraceString(entry.details, "footprint"))});`;
      case "move": {
        const point = requiredTracePoint(entry.details, "at");
        return `${component}.move({ x: ${point.x}, y: ${point.y} });`;
      }
      case "rotate":
        return `${component}.rotate(${requiredTraceNumber(entry.details, "rotation")});`;
      case "delete":
        return `${component}.delete();`;
      case "duplicate": {
        const optionParts: string[] = [];
        const ref = traceString(entry.details, "ref");
        const at = tracePoint(entry.details, "at");
        const offset = tracePoint(entry.details, "offset");
        if (ref) optionParts.push(`ref: ${quote(ref)}`);
        if (at) optionParts.push(`at: { x: ${at.x}, y: ${at.y} }`);
        if (offset) optionParts.push(`offset: { x: ${offset.x}, y: ${offset.y} }`);
        return optionParts.length > 0
          ? `${component}.duplicate({ ${optionParts.join(", ")} });`
          : `${component}.duplicate();`;
      }
      default:
        break;
    }
  }

  if (pinTarget) {
    const component = `${fixtureRoot}.component(${quote(pinTarget.ref)})`;
    switch (entry.action) {
      case "connectTo": {
        const netName = traceString(entry.details, "net") ?? traceString(entry.details, "net already");
        if (!netName) return unsupportedStatement(entry, "missing net name");
        return `${component}.connect(${quote(pinTarget.pinId)}, ${quote(netName)});`;
      }
      case "disconnect":
        return `${component}.disconnect(${quote(pinTarget.pinId)});`;
      case "markNoConnect":
        return `${component}.markNoConnect(${quote(pinTarget.pinId)});`;
      case "markDriven": {
        const netName = traceString(entry.details, "net");
        return netName
          ? `${component}.markDriven(${quote(pinTarget.pinId)}, ${quote(netName)});`
          : `${component}.markDriven(${quote(pinTarget.pinId)});`;
      }
      default:
        break;
    }
  }

  if (netTarget && entry.action === "markDriven") {
    return `${fixtureRoot}.powerDomain(${quote(netTarget.netName)}).markDriven();`;
  }

  const locatorExpression = renderRawLocator(entry.target, rawRoot);
  if (!locatorExpression) {
    return unsupportedStatement(entry, "unsupported locator");
  }

  switch (entry.action) {
    case "setValue":
      return `${locatorExpression}.setValue(${quote(requiredTraceString(entry.details, "value"))});`;
    case "setFootprint":
      return `${locatorExpression}.setFootprint(${quote(requiredTraceString(entry.details, "footprint"))});`;
    case "move": {
      const point = requiredTracePoint(entry.details, "at");
      return `${locatorExpression}.move({ x: ${point.x}, y: ${point.y} });`;
    }
    case "rotate":
      return `${locatorExpression}.rotate(${requiredTraceNumber(entry.details, "rotation")});`;
    case "delete":
      return `${locatorExpression}.delete();`;
    case "duplicate": {
      const optionParts: string[] = [];
      const ref = traceString(entry.details, "ref");
      const at = tracePoint(entry.details, "at");
      const offset = tracePoint(entry.details, "offset");
      if (ref) optionParts.push(`ref: ${quote(ref)}`);
      if (at) optionParts.push(`at: { x: ${at.x}, y: ${at.y} }`);
      if (offset) optionParts.push(`offset: { x: ${offset.x}, y: ${offset.y} }`);
      return optionParts.length > 0
        ? `${locatorExpression}.duplicate({ ${optionParts.join(", ")} });`
        : `${locatorExpression}.duplicate();`;
    }
    case "connectTo": {
      const netName = traceString(entry.details, "net") ?? traceString(entry.details, "net already");
      if (!netName) return unsupportedStatement(entry, "missing net name");
      return `${locatorExpression}.connectTo(${quote(netName)});`;
    }
    case "disconnect":
      return `${locatorExpression}.disconnect();`;
    case "markNoConnect":
      return `${locatorExpression}.markNoConnect();`;
    case "markDriven": {
      const netName = traceString(entry.details, "net");
      return netName
        ? `${locatorExpression}.markDriven(${quote(netName)});`
        : `${locatorExpression}.markDriven();`;
    }
  }
}

function getFixtureRoot(entry: AnyTraceEntry, context: StatementContext): string {
  if (context.kind === "project" && "sheetName" in entry) {
    return `${context.fixtureName}.sheet(${quote(entry.sheetName)})`;
  }
  return context.fixtureName;
}

function getRawRoot(entry: AnyTraceEntry, context: StatementContext): string {
  if (context.kind === "project" && "sheetName" in entry) {
    return `${context.targetName}.sheet(${quote(entry.sheetName)}).one()`;
  }
  return context.targetName;
}

function unsupportedStatement(entry: AnyTraceEntry, reason: string): string {
  return `// TODO recorder could not translate ${entry.action} for ${quote(entry.target)} (${reason})`;
}

function renderRawLocator(description: string, root: string): string | undefined {
  const nthMatch = description.match(/^(.*)\.nth\((\d+)\)$/);
  if (nthMatch) {
    const base = renderRawLocator(nthMatch[1], root);
    return base ? `${base}.nth(${nthMatch[2]})` : undefined;
  }

  const pinWithinMatch = description.match(/^pin "([^"]+)" within (.+)$/);
  if (pinWithinMatch) {
    const parent = renderRawLocator(pinWithinMatch[2], root);
    return parent ? `${parent}.pin(${quote(pinWithinMatch[1])})` : undefined;
  }

  const pinOnRefMatch = description.match(/^pin "([^"]+)" on ref "([^"]+)"$/);
  if (pinOnRefMatch) {
    return `${root}.pin(${quote(pinOnRefMatch[2])}, ${quote(pinOnRefMatch[1])})`;
  }

  const refMatch = parseRefTarget(description);
  if (refMatch) return `${root}.getByRef(${quote(refMatch.ref)})`;

  const libraryMatch = description.match(/^library ID "([^"]+)"$/);
  if (libraryMatch) return `${root}.getByLibraryId(${quote(libraryMatch[1])})`;

  const valueMatch = description.match(/^value "([^"]+)"$/);
  if (valueMatch) return `${root}.getByValue(${quote(valueMatch[1])})`;

  const footprintMatch = description.match(/^footprint "([^"]+)"$/);
  if (footprintMatch) return `${root}.getByFootprint(${quote(footprintMatch[1])})`;

  const labelMatch = description.match(/^label "([^"]+)"$/);
  if (labelMatch) return `${root}.getByLabel(${quote(labelMatch[1])})`;

  const netMatch = parseNetTarget(description);
  if (netMatch) return `${root}.getByNet(${quote(netMatch.netName)})`;

  return undefined;
}

function parseRefTarget(description: string): { ref: string } | undefined {
  const match = description.match(/^ref "([^"]+)"$/);
  return match ? { ref: match[1] } : undefined;
}

function parseNetTarget(description: string): { netName: string } | undefined {
  const match = description.match(/^net "([^"]+)"$/);
  return match ? { netName: match[1] } : undefined;
}

function parsePinTarget(description: string): { ref: string; pinId: string } | undefined {
  const directMatch = description.match(/^pin "([^"]+)" on ref "([^"]+)"$/);
  if (directMatch) {
    return { pinId: directMatch[1], ref: directMatch[2] };
  }

  const withinMatch = description.match(/^pin "([^"]+)" within ref "([^"]+)"$/);
  if (withinMatch) {
    return { pinId: withinMatch[1], ref: withinMatch[2] };
  }

  return undefined;
}

function traceString(details: string | undefined, key: string): string | undefined {
  if (!details) return undefined;
  const match = details.match(new RegExp(`${escapeRegex(key)} -> ("(?:\\\\.|[^"])*")`));
  if (!match) return undefined;
  return JSON.parse(match[1]);
}

function requiredTraceString(details: string | undefined, key: string): string {
  const value = traceString(details, key);
  if (value === undefined) {
    throw new Error(`Recorder expected trace detail "${key}" in ${details ?? "<missing>"} but none was found.`);
  }
  return value;
}

function tracePoint(details: string | undefined, key: string): { x: number; y: number } | undefined {
  if (!details) return undefined;
  const match = details.match(new RegExp(`${escapeRegex(key)} -> \\((-?\\d+(?:\\.\\d+)?), (-?\\d+(?:\\.\\d+)?)\\)`));
  if (!match) return undefined;
  return { x: Number(match[1]), y: Number(match[2]) };
}

function requiredTracePoint(details: string | undefined, key: string): { x: number; y: number } {
  const point = tracePoint(details, key);
  if (!point) {
    throw new Error(`Recorder expected point trace detail "${key}" in ${details ?? "<missing>"} but none was found.`);
  }
  return point;
}

function requiredTraceNumber(details: string | undefined, key: string): number {
  if (!details) {
    throw new Error(`Recorder expected numeric trace detail "${key}" but trace details were missing.`);
  }
  const match = details.match(new RegExp(`${escapeRegex(key)} -> (-?\\d+(?:\\.\\d+)?)`));
  if (!match) {
    throw new Error(`Recorder expected numeric trace detail "${key}" in ${details} but none was found.`);
  }
  return Number(match[1]);
}

function slugify(label: string): string {
  const compact = label
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return compact.length > 0 ? compact : "recordedWorkflow";
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
