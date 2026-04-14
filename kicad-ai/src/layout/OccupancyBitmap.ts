/**
 * 2D occupancy bitmap for collision-free label placement.
 *
 * Represents the schematic at ~1mm resolution. Each cell is either
 * occupied (by a symbol body, wire, power symbol, or label) or free.
 * Labels are placed at the first unoccupied candidate position.
 */

export interface Rect {
  x: number;      // left edge in mm
  y: number;      // top edge in mm
  width: number;  // in mm
  height: number; // in mm
}

const RESOLUTION = 1.0; // 1mm per pixel -- good balance of speed and accuracy

export class OccupancyBitmap {
  private grid: Uint8Array;
  private cols: number;
  private rows: number;
  private originX: number;
  private originY: number;

  /**
   * Create a bitmap covering the given area.
   * @param minX left edge of covered area (mm)
   * @param minY top edge of covered area (mm)
   * @param maxX right edge (mm)
   * @param maxY bottom edge (mm)
   */
  constructor(minX: number, minY: number, maxX: number, maxY: number) {
    this.originX = minX;
    this.originY = minY;
    this.cols = Math.ceil((maxX - minX) / RESOLUTION) + 1;
    this.rows = Math.ceil((maxY - minY) / RESOLUTION) + 1;
    this.grid = new Uint8Array(this.cols * this.rows);
  }

  /** Mark a rectangle as occupied. */
  markRect(rect: Rect): void {
    const x0 = Math.max(0, Math.floor((rect.x - this.originX) / RESOLUTION));
    const y0 = Math.max(0, Math.floor((rect.y - this.originY) / RESOLUTION));
    const x1 = Math.min(this.cols - 1, Math.ceil((rect.x + rect.width - this.originX) / RESOLUTION));
    const y1 = Math.min(this.rows - 1, Math.ceil((rect.y + rect.height - this.originY) / RESOLUTION));

    for (let r = y0; r <= y1; r++) {
      for (let c = x0; c <= x1; c++) {
        this.grid[r * this.cols + c] = 1;
      }
    }
  }

  /** Mark a wire segment as occupied (with ~1mm thickness). */
  markWire(fromX: number, fromY: number, toX: number, toY: number): void {
    const thickness = 1.5; // mm
    if (Math.abs(fromX - toX) < 0.1) {
      // Vertical wire
      const minY = Math.min(fromY, toY);
      const maxY = Math.max(fromY, toY);
      this.markRect({ x: fromX - thickness / 2, y: minY, width: thickness, height: maxY - minY });
    } else if (Math.abs(fromY - toY) < 0.1) {
      // Horizontal wire
      const minX = Math.min(fromX, toX);
      const maxX = Math.max(fromX, toX);
      this.markRect({ x: minX, y: fromY - thickness / 2, width: maxX - minX, height: thickness });
    } else {
      // Diagonal (shouldn't happen with Manhattan routing, but handle anyway)
      this.markRect({
        x: Math.min(fromX, toX),
        y: Math.min(fromY, toY),
        width: Math.abs(toX - fromX),
        height: Math.abs(toY - fromY),
      });
    }
  }

  /** Check if a rectangle overlaps any occupied cells. */
  isOccupied(rect: Rect): boolean {
    const x0 = Math.max(0, Math.floor((rect.x - this.originX) / RESOLUTION));
    const y0 = Math.max(0, Math.floor((rect.y - this.originY) / RESOLUTION));
    const x1 = Math.min(this.cols - 1, Math.ceil((rect.x + rect.width - this.originX) / RESOLUTION));
    const y1 = Math.min(this.rows - 1, Math.ceil((rect.y + rect.height - this.originY) / RESOLUTION));

    for (let r = y0; r <= y1; r++) {
      for (let c = x0; c <= x1; c++) {
        if (this.grid[r * this.cols + c]) return true;
      }
    }
    return false;
  }

  /** Count how many cells in a rectangle are occupied. */
  overlapCount(rect: Rect): number {
    const x0 = Math.max(0, Math.floor((rect.x - this.originX) / RESOLUTION));
    const y0 = Math.max(0, Math.floor((rect.y - this.originY) / RESOLUTION));
    const x1 = Math.min(this.cols - 1, Math.ceil((rect.x + rect.width - this.originX) / RESOLUTION));
    const y1 = Math.min(this.rows - 1, Math.ceil((rect.y + rect.height - this.originY) / RESOLUTION));

    let count = 0;
    for (let r = y0; r <= y1; r++) {
      for (let c = x0; c <= x1; c++) {
        if (this.grid[r * this.cols + c]) count++;
      }
    }
    return count;
  }
}
