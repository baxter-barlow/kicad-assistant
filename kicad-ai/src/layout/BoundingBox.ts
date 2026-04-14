import { findChildren, findChild, type SExpr } from "../sexpr/parser.js";
import type { SymbolDef } from "../library/SymbolLibrary.js";

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Compute the local bounding box of a symbol from its graphics elements and pin endpoints.
 * Coordinates are relative to the symbol origin (0,0).
 */
export function computeBoundingBox(symbolDef: SymbolDef): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function expand(x: number, y: number) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const rawExpr = symbolDef.rawSExpr as SExpr[];
  const subSymbols = findChildren(rawExpr, "symbol");

  for (const sub of subSymbols) {
    // Rectangles
    for (const rect of findChildren(sub, "rectangle")) {
      const start = findChild(rect, "start");
      const end = findChild(rect, "end");
      if (start && typeof start[1] === "number" && typeof start[2] === "number") {
        expand(start[1], start[2]);
      }
      if (end && typeof end[1] === "number" && typeof end[2] === "number") {
        expand(end[1], end[2]);
      }
    }

    // Polylines
    for (const poly of findChildren(sub, "polyline")) {
      const pts = findChild(poly, "pts");
      if (!pts) continue;
      for (const xy of findChildren(pts, "xy")) {
        if (typeof xy[1] === "number" && typeof xy[2] === "number") {
          expand(xy[1], xy[2]);
        }
      }
    }

    // Circles
    for (const circle of findChildren(sub, "circle")) {
      const center = findChild(circle, "center");
      const radius = findChild(circle, "radius");
      if (center && typeof center[1] === "number" && typeof center[2] === "number" &&
          radius && typeof radius[1] === "number") {
        const r = radius[1];
        expand(center[1] - r, center[2] - r);
        expand(center[1] + r, center[2] + r);
      }
    }

    // Arcs (use start/mid/end points as bounds approximation)
    for (const arc of findChildren(sub, "arc")) {
      for (const tag of ["start", "mid", "end"]) {
        const pt = findChild(arc, tag);
        if (pt && typeof pt[1] === "number" && typeof pt[2] === "number") {
          expand(pt[1], pt[2]);
        }
      }
    }
  }

  // Include pin endpoints
  for (const pin of symbolDef.pins) {
    expand(pin.x, pin.y);
  }

  // If no graphics found, use pins only (already included above)
  if (!isFinite(minX)) {
    minX = 0; minY = 0; maxX = 0; maxY = 0;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
