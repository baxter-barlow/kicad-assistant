import type { Point } from "../library/PinCalculator.js";
import { getAbsolutePinPosition } from "../library/PinCalculator.js";
import type { Netlist } from "../netlist/Netlist.js";
import type { SymbolLibrary, SymbolDef } from "../library/SymbolLibrary.js";
import { computeBoundingBox, type BoundingBox } from "./BoundingBox.js";

const GRID = 2.54;
const COLUMN_GAP = GRID * 14;      // 35.56mm between columns
const ROW_GAP = GRID * 4;          // 10.16mm between components in same column
const SHEET_MARGIN = GRID * 6;     // 15.24mm margin (tight but keeps components on sheet)
const SHEET_MIN_X = 15.24;
const SHEET_MIN_Y = 15.24;
const SHEET_MAX_X = 274.32;
const SHEET_MAX_Y = 162.56;
const CROSSING_SWEEPS = 4;

function snap(val: number): number {
  return Math.round(val / GRID) * GRID;
}

export interface LayoutPlacement { at: Point; rotation: number; }
export interface PowerPlacement { netName: string; libraryId: string; at: Point; ref: string; }
export interface LabelPlacement { netName: string; at: Point; angle: number; }

export interface LayoutResult {
  placements: Map<string, LayoutPlacement>;
  powerPlacements: PowerPlacement[];
  labelPlacements: LabelPlacement[];
  levels: Map<string, number>;
}

interface SymbolInfo { def: SymbolDef; bbox: BoundingBox; }

/**
 * Sugiyama hierarchical layout with pin-aligned Y positioning.
 */
export function autoLayout(
  netlist: Netlist,
  library: SymbolLibrary,
): LayoutResult {
  const empty: LayoutResult = {
    placements: new Map(), powerPlacements: [], labelPlacements: [], levels: new Map(),
  };
  const refs = [...netlist.symbols.keys()];
  if (refs.length === 0) return empty;

  const symbolInfo = new Map<string, SymbolInfo>();
  for (const [ref, sym] of netlist.symbols) {
    const def = library.resolve(sym.libraryId);
    symbolInfo.set(ref, { def, bbox: computeBoundingBox(def) });
  }

  // Phase 1: Level assignment
  const signalAdj = buildSignalFlowGraph(netlist);
  const levels = assignLevels(refs, signalAdj);
  promotePowerOnlyComponents(netlist, levels);

  // Phase 2: Crossing minimization
  const ordering = minimizeCrossings(netlist, levels, signalAdj);

  // Phase 3: Coordinate assignment (centered, then pin-aligned)
  const placements = assignCoordinates(ordering, symbolInfo, netlist);

  // Phase 4: Pin-alignment refinement -- shift peripherals toward their connected anchor pins
  alignToConnectedPins(placements, ordering, symbolInfo, netlist, signalAdj);

  const intLevels = new Map<string, number>();
  for (const [ref, level] of levels) intLevels.set(ref, Math.round(level));

  return { placements, powerPlacements: [], labelPlacements: [], levels: intLevels };
}

// ============================================================
// Phase 1: Level Assignment
// ============================================================

function buildSignalFlowGraph(netlist: Netlist): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const ref of netlist.symbols.keys()) adj.set(ref, new Set());

  for (const [_name, net] of netlist.nets) {
    if (net.isPower || net.connections.length < 2) continue;
    const connRefs = [...new Set(net.connections.map(c => c.symbolRef))];
    for (let i = 0; i < connRefs.length; i++) {
      for (let j = i + 1; j < connRefs.length; j++) {
        adj.get(connRefs[i])?.add(connRefs[j]);
      }
    }
  }
  return adj;
}

