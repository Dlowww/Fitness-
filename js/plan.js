// The training plan engine: works out which session is next and what's in it.
import { round5, diffDays, addDays, fmtTime, clamp } from './util.js';

export const LIFTS = { bench: 'Bench press', squat: 'Squat', press: 'Overhead press', deadlift: 'Trap bar deadlift' };
export const LIFT_ORDER = ['bench', 'squat', 'deadlift', 'press'];

export const ACCESSORY_SLOTS = {
  A1: { day: 'Lift A', def: 'Push-ups', options: ['Push-ups', 'Incline push-ups', 'Dumbbell bench', 'Weighted push-ups'] },
  A2: { day: 'Lift A', def: 'Dumbbell row', options: ['Dumbbell row', 'Cable row', 'Inverted row', 'Chest-supported row'] },
  A3: { day: 'Lift A', def: 'Sit-ups', options: ['Sit-ups', 'Crunches', 'Cable crunch', 'Decline sit-ups'] },
  B1: { day: 'Lift B', def: 'Dips', options: ['Dips', 'Dumbbell bench', 'Bench dips'] },
  B2: { day: 'Lift B', def: 'Chin-ups', options: ['Chin-ups', 'Assisted chin-ups', 'Lat pulldown', 'Pull-ups'] },
  B3: { day: 'Lift B', def: 'Back extensions', options: ['Back extensions', 'Good mornings', 'Reverse hypers', 'Bird dogs'] },
  C1: { day: 'Lift C', def: 'Push-ups', options: ['Push-ups', 'Incline push-ups', 'Dumbbell bench', 'Weighted push-ups'] },
  C2: { day: 'Lift C', def: 'Face pulls', options: ['Face pulls', 'Band pull-aparts', 'Rear delt flyes'] },
  C3: { day: 'Lift C', def: 'Hanging knee raises', options: ['Hanging knee raises', 'Lying leg raises', 'Ab wheel', 'Captain\'s chair raises'] },
};

const PT_PCT = { 1: [65, 75, 85], 2: [70, 80, 90], 3: [75, 85, 95], 4: [40, 50, 60], 5: [65, 75, 85], 6: [70, 80, 90], 7: [75, 85, 95], 8: [40, 50, 60] };
const CYCLE_PCT = { 1: [65, 75, 85], 2: [70, 80, 90], 3: [75, 85, 95], 4: [40, 50, 60] };
export const WEEK_KEYS = ['liftA', 'run1', 'liftB', 'run2', 'liftC', 'run3'];
export const BLOCK_DAYS = 56;

// ---------- Run step builders (used by the interval timer) ----------
// Countdown steps have `sec`; manual "tap when done" steps have `target` (or nothing).
const warmJog = () => ({ label: 'Warm-up: easy jog', kind: 'warm', sec: 600 });
const warmWalk = () => ({ label: 'Warm-up: brisk walk', kind: 'walk', sec: 300 });
const coolWalk = () => ({ label: 'Cool-down walk', kind: 'walk', sec: 300 });

function jogWalk(reps, jogMin, walkMin) {
  const steps = [warmWalk()];
  for (let i = 1; i <= reps; i++) {
    steps.push({ label: `Jog ${i} of ${reps}`, kind: 'run', sec: jogMin * 60 });
    steps.push({ label: `Walk ${i} of ${reps}`, kind: 'walk', sec: walkMin * 60 });
  }
  return steps;
}
function repeats(n, distLabel, target, restSec) {
  const steps = [warmJog()];
  for (let i = 1; i <= n; i++) {
    steps.push({ label: `${distLabel} — rep ${i} of ${n}`, kind: 'rep', target });
    if (i < n) steps.push({ label: 'Walk recovery', kind: 'rest', sec: restSec });
  }
  steps.push(coolWalk());
  return steps;
}
function easyRun(min, strides = false) {
  const steps = [{ label: `Easy run — ${min} min, conversational pace`, kind: 'run', sec: min * 60 }];
  if (strides) {
    for (let i = 1; i <= 4; i++) {
      steps.push({ label: `Stride ${i} of 4 — fast & relaxed`, kind: 'stride', sec: 20 });
      steps.push({ label: 'Walk back', kind: 'rest', sec: 60 });
    }
  }
  return steps;
}
function timeTrial(miles, target) {
  return [warmJog(), { label: `${miles}-mile time trial — go!`, kind: 'tt', target }, coolWalk()];
}

function run(key, type, title, detail, steps, extra = {}) {
  return { key, kind: 'run', type, title, detail, steps, ...extra };
}

