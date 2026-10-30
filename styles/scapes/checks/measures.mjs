// measures.mjs — pixel measures behind check-card.mjs (Scapes style bible checks).
//
// Every measure here repeats the method that produced the bible's numbers when the 160 reference cards were
// analysed (the analysis scripts are local working materials of the style, outside Git), so the checks measure
// exactly what the bible measured:
//   heroMask             flood fill from the border through backdrop tones (the mask proposer of the analysis)
//   wholeCard, heroBackdrop, ramps   the colour measures behind COLOUR.md
//   backdropGeometry     glow fit, rays, rings, stripes, floor line (BACKGROUNDS.md)
//   edges                outline / edge width along the mask boundary (RENDERING.md checks 4–6)
//   overshoot            edge overshoot and edge width over the whole card (RENDERING.md check 17)
//   traces               grain in flat areas, JPEG 8x8 grid (RENDERING.md check 16)
//   nearWhite, lightCentroids, tonalRange   RENDERING.md checks 11, 2, 3
// Image reading and writing: sharp. Added for the checks: decode with alpha, frame detection, pattern steps along lines (BACKGROUNDS.md check 4),
// composition numbers from the mask, safe-zone counts.
//
// Coordinates: x right, y down, origin top-left, 430 x 480 px. Luma = 0.299R + 0.587G + 0.114B (0..255).
// L*, C* = CIE Lab (D65, sRGB); C* = hypot(a*, b*). Hue = HSV hue in degrees.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

export const W = 430, H = 480, N = W * H;

// ---------- decoding ----------
// Async (sharp). Returns { width, height, transparent, rgb }: rgb is 8-bit R,G,B per pixel, transparent counts pixels with alpha < 255.
// The bible measured the stored pixel values and ignored colour profiles (ffmpeg does). sharp converts pixels by an
// embedded ICC profile (even an sRGB one shifts some values by 1), so the iCCP chunk is cut out of the PNG first.
function withoutIccChunk(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return buf;
  const parts = [buf.subarray(0, 8)];
  for (let o = 8; o + 12 <= buf.length;) {
    const len = buf.readUInt32BE(o), end = o + 12 + len;
    if (buf.toString('latin1', o + 4, o + 8) !== 'iCCP') parts.push(buf.subarray(o, end));
    o = end;
  }
  return Buffer.concat(parts);
}
export async function decode(file) {
  const { data: raw, info } = await sharp(withoutIccChunk(readFileSync(file))).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || raw.length !== info.width * info.height * 4) throw new Error(`${file}: unexpected raw layout (${info.channels} channels)`);
  const n = info.width * info.height, rgb = Buffer.alloc(n * 3);
  let transparent = 0;
  for (let p = 0; p < n; p++) { rgb[p * 3] = raw[p * 4]; rgb[p * 3 + 1] = raw[p * 4 + 1]; rgb[p * 3 + 2] = raw[p * 4 + 2]; if (raw[p * 4 + 3] < 255) transparent++; }
  return { width: info.width, height: info.height, transparent, rgb };
}

// ---------- colour ----------
const LIN = new Float64Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const f3 = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
export function rgb2lab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, y = 0.2126 * R + 0.7152 * G + 0.0722 * B, z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = f3(x), fy = f3(y), fz = f3(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx / 255];
}
const hexOf = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
export const r1 = v => v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10;
export const r2 = v => v == null || Number.isNaN(v) ? null : Math.round(v * 100) / 100;
export const r3 = v => v == null || Number.isNaN(v) ? null : Math.round(v * 1000) / 1000;
export const hueDiff = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const q = (sorted, f) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : null;

export function planes(rgb) {
  const Y = new Float32Array(N), lab = new Float32Array(N * 3), hsv = new Float32Array(N * 3), C = new Float32Array(N);
  const cache = new Map();
  for (let p = 0; p < N; p++) {
    const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2], key = r << 16 | g << 8 | b;
    Y[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    let l = cache.get(key); if (!l) { l = rgb2lab(r, g, b); cache.set(key, l); }
    lab[p * 3] = l[0]; lab[p * 3 + 1] = l[1]; lab[p * 3 + 2] = l[2]; C[p] = Math.hypot(l[1], l[2]);
    const h = rgb2hsv(r, g, b); hsv[p * 3] = h[0]; hsv[p * 3 + 1] = h[1]; hsv[p * 3 + 2] = h[2];
  }
  const lap = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x; lap[p] = Math.abs(4 * Y[p] - Y[p - 1] - Y[p + 1] - Y[p - W] - Y[p + W]); }
  return { rgb, Y, lab, hsv, C, lap };
}