function assignLevels(refs: string[], adj: Map<string, Set<string>>): Map<string, number> {
  const levels = new Map<string, number>();
  const hasIncoming = new Set<string>();
  for (const [_src, dests] of adj) for (const d of dests) hasIncoming.add(d);

  const roots = refs.filter(r => !hasIncoming.has(r));
  if (roots.length === 0 && refs.length > 0) {
    roots.push(refs.reduce((best, r) =>
      (adj.get(r)?.size ?? 0) > (adj.get(best)?.size ?? 0) ? r : best, refs[0]));
  }

  const queue = [...roots];
  for (const root of roots) levels.set(root, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const cl = levels.get(current) ?? 0;
    for (const neighbor of adj.get(current) ?? []) {
      if (cl + 1 > (levels.get(neighbor) ?? -1)) {
        levels.set(neighbor, cl + 1);
        queue.push(neighbor);
      }
    }
  }

  const maxLevel = Math.max(0, ...levels.values());
  for (const ref of refs) if (!levels.has(ref)) levels.set(ref, maxLevel + 1);
  return levels;
}

function promotePowerOnlyComponents(netlist: Netlist, levels: Map<string, number>): void {
  for (const [ref, sym] of netlist.symbols) {
    const hasSignal = [...sym.nets.values()].some(n => !netlist.nets.get(n)?.isPower);
    if (hasSignal) continue;

    const neighborCounts = new Map<string, number>();
    for (const [_, netName] of sym.nets) {
      const net = netlist.nets.get(netName);
      if (!net) continue;
      for (const conn of net.connections) {
        if (conn.symbolRef !== ref) {
          neighborCounts.set(conn.symbolRef, (neighborCounts.get(conn.symbolRef) ?? 0) + 1);
        }
      }
    }

    let bestNeighbor = "";
    let bestCount = 0;
    for (const [n, c] of neighborCounts) if (c > bestCount) { bestCount = c; bestNeighbor = n; }
    if (bestNeighbor) levels.set(ref, (levels.get(bestNeighbor) ?? 0) - 0.5);
  }
}

// ============================================================
// Phase 2: Crossing Minimization
// ============================================================

function minimizeCrossings(
  netlist: Netlist, levels: Map<string, number>, signalAdj: Map<string, Set<string>>,
): Map<number, string[]> {
  const ordering = new Map<number, string[]>();
  for (const [ref, level] of levels) {
    if (!ordering.has(level)) ordering.set(level, []);
    ordering.get(level)!.push(ref);
  }

  const undirected = new Map<string, Set<string>>();
  for (const ref of netlist.symbols.keys()) undirected.set(ref, new Set());
  for (const [src, dests] of signalAdj) {
    for (const d of dests) { undirected.get(src)?.add(d); undirected.get(d)?.add(src); }
  }
  for (const [_, net] of netlist.nets) {
    if (!net.isPower) continue;
    const cr = [...new Set(net.connections.map(c => c.symbolRef))];
    for (let i = 0; i < cr.length; i++) for (let j = i + 1; j < cr.length; j++) {
      undirected.get(cr[i])?.add(cr[j]); undirected.get(cr[j])?.add(cr[i]);
    }
  }

  const sortedLevels = [...ordering.keys()].sort((a, b) => a - b);
  for (let sweep = 0; sweep < CROSSING_SWEEPS; sweep++) {
    for (let li = 1; li < sortedLevels.length; li++)
      reorderByBarycenter(ordering.get(sortedLevels[li])!, ordering.get(sortedLevels[li - 1])!, undirected);
    for (let li = sortedLevels.length - 2; li >= 0; li--)
      reorderByBarycenter(ordering.get(sortedLevels[li])!, ordering.get(sortedLevels[li + 1])!, undirected);
  }
  return ordering;
}

function reorderByBarycenter(toReorder: string[], fixedOrder: string[], adj: Map<string, Set<string>>): void {
  const fixedPos = new Map<string, number>();
  fixedOrder.forEach((ref, i) => fixedPos.set(ref, i));
  const bc = new Map<string, number>();
  for (const ref of toReorder) {
    let sum = 0, count = 0;
    for (const n of adj.get(ref) ?? []) {
      const p = fixedPos.get(n);
      if (p !== undefined) { sum += p; count++; }
    }
    bc.set(ref, count > 0 ? sum / count : Infinity);
  }
  toReorder.sort((a, b) => (bc.get(a) ?? Infinity) - (bc.get(b) ?? Infinity));
}

