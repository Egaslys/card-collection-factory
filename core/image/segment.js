// Box → hero outline: GrabCut (Rother, Kolmogorov, Blake, «GrabCut: interactive foreground extraction using
// iterated graph cuts», SIGGRAPH 2004) with the Boykov–Kolmogorov max-flow (Boykov, Kolmogorov, «An experimental
// comparison of min-cut/max-flow algorithms for energy minimization in vision», PAMI 2004).
// Pure functions over 8-bit RGB or RGBA pixels with no Node or library imports, like adjust.js: the same code runs
// in the card loop and on the editor page, where a person draws a box and sees the outline at once.
//
// Everything outside the box is backdrop; inside, colour models of hero and backdrop (Gaussian mixtures in CIE Lab)
// and a contrast-sensitive smoothness term decide pixel by pixel. A glow behind the hero, its cast shadow and the
// floor it stands on are colours the backdrop model has seen outside the box, so they fall to the backdrop; a part of
// the hero that shares the backdrop's hue stays with the hero when it is bounded by an edge. Measured accuracy and
// cost: core/card/hero.js and the changelog entry of 2026-10-30.

const COMPONENTS = 5;      // Gaussians per colour model (the paper's K)
const GAMMA = 50;          // weight of the smoothness term (the paper's γ)
const ITERATIONS = 4;      // re-estimation rounds; stops earlier when < 0.1 % of pixels change
const MARGIN_PX = 2;       // the box is grown by this much before everything outside it is fixed as backdrop
const COV_REG = 1;         // added to the covariance diagonal (Lab units²) so a flat region stays invertible

/** @typedef {[number, number, number, number]} Box  [x0, y0, x1, y1], inclusive pixel coordinates */

