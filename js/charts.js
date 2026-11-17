// Tiny SVG chart helpers (no libraries, works offline).
import { parseKey, fmtShort, addDays, weekday, esc, monthName } from './util.js';

const W = 340, H = 180, PAD = { l: 40, r: 10, t: 12, b: 24 };

// series: [{ points: [{date, y}], color, dots, line, width, label }]
export function lineChart({ series, yFmt = (v) => Math.round(v), goal, band, height = H, emptyText = 'No data yet' }) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) return `<div class="chart-empty">${esc(emptyText)}</div>`;
  const xs = all.map((p) => parseKey(p.date).getTime());
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x1 - x0 < 86400000 * 6) { x0 -= 86400000 * 3; x1 += 86400000 * 3; }
  const ys = all.map((p) => p.y);
  if (goal != null) ys.push(goal.y);
  if (band) ys.push(band.min, band.max);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y1 - y0 < Math.max(4, Math.abs(y1) * 0.04)) { const pad = Math.max(2, Math.abs(y1) * 0.02); y0 -= pad; y1 += pad; }
  const span = y1 - y0;
  y0 -= span * 0.12; y1 += span * 0.12;
  const iw = W - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;
  const X = (t) => PAD.l + ((t - x0) / (x1 - x0)) * iw;
  const Y = (v) => PAD.t + (1 - (v - y0) / (y1 - y0)) * ih;

  let g = '';
  // grid + y labels
  for (let i = 0; i <= 3; i++) {
    const v = y0 + ((y1 - y0) * i) / 3;
    const y = Y(v);
    g += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" class="grid"/>`;
    g += `<text x="${PAD.l - 6}" y="${y + 4}" class="axis" text-anchor="end">${esc(yFmt(v))}</text>`;
  }
  // x labels: first and last date + middle
  const ticks = [x0, (x0 + x1) / 2, x1];
  ticks.forEach((t, i) => {
    const d = new Date(t);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    g += `<text x="${X(t)}" y="${height - 6}" class="axis" text-anchor="${['start', 'middle', 'end'][i]}">${fmtShort(k)}</text>`;
  });
  if (band) {
    g += `<rect x="${PAD.l}" width="${iw}" y="${Y(band.max)}" height="${Y(band.min) - Y(band.max)}" class="band"/>`;
  }
  if (goal != null) {
    g += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(goal.y)}" y2="${Y(goal.y)}" class="goal"/>`;
    g += `<text x="${W - PAD.r}" y="${Y(goal.y) - 5}" class="goal-label" text-anchor="end">${esc(goal.label || '')}</text>`;
  }
  for (const s of series) {
    const pts = s.points.map((p) => [X(parseKey(p.date).getTime()), Y(p.y)]);
    if (s.line !== false && pts.length > 1) {
      g += `<polyline fill="none" stroke="${s.color}" stroke-width="${s.width || 2.5}" stroke-linejoin="round" stroke-linecap="round" points="${pts.map((p) => p.join(',')).join(' ')}"/>`;
    }
    if (s.dots !== false) {
      for (const p of pts) g += `<circle cx="${p[0]}" cy="${p[1]}" r="${s.r || 3.5}" fill="${s.color}" opacity="${s.dotOpacity ?? 1}"/>`;
    }
  }
  const legend = series.filter((s) => s.label).map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${height}" class="chart" role="img">${g}</svg>${legend ? `<div class="legend">${legend}</div>` : ''}`;
}

// GitHub-style heatmap for a year. level(dateKey) -> 0..3
export function heatmap(year, level, todayKey) {
  const cell = 11, gap = 2, step = cell + gap;
  let start = `${year}-01-01`;
  start = addDays(start, -weekday(start)); // back to Sunday
  const end = `${year}-12-31`;
  let col = 0, g = '', lastMonth = -1;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dow = weekday(d);
    if (dow === 0 && d !== start) col++;
    if (d.slice(0, 4) !== String(year)) continue;
    const m = parseKey(d).getMonth();
    if (m !== lastMonth && dow <= 0 + 6 && parseKey(d).getDate() <= 7) {
      g += `<text x="${30 + col * step}" y="9" class="axis">${monthName(m)}</text>`;
      lastMonth = m;
    }
    const lv = d > todayKey ? -1 : level(d);
    g += `<rect x="${30 + col * step}" y="${14 + dow * step}" width="${cell}" height="${cell}" rx="2" class="hm hm${lv}${d === todayKey ? ' hm-today' : ''}"><title>${d}</title></rect>`;
  }
  const labels = ['', 'Mon', '', 'Wed', '', 'Fri', ''].map((l, i) => l ? `<text x="0" y="${14 + i * step + 9}" class="axis">${l}</text>` : '').join('');
  const w = 30 + (col + 1) * step;
  return `<div class="hm-wrap"><svg viewBox="0 0 ${w} ${14 + 7 * step}" width="${w}" height="${14 + 7 * step}" class="heatmap">${labels}${g}</svg></div>`;
}