// ---------- k-means, morphology (as in the analysis) ----------
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function kmeans(pts, k, iters = 15, seed = 7) {
  const n = pts.length / 3, rand = rng(seed); k = Math.min(k, n);
  const C = [], d2 = new Float64Array(n).fill(Infinity);
  const first = Math.floor(rand() * n); C.push([pts[first * 3], pts[first * 3 + 1], pts[first * 3 + 2]]);
  while (C.length < k) {
    const c = C[C.length - 1]; let sum = 0;
    for (let i = 0; i < n; i++) { const d = (pts[i * 3] - c[0]) ** 2 + (pts[i * 3 + 1] - c[1]) ** 2 + (pts[i * 3 + 2] - c[2]) ** 2; if (d < d2[i]) d2[i] = d; sum += d2[i]; }
    let r = rand() * sum, j = 0; for (; j < n - 1; j++) { r -= d2[j]; if (r <= 0) break; }
    C.push([pts[j * 3], pts[j * 3 + 1], pts[j * 3 + 2]]);
  }
  const assign = new Uint8Array(n); let counts = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const s = C.map(() => [0, 0, 0]); counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = (pts[i * 3] - C[c][0]) ** 2 + (pts[i * 3 + 1] - C[c][1]) ** 2 + (pts[i * 3 + 2] - C[c][2]) ** 2; if (d < bd) { bd = d; bi = c; } }
      assign[i] = bi; counts[bi]++; s[bi][0] += pts[i * 3]; s[bi][1] += pts[i * 3 + 1]; s[bi][2] += pts[i * 3 + 2];
    }
    for (let c = 0; c < k; c++) if (counts[c]) C[c] = s[c].map(v => v / counts[c]);
  }
  return { centres: C, counts, assign };
}
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function morph(m, r, dil) {
  const tmp = new Uint8Array(N), out = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = dil ? 0 : 1;
    for (let dx = -r; dx <= r; dx++) { const xx = x + dx; const s = xx < 0 || xx >= W ? (dil ? 0 : 1) : m[y * W + xx]; if (dil ? s : !s) { v = dil ? 1 : 0; break; } }
    tmp[y * W + x] = v;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = dil ? 0 : 1;
    for (let dy = -r; dy <= r; dy++) { const yy = y + dy; const s = yy < 0 || yy >= H ? (dil ? 0 : 1) : tmp[yy * W + x]; if (dil ? s : !s) { v = dil ? 1 : 0; break; } }
    out[y * W + x] = v;
  }
  return out;
}
export const erode = (m, r) => morph(m, r, false), dilate = (m, r) => morph(m, r, true);
const invert = m => { const o = new Uint8Array(N); for (let p = 0; p < N; p++) o[p] = m[p] ? 0 : 1; return o; };
function components(m) {
  const label = new Int32Array(N).fill(-1), sizes = []; const st = [];
  for (let p = 0; p < N; p++) if (m[p] && label[p] < 0) {
    const id = sizes.length; let n = 0; st.push(p); label[p] = id;
    while (st.length) { const qq = st.pop(); n++; const x = qq % W, y = (qq / W) | 0;
      for (const r of [x > 0 ? qq - 1 : -1, x < W - 1 ? qq + 1 : -1, y > 0 ? qq - W : -1, y < H - 1 ? qq + W : -1]) if (r >= 0 && m[r] && label[r] < 0) { label[r] = id; st.push(r); } }
    sizes.push(n);
  }
  return { label, sizes };
}
const borderDist = p => { const x = p % W, y = (p / W) | 0; return Math.min(x, y, W - 1 - x, H - 1 - y); };
function touched(fg) {
  const line = (pred, len) => { let c = 0; for (let p = 0; p < N; p++) if (fg[p] && pred(p % W, (p / W) | 0)) c++; return c / (2 * len) >= 0.02; };
  return [['top', (x, y) => y < 2, W], ['bottom', (x, y) => y >= H - 2, W], ['left', x => x < 2, H], ['right', x => x >= W - 2, H]].filter(([, f, l]) => line(f, l)).map(([n]) => n);
}
function boxOf(m) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let p = 0; p < N; p++) if (m[p]) { const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 >= 0 ? [x0, y0, x1, y1] : null;
}

// ---------- hero mask (the analysis mask proposer: same thresholds and give-up rules) ----------
export function heroMask(P) {
  const STRIP = 12, STRIP_FIELD = 30, T = 11, T_LOCAL = 1.2, T2 = 30, lab = P.lab;
  const stripIdx = []; for (let p = 0; p < N; p++) if (borderDist(p) < STRIP) stripIdx.push(p);
  const pts = new Float32Array(stripIdx.length * 3); stripIdx.forEach((p, i) => { pts[i * 3] = lab[p * 3]; pts[i * 3 + 1] = lab[p * 3 + 1]; pts[i * 3 + 2] = lab[p * 3 + 2]; });
  const km = kmeans(pts, 4);
  const tones = km.centres.filter((_, c) => km.counts[c] >= 0.05 * stripIdx.length);
  const dist = new Float32Array(N);
  for (let p = 0; p < N; p++) { let m = Infinity; const l = [lab[p * 3], lab[p * 3 + 1], lab[p * 3 + 2]]; for (const t of tones) { const d = dE(l, t); if (d < m) m = d; } dist[p] = m; }
  const bg = new Uint8Array(N), st = [];
  for (let p = 0; p < N; p++) if (borderDist(p) === 0 && dist[p] < T) { bg[p] = 1; st.push(p); }
  while (st.length) {
    const p = st.pop(), x = p % W, y = (p / W) | 0;
    for (const qq of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
      if (qq < 0 || bg[qq]) continue;
      const near = dist[qq] < T || (dist[qq] < T2 && Math.hypot(lab[qq * 3] - lab[p * 3], lab[qq * 3 + 1] - lab[p * 3 + 1], lab[qq * 3 + 2] - lab[p * 3 + 2]) < T_LOCAL);
      if (near) { bg[qq] = 1; st.push(qq); }
    }
  }
  let fg = invert(bg);
  fg = dilate(erode(fg, 2), 2);
  const { label, sizes } = components(fg);
  const largest = Math.max(0, ...sizes);
  const keep = sizes.map(s => s >= Math.max(0.12 * largest, 0.002 * N));
  for (let p = 0; p < N; p++) if (!(fg[p] && keep[label[p]])) fg[p] = 0;
  const outside = new Uint8Array(N); const s2 = [];
  for (let p = 0; p < N; p++) if (borderDist(p) === 0 && !fg[p]) { outside[p] = 1; s2.push(p); }
  while (s2.length) { const p = s2.pop(), x = p % W, y = (p / W) | 0; for (const qq of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (qq >= 0 && !fg[qq] && !outside[qq]) { outside[qq] = 1; s2.push(qq); } }
  let area = 0; for (let p = 0; p < N; p++) { if (!outside[p]) fg[p] = 1; area += fg[p]; }
  let stripBg = 0; for (const p of stripIdx) stripBg += fg[p] ? 0 : 1;
  const box = boxOf(fg);
  let hfB = 0, nB = 0; for (let p = 0; p < N; p++) { const x = p % W, y = (p / W) | 0; if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && borderDist(p) < STRIP_FIELD) { hfB += P.lap[p]; nB++; } }
  const pieces = keep.filter(Boolean).length;
  const d = { hero_frac: r2(area / N), strip_bg_share: r2(stripBg / stripIdx.length), pieces, border_hf: r2(hfB / nB) };
  let reason = null;
  if (d.hero_frac < 0.03) reason = 'almost nothing separates from the backdrop';
  else if (d.hero_frac > 0.72) reason = 'the backdrop does not separate: most of the frame stays as hero';
  else if (d.strip_bg_share < 0.6) reason = 'the border strip is mostly not backdrop (scene or hero fills the edges)';
  else if (d.border_hf > 6) reason = 'the backdrop is too textured for a colour flood (likely a scene)';
  else if (pieces > 4) reason = 'the mask falls apart into many pieces';
  else {
    const t = touched(fg);
    if (t.length >= 3) reason = 'the mask touches three or more frame edges (it takes ground, sky or a wall)';
    else if (t.includes('left') && t.includes('right')) reason = 'the mask runs from the left edge to the right edge (it takes a horizon, ground or table band)';
  }
  return { ok: !reason && !!box, fg, box, diagnostics: d, reason, touched: touched(fg) };
}

