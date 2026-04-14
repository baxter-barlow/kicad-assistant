import { getAbsolutePinPosition } from "../library/PinCalculator.js";
import type { Point } from "../library/PinCalculator.js";
import type { Netlist } from "../netlist/Netlist.js";
import type { SymbolLibrary } from "../library/SymbolLibrary.js";
import type { LayoutPlacement, PowerPlacement, LabelPlacement } from "./AutoLayout.js";
import type { WireSegment } from "../builder/WireRouter.js";
import { route } from "../builder/WireRouter.js";
import { computeBoundingBox, type BoundingBox } from "./BoundingBox.js";
import { OccupancyBitmap, type Rect } from "./OccupancyBitmap.js";

const GRID = 2.54;
const POWER_OFFSET_BASE = GRID * 4;    // 10.16mm
const POWER_OFFSET_LARGE = GRID * 6;   // 15.24mm for tall components
const LABEL_OFFSET = GRID * 5;         // 12.7mm preferred label distance from pin
const LABEL_TEXT_HEIGHT = 3.0;          // ~3mm rendered height at 1.27mm font
const LABEL_CHAR_WIDTH = 1.5;          // ~1.5mm per character
const LABEL_PADDING = 1.0;             // 1mm padding around label text

// 8 candidate directions for label placement, ordered by preference
// Each is [dx_multiplier, dy_multiplier] relative to LABEL_OFFSET
const CANDIDATES: Array<[number, number]> = [
  [1, 0],     // right (preferred for horizontal signal flow)
  [-1, 0],    // left
  [0, -1],    // above
  [0, 1],     // below
  [1, -0.5],  // upper-right
  [1, 0.5],   // lower-right
  [-1, -0.5], // upper-left
  [-1, 0.5],  // lower-left
];

interface PinPosition {
  symbolRef: string;
  pinId: string;
  position: Point;
  pinAngle: number;
  symbolRotation: number;
}

function findAnchorRef(netlist: Netlist): string {
  let best = "";
  let bestPins = 0;
  let secondPins = 0;
  for (const [ref, sym] of netlist.symbols) {
    const n = sym.nets.size;
    if (n > bestPins) { secondPins = bestPins; bestPins = n; best = ref; }
    else if (n > secondPins) secondPins = n;
  }
  return (bestPins >= 8 && bestPins >= secondPins * 3) ? best : "";
}

function labelRect(at: Point, netName: string): Rect {
  const w = netName.length * LABEL_CHAR_WIDTH + LABEL_PADDING * 2;
  const h = LABEL_TEXT_HEIGHT + LABEL_PADDING * 2;
  return { x: at.x - LABEL_PADDING, y: at.y - h / 2, width: w, height: h };
}