// ---------- max-flow ----------
/** Directed graph with paired arcs (a, a ^ 1) and terminal capacities; `maxflow` then `isSource(i)`. */
export class Graph {
  /** @param {number} n nodes @param {number} maxArcs */
  constructor(n, maxArcs) {
    this.n = n;
    this.head = new Int32Array(maxArcs); this.next = new Int32Array(maxArcs); this.cap = new Float32Array(maxArcs);
    this.first = new Int32Array(n).fill(-1); this.tr = new Float64Array(n); this.arcs = 0; this.flow = 0;
    this.tree = new Uint8Array(n);
  }
  /** Edge i → j with capacity cij and j → i with cji. @param {number} i @param {number} j @param {number} cij @param {number} cji */
  addEdge(i, j, cij, cji) {
    const a = this.arcs; this.arcs += 2;
    this.head[a] = j; this.next[a] = this.first[i]; this.first[i] = a; this.cap[a] = cij;
    this.head[a + 1] = i; this.next[a + 1] = this.first[j]; this.first[j] = a + 1; this.cap[a + 1] = cji;
  }
  /** Capacities source → i and i → sink. @param {number} i @param {number} toSource @param {number} toSink */
  addTWeights(i, toSource, toSink) { this.flow += Math.min(toSource, toSink); this.tr[i] += toSource - toSink; }
  /** Runs the Boykov–Kolmogorov algorithm; returns the flow value (= the minimum cut). */
  maxflow() {
    const { n, head, next, cap, first, tr, tree } = this;
    const TERM = -2, ORPHAN = -3, NONE = -1;
    const parent = new Int32Array(n).fill(NONE), ts = new Int32Array(n), dist = new Int32Array(n);
    const queue = new Int32Array(n + 1), queued = new Uint8Array(n);
    let qh = 0, qt = 0, qn = 0, time = 1;
    /** @param {number} i */
    const activate = i => { if (queued[i]) return; queued[i] = 1; queue[qt] = i; qt = (qt + 1) % queue.length; qn++; };
    tree.fill(0);
    for (let i = 0; i < n; i++) if (tr[i] !== 0) { tree[i] = tr[i] > 0 ? 1 : 2; parent[i] = TERM; ts[i] = time; dist[i] = 1; activate(i); }
    /** @type {number[]} */
    const orphans = [];
    for (;;) {
      // growth: S and T trees grow until an arc joins them
      let meet = -1;
      while (qn > 0) {
        const p = queue[qh]; qh = (qh + 1) % queue.length; qn--; queued[p] = 0;
        if (!tree[p]) continue;
        for (let a = first[p]; a >= 0; a = next[a]) {
          const q = head[a];
          if (tree[p] === 1) {
            if (cap[a] <= 0) continue;
            if (!tree[q]) { tree[q] = 1; parent[q] = a ^ 1; ts[q] = ts[p]; dist[q] = dist[p] + 1; activate(q); }
            else if (tree[q] === 2) { meet = a; break; }
          } else {
            if (cap[a ^ 1] <= 0) continue;
            if (!tree[q]) { tree[q] = 2; parent[q] = a ^ 1; ts[q] = ts[p]; dist[q] = dist[p] + 1; activate(q); }
            else if (tree[q] === 1) { meet = a ^ 1; break; }
          }
        }
        if (meet >= 0) { activate(p); break; }
      }
      if (meet < 0) break;
      time++;
      // augmentation along source → … → head[meet ^ 1] → head[meet] → … → sink
      const s0 = head[meet ^ 1], t0 = head[meet];
      let b = cap[meet];
      for (let i = s0; ;) { const a = parent[i]; if (a === TERM) { b = Math.min(b, tr[i]); break; } b = Math.min(b, cap[a ^ 1]); i = head[a]; }
      for (let i = t0; ;) { const a = parent[i]; if (a === TERM) { b = Math.min(b, -tr[i]); break; } b = Math.min(b, cap[a]); i = head[a]; }
      cap[meet] -= b; cap[meet ^ 1] += b;
      for (let i = s0; ;) {
        const a = parent[i];
        if (a === TERM) { tr[i] -= b; if (tr[i] <= 0) { parent[i] = ORPHAN; orphans.push(i); } break; }
        cap[a ^ 1] -= b; cap[a] += b; if (cap[a ^ 1] <= 0) { parent[i] = ORPHAN; orphans.push(i); }
        i = head[a];
      }
      for (let i = t0; ;) {
        const a = parent[i];
        if (a === TERM) { tr[i] += b; if (tr[i] >= 0) { parent[i] = ORPHAN; orphans.push(i); } break; }
        cap[a] -= b; cap[a ^ 1] += b; if (cap[a] <= 0) { parent[i] = ORPHAN; orphans.push(i); }
        i = head[a];
      }
      this.flow += b;
      // adoption: an orphan finds a new parent in its tree or becomes free
      while (orphans.length) {
        const p = /** @type {number} */ (orphans.pop()), t = tree[p];
        let bestA = NONE, bestD = 1 << 30;
        for (let a = first[p]; a >= 0; a = next[a]) {
          const q = head[a];
          if (tree[q] !== t || (t === 1 ? cap[a ^ 1] : cap[a]) <= 0) continue;
          let d = 0, j = q, rooted = false;
          for (;;) {
            if (ts[j] === time) { d += dist[j]; rooted = true; break; }
            const pa = parent[j]; d++;
            if (pa === TERM) { ts[j] = time; dist[j] = 1; rooted = true; break; }
            if (pa < 0) break;
            j = head[pa];
          }
          if (!rooted) continue;
          if (d < bestD) { bestA = a; bestD = d; }
          for (let j2 = q; ts[j2] !== time; j2 = head[parent[j2]]) { ts[j2] = time; dist[j2] = d--; }
        }
        if (bestA !== NONE) { parent[p] = bestA; ts[p] = time; dist[p] = bestD + 1; continue; }
        for (let a = first[p]; a >= 0; a = next[a]) {
          const q = head[a];
          if (tree[q] !== t) continue;
          if ((t === 1 ? cap[a ^ 1] : cap[a]) > 0) activate(q);
          if (parent[q] >= 0 && head[parent[q]] === p) { parent[q] = ORPHAN; orphans.push(q); }
        }
        tree[p] = 0; parent[p] = NONE;
      }
    }
    return this.flow;
  }
  /** After maxflow: node i is on the source side of the minimum cut. @param {number} i */
  isSource(i) { return this.tree[i] === 1; }
}

// ---------- colour ----------
const LIN = Float64Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
/** @param {number} t */
const f3 = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
/**
 * CIE Lab (D65) of every pixel.
 * @param {ArrayLike<number>} pixels RGB or RGBA @param {number} n pixel count
 * @returns {Float32Array} L, a, b per pixel
 */
