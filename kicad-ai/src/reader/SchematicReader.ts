import { readFileSync } from "fs";
import { parseSExpr, findChild, findChildren, type SExpr } from "../sexpr/parser.js";
import { getAbsolutePinPosition, type Point } from "../library/PinCalculator.js";
import type { WireSegment } from "../builder/WireRouter.js";
import type { SymbolLibrary } from "../library/SymbolLibrary.js";
import { buildPointConnectivityGroups, pointKey } from "../connectivity/PointConnectivity.js";

export interface ReadLabel {
  name: string;
  at: Point;
  angle: number;
  kind: "label" | "global_label" | "hierarchical_label";
}

export interface ReadJunction {
  at: Point;
  uuid?: string;
}

export interface ReadSymbol {
  ref: string;
  libraryId: string;
  value: string;
  footprint: string;
  at: Point;
  rotation: number;
  mirror?: "x" | "y";
  uuid: string;
}

export interface ReadResult {
  symbols: ReadSymbol[];
  wires: WireSegment[];
  labels: ReadLabel[];
  junctions: ReadJunction[];
  titleBlock: { title?: string; date?: string; rev?: string };
  uuid: string;
}

/**
 * Parse an existing .kicad_sch file and extract its structure.
 */
export function readSchematic(filePath: string): ReadResult {
  const text = readFileSync(filePath, "utf-8");
  const parsed = parseSExpr(text);

  if (parsed.length === 0 || !Array.isArray(parsed[0])) {
    throw new Error(`Failed to parse schematic: ${filePath}`);
  }

  const root = parsed[0] as SExpr[];

  // Extract UUID
  const uuidExpr = findChild(root, "uuid");
  const uuid = uuidExpr && typeof uuidExpr[1] === "string" ? uuidExpr[1] : "";

  // Extract title block
  const titleBlock = parseTitleBlock(root);

  // Extract placed symbols
  const symbols = parseSymbols(root);

  // Extract wires
  const wires = parseWires(root);

  // Extract labels
  const labels = parseLabels(root);
  const junctions = parseJunctions(root);

  return { symbols, wires, labels, junctions, titleBlock, uuid };
}

function parseTitleBlock(root: SExpr[]): { title?: string; date?: string; rev?: string } {
  const tb = findChild(root, "title_block");
  if (!tb) return {};

  const titleExpr = findChild(tb, "title");
  const dateExpr = findChild(tb, "date");
  const revExpr = findChild(tb, "rev");

  return {
    title: titleExpr && typeof titleExpr[1] === "string" ? titleExpr[1] : undefined,
    date: dateExpr && typeof dateExpr[1] === "string" ? dateExpr[1] : undefined,
    rev: revExpr && typeof revExpr[1] === "string" ? revExpr[1] : undefined,
  };
}

function parseSymbols(root: SExpr[]): ReadSymbol[] {
  const results: ReadSymbol[] = [];

  // Placed symbols are direct children of kicad_sch with token "symbol"
  // but NOT inside lib_symbols. They have a lib_id child.
  for (const child of root) {
    if (!Array.isArray(child) || child[0] !== "symbol") continue;

    const libIdExpr = findChild(child, "lib_id");
    if (!libIdExpr) continue; // lib_symbols entries don't have lib_id

    const libraryId = typeof libIdExpr[1] === "string" ? libIdExpr[1] : "";

    const atExpr = findChild(child, "at");
    const x = atExpr && typeof atExpr[1] === "number" ? atExpr[1] : 0;
    const y = atExpr && typeof atExpr[2] === "number" ? atExpr[2] : 0;
    const rotation = atExpr && typeof atExpr[3] === "number" ? atExpr[3] : 0;

    const mirrorExpr = findChild(child, "mirror");
    const mirror = mirrorExpr && typeof mirrorExpr[1] === "string"
      ? mirrorExpr[1] as "x" | "y"
      : undefined;

    const uuidExpr = findChild(child, "uuid");
    const uuid = uuidExpr && typeof uuidExpr[1] === "string" ? uuidExpr[1] : "";

    // Extract properties
    let ref = "";
    let value = "";
    let footprint = "";
    for (const prop of findChildren(child, "property")) {
      const key = typeof prop[1] === "string" ? prop[1] : "";
      const val = typeof prop[2] === "string" ? prop[2] : "";
      if (key === "Reference") ref = val;
      else if (key === "Value") value = val;
      else if (key === "Footprint") footprint = val;
    }

    results.push({ ref, libraryId, value, footprint, at: { x, y }, rotation, mirror, uuid });
  }

  return results;
}

