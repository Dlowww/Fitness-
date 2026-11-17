// Small shared helpers: dates, formatting, math.

// Allow overriding "today" for testing: add ?today=2026-12-01 to the URL.
let todayOverride = null;
try {
  const p = new URLSearchParams(globalThis.location ? location.search : '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.get('today') || '')) todayOverride = p.get('today');
} catch (e) { /* not in a browser */ }
export function setTodayOverride(k) { todayOverride = k; }

const pad = (n) => String(n).padStart(2, '0');

export function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function today() {
  return todayOverride || dateKey(new Date());
}
export function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // noon avoids DST edge cases
}
export function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
// b - a, in days
export function diffDays(a, b) {
  return Math.round((parseKey(b) - parseKey(a)) / 86400000);
}
export function weekday(k) { return parseKey(k).getDay(); } // 0 = Sun
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(k, withYear = false) {
  const d = parseKey(k);
  return `${DAY_NAMES[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}${withYear ? ', ' + d.getFullYear() : ''}`;
}
export function fmtShort(k) {
  const d = parseKey(k);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
export function monthName(m) { return MONTHS[m]; }

export function fmtTime(sec) {
  if (sec == null || isNaN(sec)) return '–';
  sec = Math.round(sec);
  const neg = sec < 0; sec = Math.abs(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const out = h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return neg ? '-' + out : out;
}
// Accepts "15:42", "15.42", "1542", "15" (minutes), "1:02:03"
export function parseTime(str) {
  if (str == null) return null;
  str = String(str).trim();
  if (!str) return null;
  if (/[:.]/.test(str)) {
    const parts = str.split(/[:.]/).map((x) => parseInt(x || '0', 10));
    if (parts.some(isNaN)) return null;
    return parts.reduce((acc, v) => acc * 60 + v, 0);
  }
  if (!/^\d+$/.test(str)) return null;
  if (str.length <= 2) return parseInt(str, 10) * 60;
  const s = parseInt(str.slice(-2), 10), m = parseInt(str.slice(0, -2), 10);
  return m * 60 + s;
}

export const round5 = (w) => Math.round(w / 5) * 5;
export const e1rm = (w, r) => w * r * 0.0333 + w;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Plates per side for a barbell weight (45 lb bar)
export function plates(total, bar = 45) {
  let side = (total - bar) / 2;
  if (side <= 0) return 'bar only';
  const out = [];
  for (const p of [45, 35, 25, 10, 5, 2.5]) {
    while (side >= p - 1e-9) { out.push(p); side -= p; }
  }
  return out.length ? out.join(' + ') + ' /side' : 'bar only';
}
