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
import { DEDUCTIONS } from './deductions.mjs';
import { zones, competitionNames } from './zones.mjs';
import { EUROPE } from './europe.mjs';
import { buildTable } from '../src/league.js';
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
  // The non-league file calls Aldershot Town (formed 1992) "Aldershot", which is the name of
  // the original club wound up in 1992. Use the new club's own name so the two stay separate.
  'Aldershot': 'Aldershot Town',
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
  '2020/2021': [{ type: 'expunge', team: 'Dover Athletic', date: 20210326,
    note: 'Dover Athletic stopped playing in January 2021; their National League record was expunged on 26 March 2021.' }],
};

// Plain notes shown with a season's tables.
const NOTES = {
  '1939/1940': ['The 1939/40 season was abandoned after three games when war was declared.'],
  '2019/2020': ['The 2019/20 season was curtailed by Covid-19. League One, League Two and National League final positions were decided on points per game, so the final tables here (by points) differ from the official ones.'],
  '2020/2021': ['No club was relegated from the National League in 2020/21, as the National League North and South seasons were declared void.'],
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

// engsoccerdata dates the August–December matches of the 2000/01 and 2001/02 Conference a
// year late (e.g. 2001-08-19 for a match played on 2000-08-19). No season has matches from
// July to December of its second year, so any such date is moved back a year.
function fixNonLeagueDate(dateNum, startYear) {
  const y = Math.floor(dateNum / 10000);
  const m = Math.floor(dateNum / 100) % 100;
  return y === startYear + 1 && m >= 7 ? dateNum - 10000 : dateNum;
}

let n2 = 0;
let fixedDates = 0;
for (const r of parseCsv(readFileSync(nonLeagueCsv, 'utf8'))) {
  const tier = parseInt(r.tier, 10);
  if (tier !== 5 && tier !== 6) continue;
  if (!r.Date || r.Date === 'NA') continue; // undated seasons can't produce as-of-date tables
  const startYear = parseInt(r.Season, 10);
  add(seasonLabel(startYear), {
    date: (() => {
      const raw = parseInt(r.Date.replaceAll('-', ''), 10);
      const fixed = fixNonLeagueDate(raw, startYear);
      if (fixed !== raw) fixedDates++;
      return fixed;
    })(),
    division: nonLeagueName(r.division, startYear),
    tier,
    home: club(r.home), away: club(r.visitor),
    hg: parseInt(r.hgoal, 10), ag: parseInt(r.vgoal, 10),
  });
  n2++;
}
if (fixedDates) console.log(`Non-league: moved ${fixedDates} matches dated a year late back a year`);

// National League from 2019/20: football-data.co.uk (engsoccerdata stops at 2018/19).
// Files are data-raw/fd/EC_yyyy.csv (e.g. EC_2627.csv), downloaded by scripts/fetch-data.sh.
// Its club names are short forms; FD_NAMES maps them to the names used everywhere else.
// The mapping was built by matching 2005/06–2018/19 fixtures (date and score) against
// engsoccerdata, where 7,282 of 7,284 agreed.
const FD_FROM = 2019;
const FD_NAMES = {
  'Aldershot': 'Aldershot Town', 'Boston Utd': 'Boston United', 'Carlisle': 'Carlisle United',
  'Dag and Red': 'Dagenham and Redbridge', 'Dorking': 'Dorking Wanderers', 'Ebbsfleet': 'Ebbsfleet United',
  'Forest Green': 'Forest Green Rovers', 'Fylde': 'AFC Fylde', 'Grimsby': 'Grimsby Town',
  'Halifax': 'FC Halifax Town', 'Harrogate': 'Harrogate Town', 'Hartlepool': 'Hartlepool United',
  'Hornchurch': 'AFC Hornchurch', 'Kidderminster': 'Kidderminster Harriers', "King's Lynn": "King's Lynn Town",
  'Maidenhead': 'Maidenhead United', 'Maidstone': 'Maidstone United', 'Oldham': 'Oldham Athletic',
  'Scunthorpe': 'Scunthorpe United', 'Southend': 'Southend United', 'Stockport': 'Stockport County',
  'Sutton': 'Sutton United', 'Torquay': 'Torquay United', 'Truro': 'Truro City', 'Yeovil': 'Yeovil Town',
  'York': 'York City', 'Chesterfield': 'Chesterfield', 'Wrexham': 'Wrexham', 'Notts County': 'Notts County',
  'Salford': 'Salford City', 'Macclesfield': 'Macclesfield Town', 'Bromley': 'Bromley', 'Barnet': 'Barnet',
  'Telford United': 'AFC Telford United', 'Tranmere': 'Tranmere Rovers', 'Mansfield': 'Mansfield Town',
  'Morecambe': 'Morecambe', 'Rochdale': 'Rochdale', 'Gateshead': 'Gateshead', 'Solihull': 'Solihull', 'Worthing': 'Worthing',
};
const fdDir = join(dirname(nonLeagueCsv), 'fd');
const fdKnown = new Set([...bySeason.values()].flat().flatMap((m) => [m.home, m.away]));
const fdUnmatched = new Set();
const fdName = (raw) => {
  const n = raw.replace(/\u2019|\uFFFD|\x92/g, "'").trim(); // apostrophe arrives in Windows-1252
  if (FD_NAMES[n]) return FD_NAMES[n];
  if (fdKnown.has(n)) return n;
  // A new club in the division: use the one existing club whose name starts with this one.
  const longer = [...fdKnown].filter((k) => k.startsWith(`${n} `));
  if (longer.length === 1) return longer[0];
  fdUnmatched.add(n);
  return n;
};
let n3 = 0;
for (let y = FD_FROM; ; y++) {
  const code = `${String(y % 100).padStart(2, '0')}${String((y + 1) % 100).padStart(2, '0')}`;
  let text;
  try { text = readFileSync(join(fdDir, `EC_${code}.csv`), 'latin1'); } catch { break; }
  for (const r of parseCsv(text.replace(/^\uFEFF|^\xEF\xBB\xBF/, ''))) {
    if (!r.HomeTeam || !r.Date || r.FTHG === '' || r.FTHG === undefined) continue;
    const [dd, mm, yy] = r.Date.split('/').map((v) => parseInt(v, 10));
    const year = yy < 100 ? 2000 + yy : yy;
    add(seasonLabel(y), {
      date: year * 10000 + mm * 100 + dd,
      division: nonLeagueName('conference', y),
      tier: 5,
      home: fdName(r.HomeTeam), away: fdName(r.AwayTeam),
      hg: parseInt(r.FTHG, 10), ag: parseInt(r.FTAG, 10),
    });
    n3++;
  }
}
if (fdUnmatched.size) console.log(`National League: club names not matched to an existing club: ${[...fdUnmatched].join(', ')}`);
console.log(`National League from football-data.co.uk: ${n3} matches`);

const outDir = join(root, 'data');
rmSync(join(outDir, 'seasons'), { recursive: true, force: true });
mkdirSync(join(outDir, 'seasons'), { recursive: true });

const seasonsIndex = [];
const teamSeasons = new Map(); // team -> [{ s: seasonIdx, t: tier, d: divisionName }]
let latest = 0;
const built = []; // season files, written once final-table outcomes are known

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
    adjustments: [],
  };
  // Points deductions (see scripts/deductions.mjs). `date` is when the table first shows it;
  // `on` is the date it was imposed, or 'start' / 'final' when that isn't a single known day.
  const seasonTo = ms[ms.length - 1].date;
  for (const [s, team, points, when, reason] of DEDUCTIONS) {
    if (s !== season) continue;
    const t = teamId.get(team);
    const own = t === undefined ? [] : data.matches.filter((m) => m[2] === t || m[3] === t);
    if (!own.length) throw new Error(`Deduction for ${team} in ${season}: club not in the results`);
    const div = own[0][1];
    let date, on;
    if (when === 'start') { date = 0; on = 'start'; }
    else if (when === 'final') {
      date = Math.max(...data.matches.filter((m) => m[1] === div).map((m) => m[0]));
      on = 'final';
    } else {
      on = parseInt(when.replaceAll('-', ''), 10);
      date = Math.min(on, seasonTo); // imposed after the season: applies to the final table
    }
    data.adjustments.push({ team: t, points, date, on, reason });
  }
  data.adjustments.sort((a, b) => a.date - b.date);
  for (const e of data.events) {
    if (e.team === undefined || (e.type === 'takeover' && e.to === undefined)) throw new Error(`Bad event in ${season}`);
  }
  const file = `seasons/${season.replace('/', '-')}.json`;
  built.push({ file, data });

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
// Zones, and final-table outcomes that depend on the following season.
// A club renamed on promotion still counts as the same club here.
const RENAMED = { 'Stevenage Borough': 'Stevenage' };
const tierBySeason = built.map(({ data }) => {
  const m = new Map();
  for (const [, dv, h, a] of data.matches) for (const t of [h, a]) m.set(data.teams[t], data.divisions[dv].tier);
  return m;
});
built.forEach(({ data }, s) => {
  const y = parseInt(data.season, 10);
  const size = data.divisions.map((d) => new Set(data.matches.filter((m) => m[1] === d.id).flatMap((m) => [m[2], m[3]])).size);
  data.zones = data.divisions.map((d) => zones(y, d.tier, size[d.id]));
  data.competitions = competitionNames(y);
  const next = tierBySeason[s + 1];
  const playoffWinners = [];
  if (next) {
    const last = Math.max(...data.matches.map((m) => m[0]));
    for (const d of data.divisions) {
      const z = data.zones[d.id];
      if (!z.po && !z.poDown) continue;
      for (const r of buildTable(data, d.id, last)) {
        const nt = next.get(RENAMED[r.team] || r.team);
        if (nt === undefined) continue;
        if (z.po && r.pos >= z.po[0] && r.pos <= z.po[1] && nt < d.tier) playoffWinners.push(r.teamIdx);
        if (z.poDown && r.pos === z.poDown && nt === d.tier) playoffWinners.push(r.teamIdx); // stayed up
      }
    }
  }
  data.playoffWinners = playoffWinners;
  const eu = EUROPE[data.season];
  data.europe = {};
  if (eu) {
    for (const [comp, clubs] of Object.entries(eu)) {
      for (const c of clubs) {
        const t = data.teams.indexOf(c);
        if (t < 0) throw new Error(`Europe ${data.season}: ${c} not in the results`);
        data.europe[t] = comp;
      }
    }
  }
  if (y >= 1984 && y <= 1989) {
    data.europeNote = y === 1989
      ? 'Liverpool, the champions, were still banned from Europe for a further season after Heysel.'
      : 'English clubs were banned from European competition after the Heysel disaster in May 1985, so no club qualified from this table.';
  }
  writeFileSync(join(outDir, built[s].file), JSON.stringify(data));
});

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
