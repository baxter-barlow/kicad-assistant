import { describe, it, expect } from "vitest";
import { route, routeChannel } from "../src/builder/WireRouter.js";

describe("Wire routing", () => {
  it("returns empty array for same point", () => {
    const segments = route({ x: 10, y: 20 }, { x: 10, y: 20 });
    expect(segments).toEqual([]);
  });

  it("returns 1 segment for vertically aligned points", () => {
    const segments = route({ x: 10, y: 20 }, { x: 10, y: 40 });
    expect(segments).toHaveLength(1);
    expect(segments[0].from).toEqual({ x: 10, y: 20 });
    expect(segments[0].to).toEqual({ x: 10, y: 40 });
  });

  it("returns 1 segment for horizontally aligned points", () => {
    const segments = route({ x: 10, y: 20 }, { x: 30, y: 20 });
    expect(segments).toHaveLength(1);
    expect(segments[0].from).toEqual({ x: 10, y: 20 });
    expect(segments[0].to).toEqual({ x: 30, y: 20 });
  });

  it("returns 2 segments for L-bend routing", () => {
    const segments = route({ x: 10, y: 20 }, { x: 30, y: 40 });
    expect(segments).toHaveLength(2);
    // First segment: horizontal from (10,20) to (30,20)
    expect(segments[0].from).toEqual({ x: 10, y: 20 });
    expect(segments[0].to).toEqual({ x: 30, y: 20 });
    // Second segment: vertical from (30,20) to (30,40)
    expect(segments[1].from).toEqual({ x: 30, y: 20 });
    expect(segments[1].to).toEqual({ x: 30, y: 40 });
  });

  it("routes through an explicit channel with 3 segments", () => {
    const segments = routeChannel({ x: 10, y: 20 }, { x: 40, y: 50 }, 25);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ from: { x: 10, y: 20 }, to: { x: 25, y: 20 } });
    expect(segments[1]).toEqual({ from: { x: 25, y: 20 }, to: { x: 25, y: 50 } });
    expect(segments[2]).toEqual({ from: { x: 25, y: 50 }, to: { x: 40, y: 50 } });
  });
});
