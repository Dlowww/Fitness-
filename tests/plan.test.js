// Run with: node tests/plan.test.js
import assert from 'node:assert/strict';
import { defaultState } from '../js/store.js';
import { nextSession, advance, weekLabel, syncPlan, weekSessions } from '../js/plan.js';
import { streakInfo } from '../js/stats.js';
import { addDays } from '../js/util.js';

let s = defaultState();
s.settings.tm = { bench: 150, squat: 200, press: 100, deadlift: 250 };
let day = '2026-11-17';
syncPlan(s, day);
const seen = [];
// Simulate one session per day, skipping Fridays
for (let i = 0; i < 200; i++) {
  const nx = nextSession(s);
  if (new Date(day + 'T12:00').getDay() === 5 && nx.kind !== 'pt') { day = addDays(day, 1); continue; }
  if (nx.kind === 'pt' && day < nx.date) { day = addDays(day, 1); continue; }
  seen.push({ day, label: weekLabel(s.plan), key: nx.key, title: nx.title, detail: nx.detail, lift: nx.lift, w: nx.sets && nx.sets.map((x) => x.w) });
  s.sessions.push({ id: String(i), date: day, key: nx.key });
  const notes = advance(s, day);
  if (notes.length) seen.push({ day, notes });
  day = addDays(day, 1);
}
const show = (f) => seen.filter(f).forEach((x) => console.log(JSON.stringify(x)));
if (process.argv[2] === '-v') show((x) => x.notes || x.key === 'liftA' || x.key === 'pttest' || x.key === 'liftB');

// Checks
const w1A = seen.find((x) => x.key === 'liftA');
assert.deepEqual(w1A.w, [100, 115, 130]); // 150 * 65/75/85 -> 97.5,112.5,127.5 -> rounded
const w5A = seen.find((x) => x.label && x.label.includes('Week 5') && x.key === 'liftA');
assert.deepEqual(w5A.w, [100, 115, 130].map((_, i) => Math.round(155 * [65, 75, 85][i] / 100 / 5) * 5));
const w5B = seen.find((x) => x.label && x.label.includes('Week 5') && x.key === 'liftB');
assert.equal(w5B.lift, 'deadlift');
const pt = seen.find((x) => x.key === 'pttest');
assert.equal(pt.day, '2027-01-15');
assert.ok(!seen.some((x) => x.label && x.label.includes('Week 8') && (x.key === 'liftB' || x.key === 'liftC')));
const c1 = seen.filter((x) => x.label && x.label.startsWith('Cycle 1') && x.key === 'liftB');
assert.ok(c1.every((x) => x.lift === 'squat'));
const c2 = seen.filter((x) => x.label && x.label.startsWith('Cycle 2') && x.key === 'liftB');
assert.ok(c2.length && c2.every((x) => x.lift === 'deadlift'));
assert.equal(s.pending.cycleTM, true);
console.log('runs in ongoing:', [...new Set(seen.filter((x) => x.label && x.label.startsWith('Cycle') && x.key.startsWith('run')).map((x) => x.label + ' | ' + x.title))].join('\n'));

// New PT test switches the block
const s2 = defaultState();
s2.plan.mode = 'ongoing'; s2.plan.ongoingWeek = 9; s2.plan.idx = 0;
s2.settings.nextTestDate = '2027-07-10';
syncPlan(s2, '2027-04-01'); // 100 days out: stay ongoing
assert.equal(s2.plan.mode, 'ongoing');
syncPlan(s2, '2027-05-15'); // 56 days out -> week 1
assert.equal(s2.plan.mode, 'pt'); assert.equal(s2.plan.ptWeek, 1);
const s3 = defaultState();
s3.plan.mode = 'ongoing'; s3.plan.ongoingWeek = 3; s3.plan.idx = 0; s3.settings.nextTestDate = '2027-07-10';
syncPlan(s3, '2027-06-12'); // 28 days -> week 5
assert.equal(s3.plan.ptWeek, 5);

// Streak: never miss twice
const s4 = defaultState();
const mk = (d) => ({ id: d, date: d, key: 'x' });
// Tue 17, Wed 18 done, Thu 19 missed, Fri 20 rest, Sat 21 done -> streak continues
s4.sessions = ['2026-11-17', '2026-11-18', '2026-11-21'].map(mk);
let st = streakInfo(s4, '2026-11-21');
assert.equal(st.days, 5);
// Sun 22 + Mon 23 missed -> broken
st = streakInfo(s4, '2026-11-24');
assert.equal(st.days, 0); assert.equal(st.best, 5);
// one miss -> at risk
st = streakInfo(s4, '2026-11-23');
assert.equal(st.atRisk, true); assert.equal(st.days, 7);
console.log('ALL TESTS PASSED');