// PT test block runs, weeks 1–8
function ptRun(week, which, s) {
  const lap = s.goal2mi / 8; // goal seconds per 400 m
  const L = fmtTime(lap);
  const key = 'run' + which;
  const t = {
    '1-1': () => run(key, 'quality', '5 × (3 min jog / 1 min walk)', 'Run/walk intervals. Easy effort — you should be able to talk.', jogWalk(5, 3, 1), { continuousMin: 3 }),
    '1-2': () => run(key, 'easy', '4 × (4 min jog / 1 min walk)', 'Run/walk intervals, then a push-up & sit-up max test (1 minute each).', jogWalk(4, 4, 1), { maxTest: true, continuousMin: 4 }),
    '1-3': () => run(key, 'long', '3 × (6 min jog / 2 min walk)', 'Longer jog intervals at an easy pace.', jogWalk(3, 6, 2), { continuousMin: 6 }),
    '2-1': () => run(key, 'quality', '6 × 400 m', `Hard but steady (about ${L} per lap). Walk 2 min between.`, repeats(6, '400 m', lap, 120), { estMiles: 6 * 0.2485 }),
    '2-2': () => run(key, 'easy', '20 min easy', 'Continuous easy running. Slow down if you need to — just keep moving.', easyRun(20), { continuousMin: 20 }),
    '2-3': () => run(key, 'long', '1-mile time trial', `Warm up, then run 1 mile as fast as you can. Goal pace: ${fmtTime(lap * 4)}.`, timeTrial(1, lap * 4), { tt: '1mi', estMiles: 1 }),
    '3-1': () => run(key, 'quality', '4 × 800 m at goal pace', `Target ${fmtTime(lap * 2)} per 800 m. Walk 2–3 min between.`, repeats(4, '800 m', lap * 2, 150), { estMiles: 4 * 0.497 }),
    '3-2': () => run(key, 'easy', '25 min easy', 'Continuous easy running.', easyRun(25), { continuousMin: 25 }),
    '3-3': () => run(key, 'long', '30 min easy', 'Longer easy run. Conversational pace.', easyRun(30), { continuousMin: 30 }),
    '4-1': () => run(key, 'quality', '5 × 800 m at goal pace', `Target ${fmtTime(lap * 2)} per 800 m. Walk 2–3 min between.`, repeats(5, '800 m', lap * 2, 150), { estMiles: 5 * 0.497 }),
    '4-2': () => run(key, 'easy', '25 min easy', 'Continuous easy running.', easyRun(25), { continuousMin: 25 }),
    '4-3': () => run(key, 'long', '35 min easy', 'Longer easy run. Conversational pace.', easyRun(35), { continuousMin: 35 }),
    '5-1': () => run(key, 'quality', '3 × 1000 m at goal pace', `Target ${fmtTime(lap * 2.5)} per 1000 m. Walk 3 min between.`, repeats(3, '1000 m', lap * 2.5, 180), { estMiles: 3 * 0.621 }),
    '5-2': () => run(key, 'easy', '25 min easy + max test', 'Easy run, then a push-up & sit-up max test (1 minute each).', easyRun(25), { maxTest: true, continuousMin: 25 }),
    '5-3': () => run(key, 'long', '2-mile time trial', `Warm up, then 2 miles all-out. Goal: ${fmtTime(s.goal2mi)}.`, timeTrial(2, s.goal2mi), { tt: '2mi', estMiles: 2 }),
    '6-1': () => run(key, 'quality', '2 × 1 mile at goal pace', `Target ${fmtTime(lap * 4)} per mile. Walk 4 min between.`, repeats(2, '1 mile', lap * 4, 240), { estMiles: 2 }),
    '6-2': () => run(key, 'easy', '30 min easy', 'Continuous easy running.', easyRun(30), { continuousMin: 30 }),
    '6-3': () => run(key, 'long', '40 min easy', 'Longer easy run. Conversational pace.', easyRun(40), { continuousMin: 40 }),
    '7-1': () => run(key, 'quality', '6 × 400 m, slightly fast', `A bit faster than goal pace: about ${fmtTime(lap - 3)} per lap. Walk 2 min between.`, repeats(6, '400 m', lap - 3, 120), { estMiles: 6 * 0.2485 }),
    '7-2': () => run(key, 'easy', '30 min easy', 'Continuous easy running.', easyRun(30), { continuousMin: 30 }),
    '7-3': () => run(key, 'long', '2-mile time trial', `Last hard effort before the test. Goal: ${fmtTime(s.goal2mi)}.`, timeTrial(2, s.goal2mi), { tt: '2mi', estMiles: 2 }),
    '8-1': () => run(key, 'quality', '4 × 400 m at goal pace', `Sharpen up: ${L} per lap. Walk 2 min between. Should feel controlled.`, repeats(4, '400 m', lap, 120), { estMiles: 4 * 0.2485 }),
    '8-2': () => run(key, 'easy', '15 min easy + 4 strides', 'Short and easy, then 4 × 20-second strides. Stay fresh for test day.', easyRun(15, true), { continuousMin: 15 }),
  }[`${week}-${which}`];
  return t();
}