export function toLab(pixels, n) {
  const ch = pixels.length / n, out = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) {
    const R = LIN[pixels[p * ch]], G = LIN[pixels[p * ch + 1]], B = LIN[pixels[p * ch + 2]];
    const fx = f3((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), fy = f3(0.2126 * R + 0.7152 * G + 0.0722 * B), fz = f3((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
    out[p * 3] = 116 * fy - 16; out[p * 3 + 1] = 500 * (fx - fy); out[p * 3 + 2] = 200 * (fy - fz);
  }
  return out;
}

// ---------- Gaussian mixtures ----------
/** @typedef {{n: number, m: number[], inv: number[], logC: number}} Gaussian  logC = log weight − ½ log det Σ */

/** k clusters of the pixels idx, seeded at evenly spaced lightness quantiles (deterministic). */
/** @param {Float32Array} X @param {number[]} idx @param {Uint8Array} asg written: cluster per pixel */
function cluster(X, idx, asg) {
  const s = [...idx].sort((a, b) => X[a * 3] - X[b * 3]);
  /** @type {number[][]} */
  let C = [];
  for (let i = 0; i < COMPONENTS; i++) { const p = s[Math.floor((i + 0.5) / COMPONENTS * s.length)]; C.push([X[p * 3], X[p * 3 + 1], X[p * 3 + 2]]); }
  for (let it = 0; it < 6; it++) {
    const sum = C.map(() => [0, 0, 0, 0]);
    for (const p of idx) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < C.length; c++) { const d = (X[p * 3] - C[c][0]) ** 2 + (X[p * 3 + 1] - C[c][1]) ** 2 + (X[p * 3 + 2] - C[c][2]) ** 2; if (d < bd) { bd = d; bi = c; } }
      asg[p] = bi; const t = sum[bi]; t[0] += X[p * 3]; t[1] += X[p * 3 + 1]; t[2] += X[p * 3 + 2]; t[3]++;
    }
    C = C.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
  }
}
/** @param {Float32Array} X @param {number[]} idx @param {Uint8Array} asg @returns {Gaussian[]} */
function fitMixture(X, idx, asg) {
  /** @type {Gaussian[]} */
  const out = [];
  for (let c = 0; c < COMPONENTS; c++) {
    let n = 0; const m = [0, 0, 0], S = new Array(9).fill(0);
    for (const p of idx) {
      if (asg[p] !== c) continue;
      n++;
      for (let a = 0; a < 3; a++) { m[a] += X[p * 3 + a]; for (let b = 0; b < 3; b++) S[a * 3 + b] += X[p * 3 + a] * X[p * 3 + b]; }
    }
    if (n < 10) continue;
    for (let a = 0; a < 3; a++) m[a] /= n;
    const v = S.map((s, i) => s / n - m[(i / 3) | 0] * m[i % 3]);
    v[0] += COV_REG; v[4] += COV_REG; v[8] += COV_REG;
    const [a, b, c2, d, e, f, g, h, i] = v;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c2 * (d * h - e * g);
    if (!(det > 0)) continue;
    const inv = [(e * i - f * h) / det, (c2 * h - b * i) / det, (b * f - c2 * e) / det, (f * g - d * i) / det, (a * i - c2 * g) / det, (c2 * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
    out.push({ n, m, inv, logC: -0.5 * Math.log(det) });
  }
  const total = out.reduce((s, g) => s + g.n, 0);
  for (const g of out) g.logC += Math.log(g.n / total);
  return out;
}
/** @param {Gaussian} g @param {Float32Array} X @param {number} p */
function logDensity(g, X, p) {
  const d0 = X[p * 3] - g.m[0], d1 = X[p * 3 + 1] - g.m[1], d2 = X[p * 3 + 2] - g.m[2], v = g.inv;
  return g.logC - 0.5 * (d0 * (v[0] * d0 + v[1] * d1 + v[2] * d2) + d1 * (v[3] * d0 + v[4] * d1 + v[5] * d2) + d2 * (v[6] * d0 + v[7] * d1 + v[8] * d2));
}
/** @param {Gaussian[]} gs @param {Float32Array} X @param {number} p */
function negLog(gs, X, p) {
  let mx = -Infinity; const l = gs.map(g => { const v = logDensity(g, X, p); if (v > mx) mx = v; return v; });
  let s = 0; for (const v of l) s += Math.exp(v - mx);
  return -(mx + Math.log(s));
}
/** @param {Gaussian[]} gs @param {Float32Array} X @param {number} p */
function nearest(gs, X, p) { let bi = 0, bl = -Infinity; gs.forEach((g, i) => { const v = logDensity(g, X, p); if (v > bl) { bl = v; bi = i; } }); return bi; }

// ---------- GrabCut ----------
/**
 * The hero outline inside a box.
 * @param {ArrayLike<number>} pixels RGB or RGBA, row by row, 8 bits per channel
 * @param {number} width @param {number} height
 * @param {Box} box the hero's box; everything outside it (grown by 2 px) is backdrop
 * @returns {Uint8Array} 1 = hero, per pixel
 */
export function outlineInBox(pixels, width, height, box) {
  const N = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || N <= 0 || (pixels.length !== N * 3 && pixels.length !== N * 4)) {
    throw new Error(`outlineInBox: ожидались пиксели RGB или RGBA ${width} × ${height}, а длина массива ${pixels.length}`);
  }
  const [x0, y0, x1, y1] = box.map(Math.round);
  const inside = new Uint8Array(N);
  for (let y = Math.max(0, y0 - MARGIN_PX); y <= Math.min(height - 1, y1 + MARGIN_PX); y++)
    for (let x = Math.max(0, x0 - MARGIN_PX); x <= Math.min(width - 1, x1 + MARGIN_PX); x++) inside[y * width + x] = 1;
  const X = toLab(pixels, N);
  // smoothness weights between 8-neighbours: γ / distance · exp(−β ‖Δz‖²), β = 1 / (2 ⟨‖Δz‖²⟩)
  const steps = [[1, 0], [0, 1], [1, 1], [-1, 1]];
  /** @type {number[]} */
  const pairs = [];
  /** @type {number[]} */
  const d2s = [];
  let sum = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (const [dx, dy] of steps) {
    const xx = x + dx, yy = y + dy; if (xx < 0 || xx >= width || yy >= height) continue;
    const p = y * width + x, q = yy * width + xx;
    if (!inside[p] && !inside[q]) continue; // both fixed as backdrop: the edge cannot be cut
    const d2 = (X[p * 3] - X[q * 3]) ** 2 + (X[p * 3 + 1] - X[q * 3 + 1]) ** 2 + (X[p * 3 + 2] - X[q * 3 + 2]) ** 2;
    pairs.push(p, q, Math.hypot(dx, dy)); d2s.push(d2); sum += d2;
  }
  const beta = d2s.length && sum > 0 ? 1 / (2 * sum / d2s.length) : 0;
  const weights = Float32Array.from(d2s, (d2, i) => GAMMA / pairs[i * 3 + 2] * Math.exp(-beta * d2));
  let hero = Uint8Array.from(inside);
  const asgH = new Uint8Array(N), asgB = new Uint8Array(N);
  for (let it = 0; it < ITERATIONS; it++) {
    /** @type {number[]} */
    const hi = [];
    /** @type {number[]} */
    const bi = [];
    for (let p = 0; p < N; p++) (hero[p] ? hi : bi).push(p);
    if (hi.length < 50 || bi.length < 50) break;
    cluster(X, hi, asgH); cluster(X, bi, asgB);
    let gh = fitMixture(X, hi, asgH), gb = fitMixture(X, bi, asgB);
    if (!gh.length || !gb.length) break;
    for (const p of hi) asgH[p] = nearest(gh, X, p);
    for (const p of bi) asgB[p] = nearest(gb, X, p);
    gh = fitMixture(X, hi, asgH); gb = fitMixture(X, bi, asgB);
    if (!gh.length || !gb.length) break;
    const g = new Graph(N, weights.length * 2);
    for (let p = 0; p < N; p++) {
      if (!inside[p]) { g.addTWeights(p, 0, 1e9); continue; }
      const dH = negLog(gh, X, p), dB = negLog(gb, X, p), m = Math.min(dH, dB);
      g.addTWeights(p, dB - m, dH - m); // source = hero: a hero pixel cut to the backdrop pays dB
    }
    for (let i = 0; i < weights.length; i++) g.addEdge(pairs[i * 3], pairs[i * 3 + 1], weights[i], weights[i]);
    g.maxflow();
    let changed = 0;
    const next = new Uint8Array(N);
    for (let p = 0; p < N; p++) { next[p] = g.isSource(p) ? 1 : 0; if (next[p] !== hero[p]) changed++; }
    hero = next;
    if (changed < N * 0.001) break;
  }
  return hero;
}

/** Box of the 1-pixels, or null. @param {ArrayLike<number>} mask @param {number} width @returns {Box|null} */
export function boxOf(mask, width) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let p = 0; p < mask.length; p++) if (mask[p]) { const x = p % width, y = (p / width) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 >= 0 ? [x0, y0, x1, y1] : null;
}

/** Intersection over union of two boxes (0 when either is missing). @param {Box|null} a @param {Box|null} b */
export function boxIou(a, b) {
  if (!a || !b) return 0;
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]) + 1), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]) + 1);
  const area = (/** @type {Box} */ r) => Math.max(0, r[2] - r[0] + 1) * Math.max(0, r[3] - r[1] + 1);
  const i = ix * iy, u = area(a) + area(b) - i;
  return u > 0 ? i / u : 0;
}