// ---------- colour summaries (COLOUR.md measures) ----------
function meanColour(rgb, idx) {
  if (!idx.length) return null;
  let r = 0, g = 0, b = 0; for (const p of idx) { r += rgb[p * 3]; g += rgb[p * 3 + 1]; b += rgb[p * 3 + 2]; }
  const m = [r / idx.length, g / idx.length, b / idx.length].map(Math.round);
  const l = rgb2lab(...m), h = rgb2hsv(...m);
  return { hex: hexOf(m), L: r1(l[0]), C: r1(Math.hypot(l[1], l[2])), hue: Math.round(h[0]), s: r2(h[1]), v: r2(h[2]), n: idx.length };
}
function dominant(P, idx) {
  const sub = idx.filter((_, i) => i % 2 === 0); if (sub.length < 50) return null;
  const pts = new Float32Array(sub.length * 3); sub.forEach((p, i) => { pts[i * 3] = P.lab[p * 3]; pts[i * 3 + 1] = P.lab[p * 3 + 1]; pts[i * 3 + 2] = P.lab[p * 3 + 2]; });
  const km = kmeans(pts, 3); let best = 0; km.counts.forEach((c, i) => { if (c > km.counts[best]) best = i; });
  return { ...meanColour(P.rgb, sub.filter((_, i) => km.assign[i] === best)), share: r2(km.counts[best] / sub.length) };
}
function regionStats(P, idx) {
  if (idx.length < 50) return null;
  const Ls = idx.map(p => P.lab[p * 3]).sort((a, b) => a - b);
  const Cs = idx.map(p => P.C[p]).sort((a, b) => a - b);
  return { n: idx.length, L_p10: r1(q(Ls, 0.1)), L_p90: r1(q(Ls, 0.9)), C_median: r1(q(Cs, 0.5)), dominant: dominant(P, idx) };
}
const byL = (P, idx) => [...idx].sort((a, b) => P.lab[a * 3] - P.lab[b * 3]);
const slice = (s, f0, f1) => s.slice(Math.floor(f0 * s.length), Math.max(Math.floor(f0 * s.length) + 1, Math.floor(f1 * s.length)));

export function wholeCard(P) {
  const all = Array.from({ length: N }, (_, p) => p);
  const Ls = Float32Array.from(all, p => P.lab[p * 3]).sort(), Cs = Float32Array.from(P.C).sort();
  let grey = 0, black = 0, white = 0;
  const bins = new Array(12).fill(0);
  for (let p = 0; p < N; p++) {
    const r = P.rgb[p * 3], g = P.rgb[p * 3 + 1], b = P.rgb[p * 3 + 2];
    if (P.C[p] < 8) grey++;
    if (Math.max(r, g, b) < 24) black++; if (Math.min(r, g, b) > 245) white++;
    if (P.C[p] >= 15) bins[Math.floor(((P.hsv[p * 3] + 15) % 360) / 30)]++;
  }
  const Ys = Float32Array.from(P.Y).sort();
  const top = []; for (let p = 0; p < W * Math.round(0.12 * H); p++) top.push(p);
  return {
    L_p1: r1(q(Ls, 0.01)), L_p50: r1(q(Ls, 0.5)), L_p99: r1(q(Ls, 0.99)), C_p50: r1(q(Cs, 0.5)),
    grey_share: r3(grey / N), black_share: r3(black / N), white_share: r3(white / N),
    darkest2: meanColour(P.rgb, slice(byL(P, all), 0, 0.02)),
    n_hues: bins.filter(v => v >= 0.05 * N).length, hue_bins: bins.map(v => r3(v / N)),
    luma_p005: Math.round(Ys[Math.floor(N * 0.005)]), luma_p995: Math.round(Ys[Math.floor(N * 0.995)]),
    top_strip: meanColour(P.rgb, top),
  };
}

// hue families of the hero and their tone ramps (COLOUR.md checks 11–12)
function ramps(P, idx) {
  const chrom = idx.filter(p => P.hsv[p * 3 + 1] > 0.2 && P.hsv[p * 3 + 2] > 0.15);
  if (chrom.length < 300) return [];
  const left = new Set(chrom), out = [];
  for (let k = 0; k < 3; k++) {
    const hist = new Array(36).fill(0); for (const p of left) hist[Math.floor(P.hsv[p * 3] / 10) % 36]++;
    let peak = 0; hist.forEach((v, i) => { if (v > hist[peak]) peak = i; });
    const centre = peak * 10 + 5;
    const fam = [...left].filter(p => Math.abs(hueDiff(P.hsv[p * 3], centre)) <= 40);
    if (fam.length < 0.1 * chrom.length) break;
    for (const p of fam) left.delete(p);
    const s = byL(P, fam);
    const dark = meanColour(P.rgb, slice(s, 0, 0.15)), mid = meanColour(P.rgb, slice(s, 0.4, 0.6)), light = meanColour(P.rgb, slice(s, 0.95, 1));
    out.push({ centre, share: r2(fam.length / chrom.length), dark, mid, light, dark_C_ratio: r2(dark.C / (mid.C || 1)) });
  }
  return out;
}

// hero vs backdrop numbers; fg = hero mask
export function heroBackdrop(P, fg) {
  const he = erode(fg, 3), be = erode(invert(fg), 3);
  const heroIdx = [], bgIdx = [];
  for (let p = 0; p < N; p++) { if (he[p]) heroIdx.push(p); if (be[p]) bgIdx.push(p); }
  const hero = regionStats(P, heroIdx), bg = regionStats(P, bgIdx);
  const out = { hero, bg };
  if (hero?.dominant && bg?.dominant) {
    const h = hero.dominant, b = bg.dominant;
    out.hue_diff = Math.abs(hueDiff(h.hue, b.hue)); out.hero_chromatic = h.s >= 0.15; out.bg_chromatic = b.s >= 0.15; out.dL = r1(h.L - b.L);
  }
  out.ramps = ramps(P, heroIdx);
  const bs = byL(P, bgIdx);
  out.bg_dark = meanColour(P.rgb, slice(bs, 0, 0.05)); out.bg_mid = meanColour(P.rgb, slice(bs, 0.4, 0.6));
  const ring = dilate(fg, 30), ring3 = dilate(fg, 3), near = [], corners = [];
  for (let p = 0; p < N; p++) {
    if (fg[p]) continue; const x = p % W, y = (p / W) | 0;
    if (ring[p] && !ring3[p]) near.push(p);
    if ((x < 60 || x >= W - 60) && (y < 60 || y >= H - 60)) corners.push(p);
  }
  out.bg_near = meanColour(P.rgb, near); out.bg_corners = meanColour(P.rgb, corners);
  // near-white highlights inside the hero (RENDERING.md check 11)
  let white = 0; for (const p of heroIdx) if (P.Y[p] >= 235 && P.hsv[p * 3 + 1] <= 0.25) white++;
  out.hero_near_white = heroIdx.length ? r3(white / heroIdx.length) : null;
  out.light = lightCentroids(P, he);
  return out;
}