function parseWires(root: SExpr[]): WireSegment[] {
  const results: WireSegment[] = [];

  for (const wire of findChildren(root, "wire")) {
    const ptsExpr = findChild(wire, "pts");
    if (!ptsExpr) continue;

    const xys = findChildren(ptsExpr, "xy");
    if (xys.length >= 2) {
      const from: Point = {
        x: typeof xys[0][1] === "number" ? xys[0][1] : 0,
        y: typeof xys[0][2] === "number" ? xys[0][2] : 0,
      };
      const to: Point = {
        x: typeof xys[1][1] === "number" ? xys[1][1] : 0,
        y: typeof xys[1][2] === "number" ? xys[1][2] : 0,
      };
      results.push({ from, to });
    }
  }

  return results;
}

function parseLabels(root: SExpr[]): ReadLabel[] {
  const results: ReadLabel[] = [];

  for (const kind of ["label", "global_label", "hierarchical_label"] as const) {
    for (const label of findChildren(root, kind)) {
      const name = typeof label[1] === "string" ? label[1] : "";
      const atExpr = findChild(label, "at");
      const x = atExpr && typeof atExpr[1] === "number" ? atExpr[1] : 0;
      const y = atExpr && typeof atExpr[2] === "number" ? atExpr[2] : 0;
      const angle = atExpr && typeof atExpr[3] === "number" ? atExpr[3] : 0;

      results.push({ name, at: { x, y }, angle, kind });
    }
  }

  return results;
}

function parseJunctions(root: SExpr[]): ReadJunction[] {
  const results: ReadJunction[] = [];

  for (const junction of findChildren(root, "junction")) {
    const atExpr = findChild(junction, "at");
    const uuidExpr = findChild(junction, "uuid");
    const x = atExpr && typeof atExpr[1] === "number" ? atExpr[1] : 0;
    const y = atExpr && typeof atExpr[2] === "number" ? atExpr[2] : 0;
    const uuid = uuidExpr && typeof uuidExpr[1] === "string" ? uuidExpr[1] : undefined;
    results.push({ at: { x, y }, uuid });
  }

  return results;
}

// ============================================================
// Net inference
// ============================================================

export interface InferredNet {
  name: string;
  isPower: boolean;
  pins: Array<{ symbolRef: string; pinId: string; position: Point }>;
}

/**
 * Infer net connectivity from a parsed schematic.
 *
 * Traces wires between pins and labels to determine which pins are electrically
 * connected. Power symbols (refs starting with #PWR or #FLG) name their net
 * from their Value property. Labels name their net from their text.
 */
