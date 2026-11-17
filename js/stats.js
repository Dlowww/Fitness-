// Streaks, weekly progress, bodyweight averages and personal records.
import { today, addDays, diffDays, weekday, e1rm } from './util.js';

export const realSessions = (state) => state.sessions.filter((x) => !x.skipped);

export function sessionDays(state) {
  const set = new Set();
  for (const x of realSessions(state)) set.add(x.date);
  return set;
}

function inHold(state, d) {
  return state.holds.some((h) => d >= h.from && d <= h.to);
}
export function isPlannedDay(state, d) {
  return weekday(d) !== state.settings.restDay && !inHold(state, d);
}

// "Never miss twice": the streak survives one missed planned day, but not two in a row.
// Rest days and test-day waiting periods are neutral. Length is counted in calendar days.
export function streakInfo(state, t = today()) {
  const done = sessionDays(state);
  if (!done.size) return { days: 0, weeks: 0, best: state.bestStreak || 0, atRisk: false, start: null, doneToday: false };
  const first = [...done].sort()[0];
  let start = null, misses = 0, best = 0, lastDone = null;
  for (let d = first; d <= t; d = addDays(d, 1)) {
    if (done.has(d)) {
      if (!start) start = d;
      misses = 0;
      lastDone = d;
    } else if (d === t || !isPlannedDay(state, d)) {
      // neutral
    } else {
      misses += 1;
      if (misses >= 2 && start) {
        best = Math.max(best, diffDays(start, lastDone) + 1);
        start = null;
      }
    }
  }
  const days = start ? diffDays(start, t) + 1 : 0;
  best = Math.max(best, days, state.bestStreak || 0);
  return {
    days, weeks: Math.floor(days / 7), best, start,
    atRisk: !!start && misses === 1 && !done.has(t),
    doneToday: done.has(t),
  };
}

// Calendar week runs from the day after the rest day through the rest day.
export function weekStart(state, d = today()) {
  const startDow = (state.settings.restDay + 1) % 7;
  const back = (weekday(d) - startDow + 7) % 7;
  return addDays(d, -back);
}
export function weekProgress(state, d = today()) {
  const ws = weekStart(state, d);
  const we = addDays(ws, 6);
  const list = realSessions(state).filter((x) => x.date >= ws && x.date <= we);
  return { done: list.length, target: 6, start: ws, end: we, sessions: list };
}

export function avg7(state, d = today()) {
  const vals = [];
  for (let i = 0; i < 7; i++) {
    const v = state.weights[addDays(d, -i)];
    if (v) vals.push(v);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
export function latestWeight(state) {
  const keys = Object.keys(state.weights).sort();
  if (!keys.length) return null;
  const k = keys[keys.length - 1];
  return { date: k, lb: state.weights[k] };
}
export function weightSeries(state) {
  const keys = Object.keys(state.weights).sort();
  return keys.map((k) => ({ date: k, lb: state.weights[k], avg: avg7(state, k) }));
}

// Best estimated 1RM from completed work sets in a lift session
export function sessionE1rm(sess) {
  if (!sess.lift) return null;
  let best = null;
  for (const st of sess.lift.sets) {
    if (st.done && st.w && st.r) {
      const v = e1rm(st.w, st.r);
      if (best == null || v > best) best = v;
    }
  }
  return best;
}
export function e1rmHistory(state, lift) {
  return realSessions(state)
    .filter((x) => x.lift && x.lift.lift === lift)
    .map((x) => ({ date: x.date, v: sessionE1rm(x) }))
    .filter((p) => p.v);
}
export function bestE1rm(state, lift, excludeId) {
  let best = null;
  for (const x of realSessions(state)) {
    if (x.id === excludeId || !x.lift || x.lift.lift !== lift) continue;
    const v = sessionE1rm(x);
    if (v && (best == null || v > best)) best = v;
  }
  return best;
}

// Time trials (1-mile, 2-mile) from runs and PT tests
export function trialHistory(state, kind) {
  const out = [];
  for (const x of realSessions(state)) {
    if (x.run && x.run.tt === kind && x.run.timeSec) out.push({ date: x.date, sec: x.run.timeSec, id: x.id });
    if (kind === '2mi' && x.pt && x.pt.run2mi) out.push({ date: x.date, sec: x.pt.run2mi, id: x.id, pt: true });
  }
  return out;
}
export function bestTrial(state, kind, excludeId) {
  const list = trialHistory(state, kind).filter((t) => t.id !== excludeId);
  return list.length ? Math.min(...list.map((t) => t.sec)) : null;
}
export function bestMax(state, field, excludeDate) {
  let best = null;
  for (const m of state.maxTests) {
    if (m._sid && m._sid === excludeDate) continue;
    if (m[field] && (best == null || m[field] > best)) best = m[field];
  }
  return best;
}

export function totalMiles(state, from, to) {
  let m = 0;
  for (const x of realSessions(state)) {
    if (from && x.date < from) continue;
    if (to && x.date > to) continue;
    if (x.run && x.run.miles) m += x.run.miles;
    if (x.pt && x.pt.run2mi) m += 2;
  }
  return m;
}

// Longest run of streak within a date range (for year in review)
export function bestStreakInRange(state, from, to) {
  const done = sessionDays(state);
  let start = null, misses = 0, best = 0, lastDone = null;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (done.has(d)) {
      if (!start) start = d;
      misses = 0; lastDone = d;
      best = Math.max(best, diffDays(start, d) + 1);
    } else if (isPlannedDay(state, d)) {
      misses++;
      if (misses >= 2) start = null;
    }
  }
  return best;
}