export function placeLabelsAndPower(
  netlist: Netlist,
  library: SymbolLibrary,
  placements: Map<string, LayoutPlacement>,
  levels?: Map<string, number>,
): {
  powerPlacements: PowerPlacement[];
  labelPlacements: LabelPlacement[];
  wirePlacements: WireSegment[];
} {
  const powerPlacements: PowerPlacement[] = [];
  const labelPlacements: LabelPlacement[] = [];
  const wirePlacements: WireSegment[] = [];
  let pwrCount = 0;
  const anchorRef = findAnchorRef(netlist);

  // Build occupancy bitmap covering the full A4 sheet
  const bitmap = new OccupancyBitmap(0, 0, 300, 220);

  // Pre-compute and cache symbol info
  const symbolBboxes = new Map<string, BoundingBox>();
  for (const [ref, sym] of netlist.symbols) {
    const def = library.resolve(sym.libraryId);
    const bbox = computeBoundingBox(def);
    symbolBboxes.set(ref, bbox);

    // Mark symbol body on bitmap
    const placement = placements.get(ref);
    if (placement) {
      bitmap.markRect({
        x: placement.at.x + bbox.minX - 2, // 2mm padding
        y: placement.at.y + bbox.minY - 2,
        width: bbox.width + 4,
        height: bbox.height + 4,
      });
    }
  }

  // Collect all pin positions by net, then process
  const netPins = new Map<string, PinPosition[]>();
  for (const [netName, net] of netlist.nets) {
    if (net.connections.length < 1) continue;
    const pins: PinPosition[] = [];
    for (const conn of net.connections) {
      const sym = netlist.symbols.get(conn.symbolRef);
      const placement = placements.get(conn.symbolRef);
      if (!sym || !placement) continue;
      const def = library.resolve(sym.libraryId);
      const pinDef = def.pins.find(p => p.number === conn.pinId);
      if (!pinDef) continue;
      pins.push({
        symbolRef: conn.symbolRef,
        pinId: conn.pinId,
        position: getAbsolutePinPosition(
          placement.at, { x: pinDef.x, y: pinDef.y },
          placement.rotation, sym.mirror,
        ),
        pinAngle: pinDef.angle,
        symbolRotation: placement.rotation,
      });
    }
    if (pins.length > 0) netPins.set(netName, pins);
  }

  // Phase 1: Place power symbols and mark them on bitmap
  for (const [netName, net] of netlist.nets) {
    if (!net.isPower) continue;
    const pins = netPins.get(netName);
    if (!pins) continue;

    const seenRefs = new Set<string>();
    for (const pp of pins) {
      if (seenRefs.has(pp.symbolRef)) continue;
      seenRefs.add(pp.symbolRef);
      pwrCount++;

      const symHeight = symbolBboxes.get(pp.symbolRef)?.height ?? 10;
      const offset = symHeight > 20 ? POWER_OFFSET_LARGE : POWER_OFFSET_BASE;
      const isGnd = netName === "GND" || netName.startsWith("-");
      const powerAt: Point = { x: pp.position.x, y: pp.position.y + (isGnd ? offset : -offset) };

      powerPlacements.push({
        netName, libraryId: `power:${netName}`, at: powerAt,
        ref: `#PWR0${pwrCount}`,
      });
      const wireSegs = route(powerAt, pp.position);
      wirePlacements.push(...wireSegs);

      // Mark power symbol on bitmap (~5x5mm)
      bitmap.markRect({ x: powerAt.x - 2.5, y: powerAt.y - 2.5, width: 5, height: 5 });
      for (const seg of wireSegs) {
        bitmap.markWire(seg.from.x, seg.from.y, seg.to.x, seg.to.y);
      }
    }
  }

  // Phase 2: Place wires for adjacent-level signal nets, mark on bitmap
  for (const [netName, net] of netlist.nets) {
    if (net.isPower) continue;
    const pins = netPins.get(netName);
    if (!pins || pins.length !== 2) continue;

    if (shouldUseWire(pins, levels)) {
      const wireSegs = route(pins[0].position, pins[1].position);
      wirePlacements.push(...wireSegs);
      for (const seg of wireSegs) {
        bitmap.markWire(seg.from.x, seg.from.y, seg.to.x, seg.to.y);
      }
    }
  }

  // Phase 3: Place labels using occupancy bitmap for collision-free placement
  for (const [netName, net] of netlist.nets) {
    if (net.isPower) continue;
    const pins = netPins.get(netName);
    if (!pins) continue;

    // Skip nets that were wired directly
    if (pins.length === 2 && shouldUseWire(pins, levels)) continue;

    for (const pp of pins) {
      if (pp.symbolRef === anchorRef) continue;

      const exitAngle = (pp.pinAngle + pp.symbolRotation) % 360;
      const bestPos = findBestLabelPosition(bitmap, pp.position, exitAngle, netName);

      labelPlacements.push({ netName, at: bestPos, angle: 0 });

      // Wire stub from pin to label
      const wireSegs = route(pp.position, bestPos);
      wirePlacements.push(...wireSegs);

      // Mark label and wire on bitmap so subsequent labels avoid this area
      bitmap.markRect(labelRect(bestPos, netName));
      for (const seg of wireSegs) {
        bitmap.markWire(seg.from.x, seg.from.y, seg.to.x, seg.to.y);
      }
    }
  }

  return { powerPlacements, labelPlacements, wirePlacements };
}

/**
 * Find the best position for a label among 8 candidates.
 * Prefers the pin's exit direction. Falls back to the candidate
 * with the least overlap on the occupancy bitmap.
 */
function findBestLabelPosition(
  bitmap: OccupancyBitmap,
  pinPos: Point,
  exitAngleDeg: number,
  netName: string,
): Point {
  // Sort candidates: prefer the exit direction first, then others
  const sorted = [...CANDIDATES].sort((a, b) => {
    const angleA = Math.atan2(-a[1], a[0]) * 180 / Math.PI;
    const angleB = Math.atan2(-b[1], b[0]) * 180 / Math.PI;
    const diffA = Math.abs(((angleA - exitAngleDeg + 540) % 360) - 180);
    const diffB = Math.abs(((angleB - exitAngleDeg + 540) % 360) - 180);
    return diffA - diffB;
  });

  let bestPos: Point | null = null;
  let bestOverlap = Infinity;

  for (const [dx, dy] of sorted) {
    const candidatePos: Point = {
      x: Math.round((pinPos.x + dx * LABEL_OFFSET) * 100) / 100,
      y: Math.round((pinPos.y + dy * LABEL_OFFSET) * 100) / 100,
    };

    const rect = labelRect(candidatePos, netName);

    if (!bitmap.isOccupied(rect)) {
      return candidatePos; // found a free spot
    }

    const overlap = bitmap.overlapCount(rect);
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      bestPos = candidatePos;
    }
  }

  // All candidates overlap -- return the one with least overlap
  return bestPos ?? { x: pinPos.x + LABEL_OFFSET, y: pinPos.y };
}

function shouldUseWire(
  pins: PinPosition[],
  levels?: Map<string, number>,
): boolean {
  if (pins.length !== 2) return false;
  if (levels && levels.size > 0) {
    const l0 = levels.get(pins[0].symbolRef);
    const l1 = levels.get(pins[1].symbolRef);
    if (l0 !== undefined && l1 !== undefined) return Math.abs(l0 - l1) <= 1;
  }
  const dist = Math.sqrt(
    (pins[0].position.x - pins[1].position.x) ** 2 +
    (pins[0].position.y - pins[1].position.y) ** 2
  );
  return dist < GRID * 20;
}
