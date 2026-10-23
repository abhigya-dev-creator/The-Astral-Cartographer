export type Tone = 'b' | 'v' | 'w';
export interface NodeDef { x: number; y: number; tone: Tone; size: number }   // x, y are positions inside the background image (0 to 1)
export type Link = [number, number, number];                                    // from node, to node, curve amount
export interface Options { imageAspect: number; nodes: NodeDef[]; links: Link[]; reduced: boolean }

const RGB: Record<Tone | 'x', [number, number, number]> = { b: [93, 134, 255], v: [165, 125, 255], w: [255, 150, 90], x: [255, 255, 255] };
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t: number) => t * t * (3 - 2 * t);
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
interface Pulse { e: number; u: number; v: number; dir: 1 | -1 }

export class Constellation {
  private ctx: CanvasRenderingContext2D;
  private W = 0; private H = 0; private u = 1; private T = 0;
  private raf = 0; private last = 0;
  private rand = rng(5);
  private sprites: Record<string, HTMLCanvasElement> = {};
  private pts: { x: number; y: number; on: boolean }[] = [];
  private nodeWake: number[]; private edgeStart: number[]; private edgeDur: number[]; private edgeEnd: number;
  private specks: { x: number; y: number; a: number; wake: number; sp: number; ph: number }[] = [];
  private pulses: Pulse[] = [];
  private onResize = () => this.resize();
  private onVis = () => (document.hidden ? cancelAnimationFrame(this.raf) : this.start());

