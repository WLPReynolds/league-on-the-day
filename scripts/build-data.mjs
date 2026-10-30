#!/usr/bin/env node
// Builds data/index.json and data/seasons/*.json from the raw results CSVs.
//
//   node scripts/build-data.mjs <EnglandLeagueResults.csv> <england_nonleague.csv>
//
// Sources
//   Tiers 1–4: Sean Elvidge, England-football-results (github.com/seanelvidge/England-football-results),
//              itself built on James Curley's engsoccerdata for 1888–2016.
//   Tiers 5–6: James Curley, engsoccerdata data-raw/england_nonleague.csv. Only seasons whose
//              matches carry dates are used (1999/00 onwards; tier 6 from 2012/13).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [leagueCsv, nonLeagueCsv] = process.argv.slice(2);
if (!leagueCsv || !nonLeagueCsv) {
  console.error('Usage: node scripts/build-data.mjs <EnglandLeagueResults.csv> <england_nonleague.csv>');
  process.exit(1);
}

// Minimal RFC 4180 CSV parser (handles quoted fields).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const seasonLabel = (startYear) => `${startYear}/${startYear + 1}`;

// Non-league division names by era (sponsor names left out).
function nonLeagueName(code, startYear) {
  if (code === 'conference') {
    if (startYear >= 2015) return 'National League';
    if (startYear >= 2004) return 'Conference National';
    return 'Football Conference';
  }
  const region = code === 'N' ? 'North' : 'South';
  return startYear >= 2015 ? `National League ${region}` : `Conference ${region}`;
}

// The non-league file sometimes spells a club differently from the league file.
// These are the same club, so fold them into the league spelling. Genuine renames
// (Stevenage Borough -> Stevenage) and phoenix clubs (Halifax Town / FC Halifax Town)
// are left alone.
const SAME_CLUB = {
  'Accrington': 'Accrington Stanley',
  'Cheltenham': 'Cheltenham Town',
  'Macclesfield': 'Macclesfield Town',
  'Yeovil': 'Yeovil Town',
};
const club = (name) => SAME_CLUB[name] || name;

// Mid-season changes the raw results can't express. From `date` onwards:
//   expunge  – the club's results are removed from the table (opponents lose those results too)
//   takeover – `team`'s results count towards `to`, which took over its fixtures
const EVENTS = {
  '1919/1920': [{ type: 'takeover', team: 'Leeds City', to: 'Port Vale', date: 19191013,
    note: 'Leeds City were expelled in October 1919; Port Vale took over their fixtures and record.' }],
  '1931/1932': [{ type: 'expunge', team: 'Wigan Borough', date: 19311026,
    note: 'Wigan Borough resigned in October 1931 and their record was expunged.' }],
  '1961/1962': [{ type: 'expunge', team: 'Accrington Stanley', date: 19620306,
    note: 'Accrington Stanley resigned in March 1962 and their record was expunged.' }],
};

// Plain notes shown with a season's tables.
const NOTES = {
  '1939/1940': ['The 1939/40 season was abandoned after three games when war was declared.'],
  '2019/2020': ['The 2019/20 season was curtailed by Covid-19. League One and League Two final positions were decided on points per game, so the final tables here (by points) differ from the official ones.'],
};

/** season label -> array of { date, division, tier, home, away, hg, ag } */
const bySeason = new Map();
const add = (season, m) => {
  if (!bySeason.has(season)) bySeason.set(season, []);
  bySeason.get(season).push(m);
};

let n1 = 0;
for (const r of parseCsv(readFileSync(leagueCsv, 'utf8'))) {
  add(r.Season, {
    date: parseInt(r.Date.replaceAll('-', ''), 10),
    division: r.Division,
    tier: parseInt(r.Tier, 10),
    home: r.HomeTeam, away: r.AwayTeam,
    hg: parseInt(r.hGoal, 10), ag: parseInt(r.aGoal, 10),
  });
  n1++;
}

