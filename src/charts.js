// Hand-built SVG charts (no libraries, so they work offline). Each builder returns
// { svg, xs } where xs are the x positions of the pickable points, for tap/drag scrubbing.
import { tierBands } from './league.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayNum = (n) => Date.UTC(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100) / 864e5;

/**
 * Position through one season. Higher is better, so 1st is at the top.
 * points: positionTimeline() output; outcomes: Map date -> 'W'|'D'|'L' for the club's games;
 * picked: index into the played points to highlight; marker: yyyymmdd of the selected date.
 */
export function seasonChart({ points, outcomes, picked, marker, width, height = 220 }) {
  const m = { l: 30, r: 10, t: 10, b: 24 };
  const w = width - m.l - m.r;
  const h = height - m.t - m.b;
  const size = Math.max(...points.map((p) => p.size));
  const d0 = dayNum(points[0].date);
  const d1 = Math.max(dayNum(points.at(-1).date), d0 + 1);
  const x = (n) => m.l + ((dayNum(n) - d0) / (d1 - d0)) * w;
  const y = (pos) => m.t + ((pos - 1) / Math.max(size - 1, 1)) * h;

  // Grid: 1st, every 5th, and bottom place.
  const ticks = [1, ...Array.from({ length: Math.floor(size / 5) }, (_, i) => (i + 1) * 5).filter((t) => size - t >= 2), size];
  let g = ticks.map((t) => `<line class="grid" x1="${m.l}" x2="${m.l + w}" y1="${y(t)}" y2="${y(t)}"/>
    <text class="axis" x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('');

  // Month labels at the 1st of each month, thinned on narrow screens.
  const first = points[0].date;
  let yr = Math.floor(first / 10000), mo = Math.floor(first / 100) % 100 + 1;
  const step = w < 300 ? 2 : 1;
  for (let i = 0; ; i++) {
    if (mo > 12) { mo = 1; yr++; }
    const n = yr * 10000 + mo * 100 + 1;
    if (dayNum(n) > d1) break;
    if (i % step === 0) {
      g += `<line class="tick" x1="${x(n)}" x2="${x(n)}" y1="${m.t + h}" y2="${m.t + h + 4}"/>
        <text class="axis" x="${x(n)}" y="${height - 6}" text-anchor="middle">${MONTHS[mo - 1]}</text>`;
    }
    mo++;
  }

  // Position holds between match days, so draw it as steps.
  let path = `M${x(points[0].date)},${y(points[0].pos)}`;
  for (const p of points.slice(1)) path += `H${x(p.date)}V${y(p.pos)}`;

  const played = points.filter((p) => p.played);
  const dots = played.map((p, i) => `<circle class="dot res-${outcomes.get(p.date) || ''}${i === picked ? ' picked' : ''}"
    cx="${x(p.date)}" cy="${y(p.pos)}" r="${i === picked ? 6 : 4}"/>`).join('');

  let mark = '';
  if (marker && marker >= points[0].date && marker <= points.at(-1).date) {
    mark = `<line class="marker" x1="${x(marker)}" x2="${x(marker)}" y1="${m.t}" y2="${m.t + h}"/>`;
  }
  const cross = picked != null && played[picked]
    ? `<line class="cross" x1="${x(played[picked].date)}" x2="${x(played[picked].date)}" y1="${m.t}" y2="${m.t + h}"/>` : '';

  return {
    svg: `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"
      aria-label="League position through the season">${g}${mark}${cross}
      <path class="line" d="${path}"/>${dots}</svg>`,
    xs: played.map((p) => x(p.date)),
  };
}

/**
 * Final position in every season, with the divisions stacked into one scale so moving
 * between tiers shows as a jump across a band. rows: history.json rows for one club.
 */
export function historyChart({ rows, seasons, sizes, picked, inProgress, width, height = 260 }) {
  const m = { l: 26, r: 10, t: 8, b: 24 };
  const w = width - m.l - m.r;
  const h = height - m.t - m.b;
  const year = (s) => parseInt(seasons[s].season, 10);
  const y0 = year(rows[0][0]) - 0.5;
  const y1 = year(rows.at(-1)[0]) + 0.5;
  const x = (yr) => m.l + ((yr - y0) / (y1 - y0)) * w;

  // Seasons in range, with their stacked divisions.
  // Only the tiers the club has played in (and those above), so the scale isn't squashed.
  const deepest = Math.max(...rows.map((r) => seasons[r[0]].divisions[r[1]].tier));
  const cols = [];
  for (let s = rows[0][0]; s <= rows.at(-1)[0]; s++) {
    const keep = seasons[s].divisions.map((d, i) => [d, sizes[s][i]]).filter(([d]) => d.tier <= deepest);
    cols.push({ s, ...tierBands(keep.map(([d]) => d), keep.map(([, n]) => n)) });
  }
  const total = Math.max(...cols.map((c) => c.total));
  const y = (place) => m.t + (place / total) * h;

  let g = '';
  const labelled = new Set();
  for (const c of cols) {
    const xa = x(year(c.s) - 0.5);
    const xb = x(year(c.s) + 0.5);
    for (const b of c.bands) {
      g += `<rect class="band band-${b.tier % 2}" x="${xa}" y="${y(b.top)}" width="${xb - xa + 0.5}" height="${y(b.top + b.size) - y(b.top)}"/>`;
    }
  }
  for (const c of cols) {
    for (const b of c.bands) {
      if (labelled.has(b.tier)) continue;
      labelled.add(b.tier);
      // Tier number in the left gutter, level with the band where it first appears.
      g += `<text class="axis tier" x="${m.l - 6}" y="${(y(b.top) + y(b.top + b.size)) / 2 + 4}" text-anchor="end">T${b.tier}</text>`;
    }
  }

  // Decade-ish labels at least ~45px apart.
  const span = y1 - y0;
  const stepYears = [5, 10, 20, 25, 50].find((st) => (st / span) * w >= 45) || 50;
  for (let yr = Math.ceil(y0 / stepYears) * stepYears; yr <= y1; yr += stepYears) {
    g += `<line class="tick" x1="${x(yr)}" x2="${x(yr)}" y1="${m.t + h}" y2="${m.t + h + 4}"/>
      <text class="axis" x="${x(yr)}" y="${height - 6}" text-anchor="middle">${yr}</text>`;
  }

  // One point per season, joined only across consecutive covered seasons.
  const pts = rows.map((r) => {
    const col = cols[r[0] - cols[0].s];
    const tier = seasons[r[0]].divisions[r[1]].tier;
    return { s: r[0], tier, pos: r[2], cx: x(year(r[0])), cy: y(col.offset(tier) + r[2] - 0.5) };
  });
  let path = '';
    // Break the line for wartime gaps and seasons outside the covered divisions.
  pts.forEach((p, i) => {
    const joined = i && pts[i - 1].s === p.s - 1 && year(p.s) - year(pts[i - 1].s) === 1;
    path += `${joined ? 'L' : 'M'}${p.cx},${p.cy}`;
  });
  const dots = pts.map((p) => {
    const cls = ['dot', p.tier === 1 && p.pos === 1 ? 'title' : '', p.s === inProgress ? 'live' : ''].join(' ');
    return `<circle class="${cls}" cx="${p.cx}" cy="${p.cy}" r="${p.tier === 1 && p.pos === 1 ? 4 : 2.5}"/>`;
  }).join('');
  const sel = pts[picked];
  const pick = sel ? `<line class="cross" x1="${sel.cx}" x2="${sel.cx}" y1="${m.t}" y2="${m.t + h}"/>
    <circle class="picked-ring" cx="${sel.cx}" cy="${sel.cy}" r="7"/>` : '';

  return {
    svg: `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"
      aria-label="Final league position in every season">${g}${pick}
      <path class="line" d="${path}"/>${dots}</svg>`,
    xs: pts.map((p) => p.cx),
  };
}
