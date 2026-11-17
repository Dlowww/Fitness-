// Achievement definitions and the logic that awards them.
import { today, addDays } from './util.js';
import { realSessions, streakInfo, weekStart, isPlannedDay, sessionDays, avg7, trialHistory } from './stats.js';

export const BADGES = [
  { id: 'first_session', icon: '🎯', name: 'First Step', desc: 'Log your first session' },
  { id: 'first_week', icon: '📅', name: 'Full Week', desc: 'All 6 sessions in one week' },
  { id: 's10', icon: '💪', name: '10 Sessions', desc: 'Log 10 sessions', count: 10 },
  { id: 's25', icon: '⭐', name: '25 Sessions', desc: 'Log 25 sessions', count: 25 },
  { id: 's50', icon: '🌟', name: '50 Sessions', desc: 'Log 50 sessions', count: 50 },
  { id: 's100', icon: '💯', name: '100 Sessions', desc: 'Log 100 sessions', count: 100 },
  { id: 's250', icon: '🏅', name: '250 Sessions', desc: 'Log 250 sessions', count: 250 },
  { id: 's500', icon: '🎖️', name: '500 Sessions', desc: 'Log 500 sessions', count: 500 },
  { id: 's1000', icon: '👑', name: '1,000 Sessions', desc: 'Log 1,000 sessions', count: 1000 },
  { id: 'streak4', icon: '🔥', name: '4-Week Streak', desc: 'Never miss twice for 4 weeks', days: 28 },
  { id: 'streak12', icon: '🚀', name: '12-Week Streak', desc: 'Never miss twice for 12 weeks', days: 84 },
  { id: 'streak26', icon: '🌋', name: '26-Week Streak', desc: 'Never miss twice for 6 months', days: 182 },
  { id: 'streak52', icon: '🐉', name: '52-Week Streak', desc: 'Never miss twice for a whole year', days: 364 },
  { id: 'full_month', icon: '🗓️', name: 'Full Month', desc: 'Every planned session in a calendar month', repeat: true },
  { id: 'run20', icon: '🏃', name: '20 Minutes Strong', desc: 'First continuous 20-minute run' },
  { id: 'first_2mi', icon: '⏱️', name: 'First 2-Mile Trial', desc: 'Complete your first 2-mile time trial' },
  { id: 'best_2mi', icon: '🥇', name: '2-Mile Best', desc: 'Set a new 2-mile best', repeat: true },
  { id: 'best_1mi', icon: '🥈', name: '1-Mile Best', desc: 'Set a new 1-mile best', repeat: true },
  { id: 'pr_bench', icon: '🏋️', name: 'Bench PR', desc: 'New estimated 1RM on bench', repeat: true },
  { id: 'pr_squat', icon: '🦵', name: 'Squat PR', desc: 'New estimated 1RM on squat', repeat: true },
  { id: 'pr_deadlift', icon: '🪨', name: 'Deadlift PR', desc: 'New estimated 1RM on trap bar deadlift', repeat: true },
  { id: 'pr_press', icon: '🙌', name: 'Press PR', desc: 'New estimated 1RM on overhead press', repeat: true },
  { id: 'pushup_max', icon: '💥', name: 'Push-up Max', desc: 'Beat your push-up max', repeat: true },
  { id: 'situp_max', icon: '🌀', name: 'Sit-up Max', desc: 'Beat your sit-up max', repeat: true },
  { id: 'lost5', icon: '⚖️', name: '5 lb Down', desc: 'Every 5 lb lost (7-day average)', repeat: true },
  { id: 'goal_weight', icon: '🎉', name: 'Goal Weight', desc: 'Reach your goal weight (7-day average)' },
  { id: 'pt_pass', icon: '🦅', name: 'PT Test Passed', desc: 'One for every PT test you pass', repeat: true },
];
export const BADGE_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]));

export function hasKey(state, key) {
  return state.badges.some((b) => b.key === key);
}

// Add badges; returns the ones that are actually new.
export function award(state, list, date = today()) {
  const out = [];
  for (const b of list) {
    const key = b.key || b.id;
    if (hasKey(state, key)) continue;
    const rec = { id: b.id, key, date, text: b.text || BADGE_BY_ID[b.id].name };
    state.badges.push(rec);
    out.push(rec);
  }
  return out;
}

// Everything that can be worked out from saved data. May switch the weight goal to "maintain".
export function evaluate(state, t = today()) {
  const found = [];
  const sessions = realSessions(state);
  const n = sessions.length;
  if (n >= 1) found.push({ id: 'first_session' });
  for (const b of BADGES) if (b.count && n >= b.count) found.push({ id: b.id });

  // Full week
  const perWeek = {};
  for (const x of sessions) {
    const ws = weekStart(state, x.date);
    perWeek[ws] = (perWeek[ws] || 0) + 1;
  }
  if (Object.values(perWeek).some((c) => c >= 6)) found.push({ id: 'first_week' });

  // Streaks
  const st = streakInfo(state, t);
  if (st.days > (state.bestStreak || 0)) state.bestStreak = st.days;
  const best = Math.max(st.best, state.bestStreak || 0);
  for (const b of BADGES) if (b.days && best >= b.days) found.push({ id: b.id });

  // Full month
  if (n) {
    const done = sessionDays(state);
    const first = sessions.map((x) => x.date).sort()[0];
    let [y, m] = first.split('-').map(Number);
    while (true) {
      const ms = `${y}-${String(m).padStart(2, '0')}-01`;
      if (ms > t) break;
      const nm = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const me = addDays(nm, -1);
      const closed = me < t || (me === t && done.has(t));
      if (closed) {
        let ok = true, any = false;
        for (let d = ms; d <= me; d = addDays(d, 1)) {
          if (done.has(d)) any = true;
          else if (isPlannedDay(state, d)) { ok = false; break; }
        }
        if (ok && any) found.push({ id: 'full_month', key: `full_month:${ms.slice(0, 7)}`, text: `Full Month · ${ms.slice(0, 7)}` });
      }
      m++; if (m > 12) { m = 1; y++; }
    }
  }

  if (sessions.some((x) => x.run && x.run.continuous20)) found.push({ id: 'run20' });
  if (trialHistory(state, '2mi').length) found.push({ id: 'first_2mi' });

  // Weight
  const start = state.settings.startWeight;
  const dates = Object.keys(state.weights).sort();
  if (start && dates.length) {
    let minAvg = Infinity;
    for (const d of dates) minAvg = Math.min(minAvg, avg7(state, d));
    for (let k = 5; start - k >= minAvg; k += 5) {
      found.push({ id: 'lost5', key: `lost5:${start - k}`, text: `Down ${k} lb (7-day avg under ${start - k})` });
    }
  }
  const g = state.settings.goal;
  const a = avg7(state, t);
  let goalReached = false;
  if (g && g.type === 'lose' && a != null && a <= g.target) {
    found.push({ id: 'goal_weight', key: `goal_weight:${g.target}`, text: `Goal weight: ${g.target} lb!` });
    goalReached = true;
  }

  for (const r of state.ptResults) {
    if (r.passed) found.push({ id: 'pt_pass', key: `pt_pass:${r.date}`, text: `PT test passed · ${r.date}` });
  }

  const fresh = award(state, found, t);
  if (goalReached && fresh.some((b) => b.id === 'goal_weight')) {
    state.settings.goal = { type: 'maintain', min: g.target - 5, max: g.target + 5 };
  }
  return fresh;
}

export function badgeCount(state, id) {
  return state.badges.filter((b) => b.id === id).length;
}
