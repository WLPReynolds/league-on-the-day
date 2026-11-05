import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../src/league.js';

const load = (s) => JSON.parse(readFileSync(new URL(`../data/seasons/${s}.json`, import.meta.url)));
const index = JSON.parse(readFileSync(new URL('../data/index.json', import.meta.url)));

const tiny = {
  season: '1975/1976',
  divisions: [{ id: 0, name: 'Div', tier: 1 }],
  teams: ['A', 'B', 'C'],
  matches: [
    [19750816, 0, 0, 1, 2, 0], // A 2-0 B
    [19750823, 0, 1, 2, 1, 1], // B 1-1 C
    [19750830, 0, 2, 0, 3, 1], // C 3-1 A
  ],
};

test('era rules', () => {
  assert.equal(L.pointsForWin('1980/1981'), 2);
  assert.equal(L.pointsForWin('1981/1982'), 3);
  assert.equal(L.tieBreaker('1975/1976'), 'ga');
  assert.equal(L.tieBreaker('1976/1977'), 'gd');
  assert.equal(L.goalAverage(3, 0), Infinity);
  assert.equal(L.goalAverage(0, 0), 0);
});

test('table as at a date, inclusive and exclusive', () => {
  const after = L.buildTable(tiny, 0, '1975-08-23');
  assert.deepEqual(after.map((r) => [r.team, r.p, r.pts]), [['A', 1, 2], ['C', 1, 1], ['B', 2, 1]]);
  const before = L.buildTable(tiny, 0, '1975-08-23', { includeDate: false });
  assert.deepEqual(before.map((r) => [r.team, r.p]), [['A', 1], ['B', 1], ['C', 0]]);
});

test('goal average decides ties before 1976/77', () => {
  // After 23 Aug, B and C are level on 1 point: C's average 1/1 beats B's 1/3.
  const mid = L.buildTable(tiny, 0, '1975-08-23');
  assert.deepEqual(mid.slice(1).map((r) => r.team), ['C', 'B']);
  // At the end: C 3pts, A 2pts (2 for a win in 1975/76), B 1pt.
  const end = L.buildTable(tiny, 0, '1975-08-31');
  assert.deepEqual(end.map((r) => [r.team, r.pts]), [['C', 3], ['A', 2], ['B', 1]]);
});

test('shared positions when teams are level on everything', () => {
  const t = L.buildTable(tiny, 0, '1975-08-01');
  assert.ok(t.every((r) => r.pos === 1));
});

test('last result, inclusive and exclusive of the date', () => {
  assert.equal(L.lastResult(tiny, 0, '1975-08-30').away, 'A');
  assert.equal(L.lastResult(tiny, 0, '1975-08-30', { includeDate: false }).away, 'B');
  assert.equal(L.lastResult(tiny, 0, '1975-08-01'), null);
  const r = L.lastResult(tiny, 0, '1975-08-30');
  assert.equal(r.venue, 'A');
  assert.equal(r.outcome, 'L');
});

test('seasonForDate handles in-season, close season and wartime', () => {
  const s = index.seasons;
  assert.equal(L.seasonForDate(s, '1983-02-19').entry.season, '1982/1983');
  assert.equal(L.seasonForDate(s, '1983-02-19').status, 'in-progress');
  const summer = L.seasonForDate(s, '1983-07-01');
  assert.equal(summer.entry.season, '1982/1983');
  assert.equal(summer.status, 'finished');
  assert.equal(L.seasonForDate(s, '1943-01-01').entry.season, '1939/1940');
  assert.equal(L.seasonForDate(s, '1880-01-01').entry, null);
});

test('Plymouth Argyle, 19 February 1983', () => {
  const sd = load('1982-1983');
  const p = sd.teams.indexOf('Plymouth Argyle');
  const div = L.teamDivision(sd, p);
  assert.equal(sd.divisions[div].name, 'Football League Third Division');
  const row = L.buildTable(sd, div, '1983-02-19').find((r) => r.team === 'Plymouth Argyle');
  assert.equal(row.pos, 8);
  const last = L.lastResult(sd, p, '1983-02-19');
  assert.equal(`${last.home} ${last.homeGoals}-${last.awayGoals} ${last.away}`, 'Plymouth Argyle 3-1 Bradford City');
});

test('known final tables', () => {
  const champ = (s, name) => {
    const sd = load(s);
    const div = sd.divisions.find((d) => d.name === name).id;
    const t = L.buildTable(sd, div, '2099-01-01');
    return [t[0].team, t[0].pts];
  };
  assert.deepEqual(champ('1982-1983', 'Football League Third Division'), ['Portsmouth', 91]);
  assert.deepEqual(champ('1970-1971', 'Football League First Division'), ['Arsenal', 65]);
  assert.deepEqual(champ('2015-2016', 'Premier League'), ['Leicester City', 81]);
  assert.deepEqual(champ('2018-2019', 'National League North'), ['Stockport County', 82]);
});

test('play-offs are not counted in non-league tables', () => {
  const sd = load('2016-2017');
  const div = sd.divisions.find((d) => d.name === 'National League North').id;
  const t = L.buildTable(sd, div, '2017-06-30');
  assert.ok(t.every((r) => r.p === 42), t.map((r) => `${r.team} ${r.p}`).join(', '));
});