// Ongoing cycle runs. n = ongoing week counter (1-based).
export function ongoingRun(n, which, s) {
  const lap = s.goal2mi / 8;
  const key = 'run' + which;
  const i = n - 1;
  if (which === 1) {
    if (i % 4 === 3) {
      return run(key, 'quality', '2-mile time trial', `Monthly check-in. Goal: ${fmtTime(s.goal2mi)}.`, timeTrial(2, s.goal2mi), { tt: '2mi', estMiles: 2 });
    }
    const q = (Math.floor(i / 4) * 3 + (i % 4)) % 4;
    return [
      () => run(key, 'quality', '6 × 400 m at goal pace', `${fmtTime(lap)} per lap. Walk 2 min between.`, repeats(6, '400 m', lap, 120), { estMiles: 6 * 0.2485 }),
      () => run(key, 'quality', '5 × 800 m at goal pace', `${fmtTime(lap * 2)} per 800 m. Walk 2½ min between.`, repeats(5, '800 m', lap * 2, 150), { estMiles: 5 * 0.497 }),
      () => run(key, 'quality', '4 × 1000 m at goal pace', `${fmtTime(lap * 2.5)} per 1000 m. Walk 3 min between.`, repeats(4, '1000 m', lap * 2.5, 180), { estMiles: 4 * 0.621 }),
      () => run(key, 'quality', '3 × 1 mile at goal pace', `${fmtTime(lap * 4)} per mile. Walk 4 min between.`, repeats(3, '1 mile', lap * 4, 240), { estMiles: 3 }),
    ][q]();
  }
  const steps = Math.floor(i / 2);
  if (which === 2) {
    const min = Math.min(45, 30 + 5 * steps);
    return run(key, 'easy', `${min} min easy`, 'Continuous easy running. Conversational pace.', easyRun(min), { continuousMin: min });
  }
  const min = Math.min(60, 40 + 5 * steps);
  return run(key, 'long', `${min} min long run`, 'Your longest run of the week. Keep it easy.', easyRun(min), { continuousMin: min });
}

// ---------- Lifts ----------
export function accName(s, slot) {
  return (s.swaps && s.swaps[slot]) || ACCESSORY_SLOTS[slot].def;
}

export function liftSession(key, slot, lift, pcts, s) {
  const tm = s.tm[lift];
  const sets = pcts.map((p) => ({ pct: p, w: tm ? Math.max(45, round5((tm * p) / 100)) : null, r: 5 }));
  let warmups = [{ label: 'Empty bar', w: 45, r: 5 }];
  if (tm && pcts[0] >= 60) {
    for (const p of [40, 50]) {
      const w = round5((tm * p) / 100);
      if (w > 45 && w < sets[0].w) warmups.push({ label: `${p}%`, w, r: 5 });
    }
  }
  const accessories = [1, 2, 3].map((n) => {
    const id = slot + n;
    return { slot: id, name: accName(s, id) };
  });
  return {
    key, kind: 'lift', slot, lift, title: `Lift ${slot}`,
    liftName: LIFTS[lift],
    detail: `${LIFTS[lift]} 3×5 @ ${pcts.join('/')}%`,
    pcts, sets, warmups, accessories, deload: pcts[0] < 60,
  };
}

// ---------- Week + position ----------
export function weekSessions(state) {
  const { plan, settings: s } = state;
  if (plan.mode === 'pt') {
    const w = plan.ptWeek;
    const pcts = PT_PCT[w];
    const liftB = w <= 4 ? 'squat' : 'deadlift';
    if (w === 8) {
      return [
        liftSession('liftA', 'A', 'bench', pcts, s),
        ptRun(8, 1, s),
        ptRun(8, 2, s),
        { key: 'pttest', kind: 'pt', title: 'PT TEST', detail: '2-mile run · push-ups · sit-ups', date: plan.testDate },
      ];
    }
    return [
      liftSession('liftA', 'A', 'bench', pcts, s),
      ptRun(w, 1, s),
      liftSession('liftB', 'B', liftB, pcts, s),
      ptRun(w, 2, s),
      liftSession('liftC', 'C', 'press', pcts, s),
      ptRun(w, 3, s),
    ];
  }
  const n = plan.ongoingWeek;
  const cw = ((n - 1) % 4) + 1;
  const pcts = CYCLE_PCT[cw];
  return [
    liftSession('liftA', 'A', 'bench', pcts, s),
    ongoingRun(n, 1, s),
    liftSession('liftB', 'B', plan.cycleLiftB, pcts, s),
    ongoingRun(n, 2, s),
    liftSession('liftC', 'C', 'press', pcts, s),
    ongoingRun(n, 3, s),
  ];
}

