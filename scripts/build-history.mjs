#!/usr/bin/env node
// Builds data/history.json (every club's final position in every season) from data/seasons/*.json,
// for the History graph. Run after build-data; `npm run build-data` does both.
//
// Shape: {
//   sizes: [[clubs in division 0, division 1, ...] per season, in index.json order],
//   inProgress: season index still being played, or null,
//   teams: { "Manchester City": [[seasonIdx, divisionId, pos, p, w, d, l, gf, ga, pts], ...] }
// }
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTable } from '../src/league.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const index = JSON.parse(readFileSync(join(dataDir, 'index.json'), 'utf8'));
const out = { sizes: [], inProgress: null, teams: {} };

index.seasons.forEach((entry, s) => {
  const sd = JSON.parse(readFileSync(join(dataDir, entry.file), 'utf8'));
  out.sizes.push(sd.divisions.map((div) => {
    const table = buildTable(sd, div.id, entry.to);
    for (const r of table) {
      (out.teams[r.team] ||= []).push([s, div.id, r.pos, r.p, r.w, r.d, r.l, r.gf, r.ga, r.pts]);
    }
    return table.length;
  }));
});

// The latest season is still going if its last result is from August to April.
const lastIdx = index.seasons.length - 1;
const lastMonth = Math.floor(index.seasons[lastIdx].to / 100) % 100;
if (lastMonth >= 8 || lastMonth <= 4) out.inProgress = lastIdx;

writeFileSync(join(dataDir, 'history.json'), JSON.stringify(out));
console.log(`history.json: ${Object.keys(out.teams).length} clubs, ${out.sizes.length} seasons`);
