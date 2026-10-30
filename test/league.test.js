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

test('version is the same everywhere', () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const v = JSON.parse(read('package.json')).version;
  assert.match(read('src/app.js'), new RegExp(`APP_VERSION = '${v.replaceAll('.', '\\.')}'`));
  assert.match(read('sw.js'), new RegExp(`VERSION = '${v.replaceAll('.', '\\.')}'`));
  assert.ok(read('index.html').includes(`v${v}`));
});