// RENDERING.md check 2: brightest 3 % and darkest 10 % of hero pixels relative to the hero centroid (box-normalised)
function lightCentroids(P, m) {
  let cx = 0, cy = 0, n = 0; const vals = []; const box = boxOf(m); if (!box) return null;
  for (let p = 0; p < N; p++) if (m[p]) { cx += p % W; cy += (p / W) | 0; n++; vals.push(P.Y[p]); }
  if (n < 100) return null;
  cx /= n; cy /= n; vals.sort((a, b) => a - b);
  const hiT = vals[Math.floor(n * 0.97)], loT = vals[Math.floor(n * 0.10)];
  let hx = 0, hy = 0, hn = 0, sx = 0, sy = 0, sn = 0;
  for (let p = 0; p < N; p++) if (m[p]) { const x = p % W, y = (p / W) | 0; if (P.Y[p] >= hiT) { hx += x; hy += y; hn++; } if (P.Y[p] <= loT) { sx += x; sy += y; sn++; } }
  const bw = box[2] - box[0], bh = box[3] - box[1];
  return { highlight_dx: r2((hx / hn - cx) / bw), highlight_dy: r2((hy / hn - cy) / bh), shade_dx: r2((sx / sn - cx) / bw), shade_dy: r2((sy / sn - cy) / bh) };
}

// ---------- composition numbers from a hero mask or box ----------
// mainMass = mask opened by `openR` px: removes parts thinner than 2*openR+1 px (thin tips, antennas, straws).
export function composition(fg, box, { openR, safe }) {
  const [x0, y0, x1, y1] = box, w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = {
    box, centre_dx_px: r1((x0 + x1 + 1) / 2 - W / 2), centre_dy_px: r1((y0 + y1 + 1) / 2 - H / 2),
    area_frac: r3(w * h / N), width_frac: r3(w / W),
    margin_left: x0, margin_right: W - 1 - x1, margin_top: y0, margin_bottom: H - 1 - y1,
    touches: [y0 <= 0 && 'top', y1 >= H - 1 && 'bottom', x0 <= 0 && 'left', x1 >= W - 1 && 'right'].filter(Boolean),
  };
  if (fg) {
    const main = dilate(erode(fg, openR), openR);
    const mb = boxOf(main);
    out.main_mass_box = mb; out.main_margin_top = mb ? mb[1] : null;
    let outZone = 0, inCorner = 0, beyondArc = 0, topBand = 0, n = 0;
    const [zx0, zy0, zx1, zy1] = safe.rect, c = safe.corner;
    for (let p = 0; p < N; p++) if (main[p]) {
      n++; const x = p % W, y = (p / W) | 0;
      if (x < zx0 || x > zx1 || y < zy0 || y > zy1) outZone++;
      if (y < safe.top_band) topBand++;
      if (y < c && (x < c || x >= W - c)) {
        inCorner++;
        const cx = x < c ? c : W - 1 - c; // centre of the rounded corner of radius c
        if (Math.hypot(x - cx, y - c) > c) beyondArc++;
      }
    }
    out.main_px = n; out.main_outside_safe_px = outZone; out.main_in_top_corners_px = inCorner; out.main_beyond_corner_arc_px = beyondArc; out.main_in_top_band_px = topBand;
    // share of each frame edge (outermost line) covered by the hero mask: a thin cut-off tail covers little
    const cover = (len, f) => { let k = 0; for (let i = 0; i < len; i++) if (fg[f(i)]) k++; return r3(k / len); };
    out.edge_cover = { top: cover(W, x => x), bottom: cover(W, x => (H - 1) * W + x), left: cover(H, y => y * W), right: cover(H, y => y * W + W - 1) };
  }
  return out;
}

