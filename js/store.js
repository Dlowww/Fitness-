// All data lives in this one object, saved to the phone's local storage.
const KEY = 'workoutlog.v1';

export function defaultState() {
  return {
    version: 1,
    onboarded: false,
    settings: {
      tm: { bench: null, squat: null, press: null, deadlift: null },
      goal2mi: 16 * 60, // seconds
      restDay: 5, // Friday
      startWeight: 215,
      goal: { type: 'lose', target: 185 },
      swaps: {},
      sound: true,
      vibrate: true,
      stalled: {},
      nextTestDate: '2027-01-15',
    },
    plan: {
      mode: 'pt', // 'pt' (8-week PT test block) or 'ongoing'
      ptWeek: 1,
      testDate: '2027-01-15',
      ongoingWeek: 0, // counts ongoing weeks; 0 = none yet
      cycleLiftB: 'squat',
      idx: 0, // which session in the week is next
    },
    pending: { cycleTM: false },
    sessions: [],
    weights: {}, // 'YYYY-MM-DD': lb
    mobility: {}, // 'YYYY-MM-DD': true
    maxTests: [], // {date, pushups, situps}
    ptResults: [], // {date, run2mi, pushups, situps, passed}
    badges: [], // {id, key, date, text}
    holds: [], // {from, to} days that don't count against streak (waiting for test day)
    tmHistory: [],
    draft: null,
    lastBackup: null,
    bestStreak: 0,
  };
}

function merge(base, data) {
  // shallow-deep merge so new fields added in later versions get defaults
  const out = { ...base, ...data };
  for (const k of ['settings', 'plan', 'pending']) out[k] = { ...base[k], ...(data[k] || {}) };
  out.settings.tm = { ...base.settings.tm, ...((data.settings || {}).tm || {}) };
  out.settings.goal = (data.settings && data.settings.goal) || base.settings.goal;
  return out;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return merge(defaultState(), JSON.parse(raw));
  } catch (e) {
    console.error('load failed', e);
    return defaultState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('save failed', e);
    alert('Could not save data on this phone (storage full or blocked). Please export a backup.');
    return false;
  }
}

export function validateImport(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Not a backup file');
  if (!obj.settings || !obj.plan || !Array.isArray(obj.sessions)) throw new Error('This file is not a workout backup');
  return merge(defaultState(), obj);
}

// Ask the browser to never auto-delete our data.
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch (e) { /* ignore */ }
}
