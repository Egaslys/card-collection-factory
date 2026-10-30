#!/usr/bin/env node
// adjust-trial.mjs — tries post-generation adjustments (ffmpeg filters: sharpening, saturation, brightness) on copies
// of cards and re-measures what the bible measures, so the adjustment step of the pipeline can be tuned by numbers.
// The cards themselves are never changed: copies go to --out (use a scratch folder).
// Measures: overshoot and edge width over the whole card (RENDERING 17), median C* and L* of the card (COLOUR 1, 5),
// grey / white shares (COLOUR 2, 4), grain (RENDERING 16), and the backdrop main colour (COLOUR 8) when the spec
// confirms the card's mask (the mask is taken from the unadjusted card). Bible ranges come from thresholds.json.
// With --ref-json (a check-card.mjs --json output of the 160 reference cards) it also prints the reference spread
// of the same measures, for the other sets and the grand set (cards 151–160) separately.
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli } from '../../../tools/cli-args.mjs';
import * as M from './measures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// the starting settings of RENDERING.md and COLOUR.md and their neighbours
const DEFAULT_FILTERS = 'none=null;us5-0.3=unsharp=5:5:0.3;us5-0.45=unsharp=5:5:0.45;sat1.15=eq=saturation=1.15;sat1.3=eq=saturation=1.3;sat1.3+us5-0.3=eq=saturation=1.3,unsharp=5:5:0.3';
const { values: opts } = await cli({
  name: 'styles/scapes/checks/adjust-trial.mjs',
  usage: ['styles/scapes/checks/adjust-trial.mjs --spec SPEC.json --out DIR [--only ID,ID] [--filters LIST] [--ref-json REFS.json]'],
  about: `Applies ffmpeg filters to copies of the spec's cards (written to DIR) and prints the bible's measures per copy,
with the bible's ranges and the adjustment targets from thresholds.json. The cards themselves are not changed.`,
  options: {
    spec: { type: 'string', value: 'FILE', help: 'check-card.mjs spec (cards, file paths, optional "mask": "confirmed")' },
    out: { type: 'string', value: 'DIR', help: 'folder for the adjusted copies (created; use a scratch folder)' },
    only: { type: 'string', value: 'LIST', help: 'only these card ids, comma-separated' },
    filters: { type: 'string', value: 'LIST', help: `name=ffmpeg-filter pairs separated by ';'\n(default: ${DEFAULT_FILTERS})\nunsharp=W:H:AMOUNT is ffmpeg's unsharp mask (luma W x H matrix, amount; the bible's settings use 5 x 5)` },
    'ref-json': { type: 'string', value: 'FILE', help: 'check-card.mjs --json output for the reference cards: print their spread of the same measures' },
  },
  check: v => (!v.spec || !v.out ? '--spec and --out are required' : null),
});
const T = JSON.parse(readFileSync(join(HERE, 'thresholds.json'), 'utf8')).checks;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const q = (a, f) => { const s = a.filter(v => v != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.round(f * (s.length - 1)))] : null; };
const rt = r => r ? `${r.min ?? ''}–${r.max ?? ''}` : '';

if (opts['ref-json']) {
  const R = JSON.parse(readFileSync(resolve(opts['ref-json']), 'utf8'));
  const grand = c => c.staging && /ref-(15[1-9]|160)$/.test(c.id);
  const keys = { overshoot: c => c.measures.overshoot.overshoot_med, edge_width: c => c.measures.overshoot.width_med, C_p50: c => c.measures.whole.C_p50, L_p50: c => c.measures.whole.L_p50, grain: c => c.measures.traces.flat_grain, bg_C: c => c.hero.mask_status === 'confirmed' ? c.measures.hero_backdrop?.bg?.dominant?.C : null, bg_S: c => c.hero.mask_status === 'confirmed' ? c.measures.hero_backdrop?.bg?.dominant?.s : null };
  console.log('reference spread: min / p10 / median / p90 / max');
  for (const [g, a] of [['other sets', R.filter(c => !grand(c))], ['grand set', R.filter(grand)], ['all', R]]) {
    console.log(`  ${g} (${a.length})`);
    for (const [k, f] of Object.entries(keys)) { const v = a.map(f).filter(x => x != null); if (v.length) console.log(`    ${k.padEnd(11)} n=${v.length}: ${[0, 0.1, 0.5, 0.9, 1].map(p => q(v, p)).join(' / ')}`); }
  }
}

const specFile = resolve(opts.spec), S = JSON.parse(readFileSync(specFile, 'utf8'));
const only = opts.only ? new Set(opts.only.split(',')) : null;
const filters = (opts.filters || DEFAULT_FILTERS).split(';').map(s => { const k = s.indexOf('='); if (k < 1) { console.error(`bad filter: ${s}`); process.exit(2); } return [s.slice(0, k), s.slice(k + 1)]; });
const out = resolve(opts.out); mkdirSync(out, { recursive: true });
console.log(`\nbible ranges: overshoot ${rt(T['RENDERING.17a'].limit)} (≥ ${T['RENDERING.17a'].halo_warn} visible halos), edge width ${rt(T['RENDERING.17b'].limit)} px, C* norm ${rt(T['COLOUR.1'].norm)}, L* norm ${rt(T['COLOUR.5a'].norm)}, grey ≤ ${T['COLOUR.2'].norm.max}, white ≤ ${T['COLOUR.4'].norm.max}, backdrop C* norm ${rt(T['COLOUR.8a'].norm)}, backdrop S norm ${rt(T['COLOUR.8b'].norm)}`);
console.log(`adjustment targets: overshoot ${rt(T['RENDERING.17a'].target)} (grand-style scenes ≤ ${T['RENDERING.17a'].target_grand_style.max}, no sharpening), edge width ${rt(T['RENDERING.17b'].target)} px, grain ≤ ${T['RENDERING.16a'].target.max}, C* about ${T['COLOUR.1'].target_about}`);
console.log('card | filter | overshoot | edge width | C* p50 | L* p50 | grey | white | grain | backdrop C* / S');
for (const card of S.cards) {
  if (only && !only.has(card.id)) continue;
  const src = resolve(dirname(specFile), card.file);
  const P0 = M.planes(M.decode(src).rgb);
  const mask = card.mask === 'confirmed' ? M.heroMask(P0) : null;
  for (const [name, f] of filters) {
    const dst = join(out, `${card.id.replace(/[^\w.-]+/g, '_')}__${name}.png`);
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', src, '-vf', f === 'null' ? 'null' : f, '-pix_fmt', 'rgb24', dst]);
    const P = M.planes(M.decode(dst).rgb);
    const ov = M.overshoot(P), wc = M.wholeCard(P), tr = M.traces(P);
    let bg = '';
    if (mask?.ok) { const hb = M.heroBackdrop(P, mask.fg); bg = `${hb.bg?.dominant?.C} / ${hb.bg?.dominant?.s}`; }
    console.log(`${card.id} | ${name} | ${ov.overshoot_med} | ${ov.width_med} | ${wc.C_p50} | ${wc.L_p50} | ${wc.grey_share} | ${wc.white_share} | ${tr.flat_grain} | ${bg}`);
  }
}
