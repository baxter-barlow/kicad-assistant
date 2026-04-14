import type { Point } from "../library/PinCalculator.js";

export interface PointConnectivityWire {
  points: readonly Point[];
}

interface WireSegment {
  from: Point;
  to: Point;
}

const EPSILON = 0.001;

export function pointKey(point: Point): string {
  return `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`;
}

export function buildPointConnectivityGroups(
  points: readonly Point[],
  wires: readonly PointConnectivityWire[],
): Map<string, string[]> {
  const uniquePoints = dedupePoints(points);
  const uf = new UnionFind();

  for (const point of uniquePoints) {
    uf.find(pointKey(point));
  }

  for (const segment of expandSegments(wires)) {
    const touchingPoints = uniquePoints
      .filter(point => pointLiesOnSegment(point, segment))
      .sort((left, right) => segmentParameter(left, segment) - segmentParameter(right, segment));

    for (let index = 0; index < touchingPoints.length - 1; index++) {
      uf.union(pointKey(touchingPoints[index]), pointKey(touchingPoints[index + 1]));
    }
  }

  return uf.groups();
}

function dedupePoints(points: readonly Point[]): Point[] {
  const seen = new Set<string>();
  const result: Point[] = [];
  for (const point of points) {
    const key = pointKey(point);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }
  return result;
}

function expandSegments(wires: readonly PointConnectivityWire[]): WireSegment[] {
  const segments: WireSegment[] = [];
  for (const wire of wires) {
    if (wire.points.length < 2) continue;
    for (let index = 0; index < wire.points.length - 1; index++) {
      const from = wire.points[index];
      const to = wire.points[index + 1];
      if (pointKey(from) === pointKey(to)) continue;
      segments.push({ from, to });
    }
  }
  return segments;
}

function pointLiesOnSegment(point: Point, segment: WireSegment): boolean {
  const { from, to } = segment;
  const cross = ((point.y - from.y) * (to.x - from.x)) - ((point.x - from.x) * (to.y - from.y));
  if (Math.abs(cross) > EPSILON) {
    return false;
  }

  const minX = Math.min(from.x, to.x) - EPSILON;
  const maxX = Math.max(from.x, to.x) + EPSILON;
  const minY = Math.min(from.y, to.y) - EPSILON;
  const maxY = Math.max(from.y, to.y) + EPSILON;
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function segmentParameter(point: Point, segment: WireSegment): number {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;

  if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > EPSILON) {
    return (point.x - segment.from.x) / dx;
  }
  if (Math.abs(dy) > EPSILON) {
    return (point.y - segment.from.y) / dy;
  }
  return 0;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(key: string): string {
    if (!this.parent.has(key)) this.parent.set(key, key);
    let root = key;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }

    let cursor = key;
    while (cursor !== root) {
      const next = this.parent.get(cursor)!;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parent.set(leftRoot, rightRoot);
    }
  }

  groups(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      const bucket = groups.get(root) ?? [];
      bucket.push(key);
      groups.set(root, bucket);
    }
    return groups;
  }
}