let n2 = 0;
for (const r of parseCsv(readFileSync(nonLeagueCsv, 'utf8'))) {
  const tier = parseInt(r.tier, 10);
  if (tier !== 5 && tier !== 6) continue;
  if (!r.Date || r.Date === 'NA') continue; // undated seasons can't produce as-of-date tables
  const startYear = parseInt(r.Season, 10);
  add(seasonLabel(startYear), {
    date: parseInt(r.Date.replaceAll('-', ''), 10),
    division: nonLeagueName(r.division, startYear),
    tier,
    home: club(r.home), away: club(r.visitor),
    hg: parseInt(r.hgoal, 10), ag: parseInt(r.vgoal, 10),
  });
  n2++;
}

const outDir = join(root, 'data');
rmSync(join(outDir, 'seasons'), { recursive: true, force: true });
mkdirSync(join(outDir, 'seasons'), { recursive: true });

const seasonsIndex = [];
const teamSeasons = new Map(); // team -> [{ s: seasonIdx, t: tier, d: divisionName }]
let latest = 0;

for (const season of [...bySeason.keys()].sort()) {
  // Drop play-off games: the non-league file includes them from 2016/17, and a play-off
  // is always a repeat of a home/away pairing already played in the league season.
  // A repeat whose reverse fixture is missing altogether is a data-entry slip with home
  // and away swapped, so it is flipped rather than dropped.
  const key = (m) => `${m.division}|${m.home}|${m.away}`;
  const all = bySeason.get(season).sort((a, b) => a.date - b.date);
  const present = new Set(all.map(key));
  const seen = new Set();
  let dropped = 0;
  const ms = [];
  for (const m of all) {
    if (seen.has(key(m))) {
      const flipped = { ...m, home: m.away, away: m.home, hg: m.ag, ag: m.hg };
      if (!present.has(key(flipped))) {
        console.log(`${season}: flipped ${m.home} v ${m.away} (${m.date}) — reverse fixture missing`);
        present.add(key(flipped)); seen.add(key(flipped)); ms.push(flipped);
      } else dropped++;
      continue;
    }
    seen.add(key(m));
    ms.push(m);
  }
  if (dropped) console.log(`${season}: dropped ${dropped} play-off fixtures`);
  const divs = [...new Map(ms.map((m) => [m.division, m.tier])).entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([name, tier], id) => ({ id, name, tier }));
  const divId = new Map(divs.map((d) => [d.name, d.id]));
  const teams = [...new Set(ms.flatMap((m) => [m.home, m.away]))].sort();
  const teamId = new Map(teams.map((t, i) => [t, i]));

  const data = {
    season,
    divisions: divs,
    teams,
    matches: ms.map((m) => [m.date, divId.get(m.division), teamId.get(m.home), teamId.get(m.away), m.hg, m.ag]),
    events: (EVENTS[season] || []).map((e) => ({ ...e, team: teamId.get(e.team), to: e.to && teamId.get(e.to) })),
    notes: NOTES[season] || [],
  };
  for (const e of data.events) {
    if (e.team === undefined || (e.type === 'takeover' && e.to === undefined)) throw new Error(`Bad event in ${season}`);
  }
  const file = `seasons/${season.replace('/', '-')}.json`;
  writeFileSync(join(outDir, file), JSON.stringify(data));

  const idx = seasonsIndex.length;
  const from = ms[0].date, to = ms[ms.length - 1].date;
  latest = Math.max(latest, to);
  seasonsIndex.push({ season, file, from, to, divisions: divs.map((d) => ({ name: d.name, tier: d.tier })) });

  for (const m of ms) {
    for (const t of [m.home, m.away]) {
      if (!teamSeasons.has(t)) teamSeasons.set(t, []);
      const list = teamSeasons.get(t);
      if (!list.length || list[list.length - 1].s !== idx) list.push({ s: idx, t: m.tier, d: divId.get(m.division) });
    }
  }
}

// teams: { name: [[seasonIdx, divisionId], ...] } — lets the app explain where a team was
// in seasons, and spot seasons where they're outside the covered divisions.
const teamsOut = {};
for (const t of [...teamSeasons.keys()].sort()) teamsOut[t] = teamSeasons.get(t).map((x) => [x.s, x.d]);

const index = {
  generated: new Date().toISOString().slice(0, 10),
  dataTo: latest,
  seasons: seasonsIndex,
  teams: teamsOut,
};
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index));
console.log(`League rows: ${n1}, non-league rows: ${n2}, seasons: ${seasonsIndex.length}, teams: ${teamSeasons.size}, data to ${latest}`);