  constructor(private canvas: HTMLCanvasElement, private o: Options) {
    this.ctx = canvas.getContext('2d')!;
    (Object.keys(RGB) as (Tone | 'x')[]).forEach((k) => (this.sprites[k] = this.makeSprite(RGB[k])));
    // timeline in seconds: stars awaken first, then the lines form, then pulses start
    this.nodeWake = o.nodes.map((_, i) => 1.3 + i * 0.16);
    this.edgeStart = o.links.map((_, i) => 2.7 + i * 0.1);
    this.edgeDur = o.links.map(() => 1.1 + this.rand() * 0.4);
    this.edgeEnd = Math.max(...this.edgeStart.map((s, i) => s + this.edgeDur[i]));
    for (let i = 0; i < 140; i++) this.specks.push({ x: this.rand(), y: this.rand(), a: 0.25 + this.rand() * 0.45, wake: 0.8 + this.rand() * 2.2, sp: 1 + this.rand() * 3, ph: this.rand() * 6.3 });
    if (o.reduced) this.T = 99;
    this.resize();
    addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVis);
  }
  private makeSprite([r, g, b]: number[]) {
    const s = document.createElement('canvas'); s.width = s.height = 128; const x = s.getContext('2d')!;
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, `rgba(${r},${g},${b},.9)`);
    gr.addColorStop(0.4, `rgba(${r},${g},${b},.25)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return s;
  }
  private resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.W = innerWidth; this.H = innerHeight;
    this.canvas.width = this.W * dpr; this.canvas.height = this.H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.u = clamp(Math.min(this.W, this.H) / 900, 0.7, 1.3);
    // same maths as CSS background-size: cover, centered, so nodes stay on the image's own stars
    const dh = Math.max(this.H, this.W / this.o.imageAspect), dw = dh * this.o.imageAspect;
    const ox = (this.W - dw) / 2, oy = (this.H - dh) / 2;
    this.pts = this.o.nodes.map((n) => {
      const x = ox + n.x * dw, y = oy + n.y * dh;
      return { x, y, on: x > -10 && x < this.W + 10 && y > -10 && y < this.H + 10 };
    });
    if (this.o.reduced) this.draw();
  }
  private bez(a: number, b: number, k: number, t: number): [number, number] {
    const p0 = this.pts[a], p2 = this.pts[b], mx = (p0.x + p2.x) / 2, my = (p0.y + p2.y) / 2, q = 1 - t;
    const cx = mx + (mx - this.W / 2) * k * 1.6, cy = my + (my - this.H / 2) * k * 1.6;
    return [q * q * p0.x + 2 * q * t * cx + t * t * p2.x, q * q * p0.y + 2 * q * t * cy + t * t * p2.y];
  }
  start() { cancelAnimationFrame(this.raf); if (this.o.reduced) return; this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); }
  stop() { cancelAnimationFrame(this.raf); removeEventListener('resize', this.onResize); document.removeEventListener('visibilitychange', this.onVis); }
  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.T += dt;
    if (this.T > this.edgeEnd && this.pulses.length < 5 && this.rand() < dt * 1.2)
      this.pulses.push({ e: (this.rand() * this.o.links.length) | 0, u: 0, v: 0.18 + this.rand() * 0.14, dir: this.rand() < 0.5 ? 1 : -1 });
    this.pulses.forEach((p) => (p.u += p.v * dt));
    this.pulses = this.pulses.filter((p) => p.u < 1);
    this.draw(); this.raf = requestAnimationFrame(this.frame);
  };
  private draw() {
    const { ctx, W, H, T } = this; const { nodes, links, reduced } = this.o;
    ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#cfe0ff';
    for (const s of this.specks) {
      const k = ease(clamp((T - s.wake) / 1.2)); if (k <= 0) continue;
      ctx.globalAlpha = s.a * k * (reduced ? 1 : 0.65 + 0.35 * Math.sin(T * s.sp + s.ph));
      ctx.fillRect(s.x * W, s.y * H, 1.4, 1.4);
    }
    ctx.globalCompositeOperation = 'lighter';
    links.forEach(([a, b, k], i) => {
      if (!this.pts[a].on || !this.pts[b].on) return;
      const p = ease(clamp((T - this.edgeStart[i]) / this.edgeDur[i])); if (p <= 0) return;
      const A = RGB[nodes[a].tone], B = RGB[nodes[b].tone], g = ctx.createLinearGradient(this.pts[a].x, this.pts[a].y, this.pts[b].x, this.pts[b].y);
      g.addColorStop(0, `rgb(${A})`); g.addColorStop(1, `rgb(${B})`);
      ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(this.pts[a].x, this.pts[a].y);
      for (let s = 1; s <= 30; s++) { const [x, y] = this.bez(a, b, k, (p * s) / 30); ctx.lineTo(x, y); }
      ctx.globalAlpha = 0.12; ctx.lineWidth = 4; ctx.stroke(); ctx.globalAlpha = 0.65; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#cfe0ff'; ctx.globalAlpha = 0.75;
      for (let d = 1; d < 7; d++) { const u = d / 7; if (u > p) break; const [x, y] = this.bez(a, b, k, u); ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6); }
    });
    for (const p of this.pulses) {
      const [a, b, k] = links[p.e]; if (!this.pts[a].on || !this.pts[b].on) continue;
      const u = p.dir > 0 ? p.u : 1 - p.u, spr = this.sprites[nodes[a].tone];
      for (let d = 0; d < 4; d++) { const [x, y] = this.bez(a, b, k, clamp(u - d * 0.012 * p.dir)), s = (16 - d * 3) * this.u; ctx.globalAlpha = (1 - d * 0.25) * 0.9; ctx.drawImage(spr, x - s, y - s, s * 2, s * 2); }
    }
    nodes.forEach((n, i) => {
      const pt = this.pts[i]; if (!pt.on) return;
      const k = ease(clamp((T - this.nodeWake[i]) / 1.1)); if (k <= 0) return;
      const sz = n.size * this.u * k * (reduced ? 1 : 1 + 0.08 * Math.sin(T * 1.6 + i)), g = sz * 7, rgb = RGB[n.tone], L = sz * 9;
      ctx.globalAlpha = 0.95 * k; ctx.drawImage(this.sprites[n.tone], pt.x - g, pt.y - g, g * 2, g * 2);
      for (const [x1, y1, x2, y2] of [[pt.x - L, pt.y, pt.x + L, pt.y], [pt.x, pt.y - L, pt.x, pt.y + L]]) {
        const sp = ctx.createLinearGradient(x1, y1, x2, y2);
        sp.addColorStop(0, `rgba(${rgb},0)`); sp.addColorStop(0.5, `rgba(${rgb},.8)`); sp.addColorStop(1, `rgba(${rgb},0)`);
        ctx.strokeStyle = sp; ctx.lineWidth = 1; ctx.globalAlpha = k; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.globalAlpha = k; ctx.drawImage(this.sprites.x, pt.x - sz, pt.y - sz, sz * 2, sz * 2);
      if (n.size > 5) { ctx.strokeStyle = `rgba(${rgb},.18)`; for (const m of [2, 3.2, 4.6]) { ctx.beginPath(); ctx.arc(pt.x, pt.y, sz * m, 0, 6.283); ctx.stroke(); } }
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
}