test('Accrington Stanley 1961/62: in the table before resigning, gone after', () => {
  const sd = load('1961-1962');
  const div = sd.divisions.find((d) => d.name === 'Football League Fourth Division').id;
  assert.ok(L.buildTable(sd, div, '1962-03-03').some((r) => r.team === 'Accrington Stanley'));
  const after = L.buildTable(sd, div, '1962-05-31');
  assert.ok(!after.some((r) => r.team === 'Accrington Stanley'));
  assert.equal(after.length, 23);
  assert.ok(after.every((r) => r.p === 44));
});

test('Leeds City 1919/20: record passes to Port Vale', () => {
  const sd = load('1919-1920');
  const div = sd.divisions.find((d) => d.name === 'Football League Second Division').id;
  const early = L.buildTable(sd, div, '1919-10-04');
  assert.ok(early.some((r) => r.team === 'Leeds City' && r.p === 8));
  const end = L.buildTable(sd, div, '1920-06-01');
  assert.ok(!end.some((r) => r.team === 'Leeds City'));
  assert.equal(end.find((r) => r.team === 'Port Vale').p, 42);
});

test('position timeline through a season', () => {
  const sd = load('1998-1999');
  const city = sd.teams.indexOf('Manchester City');
  const div = L.teamDivision(sd, city);
  const tl = L.positionTimeline(sd, div, city);
  assert.equal(tl.filter((p) => p.played).length, 46);
  assert.ok(tl.every((p) => p.size === 24 && p.pos >= 1 && p.pos <= 24));
  // Final point matches the final table.
  const final = L.buildTable(sd, div, '1999-12-31').find((r) => r.team === 'Manchester City');
  assert.deepEqual([tl.at(-1).pos, tl.at(-1).pts], [final.pos, final.pts]);
  assert.equal(L.teamMatches(sd, city).length, 46);
});

test('tier bands stack divisions, parallel divisions share one', () => {
  const b = L.tierBands([{ tier: 1 }, { tier: 2 }, { tier: 3 }, { tier: 3 }], [22, 22, 22, 21]);
  assert.deepEqual(b.bands.map((x) => [x.tier, x.top, x.size]), [[1, 0, 22], [2, 22, 22], [3, 44, 22]]);
  assert.equal(b.offset(3), 44);
  assert.equal(b.total, 66);
});

test('history: Manchester City 1997/98 to 2001/02', () => {
  const hist = JSON.parse(readFileSync(new URL('../data/history.json', import.meta.url)));
  assert.equal(hist.sizes.length, index.seasons.length);
  const seq = hist.teams['Manchester City']
    .filter(([s]) => index.seasons[s].season >= '1997' && index.seasons[s].season < '2002')
    .map(([s, d, pos]) => [index.seasons[s].divisions[d].tier, pos]);
  assert.deepEqual(seq, [[2, 22], [3, 3], [2, 2], [1, 18], [2, 1]]);
});

test('every season sits within its own years', () => {
  // A season starting in year Y runs from July Y to June Y+1, except 2019/20 (Covid: to August 2020).
  index.seasons.forEach((e, i) => {
    const y = parseInt(e.season, 10);
    const latest = e.season === '2019/2020' ? (y + 1) * 10000 + 831 : (y + 1) * 10000 + 630;
    assert.ok(e.from >= y * 10000 + 701 && e.to <= latest, `${e.season}: ${e.from}–${e.to}`);
    const next = index.seasons[i + 1];
    if (next) assert.ok(e.to < next.from, `${e.season} overlaps ${next.season}`);
  });
});

test('Conference 2000/01 dates are in the right year', () => {
  const sd = load('2000-2001');
  const div = sd.divisions.find((d) => d.name === 'Football Conference').id;
  const dates = sd.matches.filter((m) => m[1] === div).map((m) => m[0]);
  assert.ok(Math.min(...dates) >= 20000801 && Math.max(...dates) <= 20010630);
});

const finalRow = (s, team) => {
  const sd = load(s);
  const t = sd.teams.indexOf(team);
  return { sd, row: (date) => L.buildTable(sd, L.teamDivision(sd, t), date).find((r) => r.team === team) };
};

test('deductions: Leeds 2007/08 start on -15 and finish on 76', () => {
  const { row } = finalRow('2007-2008', 'Leeds United');
  assert.equal(row('2007-08-01').pts, -15);
  assert.equal(row('2008-06-30').pts, 76);
  assert.equal(L.netAdjustment(row('2008-06-30')), -15);
});

test('deductions: Everton 2023/24 -10, then -6 on appeal, then -8', () => {
  const { row } = finalRow('2023-2024', 'Everton');
  assert.equal(L.netAdjustment(row('2023-12-01')), -10);
  assert.equal(L.netAdjustment(row('2024-03-01')), -6);
  assert.equal(L.netAdjustment(row('2024-06-30')), -8);
  assert.equal(row('2024-06-30').pts, 40);
});