// ---------- backdrop geometry (BACKGROUNDS.md measures) ----------
// box: hero box in px [x0,y0,x1,y1] or null; the backdrop excludes it grown by 2 % of the frame.
export function backdropGeometry(P, box, pattern, wantsFloor) {
  const L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) { L[i] = P.lab[i * 3]; A[i] = P.lab[i * 3 + 1]; B[i] = P.lab[i * 3 + 2]; }
  const gx = 0.02 * W, gy = 0.02 * H;
  const bx0 = box ? Math.max(0, box[0] - gx) : W, bx1 = box ? Math.min(W, box[2] + 1 + gx) : -1;
  const by0 = box ? Math.max(0, box[1] - gy) : H, by1 = box ? Math.min(H, box[3] + 1 + gy) : -1;
  const inBox = (x, y) => x >= bx0 && x < bx1 && y >= by0 && y < by1;
  const res = {};
  let floorY = null;
  if (wantsFloor) {
    const strip = side => {
      const xs = [];
      if (side === 'left') { const lim = box ? Math.floor(bx0) : 0; for (let x = 0; x < Math.max(lim, Math.round(W * 0.08)) && x < W * 0.3; x++) xs.push(x); }
      else { const lim = box ? Math.ceil(bx1) : W; for (let x = W - 1; x >= Math.min(lim, Math.round(W * 0.92)) && x > W * 0.7; x--) xs.push(x); }
      const prof = [];
      for (let y = 0; y < H; y++) { let l = 0, a = 0, b = 0; for (const x of xs) { const i = y * W + x; l += L[i]; a += A[i]; b += B[i]; } prof.push([l / xs.length, a / xs.length, b / xs.length]); }
      let best = -1, by = null, bdL = null;
      for (let y = Math.round(H * 0.15); y < Math.round(H * 0.97); y++) {
        if (y - 8 < 0 || y + 8 >= H) continue;
        const up = [0, 0, 0], dn = [0, 0, 0];
        for (let k = 1; k <= 8; k++) for (let c = 0; c < 3; c++) { up[c] += prof[y - k][c] / 8; dn[c] += prof[y + k][c] / 8; }
        const d = Math.hypot(up[0] - dn[0], up[1] - dn[1], up[2] - dn[2]);
        if (d > best) { best = d; by = y; bdL = dn[0] - up[0]; }
      }
      return { y: by, dE: best, dL: bdL };
    };
    const l = strip('left'), r = strip('right');
    res.floor = { y_left: r1(l.y / H * 100), y_right: r1(r.y / H * 100), dE_left: r1(l.dE), dE_right: r1(r.dE) };
    // the agreement rule of the analysis (its floor lines were checked by eye): sides within 3 %, step >= 8 dE
    res.floor.agree = Math.abs(res.floor.y_left - res.floor.y_right) <= 3 && Math.min(l.dE, r.dE) >= 8;
    res.floor.y = res.floor.agree ? r1((res.floor.y_left + res.floor.y_right) / 2) : null;
    if (Math.abs(l.y - r.y) < H * 0.06 && Math.min(l.dE, r.dE) > 8) floorY = Math.min(l.y, r.y) - 6;
    // new here: when the two sides disagree (one strip found the front edge of a table or board instead of the far
    // edge) but both steps are clear, still keep the pattern measures above the higher candidate
    else if (Math.min(l.dE, r.dE) > 8) floorY = Math.min(l.y, r.y) - 6;
  }
  res.floor_cut_px = floorY;
  const px = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { if (inBox(x, y)) continue; if (floorY != null && y >= floorY) continue; px.push(x, y); }
  const n = px.length / 2;
  const Lres = new Float32Array(N);
  // glow: L = c0 + c1 x + c2 y + c3 (x^2 + y^2)
  const M = Array.from({ length: 4 }, () => new Float64Array(4)), v = new Float64Array(4);
  for (let i = 0; i < n; i++) {
    const x = px[2 * i] / W, y = px[2 * i + 1] / W, f = [1, x, y, x * x + y * y], l = L[px[2 * i + 1] * W + px[2 * i]];
    for (let a = 0; a < 4; a++) { v[a] += f[a] * l; for (let b = 0; b < 4; b++) M[a][b] += f[a] * f[b]; }
  }
  const c = solve(M, v);
  const corner = (x0, y0) => { let s = 0, k = 0; for (let y = y0; y < y0 + 48; y++) for (let x = x0; x < x0 + 48; x++) { if (inBox(x, y)) continue; s += L[y * W + x]; k++; } return k ? s / k : null; };
  const cs = [corner(0, 0), corner(W - 48, 0), corner(0, H - 48), corner(W - 48, H - 48)].filter(x => x != null);
  if (c && c[3] < 0) {
    const gx0 = -c[1] / (2 * c[3]), gy0 = -c[2] / (2 * c[3]);
    const Lc = c[0] + c[1] * gx0 + c[2] * gy0 + c[3] * (gx0 * gx0 + gy0 * gy0);
    res.glow = { centre_pct: [r1(gx0 * 100), r1(gy0 * W / H * 100)], falloff: r1(Lc - cs.reduce((a, b) => a + b, 0) / cs.length) };
  } else res.glow = null;
  // backdrop above vs below the middle (for "no dome": the lower half or the floor is lighter)
  let top = 0, nt = 0, bot = 0, nb = 0;
  for (let i = 0; i < n; i++) { const y = px[2 * i + 1], l = L[y * W + px[2 * i]]; if (y < H / 2) { top += l; nt++; } else { bot += l; nb++; } }
  res.half_dL = nt && nb ? r1(bot / nb - top / nt) : null;
  if (c) for (let i = 0; i < N; i++) { const x = (i % W) / W, y = Math.floor(i / W) / W; Lres[i] = L[i] - (c[0] + c[1] * x + c[2] * y + c[3] * (x * x + y * y)); }
  else Lres.set(L);
  res.box_used = box;
  if (pattern === 'rays') res.rays = rays(Lres, px, n, box);
  if (pattern === 'rings' || pattern === 'spiral') res.rings = rings(Lres, px, n, box);
  if (/^stripes|rhombi|checker|motif_repeat|brick/.test(pattern || '')) res.stripes = stripes(Lres, px, n);
  res.steps = patternSteps(L, res, inBox, floorY, pattern);
  return res;
}
function solve(M, v) {
  const n = v.length, a = M.map((r, i) => [...r, v[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null; [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c] / a[c][c]; for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k]; }
  }
  return a.map((r, i) => r[n] / r[i]);
}
function binProfile(L, px, n, cx, cy, mode, bins, win) {
  const sum = new Float64Array(bins), cnt = new Float64Array(bins);
  for (let i = 0; i < n; i++) {
    const dx = px[2 * i] - cx, dy = px[2 * i + 1] - cy, r = Math.hypot(dx, dy);
    if (r < 25) continue;
    let b;
    if (mode === 'angle') b = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * bins) % bins;
    else { b = Math.floor(r / 2); if (b >= bins) continue; }
    sum[b] += L[px[2 * i + 1] * W + px[2 * i]]; cnt[b]++;
  }
  const raw = Array.from(sum, (s, i) => cnt[i] >= 4 ? s / cnt[i] : NaN);
  const hp = raw.map((v, i) => {
    if (Number.isNaN(v)) return NaN; let s = 0, k = 0;
    for (let j = i - win; j <= i + win; j++) { const jj = mode === 'angle' ? (j + bins) % bins : j; if (jj < 0 || jj >= bins || Number.isNaN(raw[jj])) continue; s += raw[jj]; k++; }
    return v - s / k;
  });
  let score = 0, tot = 0; for (let i = 0; i < bins; i++) if (!Number.isNaN(hp[i])) { score += hp[i] * hp[i] * cnt[i]; tot += cnt[i]; }
  return { hp, cnt, score: tot ? score / tot : 0 };
}
function searchCentre(L, px, n, mode, bins, win, xr, yr) {
  let best = null;
  for (let cy = yr[0] * H; cy <= yr[1] * H; cy += 15) for (let cx = xr[0] * W; cx <= xr[1] * W; cx += 15) {
    const p = binProfile(L, px, n, cx, cy, mode, bins, win); if (!best || p.score > best.p.score) best = { cx, cy, p };
  }
  let ref = best;
  for (let cy = best.cy - 14; cy <= best.cy + 14; cy += 2) for (let cx = best.cx - 14; cx <= best.cx + 14; cx += 2) {
    const p = binProfile(L, px, n, cx, cy, mode, bins, win); if (p.score > ref.p.score) ref = { cx, cy, p };
  }
  return ref;
}
function runs(hp, cyclic) {
  const Nn = hp.length, out = [];
  const sm = hp.map((v, i) => { if (Number.isNaN(v)) return NaN; let s = 0, k = 0; for (let j = i - 1; j <= i + 1; j++) { const jj = cyclic ? (j + Nn) % Nn : j; if (jj < 0 || jj >= Nn || Number.isNaN(hp[jj])) continue; s += hp[jj]; k++; } return s / k; });
  let start = null, sign = null;
  for (let i = 0; i < Nn; i++) {
    const v = sm[i];
    if (Number.isNaN(v)) { start = null; sign = null; continue; }
    const sg = v > 0;
    if (sign === null) { sign = sg; start = -1; continue; }
    if (sg !== sign) { if (start >= 0) out.push({ light: sign, from: start, len: i - start }); start = i; sign = sg; }
  }
  return out;
}
function inGrown(box, cx, cy) { return box && cx >= box[0] - 0.1 * W && cx <= box[2] + 0.1 * W && cy >= box[1] - 0.1 * H && cy <= box[3] + 0.1 * H; }
function grownRange(box) { return [[(box[0] - 0.1 * W) / W, (box[2] + 0.1 * W) / W], [(box[1] - 0.1 * H) / H, (box[3] + 0.1 * H) / H]]; }
const med = a => { const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
function rays(L, px, n, box) {
  const BINS = 360;
  let best = searchCentre(L, px, n, 'angle', BINS, 20, [-0.1, 1.1], [-0.1, 1.1]), constrained = false;
  if (box && !inGrown(box, best.cx, best.cy)) { const [xr, yr] = grownRange(box); best = searchCentre(L, px, n, 'angle', BINS, 20, xr, yr); constrained = true; }
  const rs = runs(best.p.hp, true);
  const light = rs.filter(r => r.light).map(r => r.len), dark = rs.filter(r => !r.light).map(r => r.len);
  const per = light.length + dark.length ? 2 * (light.reduce((a, b) => a + b, 0) + dark.reduce((a, b) => a + b, 0)) / (light.length + dark.length) : null;
  return { centre_px: [Math.round(best.cx), Math.round(best.cy)], centre_pct: [r1(best.cx / W * 100), r1(best.cy / H * 100)],
    light_deg_med: light.length ? med(light) : null, dark_deg_med: dark.length ? med(dark) : null, light_n: light.length,
    rays_per_turn: per ? r1(360 / per) : null, constrained };
}
function rings(L, px, n, box) {
  const BINS = Math.ceil(Math.hypot(W, H) * 1.3 / 2);
  let best = searchCentre(L, px, n, 'radius', BINS, 12, [0, 1], [-0.1, 1.1]), constrained = false;
  if (box && !inGrown(box, best.cx, best.cy)) { const [xr, yr] = grownRange(box); best = searchCentre(L, px, n, 'radius', BINS, 12, xr, yr); constrained = true; }
  const rs = runs(best.p.hp, false);
  const light = rs.filter(r => r.light).map(r => r.len * 2), dark = rs.filter(r => !r.light).map(r => r.len * 2);
  const per = light.length + dark.length ? 2 * (light.reduce((a, b) => a + b, 0) + dark.reduce((a, b) => a + b, 0)) / (light.length + dark.length) : null;
  const far = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - best.cx, y - best.cy)));
  return { centre_px: [Math.round(best.cx), Math.round(best.cy)], centre_pct: [r1(best.cx / W * 100), r1(best.cy / H * 100)], period_px: r1(per), rings_to_far_corner: per ? r1(far / per) : null, constrained };
}
function stripes(L, px, n) {
  let best = null;
  for (let deg = 0; deg < 180; deg++) {
    const t = deg * Math.PI / 180, nx = -Math.sin(t), ny = -Math.cos(t);
    let mn = Infinity, mx = -Infinity; const pos = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = px[2 * i] * nx + px[2 * i + 1] * ny; pos[i] = p; if (p < mn) mn = p; if (p > mx) mx = p; }
    const Nb = Math.ceil(mx - mn) + 1, sum = new Float64Array(Nb), cnt = new Float64Array(Nb);
    for (let i = 0; i < n; i++) { const b = Math.floor(pos[i] - mn); sum[b] += L[px[2 * i + 1] * W + px[2 * i]]; cnt[b]++; }
    const raw = Array.from(sum, (s, i) => cnt[i] > 2 ? s / cnt[i] : NaN);
    const prof = raw.map((v, i) => { if (Number.isNaN(v)) return NaN; let s = 0, k = 0; for (let j = Math.max(0, i - 100); j <= Math.min(Nb - 1, i + 100); j++) if (!Number.isNaN(raw[j])) { s += raw[j]; k++; } return v - s / k; });
    let m = 0, c0 = 0; for (const v of prof) if (!Number.isNaN(v)) { m += v; c0++; } if (c0 < 40) continue; m /= c0;
    for (let per = 12; per <= 260; per++) {
      const w = 2 * Math.PI / per;
      let cc = 0, ss = 0, cs = 0, yc = 0, ys = 0;
      for (let i = 0; i < Nb; i++) { if (Number.isNaN(prof[i])) continue; const c = Math.cos(w * i), s = Math.sin(w * i), y = prof[i] - m; cc += c * c; ss += s * s; cs += c * s; yc += y * c; ys += y * s; }
      const det = cc * ss - cs * cs; if (Math.abs(det) < 1e-9) continue;
      const a = (yc * ss - ys * cs) / det, b = (ys * cc - yc * cs) / det, amp = Math.hypot(a, b);
      const score = amp * amp * c0;
      if (!best || score > best.score) best = { deg, per, amp: 2 * amp, score, extent: Nb };
    }
  }
  if (!best) return null;
  let ang = best.deg; if (ang > 90) ang -= 180;
  return { angle_deg: ang, period_px: best.per, stripe_width_px: best.per / 2, amp: r1(best.amp), count_across: r1(best.extent / best.per) };
}