export function nextSession(state) {
  const list = weekSessions(state);
  const d = list[Math.min(state.plan.idx, list.length - 1)];
  return { ...d, weekIndex: state.plan.idx, weekLength: list.length };
}

export function weekLabel(plan) {
  if (plan.mode === 'pt') {
    const extra = plan.ptWeek === 4 ? ' (deload)' : plan.ptWeek === 8 ? ' (test week)' : '';
    return `PT block · Week ${plan.ptWeek} of 8${extra}`;
  }
  const n = plan.ongoingWeek;
  const cycle = Math.floor((n - 1) / 4) + 1;
  const cw = ((n - 1) % 4) + 1;
  return `Cycle ${cycle} · Week ${cw} of 4${cw === 4 ? ' (deload)' : ''}`;
}

// Called after a session is logged or skipped. Returns a list of notes about changes.
export function advance(state, todayKey) {
  const notes = [];
  const list = weekSessions(state);
  state.plan.idx += 1;
  if (state.plan.idx >= list.length) {
    state.plan.idx = 0;
    endWeek(state, todayKey, notes);
  }
  syncPlan(state, todayKey, notes);
  // Waiting for test day: those days shouldn't count against the streak
  const nx = nextSession(state);
  if (nx.kind === 'pt' && nx.date && diffDays(todayKey, nx.date) > 1) {
    state.holds.push({ from: addDays(todayKey, 1), to: addDays(nx.date, -1) });
  }
  return notes;
}

function startOngoingCycle(state, notes, first) {
  const p = state.plan;
  if (first) {
    // after a PT block, start a fresh 4-week cycle with squat
    p.ongoingWeek = p.ongoingWeek > 0 ? Math.ceil(p.ongoingWeek / 4) * 4 + 1 : 1;
    p.cycleLiftB = 'squat';
  } else {
    p.cycleLiftB = p.cycleLiftB === 'squat' ? 'deadlift' : 'squat';
  }
  state.pending.cycleTM = true;
  notes.push(`New 4-week cycle starts — Lift B is ${LIFTS[p.cycleLiftB].toLowerCase()} this cycle.`);
}

function endWeek(state, todayKey, notes) {
  const p = state.plan;
  if (p.mode === 'pt') {
    if (p.ptWeek >= 8) {
      p.mode = 'ongoing';
      if (state.settings.nextTestDate === p.testDate) state.settings.nextTestDate = null;
      notes.push('PT block complete — you\'re now in the ongoing training cycle.');
      startOngoingCycle(state, notes, true);
      return;
    }
    p.ptWeek += 1;
    if (p.ptWeek === 5) {
      for (const lift of ['bench', 'press']) {
        const tm = state.settings.tm[lift];
        if (tm) {
          state.settings.tm[lift] = tm + 5;
          state.tmHistory.push({ date: todayKey, lift, from: tm, to: tm + 5, reason: 'PT block week 5' });
        }
      }
      notes.push('Week 5: bench & press Training Maxes +5 lb. Trap bar deadlift replaces squat.');
    }
    return;
  }
  p.ongoingWeek += 1;
  if ((p.ongoingWeek - 1) % 4 === 0) startOngoingCycle(state, notes, false);
}

// Switch into / within the PT block based on the next test date. Safe to call any time.
export function syncPlan(state, todayKey, notes = []) {
  const p = state.plan;
  const next = state.settings.nextTestDate;
  if (p.mode === 'ongoing' && next && p.idx === 0) {
    const days = diffDays(todayKey, next);
    if (days >= 0 && days <= BLOCK_DAYS) {
      p.mode = 'pt';
      p.testDate = next;
      p.ptWeek = clamp(9 - Math.ceil(days / 7), 1, 8);
      state.pending.cycleTM = false;
      notes.push(`PT test on ${next} — switching to the PT test block (week ${p.ptWeek} of 8).`);
    }
  }
  if (p.mode === 'pt') {
    if (next && next !== p.testDate && diffDays(todayKey, next) >= 0) p.testDate = next;
    const days = diffDays(todayKey, p.testDate);
    // Test is within a week: jump straight to the test-week taper
    if (p.ptWeek < 8 && days >= 0 && days <= 7) {
      p.ptWeek = 8;
      p.idx = 0;
      notes.push('Test is within 7 days — jumping to test-week taper.');
    }
  }
  return notes;
}