export function inferNets(
  result: ReadResult,
  library: SymbolLibrary,
): InferredNet[] {
  const candidatePoints: Point[] = [];
  const pinAtPoint = new Map<string, Array<{ symbolRef: string; pinId: string; position: Point }>>();
  const labelAtPoint = new Map<string, ReadLabel[]>();
  const powerAtPoint = new Map<string, string[]>();
  const drivenAtPoint = new Set<string>();

  for (const sym of result.symbols) {
    let def;
    try {
      def = library.resolve(sym.libraryId);
    } catch {
      continue; // skip if symbol not in library
    }

    const isPowerSymbol = sym.ref.startsWith("#PWR");
    const isFlagSymbol = sym.ref.startsWith("#FLG");

    for (const pin of def.pins) {
      const absPos = getAbsolutePinPosition(
        sym.at,
        { x: pin.x, y: pin.y },
        sym.rotation,
        sym.mirror,
      );
      const key = pointKey(absPos);

      candidatePoints.push(absPos);
      if (!pinAtPoint.has(key)) pinAtPoint.set(key, []);
      pinAtPoint.get(key)!.push({ symbolRef: sym.ref, pinId: pin.number, position: absPos });

      if (isPowerSymbol) {
        const bucket = powerAtPoint.get(key) ?? [];
        bucket.push(sym.value);
        powerAtPoint.set(key, bucket);
      }
      if (isFlagSymbol) {
        drivenAtPoint.add(key);
      }
    }
  }

  for (const label of result.labels) {
    const key = pointKey(label.at);
    candidatePoints.push(label.at);
    const bucket = labelAtPoint.get(key) ?? [];
    bucket.push(label);
    labelAtPoint.set(key, bucket);
  }

  for (const junction of result.junctions) {
    candidatePoints.push(junction.at);
  }

  for (const wire of result.wires) {
    candidatePoints.push(wire.from, wire.to);
  }

  const groupedPinsByName = new Map<string, Array<{ symbolRef: string; pinId: string; position: Point }>>();
  const groupedLabelsByName = new Map<string, ReadLabel[]>();
  const groupedDrivenByName = new Map<string, boolean>();
  const unnamedNets: InferredNet[] = [];
  const groups = buildPointConnectivityGroups(
    candidatePoints,
    result.wires.map(wire => ({ points: [wire.from, wire.to] })),
  );
  let autoNetCount = 0;

  for (const members of groups.values()) {
    const pins: Array<{ symbolRef: string; pinId: string; position: Point }> = [];
    const labels: ReadLabel[] = [];
    const powerNames: string[] = [];
    let isDriven = false;

    for (const key of members) {
      const pinsHere = pinAtPoint.get(key);
      if (pinsHere) pins.push(...pinsHere);

      const labelsHere = labelAtPoint.get(key);
      if (labelsHere) labels.push(...labelsHere);

      const powerHere = powerAtPoint.get(key);
      if (powerHere) powerNames.push(...powerHere);

      if (drivenAtPoint.has(key)) isDriven = true;
    }

    if (pins.length === 0) continue;

    const userPins = pins.filter(
      p => !p.symbolRef.startsWith("#PWR") && !p.symbolRef.startsWith("#FLG")
    );
    const effectivePins = userPins.length > 0 ? userPins : pins;
    const namedNet = powerNames[0] ?? labels[0]?.name;
    const isPower = powerNames.length > 0 || isDriven;

    if (effectivePins.length === 0) continue;

    if (namedNet) {
      const pinBucket = groupedPinsByName.get(namedNet) ?? [];
      pinBucket.push(...effectivePins);
      groupedPinsByName.set(namedNet, pinBucket);

      const labelBucket = groupedLabelsByName.get(namedNet) ?? [];
      labelBucket.push(...labels.filter(label => label.name === namedNet));
      groupedLabelsByName.set(namedNet, labelBucket);

      if (isPower) groupedDrivenByName.set(namedNet, true);
      continue;
    }

    if (effectivePins.length === 1 && !isPower) {
      continue;
    }

    autoNetCount++;
    unnamedNets.push({ name: `NET_${autoNetCount}`, isPower, pins: effectivePins });
  }

  const namedNets: InferredNet[] = [];
  for (const [name, pins] of groupedPinsByName) {
    namedNets.push({
      name,
      isPower: groupedDrivenByName.get(name) === true
        || pins.some(pin => pin.symbolRef.startsWith("#PWR") || pin.symbolRef.startsWith("#FLG")),
      pins: dedupePins(pins),
    });
  }

  return [...namedNets, ...unnamedNets];
}

function dedupePins(
  pins: Array<{ symbolRef: string; pinId: string; position: Point }>,
): Array<{ symbolRef: string; pinId: string; position: Point }> {
  const seen = new Set<string>();
  const result: Array<{ symbolRef: string; pinId: string; position: Point }> = [];

  for (const pin of pins) {
    const key = `${pin.symbolRef}:${pin.pinId}:${pointKey(pin.position)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(pin);
  }

  return result;
}
