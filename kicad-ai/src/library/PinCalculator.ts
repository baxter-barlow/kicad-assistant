export interface Point {
  x: number;
  y: number;
}

/**
 * Compute the absolute position of a pin given:
 * - symbolAt: where the symbol is placed on the schematic
 * - pinLocal: the pin's position relative to the symbol origin (from lib_symbols)
 * - rotation: symbol rotation in degrees (0, 90, 180, 270)
 * - mirror: "x" or "y" or undefined
 *
 * KiCad angles: 0=right, 90=up, 180=left, 270=down
 * KiCad schematic coordinates use a screen-style Y axis where positive is down,
 * so positive rotations are clockwise rather than Cartesian counter-clockwise.
 */
export function getAbsolutePinPosition(
  symbolAt: Point,
  pinLocal: Point,
  rotation: number = 0,
  mirror?: "x" | "y"
): Point {
  let lx = pinLocal.x;
  let ly = pinLocal.y;

  // Apply mirror before rotation
  if (mirror === "x") {
    lx = -lx;
  } else if (mirror === "y") {
    ly = -ly;
  }

  // KiCad rotates clockwise in schematic space, so invert the angle before
  // applying standard Cartesian rotation math.
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rx = lx * cos - ly * sin;
  const ry = lx * sin + ly * cos;

  // Round to avoid floating point noise (KiCad uses 0.01mm precision)
  return {
    x: Math.round((symbolAt.x + rx) * 100) / 100,
    y: Math.round((symbolAt.y + ry) * 100) / 100,
  };
}
