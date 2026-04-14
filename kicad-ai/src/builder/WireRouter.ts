import type { Point } from "../library/PinCalculator.js";

export interface WireSegment {
  from: Point;
  to: Point;
}

/**
 * Route a wire between two points using Manhattan (L-shaped) routing.
 * Returns 1 segment if points are aligned, 2 segments with an L-bend otherwise.
 */
export function route(from: Point, to: Point): WireSegment[] {
  if (Math.abs(from.x - to.x) < 0.01 && Math.abs(from.y - to.y) < 0.01) {
    return [];
  }

  if (Math.abs(from.x - to.x) < 0.01 || Math.abs(from.y - to.y) < 0.01) {
    return [{ from, to }];
  }

  const corner: Point = { x: to.x, y: from.y };
  return [
    { from, to: corner },
    { from: corner, to },
  ];
}

/**
 * Route through a vertical channel between two columns.
 * Creates 3 segments: horizontal stub → vertical channel → horizontal stub.
 */
export function routeChannel(from: Point, to: Point, channelX: number): WireSegment[] {
  const segments: WireSegment[] = [];
  const top: Point = { x: channelX, y: from.y };
  const bottom: Point = { x: channelX, y: to.y };

  // Horizontal from source to channel
  if (Math.abs(from.x - channelX) > 0.01) {
    segments.push({ from, to: top });
  }
  // Vertical through channel
  if (Math.abs(from.y - to.y) > 0.01) {
    segments.push({ from: top, to: bottom });
  }
  // Horizontal from channel to destination
  if (Math.abs(channelX - to.x) > 0.01) {
    segments.push({ from: bottom, to });
  }

  return segments;
}
