/** Uniform-grid spatial index for circles: fast viewport culling and hit testing. */
export class GridIndex<T> {
  private cells = new Map<number, Array<{ item: T; x: number; y: number; r: number }>>();

  constructor(private cell = 64) {}

  private key(ix: number, iy: number) {
    return (ix + 32768) * 65536 + (iy + 32768);
  }

  clear() {
    this.cells.clear();
  }

  insert(item: T, x: number, y: number, r: number) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    const entry = { item, x, y, r };
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = this.key(ix, iy);
        const list = this.cells.get(k);
        if (list) list.push(entry); else this.cells.set(k, [entry]);
      }
    }
  }

  /** Every item whose circle intersects the rectangle (each item reported once). */
  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: Set<T> = new Set()): Set<T> {
    const c = this.cell;
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
    const y0 = Math.floor(minY / c), y1 = Math.floor(maxY / c);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size * 4) {
      // viewport larger than the populated area: scanning the cells is cheaper
      for (const list of this.cells.values()) for (const e of list) if (e.x + e.r >= minX && e.x - e.r <= maxX && e.y + e.r >= minY && e.y - e.r <= maxY) out.add(e.item);
      return out;
    }
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const list = this.cells.get(this.key(ix, iy));
        if (list) for (const e of list) out.add(e.item);
      }
    }
    return out;
  }

  /** Smallest item containing the point (with `slack` world units of tolerance). */
  hit(x: number, y: number, slack = 0): T | null {
    const list = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(y / this.cell)));
    if (!list) return null;
    let best: { item: T; r: number } | null = null;
    for (const e of list) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d <= e.r + slack && (!best || e.r < best.r)) best = { item: e.item, r: e.r };
    }
    return best ? best.item : null;
  }
}