test('deductions: final-table-only and after-the-season cases', () => {
  // Wigan 2019/20: -12 applied after the last game, relegating them on 47 points.
  const wigan = finalRow('2019-2020', 'Wigan Athletic').row;
  assert.equal(L.netAdjustment(wigan('2020-07-01')), 0);
  assert.equal(wigan('2020-08-31').pts, 47);
  // Macclesfield 2019/20: -17 in all by the final table.
  assert.equal(L.netAdjustment(finalRow('2019-2020', 'Macclesfield Town').row('2020-08-31')), -17);
  // Luton 2008/09: -30 from the start, finished on 26.
  assert.equal(finalRow('2008-2009', 'Luton Town').row('2009-06-30').pts, 26);
});

test('every deduction in the list is in the built data', async () => {
  const { DEDUCTIONS } = await import('../scripts/deductions.mjs');
  let n = 0;
  for (const e of index.seasons) n += (load(e.file.slice(8, -5)).adjustments || []).length;
  assert.equal(n, DEDUCTIONS.length);
});

test('zones: 1980s rules, play-off era, and this season', async () => {
  const { zones } = await import('../scripts/zones.mjs');
  assert.deepEqual([zones(1983, 1, 22).down, zones(1983, 2, 22).up, zones(1983, 2, 22).down,
    zones(1983, 3, 24).up, zones(1983, 3, 24).down, zones(1983, 4, 24).up, zones(1983, 4, 24).reelect],
  [3, 3, 3, 3, 4, 4, 4]);
  assert.deepEqual(zones(1986, 1, 22).poDown, 19);
  assert.deepEqual(zones(2025, 2, 24).po, [3, 6]);
  assert.deepEqual(zones(2026, 2, 24).po, [3, 8]);
  assert.equal(zones(1986, 1, 22).eu, null); // Heysel ban
  assert.deepEqual(zones(2024, 1, 20).eu, { cl: 5, el: 1, ecl: 1 });
});

test('zone lines: relegation never hidden by a line above it', () => {
  const lines = L.zoneLines({ up: 0, po: null, poDown: 19, down: 3, reelect: 0, testTop: 0, testBottom: 0, eu: { cl: 1, el: 0, ecl: 0 } }, 22);
  assert.deepEqual(lines, { 19: 'down', 18: 'po', 1: 'cl' });
});

test('final tables: play-off winners and European qualifiers', () => {
  const sd = load('2012-2013');
  assert.deepEqual(sd.playoffWinners.map((t) => sd.teams[t]).sort(),
    ['Bradford City', 'Crystal Palace', 'FC Halifax Town', 'Newport County', 'Salisbury', 'Yeovil Town']);
  assert.equal(sd.europe[sd.teams.indexOf('Wigan Athletic')], 'UEFA');
  assert.equal(sd.competitions.UEFA, 'Europa League');
  const charlton = load('1986-1987');
  assert.ok(charlton.playoffWinners.includes(charlton.teams.indexOf('Charlton Athletic')));
  assert.match(load('1986-1987').europeNote, /Heysel/);
  assert.ok(L.divisionFinished(sd, 0, '2013-06-30'));
  assert.ok(!L.divisionFinished(sd, 0, '2013-03-01'));
});

test('Aldershot Town is kept separate from the original Aldershot', () => {
  const t = index.teams;
  assert.ok(t['Aldershot'].every(([s]) => parseInt(index.seasons[s].season, 10) < 1992));
  assert.ok(t['Aldershot Town'].some(([s]) => index.seasons[s].season === '2007/2008'));
});

test('National League from football-data.co.uk', () => {
  const final = (season, club) => {
    const sd = load(season);
    const div = sd.divisions.find((d) => d.tier === 5).id;
    return L.buildTable(sd, div, '2099-01-01').find((r) => r.team === club);
  };
  assert.deepEqual([final('2022-2023', 'Wrexham').pos, final('2022-2023', 'Wrexham').pts], [1, 111]);
  assert.equal(final('2021-2022', 'Stockport County').pos, 1);
  // Dover's 2020/21 record was expunged, and they started 2021/22 on -12.
  assert.equal(final('2020-2021', 'Dover Athletic'), undefined);
  assert.equal(L.netAdjustment(final('2021-2022', 'Dover Athletic')), -12);
  // Short names are mapped, so clubs' histories join up across the League and non-league.
  for (const club of ['Stockport County', 'Notts County', 'Hartlepool United', 'Oldham Athletic']) {
    assert.ok(index.teams[club].some(([s, d]) => index.seasons[s].divisions[d].tier === 5 && parseInt(index.seasons[s].season, 10) >= 2019), club);
  }
  assert.ok(!index.teams['Stockport'] && !index.teams['Oldham']);
});

test('version is the same everywhere', () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const v = JSON.parse(read('package.json')).version;
  assert.match(read('src/app.js'), new RegExp(`APP_VERSION = '${v.replaceAll('.', '\\.')}'`));
  assert.match(read('sw.js'), new RegExp(`VERSION = '${v.replaceAll('.', '\\.')}'`));
  assert.ok(read('index.html').includes(`v${v}`));
});