// ---------- pattern steps along lines (BACKGROUNDS.md check 4) ----------
// Lines cross the pattern: circles around the ray centre, radial lines from the ring centre, lines across the
// stripes, otherwise horizontal lines. Only backdrop pixels count (outside the grown hero box, above the floor).
// A band edge = a local maximum of the 1-px L* difference with flat plateaus (range <= 2.5 L*) at 4..7 px on both
// sides, a plateau difference >= 2.5 L* and >= 70 % of it within the central 5 px (so smooth gradients do not count);
// step = plateau difference, width = 10–90 % rise distance (px), as in
// overshoot() below but on L* with low thresholds, because pattern steps are small (2–15 L*).
function patternSteps(L, geo, inBox, floorY, pattern) {
  // graphic patterns only: 'other' (curtains, panels) and 'brick' are material walls, not a «узор» of BACKGROUNDS 4
  if (!pattern || ['plain_gradient', 'n/a', 'other', 'brick'].includes(pattern)) return null;
  const ok = (x, y) => x >= 2 && y >= 2 && x < W - 2 && y < H - 2 && !inBox(x, y) && !(floorY != null && y >= floorY);
  const lines = []; // each: array of [x,y] at 1-px spacing
  if (geo.rays) {
    const [cx, cy] = geo.rays.centre_px;
    for (const R of [120, 160, 200, 240, 280]) { const pts = []; const nS = Math.round(2 * Math.PI * R); for (let i = 0; i < nS; i++) { const t = i / R; pts.push([cx + R * Math.cos(t), cy + R * Math.sin(t)]); } lines.push(pts); }
  } else if (geo.rings) {
    const [cx, cy] = geo.rings.centre_px;
    for (let a = 0; a < 360; a += 20) { const t = a * Math.PI / 180, pts = []; for (let r = 0; r < 700; r++) pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); lines.push(pts); }
  } else if (geo.stripes && /^stripes/.test(pattern)) {
    const t = geo.stripes.angle_deg * Math.PI / 180, dx = Math.cos(t), dy = -Math.sin(t); // along the stripes (y down)
    const nx = -dy, ny = dx; // across
    for (let off = -300; off <= 300; off += 40) { const ox = W / 2 + dx * off, oy = H / 2 + dy * off, pts = []; for (let s = -700; s <= 700; s++) pts.push([ox + nx * s, oy + ny * s]); lines.push(pts); }
  } else {
    for (let y = 0.06 * H; y < 0.95 * H; y += 0.08 * H) { const pts = []; for (let x = 0; x < W; x++) pts.push([x, y]); lines.push(pts); }
  }
  const steps = [], widths = [];
  for (const pts of lines) {
    let seg = [];
    const flush = () => { if (seg.length >= 20) analyseSeg(seg, steps, widths); seg = []; };
    // nearest pixel, as the analysis sampled (bilinear sampling would add up to 1 px of blur to every edge)
    for (const [x, y] of pts) { if (ok(x, y)) seg.push(L[Math.round(y) * W + Math.round(x)]); else flush(); }
    flush();
  }
  if (!steps.length) return { edges: 0 };
  const s = [...steps].sort((a, b) => a - b);
  return { edges: steps.length, step_med: r1(median(steps)), step_p90: r1(q(s, 0.9)), width_med: median(widths) };
}
function analyseSeg(v, steps, widths) {
  for (let i = 8; i < v.length - 8; i++) {
    const d0 = Math.abs(v[i + 1] - v[i]);
    let isMax = true; for (let k = -3; k <= 3; k++) if (k && Math.abs(v[i + 1 + k] - v[i + k]) > d0) { isMax = false; break; }
    if (!isMax) continue;
    const A = [v[i - 7], v[i - 6], v[i - 5], v[i - 4]], B = [v[i + 4], v[i + 5], v[i + 6], v[i + 7]];
    if (Math.max(...A) - Math.min(...A) > 2.5 || Math.max(...B) - Math.min(...B) > 2.5) continue;
    const a = A.reduce((s, x) => s + x) / 4, b = B.reduce((s, x) => s + x) / 4, step = b - a; if (Math.abs(step) < 2.5) continue;
    // a band edge concentrates the change: >= 70 % of the step within the central 5 px (a smooth gradient puts ~45 % there)
    if (Math.abs(v[i + 3] - v[i - 2]) < 0.7 * Math.abs(step)) continue;
    let lo = null, hi = null; for (let k = -3; k <= 4; k++) { const t = (v[i + k] - a) / step; if (lo == null && t >= 0.1) lo = k; if (hi == null && t >= 0.9) hi = k; }
    if (lo == null || hi == null) continue;
    steps.push(Math.abs(step)); widths.push(hi - lo + 1);
  }
}