// ============================================================
// Phase 3: Coordinate Assignment
// ============================================================

function assignCoordinates(
  ordering: Map<number, string[]>,
  symbolInfo: Map<string, SymbolInfo>,
  netlist: Netlist,
): Map<string, LayoutPlacement> {
  const placements = new Map<string, LayoutPlacement>();
  const sortedLevels = [...ordering.keys()].sort((a, b) => a - b);
  if (sortedLevels.length === 0) return placements;

  // Column widths
  const colWidths = new Map<number, number>();
  for (const level of sortedLevels) {
    let maxW = 0;
    for (const ref of ordering.get(level)!) {
      const w = symbolInfo.get(ref)?.bbox.width ?? 0;
      if (w > maxW) maxW = w;
    }
    colWidths.set(level, maxW);
  }

  // Total width and scaling
  let totalWidth = 0;
  for (const level of sortedLevels) totalWidth += colWidths.get(level)! + COLUMN_GAP;
  totalWidth -= COLUMN_GAP;

  const usableW = SHEET_MAX_X - SHEET_MIN_X - SHEET_MARGIN * 2;
  const xScale = totalWidth > usableW ? usableW / totalWidth : 1;

  // X -- centered on sheet
  const sheetCX = (SHEET_MIN_X + SHEET_MAX_X) / 2;
  let cx = sheetCX - (totalWidth * xScale) / 2;
  const levelX = new Map<number, number>();
  for (const level of sortedLevels) {
    levelX.set(level, snap(cx));
    cx += (colWidths.get(level)! + COLUMN_GAP) * xScale;
  }

  // Y -- each column centered on sheet center
  const sheetCY = (SHEET_MIN_Y + SHEET_MAX_Y) / 2;
  const usableH = SHEET_MAX_Y - SHEET_MIN_Y - SHEET_MARGIN * 2;

  for (const level of sortedLevels) {
    const refs = ordering.get(level)!;
    const x = levelX.get(level)!;

    // Compute column height
    let colH = 0;
    for (const ref of refs) colH += (symbolInfo.get(ref)?.bbox.height ?? 0) + ROW_GAP;
    colH -= ROW_GAP;

    // Scale row gap if too tall
    let gap = ROW_GAP;
    if (colH > usableH && refs.length > 1) {
      const symH = colH - (refs.length - 1) * ROW_GAP;
      gap = Math.max(GRID, (usableH - symH) / (refs.length - 1));
      colH = symH + gap * (refs.length - 1);
    }

    let y = sheetCY - colH / 2;

    for (const ref of refs) {
      const info = symbolInfo.get(ref)!;
      const sym = netlist.symbols.get(ref)!;
      const finalY = snap(Math.max(SHEET_MIN_Y + SHEET_MARGIN, Math.min(SHEET_MAX_Y - SHEET_MARGIN, y)));
      placements.set(ref, { at: { x: snap(x), y: finalY }, rotation: sym.rotation });
      y += info.bbox.height + gap;
    }
  }

  return placements;
}

// ============================================================
// Phase 4: Pin-Alignment Refinement
// ============================================================

/**
 * After initial coordinate assignment, shift peripheral components
 * toward the Y position of the anchor pin they connect to.
 * This makes wires more horizontal and reduces visual clutter.
 */
function alignToConnectedPins(
  placements: Map<string, LayoutPlacement>,
  ordering: Map<number, string[]>,
  symbolInfo: Map<string, SymbolInfo>,
  netlist: Netlist,
  signalAdj: Map<string, Set<string>>,
): void {
  const sortedLevels = [...ordering.keys()].sort((a, b) => a - b);
  if (sortedLevels.length < 2) return;

  // For each level after the first, try to align components with their predecessors
  for (let li = 1; li < sortedLevels.length; li++) {
    const level = sortedLevels[li];
    const refs = ordering.get(level)!;

    // Compute desired Y for each ref based on connected pins in previous levels
    const desiredY = new Map<string, number>();

    for (const ref of refs) {
      const neighbors = signalAdj.get(ref) ?? new Set();
      let sumY = 0, count = 0;

      for (const neighbor of neighbors) {
        const neighborPlacement = placements.get(neighbor);
        if (!neighborPlacement) continue;

        // Find the shared net and get the neighbor's pin position
        const sym = netlist.symbols.get(neighbor);
        const refSym = netlist.symbols.get(ref);
        if (!sym || !refSym) continue;

        // Find shared signal nets
        for (const [_pinId, netName] of refSym.nets) {
          if (netlist.nets.get(netName)?.isPower) continue;
          // Check if neighbor is also on this net
          for (const [nPinId, nNetName] of sym.nets) {
            if (nNetName === netName) {
              const info = symbolInfo.get(neighbor);
              if (!info) continue;
              const pinDef = info.def.pins.find(p => p.number === nPinId);
              if (!pinDef) continue;
              const pinPos = getAbsolutePinPosition(
                neighborPlacement.at,
                { x: pinDef.x, y: pinDef.y },
                neighborPlacement.rotation,
              );
              sumY += pinPos.y;
              count++;
            }
          }
        }
      }

      // Also check backward edges (reverse direction in signalAdj)
      for (const [src, dests] of signalAdj) {
        if (!dests.has(ref)) continue;
        const neighborPlacement = placements.get(src);
        if (!neighborPlacement) continue;
        const srcSym = netlist.symbols.get(src);
        const refSym = netlist.symbols.get(ref);
        if (!srcSym || !refSym) continue;

        for (const [_pinId, netName] of refSym.nets) {
          if (netlist.nets.get(netName)?.isPower) continue;
          for (const [nPinId, nNetName] of srcSym.nets) {
            if (nNetName === netName) {
              const info = symbolInfo.get(src);
              if (!info) continue;
              const pinDef = info.def.pins.find(p => p.number === nPinId);
              if (!pinDef) continue;
              const pinPos = getAbsolutePinPosition(
                neighborPlacement.at,
                { x: pinDef.x, y: pinDef.y },
                neighborPlacement.rotation,
              );
              sumY += pinPos.y;
              count++;
            }
          }
        }
      }

      if (count > 0) desiredY.set(ref, sumY / count);
    }

    // Sort refs by desired Y and assign, maintaining minimum gaps
    const withDesired = refs
      .map(ref => ({ ref, desired: desiredY.get(ref) ?? placements.get(ref)!.at.y }))
      .sort((a, b) => a.desired - b.desired);

    // First pass: assign Y positions top-down, respecting min gaps
    const positions: Array<{ ref: string; y: number }> = [];
    let lastBottomY = -Infinity;
    for (const { ref, desired } of withDesired) {
      const info = symbolInfo.get(ref)!;
      const minY = lastBottomY + ROW_GAP;
      const y = snap(Math.max(SHEET_MIN_Y + SHEET_MARGIN, Math.max(minY, desired)));
      positions.push({ ref, y });
      lastBottomY = y + info.bbox.height;
    }

    // Second pass: if bottom overflows sheet, shift everything up proportionally
    const lastRef = positions[positions.length - 1];
    const lastInfo = symbolInfo.get(lastRef.ref)!;
    const overflow = (lastRef.y + lastInfo.bbox.height) - (SHEET_MAX_Y - SHEET_MARGIN);
    if (overflow > 0 && positions.length > 0) {
      const shift = overflow;
      for (const pos of positions) {
        pos.y = snap(Math.max(SHEET_MIN_Y + SHEET_MARGIN, pos.y - shift));
      }
    }

    // Apply positions
    for (const { ref, y } of positions) {
      const p = placements.get(ref)!;
      placements.set(ref, { at: { x: p.at.x, y }, rotation: p.rotation });
    }
  }
}