// ---------- hero silhouette edges (RENDERING.md checks 4–6) ----------
const SECT = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
export function edges(P, fg) {
  const Y = P.Y, Bm = new Float32Array(N), R = 3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; s += fg[yy * W + xx]; n++; } Bm[y * W + x] = s / n; }
  const at = (x, y) => { if (x < 0 || y < 0 || x > W - 1.001 || y > H - 1.001) return NaN; const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, p = y0 * W + x0;
    return Y[p] * (1 - fx) * (1 - fy) + Y[p + 1] * fx * (1 - fy) + Y[p + W] * (1 - fx) * fy + Y[p + W + 1] * fx * fy; };
  let count = 0; const width = [], sect = SECT.map(() => [0, 0]);
  for (let y = 12; y < H - 12; y++) for (let x = 12; x < W - 12; x++) {
    const p = y * W + x; if (fg[p] !== 1) continue;
    if (fg[p - 1] && fg[p + 1] && fg[p - W] && fg[p + W]) continue;
    let gx = Bm[p + 1] - Bm[p - 1], gy = Bm[p + W] - Bm[p - W]; const g = Math.hypot(gx, gy); if (g < 1e-3) continue;
    gx /= -g; gy /= -g;
    const prof = []; for (let t = -15; t <= 15; t++) prof.push(at(x + gx * t, y + gy * t));
    if (prof.some(Number.isNaN)) continue;
    let best = 0, bi = 15; for (let t = -3; t <= 3; t++) { const d = Math.abs(prof[15 + t + 1] - prof[15 + t]); if (d > best) { best = d; bi = 15 + t; } }
    const Lp = i => prof[bi + i];
    const mean = (a, b) => { let s = 0; for (let i = a; i <= b; i++) s += Lp(i); return s / (b - a + 1); };
    const inP = mean(-9, -5), outP = mean(6, 10), step = outP - inP;
    if (Math.abs(step) < 20) continue;
    count++;
    let a = null, b = null;
    for (let i = -6; i <= 7; i++) { const v = (Lp(i) - inP) / step; if (a == null && v >= 0.1) a = i; if (v >= 0.9) { b = i; break; } }
    if (a != null && b != null) width.push(b - a + 1);
    const near = Math.min(Lp(-2), Lp(-1), Lp(0), Lp(1), Lp(2), Lp(3));
    const isDark = Math.min(inP, outP) - near >= Math.max(10, 0.15 * Math.abs(step));
    const s = Math.round(((Math.atan2(gy, gx) * 180 / Math.PI) + 360 + 22.5) % 360 / 45) % 8;
    sect[s][0]++; if (isDark) sect[s][1]++;
  }
  const dark_by_dir = Object.fromEntries(SECT.map((nm, i) => [nm, sect[i][0] >= 20 ? r2(sect[i][1] / sect[i][0]) : null]));
  const vals = Object.values(dark_by_dir).filter(v => v != null);
  return { edges: count, width_med: median(width), dark_by_dir, dark_min_dir: vals.length ? Math.min(...vals) : null };
}

// ---------- whole-card edge crispness and overshoot (RENDERING.md check 17) ----------
export function overshoot(P) {
  const Y = P.Y, widths = [], overs = [];
  const scan = (len, get) => {
    for (let i = 8; i < len - 8; i++) {
      const d0 = Math.abs(get(i + 1) - get(i)); if (d0 < Math.abs(get(i) - get(i - 1)) || d0 < Math.abs(get(i + 2) - get(i + 1))) continue;
      const A = [get(i - 7), get(i - 6), get(i - 5), get(i - 4)], B = [get(i + 4), get(i + 5), get(i + 6), get(i + 7)];
      if (Math.max(...A) - Math.min(...A) > 8 || Math.max(...B) - Math.min(...B) > 8) continue;
      const a = A.reduce((s, v) => s + v) / 4, b = B.reduce((s, v) => s + v) / 4, step = b - a; if (Math.abs(step) < 40) continue;
      let lo = null, hi = null; for (let k = -3; k <= 4; k++) { const v = (get(i + k) - a) / step; if (lo == null && v >= 0.1) lo = k; if (hi == null && v >= 0.9) hi = k; }
      if (lo == null || hi == null) continue; widths.push(hi - lo + 1);
      const near = [get(i - 3), get(i - 2), get(i - 1), get(i), get(i + 1), get(i + 2), get(i + 3), get(i + 4)];
      const brightPl = Math.max(a, b), darkPl = Math.min(a, b);
      overs.push((Math.max(0, Math.max(...near) - brightPl) + Math.max(0, darkPl - Math.min(...near))) / Math.abs(step));
    }
  };
  for (let y = 0; y < H; y++) scan(W, x => Y[y * W + x]);
  for (let x = 0; x < W; x++) scan(H, y => Y[y * W + x]);
  return { steps: widths.length, width_med: median(widths), overshoot_med: r3(median(overs)) };
}

// ---------- grain and JPEG grid (RENDERING.md check 16) ----------
export function traces(P) {
  const { Y, lap } = P; let flatN = 0, flatRes = 0;
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) { const p = y * W + x;
    const gw = Math.abs(Y[p + 2] - Y[p - 2]) + Math.abs(Y[p + 2 * W] - Y[p - 2 * W]); if (gw < 3) { flatN++; flatRes += lap[p]; } }
  const grid = horiz => {
    const acc = new Float64Array(8), n = new Float64Array(8);
    if (horiz) { for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) { acc[x % 8] += Math.abs(Y[y * W + x + 1] - Y[y * W + x]); n[x % 8]++; } }
    else { for (let y = 0; y < H - 1; y++) for (let x = 0; x < W; x++) { acc[y % 8] += Math.abs(Y[(y + 1) * W + x] - Y[y * W + x]); n[y % 8]++; } }
    const m = [...acc].map((a, i) => a / n[i]); const mx = Math.max(...m), ph = m.indexOf(mx), others = m.filter((_, i) => i !== ph);
    return r2(mx / (others.reduce((a, b) => a + b) / others.length));
  };
  return { flat_grain: flatN ? r2(flatRes / flatN) : null, jpeg_grid_h: grid(true), jpeg_grid_v: grid(false) };
}

// ---------- frame: a band along an edge that differs from the picture just inside it ----------
// Per side: share of positions where the outer 2-px line differs from the pixel 6–8 px inside by more than dEmin.
export function frame(P, dEmin) {
  const lab = p => [P.lab[p * 3], P.lab[p * 3 + 1], P.lab[p * 3 + 2]];
  const avg = ps => { const s = [0, 0, 0]; for (const p of ps) { const l = lab(p); s[0] += l[0]; s[1] += l[1]; s[2] += l[2]; } return s.map(v => v / ps.length); };
  const side = (len, outer, inner) => { let k = 0; for (let i = 0; i < len; i++) if (dE(avg(outer(i)), avg(inner(i))) > dEmin) k++; return r2(k / len); };
  return {
    top: side(W, x => [x, W + x], x => [6 * W + x, 7 * W + x, 8 * W + x]),
    bottom: side(W, x => [(H - 1) * W + x, (H - 2) * W + x], x => [(H - 7) * W + x, (H - 8) * W + x, (H - 9) * W + x]),
    left: side(H, y => [y * W, y * W + 1], y => [y * W + 6, y * W + 7, y * W + 8]),
    right: side(H, y => [y * W + W - 1, y * W + W - 2], y => [y * W + W - 7, y * W + W - 8, y * W + W - 9]),
  };
}

// ---------- mask overlay for a person to confirm or reject the mask ----------
// backdrop dimmed to 55 %, mask edge magenta inside / yellow outside, mask box dashed cyan.
export async function writeOverlay(P, fg, box, file) {
  const out = Buffer.from(P.rgb);
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; };
  const edge = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (fg[p]) { const x = p % W, y = (p / W) | 0; if ((x > 0 && !fg[p - 1]) || (x < W - 1 && !fg[p + 1]) || (y > 0 && !fg[p - W]) || (y < H - 1 && !fg[p + W])) edge[p] = 1; }
  const thick = dilate(edge, 1);
  for (let p = 0; p < N; p++) if (!fg[p] && !thick[p]) for (let k = 0; k < 3; k++) out[p * 3 + k] = Math.round(out[p * 3 + k] * 0.55);
  for (let p = 0; p < N; p++) if (thick[p]) put(p % W, (p / W) | 0, fg[p] ? [255, 0, 255] : [255, 255, 0]);
  if (box) { const [x0, y0, x1, y1] = box;
    for (let x = x0; x <= x1; x++) if ((x >> 2) % 2 === 0) { put(x, y0, [0, 255, 255]); put(x, y1, [0, 255, 255]); }
    for (let y = y0; y <= y1; y++) if ((y >> 2) % 2 === 0) { put(x0, y, [0, 255, 255]); put(x1, y, [0, 255, 255]); } }
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
}
