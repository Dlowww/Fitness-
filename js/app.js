// Main app: screens, buttons and logging.
import { load, save, validateImport, requestPersist, defaultState } from './store.js';
import {
  today, addDays, diffDays, fmtDate, fmtShort, fmtTime, parseTime, round5, e1rm, esc, uid, plates, DAY_FULL, clamp,
} from './util.js';
import { LIFTS, LIFT_ORDER, ACCESSORY_SLOTS, nextSession, weekSessions, weekLabel, advance, syncPlan, accName } from './plan.js';
import {
  realSessions, streakInfo, weekProgress, avg7, latestWeight, weightSeries, sessionE1rm, e1rmHistory, bestE1rm,
  trialHistory, bestTrial, totalMiles, bestStreakInRange,
} from './stats.js';
import { BADGES, BADGE_BY_ID, award, evaluate, badgeCount } from './badges.js';
import { lineChart, heatmap } from './charts.js';
import { IntervalTimer, unlockAudio, vibrate, beep } from './timer.js';
import { confetti } from './confetti.js';

let state = load();
let view = { name: state.onboarded ? 'home' : 'onboard' };
let timer = null;
let hmYear = Number(today().slice(0, 4));

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const $overlay = document.getElementById('overlay');
const $toast = document.getElementById('toast');

function persist() { save(state); }
function commit() { save(state); render(); }
const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const KIND_ICON = { lift: '🏋️', run: '🏃', pt: '🦅' };

function toast(msg, ms = 2200) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('show'), ms);
}
function buzz(p = 30) { if (state.settings.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) vibrate(p); }

function planSig() {
  const p = state.plan;
  return `${p.mode}-${p.mode === 'pt' ? p.ptWeek : p.ongoingWeek}-${p.idx}`;
}
function sessionHeading(d) {
  if (d.kind === 'lift') return `${d.title} · ${d.liftName}`;
  if (d.kind === 'pt') return 'PT TEST';
  const t = { quality: 'Run 1 · Quality', easy: 'Run 2 · Easy', long: 'Run 3 · Long' }[d.type];
  return t || 'Run';
}

// ================= RENDER =================
function render() {
  document.body.dataset.view = view.name;
  const nav = ['home', 'progress', 'badges', 'settings'].includes(view.name);
  let html = '';
  switch (view.name) {
    case 'onboard': html = renderOnboard(); break;
    case 'home': html = renderHome(); break;
    case 'session': html = renderSession(); break;
    case 'summary': html = renderSummary(); break;
    case 'progress': html = renderProgress(); break;
    case 'badges': html = renderBadges(); break;
    case 'settings': html = renderSettings(); break;
  }
  $app.innerHTML = html + (nav ? renderNav() : '');
  tickSince();
  // show the current part of the year in the heatmap
  const hw = $app.querySelector('.hm-wrap');
  const td = hw && hw.querySelector('.hm-today');
  if (td) hw.scrollLeft = Math.max(0, Number(td.getAttribute('x')) - hw.clientWidth + 60);
  else if (hw) hw.scrollLeft = hw.scrollWidth;
}

function renderNav() {
  const items = [['home', '🏠', 'Home'], ['progress', '📈', 'Progress'], ['badges', '🏆', 'Badges'], ['settings', '⚙️', 'Settings']];
  return `<nav class="nav">${items.map(([v, i, l]) => `<button data-a="go" data-v="${v}" class="${view.name === v ? 'on' : ''}"><span>${i}</span>${l}</button>`).join('')}</nav>`;
}

// ---------- Onboarding ----------
function renderOnboard() {
  const s = state.settings;
  const tmRow = (lift) => `
    <div class="field">
      <label>${LIFTS[lift]} TM (lb)</label>
      <div class="row">
        <input type="number" inputmode="decimal" data-s="tm.${lift}" value="${s.tm[lift] ?? ''}" placeholder="e.g. 155">
        <button class="btn small ghost" data-a="tmHelper" data-lift="${lift}">Calculate</button>
      </div>
    </div>`;
  return `
  <div class="screen">
    <div class="hero">
      <div class="hero-emoji">🔥</div>
      <h1>Let's build the habit.</h1>
      <p class="muted">Quick setup — you can change all of this later in Settings.</p>
    </div>
    <div class="card">
      <h3>Training Maxes</h3>
      <p class="muted small">Don't know them? Tap <b>Calculate</b> and enter a recent set (e.g. 185 × 5). TM = 85% of your estimated max. You can leave deadlift blank until week 5.</p>
      ${LIFT_ORDER.map(tmRow).join('')}
    </div>
    <div class="card">
      <h3>Body & running</h3>
      <div class="field"><label>Starting weight (lb)</label><input type="number" inputmode="decimal" data-s="startWeight" value="${s.startWeight ?? ''}"></div>
      <div class="field"><label>Goal weight (lb)</label><input type="number" inputmode="decimal" data-s="goal.target" value="${s.goal.target ?? 185}"></div>
      <div class="field"><label>Goal 2-mile time (mm:ss)</label><input type="text" inputmode="numeric" data-s="goal2mi" data-type="time" value="${fmtTime(s.goal2mi)}"></div>
      <div class="field"><label>PT test date</label><input type="date" data-s="nextTestDate" value="${s.nextTestDate || ''}"></div>
    </div>
    <button class="btn big primary" data-a="finishOnboard">LET'S GO 🚀</button>
  </div>`;
}

// ---------- Home ----------
function flameHtml(st) {
  const d = st.days;
  const size = d ? Math.round(64 + Math.min(d, 365) / 365 * 70) : 56;
  const lv = d === 0 ? 0 : d < 7 ? 1 : d < 28 ? 2 : d < 84 ? 3 : 4;
  return `<div class="flame lv${lv}" style="font-size:${size}px">🔥</div>`;
}

function renderHome() {
  const s = state.settings, p = state.plan;
  const nx = nextSession(state);
  const st = streakInfo(state);
  const wk = weekProgress(state);
  const t = today();
  const hasDraft = state.draft && state.draft.sig === planSig();
  const w = state.weights[t];
  const mob = state.mobility[t];
  let extra = '';

  if (state.pending.cycleTM) {
    extra += `<button class="card banner" data-a="cyclePrompt">🔁 <div><b>New cycle!</b><br><span class="muted small">Tap to raise your Training Maxes</span></div></button>`;
  }
  const yr = reviewYear();
  if (yr) extra += `<button class="card banner gold" data-a="yearReview" data-y="${yr}">🎊 <div><b>Your ${yr} in review is ready</b><br><span class="muted small">Tap to see your year</span></div></button>`;
  const lastB = state.lastBackup;
  if (realSessions(state).length >= 3 && (!lastB || diffDays(lastB, t) >= 14)) {
    extra += `<button class="card banner warn" data-a="export">💾 <div><b>Back up your data</b><br><span class="muted small">${lastB ? `Last backup ${diffDays(lastB, t)} days ago` : 'No backup yet'} — tap to save a copy</span></div></button>`;
  }

  // Next up card
  let nextBody = `<div class="nx-detail">${esc(nx.kind === 'lift' ? nx.detail : nx.title)}</div>`;
  if (nx.kind === 'run') nextBody += `<div class="muted small">${esc(nx.detail)}</div>`;
  let startLabel = hasDraft ? 'RESUME ▶︎' : 'START ▶︎';
  if (nx.kind === 'pt') {
    const days = diffDays(t, nx.date);
    nextBody = `<div class="nx-detail">2-mile run · push-ups · sit-ups</div>
      <div class="muted small">${days > 0 ? `Test day is <b>${fmtDate(nx.date)}</b> — in ${days} day${days === 1 ? '' : 's'}. Rest, mobility and easy walks until then. Your streak is paused.` : days === 0 ? '<b>Today is test day. You\'re ready. 💪</b>' : `Test was ${fmtDate(nx.date)} — log your results.`}</div>`;
    startLabel = 'LOG PT TEST';
  } else if (nx.kind === 'lift' && !s.tm[nx.lift]) {
    nextBody += `<div class="warn-text small">Set your ${LIFTS[nx.lift]} Training Max to see weights.</div>`;
  }

  const ptDays = s.nextTestDate ? diffDays(t, s.nextTestDate) : null;
  const countdown = ptDays != null && ptDays >= 0
    ? `<div class="stat"><div class="stat-big">${ptDays}</div><div class="stat-lbl">days to PT test<br><span class="muted">${fmtShort(s.nextTestDate)}</span></div></div>`
    : `<div class="stat"><div class="stat-big">${p.mode === 'pt' ? p.ptWeek : ((p.ongoingWeek - 1) % 4) + 1}</div><div class="stat-lbl">${p.mode === 'pt' ? 'PT block week' : 'cycle week'}<br><span class="muted">${p.mode === 'pt' ? 'of 8' : 'of 4'}</span></div></div>`;

  const dots = Array.from({ length: 6 }, (_, i) => `<i class="${i < wk.done ? 'on' : ''}"></i>`).join('');

  return `
  <div class="screen home">
    <div class="topline"><span class="muted">${fmtDate(t)}</span><span class="pill">${esc(weekLabel(p))}</span></div>
    ${extra}
    <div class="card next ${nx.kind}">
      <div class="nx-label">NEXT UP</div>
      <div class="nx-title">${KIND_ICON[nx.kind]} ${esc(sessionHeading(nx))}</div>
      ${nextBody}
      <button class="btn huge primary" data-a="start">${startLabel}</button>
      ${nx.kind !== 'pt' ? `<div class="nx-foot"><span class="muted small">Session ${nx.weekIndex + 1} of ${nx.weekLength} this plan week</span><button class="link" data-a="skip">Skip</button></div>` : ''}
    </div>

    <div class="card streak ${st.atRisk ? 'risk' : ''}">
      ${flameHtml(st)}
      <div>
        <div class="streak-num">${st.days}<span> day${st.days === 1 ? '' : 's'}</span></div>
        <div class="muted">${st.days ? `streak${st.weeks ? ` · ${st.weeks} week${st.weeks === 1 ? '' : 's'}` : ''}` : 'Log a session to light the flame'}</div>
        <div class="muted small">Best: ${st.best} day${st.best === 1 ? '' : 's'} · never miss twice in a row</div>
        ${st.atRisk ? '<div class="risk-text">⚠️ You missed yesterday. Train today to keep it alive!</div>' : st.doneToday ? '<div class="ok-text">✓ Trained today</div>' : ''}
      </div>
    </div>

    <div class="stats2">
      ${countdown}
      <div class="stat"><div class="stat-big">${wk.done}<span>/6</span></div><div class="stat-lbl">this week<div class="dots">${dots}</div></div></div>
    </div>

    <div class="quick">
      <button class="btn quickbtn ${w ? 'done' : ''}" data-a="weight">⚖️<span>${w ? `${w} lb ✓` : 'Log weight'}</span></button>
      <button class="btn quickbtn ${mob ? 'done' : ''}" data-a="mobility">🧘<span>${mob ? 'Mobility ✓' : 'Mobility done'}</span></button>
    </div>
    ${weightLine()}
  </div>`;
}

function weightLine() {
  const a = avg7(state);
  if (a == null) return '';
  const g = state.settings.goal;
  let txt = `7-day avg <b>${a.toFixed(1)} lb</b>`;
  if (g.type === 'lose') {
    const left = a - g.target;
    txt += left > 0 ? ` · ${left.toFixed(1)} to go to ${g.target}` : ' · goal reached!';
  } else if (g.type === 'maintain') {
    txt += a >= g.min && a <= g.max ? ` · in your ${g.min}–${g.max} range ✓` : ` · target range ${g.min}–${g.max}`;
  }
  const start = state.settings.startWeight;
  if (start) txt += ` · ${start - a >= 0 ? '−' : '+'}${Math.abs(start - a).toFixed(1)} since start`;
  return `<p class="muted small center">${txt}</p>`;
}

function reviewYear() {
  const t = today();
  const md = t.slice(5);
  const y = Number(t.slice(0, 4));
  const yr = md >= '12-20' ? y : md <= '01-31' ? y - 1 : null;
  if (!yr) return null;
  if (!realSessions(state).some((x) => x.date.startsWith(String(yr)))) return null;
  if ((state.seenReview || []).includes(yr)) return null;
  return yr;
}

// ---------- Session (logging) ----------
function lastAcc(name) {
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const x = state.sessions[i];
    if (!x.lift) continue;
    const a = x.lift.acc.find((q) => q.name === name && q.sets.length);
    if (a) return a;
  }
  return null;
}
function lastLiftSession(lift) {
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const x = state.sessions[i];
    if (x.lift && x.lift.lift === lift) return x;
  }
  return null;
}

function makeDraft(d) {
  const base = { sig: planSig(), key: d.key, desc: d, startedAt: Date.now(), notes: '' };
  if (d.kind === 'lift') {
    return {
      ...base,
      warm: d.warmups.map((w) => ({ ...w, done: false })),
      sets: d.sets.map((x) => ({ pct: x.pct, w: x.w, r: x.r, done: false })),
      acc: d.accessories.map((a) => {
        const last = lastAcc(a.name);
        const ls = last ? last.sets[last.sets.length - 1] : null;
        return { slot: a.slot, name: a.name, sets: [], addR: ls ? ls.r : 10, addW: ls && ls.w ? ls.w : '', last: last ? last.sets.map((q) => q.r + (q.w ? `@${q.w}` : '')).join(' · ') : '' };
      }),
      stalled: !!state.settings.stalled[d.lift],
      lastCheck: null,
    };
  }
  if (d.kind === 'run') {
    return { ...base, time: '', miles: d.estMiles && d.tt ? String(d.estMiles) : '', effort: null, pushups: '', situps: '', timerResult: null };
  }
  return { ...base, time: '', pushups: '', situps: '', passed: null };
}

function renderSession() {
  const dr = state.draft;
  if (!dr) { view = { name: 'home' }; return renderHome(); }
  const d = dr.desc;
  const head = `
    <div class="sess-head">
      <button class="btn small ghost" data-a="leaveSession">✕</button>
      <div><div class="sess-title">${KIND_ICON[d.kind]} ${esc(sessionHeading(d))}</div>
      <div class="muted small">${esc(weekLabel(state.plan))} · <span data-since="${dr.startedAt}"></span></div></div>
    </div>`;
  if (d.kind === 'lift') return `<div class="screen">${head}${renderLiftBody(dr)}</div>`;
  if (d.kind === 'run') return `<div class="screen">${head}${renderRunBody(dr)}</div>`;
  return `<div class="screen">${head}${renderPtBody(dr)}</div>`;
}

function renderLiftBody(dr) {
  const d = dr.desc;
  const tm = state.settings.tm[d.lift];
  const last = lastLiftSession(d.lift);
  const warm = dr.warm.map((w, i) => `
    <button class="setrow warm ${w.done ? 'done' : ''}" data-a="toggleWarm" data-i="${i}">
      <span class="set-lbl">${esc(w.label)}</span><span class="set-w">${w.w} × ${w.r}</span><span class="chk">${w.done ? '✓' : ''}</span>
    </button>`).join('');
  const sets = dr.sets.map((s, i) => `
    <div class="setrow work ${s.done ? 'done' : ''}">
      <div class="set-lbl">Set ${i + 1}<br><span class="muted small">${s.pct}%</span></div>
      <div class="set-inputs">
        <input type="number" inputmode="decimal" data-f="sets.${i}.w" value="${s.w ?? ''}" placeholder="lb"><span>×</span>
        <input type="number" inputmode="numeric" data-f="sets.${i}.r" value="${s.r ?? ''}" class="reps">
        <div class="plates muted small">${s.w ? plates(Number(s.w)) : ''}</div>
      </div>
      <button class="chk big" data-a="toggleSet" data-i="${i}">${s.done ? '✓' : ''}</button>
    </div>`).join('');
  const acc = dr.acc.map((a, i) => {
    const total = a.sets.reduce((x, y) => x + (Number(y.r) || 0), 0);
    const cls = total >= 50 ? 'over' : total >= 25 ? 'ok' : '';
    return `
    <div class="card acc">
      <div class="acc-head"><b>${esc(a.name)}</b><span class="acc-total ${cls}">${total}<span class="muted"> / 25–50</span></span></div>
      ${a.last ? `<div class="muted small">Last time: ${esc(a.last)}</div>` : ''}
      <div class="chips">${a.sets.map((q, j) => `<button class="chip" data-a="accDel" data-i="${i}" data-j="${j}">${q.r}${q.w ? `<small>@${q.w}</small>` : ''} ✕</button>`).join('') || '<span class="muted small">No sets yet</span>'}</div>
      <div class="acc-add">
        <button class="btn step" data-a="accStep" data-i="${i}" data-d="-1">−</button>
        <input type="number" inputmode="numeric" data-f="acc.${i}.addR" value="${a.addR}" class="reps-in">
        <button class="btn step" data-a="accStep" data-i="${i}" data-d="1">+</button>
        <input type="number" inputmode="decimal" data-f="acc.${i}.addW" value="${a.addW}" placeholder="lb" class="w-in">
        <button class="btn primary addset" data-a="accAdd" data-i="${i}">+ SET</button>
      </div>
    </div>`;
  }).join('');
  return `
    ${!tm ? `<div class="card warn-card">No Training Max set for ${LIFTS[d.lift]}. <button class="btn small" data-a="tmQuick" data-lift="${d.lift}">Set TM</button></div>` : `<div class="muted small">TM ${tm} lb${d.deload ? ' · Deload week — keep it easy' : ''}${last ? ` · Last time ${fmtShort(last.date)}: ${last.lift.sets.filter((s) => s.done).map((s) => `${s.w}×${s.r}`).join(', ')}` : ''}</div>`}
    <h3 class="sec">Warm-up</h3>
    ${warm}
    <h3 class="sec">Work sets · ${esc(d.liftName)}</h3>
    ${sets}
    <div class="rest-bar ${dr.lastCheck ? '' : 'hidden'}">Rest <b data-since="${dr.lastCheck || ''}"></b></div>
    <h3 class="sec">Accessories</h3>
    ${acc}
    <label class="toggle-row"><input type="checkbox" data-f="stalled" data-type="bool" ${dr.stalled ? 'checked' : ''}><span>Mark ${esc(d.liftName)} as stalled<br><span class="muted small">Sets felt like a grind? You'll be offered a 10% TM reset next cycle.</span></span></label>
    <div class="field"><label>Notes</label><textarea data-f="notes" rows="2" placeholder="How did it feel?">${esc(dr.notes)}</textarea></div>
    <button class="btn big primary finish" data-a="finish">FINISH SESSION ✓</button>`;
}

function effortRow(val) {
  return `<div class="effort">${Array.from({ length: 10 }, (_, i) => `<button class="${val === i + 1 ? 'on' : ''}" data-a="effort" data-v="${i + 1}">${i + 1}</button>`).join('')}</div>`;
}

function renderRunBody(dr) {
  const d = dr.desc;
  const totalSec = d.steps.reduce((a, s) => a + (s.sec || s.target || 0), 0);
  const tr = dr.timerResult;
  const lapRows = tr && tr.laps.length ? `<div class="laps">${tr.laps.map((l, i) => `<div><span>Rep ${i + 1}</span><b>${fmtTime(l.sec)}</b>${l.target ? `<span class="${l.sec <= l.target ? 'under' : 'over'}">${l.sec <= l.target ? '✓' : '+' + fmtTime(l.sec - l.target)}</span>` : ''}</div>`).join('')}</div>` : '';
  return `
    <div class="card">
      <div class="nx-detail">${esc(d.title)}</div>
      <p class="muted">${esc(d.detail)}</p>
      <details><summary class="muted small">${d.steps.length} steps · about ${Math.round(totalSec / 60)} min</summary>
        <ol class="steps">${d.steps.map((s) => `<li>${esc(s.label)}${s.sec ? ` — ${fmtTime(s.sec)}` : s.target ? ` — target ${fmtTime(s.target)}` : ''}</li>`).join('')}</ol>
      </details>
      <button class="btn huge primary" data-a="startTimer">${tr ? '↻ RESTART TIMER' : '▶︎ START TIMER'}</button>
      ${tr ? `<div class="ok-text">Timer done: ${fmtTime(tr.totalSec)} total${tr.completedAll ? '' : ' (ended early)'}</div>${lapRows}` : ''}
    </div>
    <div class="card">
      <div class="field"><label>${d.tt ? `${d.tt === '2mi' ? '2-mile' : '1-mile'} time (mm:ss)` : 'Total time (mm:ss)'}</label>
        <input type="text" inputmode="numeric" data-f="time" value="${esc(dr.time)}" placeholder="e.g. 16:30" class="bigin"></div>
      <div class="field"><label>Distance (miles)</label>
        <input type="number" inputmode="decimal" step="0.01" data-f="miles" value="${esc(dr.miles)}" placeholder="${d.estMiles ? `reps alone ≈ ${d.estMiles.toFixed(2)}` : 'e.g. 2.5'}" class="bigin"></div>
      <label>Effort (1 = easy, 10 = all-out) <span class="muted small">optional</span></label>
      ${effortRow(dr.effort)}
    </div>
    ${d.maxTest ? `
    <div class="card">
      <h3>Max test 💥</h3>
      <p class="muted small">After the run: max push-ups in 1 minute, rest 3 min, then max sit-ups in 1 minute.</p>
      <div class="two">
        <div class="field"><label>Push-ups</label><input type="number" inputmode="numeric" data-f="pushups" value="${esc(dr.pushups)}" class="bigin"></div>
        <div class="field"><label>Sit-ups</label><input type="number" inputmode="numeric" data-f="situps" value="${esc(dr.situps)}" class="bigin"></div>
      </div>
    </div>` : ''}
    <div class="field"><label>Notes</label><textarea data-f="notes" rows="2" placeholder="Weather, how you felt…">${esc(dr.notes)}</textarea></div>
    <button class="btn big primary finish" data-a="finish">FINISH SESSION ✓</button>`;
}

function renderPtBody(dr) {
  return `
    <div class="card">
      <div class="nx-detail">PT test · ${fmtDate(dr.desc.date, true)}</div>
      <p class="muted small">Log your official results. Then celebrate — you earned it.</p>
      <div class="field"><label>2-mile run time (mm:ss)</label><input type="text" inputmode="numeric" data-f="time" value="${esc(dr.time)}" class="bigin" placeholder="e.g. 15:58"></div>
      <div class="two">
        <div class="field"><label>Push-ups</label><input type="number" inputmode="numeric" data-f="pushups" value="${esc(dr.pushups)}" class="bigin"></div>
        <div class="field"><label>Sit-ups</label><input type="number" inputmode="numeric" data-f="situps" value="${esc(dr.situps)}" class="bigin"></div>
      </div>
      <label>Did you pass?</label>
      <div class="two">
        <button class="btn ${dr.passed === true ? 'primary' : 'ghost'}" data-a="ptPass" data-v="1">✅ Passed</button>
        <button class="btn ${dr.passed === false ? 'primary' : 'ghost'}" data-a="ptPass" data-v="0">Not this time</button>
      </div>
    </div>
    <div class="field"><label>Notes</label><textarea data-f="notes" rows="2">${esc(dr.notes)}</textarea></div>
    <button class="btn big primary finish" data-a="finish">FINISH ✓</button>`;
}

// ---------- Finishing a session ----------
function snapshot() {
  return clone({ plan: state.plan, tm: state.settings.tm, pending: state.pending, holds: state.holds, bestStreak: state.bestStreak, stalled: state.settings.stalled, nextTestDate: state.settings.nextTestDate });
}

function finishSession() {
  const dr = state.draft;
  const d = dr.desc;
  const t = today();
  const rec = { id: uid(), date: t, key: d.key, kind: d.kind, title: sessionHeading(d), detail: d.kind === 'lift' ? d.detail : d.title, planLabel: weekLabel(state.plan), startedAt: dr.startedAt, finishedAt: Date.now(), notes: dr.notes || '', prs: [], before: snapshot() };
  const badgeCands = [];

  if (d.kind === 'lift') {
    const sets = dr.sets.map((s) => ({ pct: s.pct, w: num(s.w), r: num(s.r), done: s.done }));
    if (!sets.some((s) => s.done) && !dr.acc.some((a) => a.sets.length)) {
      if (!confirm('Nothing is checked off yet. Log this session anyway?')) return;
    }
    rec.lift = { lift: d.lift, sets, warm: dr.warm, acc: dr.acc.map((a) => ({ slot: a.slot, name: a.name, sets: a.sets })), stalled: dr.stalled };
    state.settings.stalled[d.lift] = !!dr.stalled;
    const e = sessionE1rm(rec);
    const prev = bestE1rm(state, d.lift);
    if (e) {
      if (prev == null) rec.prs.push(`Baseline set: ${LIFTS[d.lift]} est. 1RM ${Math.round(e)} lb`);
      else if (e > prev + 0.01) {
        rec.prs.push(`NEW PR! ${LIFTS[d.lift]} est. 1RM ${Math.round(e)} lb (+${Math.round(e - prev)})`);
        badgeCands.push({ id: 'pr_' + d.lift, key: `pr_${d.lift}:${rec.id}`, text: `${LIFTS[d.lift]} est. 1RM ${Math.round(e)} lb` });
      }
    }
  } else if (d.kind === 'run') {
    const timeSec = parseTime(dr.time);
    const miles = num(dr.miles);
    const tr = dr.timerResult;
    const longest = tr ? tr.longestRunSec : (d.continuousMin && timeSec ? Math.min(timeSec, d.continuousMin * 60) : 0);
    rec.run = { type: d.type, tt: d.tt || null, timeSec, miles, effort: dr.effort, laps: tr ? tr.laps : [], continuous20: (d.continuousMin || 0) >= 20 && longest >= 1170 };
    if (d.tt && timeSec) {
      const prev = bestTrial(state, d.tt);
      const name = d.tt === '2mi' ? '2-mile' : '1-mile';
      if (prev == null) {
        rec.prs.push(`First ${name} time trial: ${fmtTime(timeSec)}`);
        if (d.tt === '1mi') badgeCands.push({ id: 'best_1mi', key: `best_1mi:${rec.id}`, text: `1-mile: ${fmtTime(timeSec)}` });
      } else if (timeSec < prev) {
        rec.prs.push(`NEW ${name.toUpperCase()} BEST! ${fmtTime(timeSec)} (−${fmtTime(prev - timeSec)})`);
        badgeCands.push({ id: d.tt === '2mi' ? 'best_2mi' : 'best_1mi', key: `best_${d.tt}:${rec.id}`, text: `${name}: ${fmtTime(timeSec)}` });
      }
    }
    if (d.maxTest) maxTestPRs(rec, num(dr.pushups), num(dr.situps), badgeCands);
  } else {
    const run2mi = parseTime(dr.time);
    const pu = num(dr.pushups), su = num(dr.situps);
    rec.pt = { run2mi, pushups: pu, situps: su, passed: dr.passed, testDate: d.date };
    if (run2mi) {
      const prev = bestTrial(state, '2mi');
      if (prev != null && run2mi < prev) {
        rec.prs.push(`NEW 2-MILE BEST! ${fmtTime(run2mi)}`);
        badgeCands.push({ id: 'best_2mi', key: `best_2mi:${rec.id}`, text: `2-mile: ${fmtTime(run2mi)}` });
      }
    }
    maxTestPRs(rec, pu, su, badgeCands);
    state.ptResults.push({ date: t, testDate: d.date, run2mi, pushups: pu, situps: su, passed: dr.passed, sid: rec.id });
    if (dr.passed) rec.prs.push('PT TEST PASSED! 🦅');
  }

  state.sessions.push(rec);
  rec.notesPlan = advance(state, t);
  state.draft = null;
  const fresh = [...award(state, badgeCands, t), ...evaluate(state, t)];
  rec.badgeKeys = fresh.map((b) => b.key);
  persist();
  view = { name: 'summary', id: rec.id, fresh };
  render();
  window.scrollTo(0, 0);
  buzz([40, 60, 40, 60, 120]);
  if (state.settings.sound) { unlockAudio(); beep(784, 0.12); beep(988, 0.12, 0.13); beep(1319, 0.35, 0.26); }
  confetti(fresh.length ? 2 : 1);
}

function maxTestPRs(rec, pu, su, cands) {
  if (pu == null && su == null) return;
  const prevPu = Math.max(-1, ...state.maxTests.map((m) => m.pushups || 0));
  const prevSu = Math.max(-1, ...state.maxTests.map((m) => m.situps || 0));
  const first = !state.maxTests.length;
  state.maxTests.push({ date: rec.date, pushups: pu, situps: su, sid: rec.id });
  rec.maxTest = { pushups: pu, situps: su };
  if (first) { rec.prs.push(`Baseline: ${pu ?? '–'} push-ups, ${su ?? '–'} sit-ups`); return; }
  if (pu != null && pu > prevPu) { rec.prs.push(`NEW PUSH-UP MAX! ${pu}`); cands.push({ id: 'pushup_max', key: `pushup_max:${rec.id}`, text: `${pu} push-ups` }); }
  if (su != null && su > prevSu) { rec.prs.push(`NEW SIT-UP MAX! ${su}`); cands.push({ id: 'situp_max', key: `situp_max:${rec.id}`, text: `${su} sit-ups` }); }
}

function undoLast() {
  const rec = state.sessions[state.sessions.length - 1];
  if (!rec) return;
  if (!confirm(`Undo "${rec.title}" from ${fmtShort(rec.date)}? The plan goes back one step.`)) return;
  const b = rec.before;
  if (b) {
    state.plan = b.plan; state.settings.tm = b.tm; state.pending = b.pending; state.holds = b.holds;
    state.bestStreak = b.bestStreak; state.settings.stalled = b.stalled || {};
    if ('nextTestDate' in b) state.settings.nextTestDate = b.nextTestDate;
  }
  const keys = new Set(rec.badgeKeys || []);
  state.badges = state.badges.filter((x) => !keys.has(x.key));
  state.maxTests = state.maxTests.filter((m) => m.sid !== rec.id);
  state.ptResults = state.ptResults.filter((m) => m.sid !== rec.id);
  state.sessions.pop();
  commit();
  toast('Session undone');
}

// ---------- Summary ----------
function renderSummary() {
  const rec = state.sessions.find((x) => x.id === view.id);
  if (!rec) { view = { name: 'home' }; return renderHome(); }
  const st = streakInfo(state);
  const wk = weekProgress(state);
  const nx = nextSession(state);
  const mins = Math.max(1, Math.round((rec.finishedAt - rec.startedAt) / 60000));
  let stats = [];
  if (rec.lift) {
    const done = rec.lift.sets.filter((s) => s.done);
    const top = done[done.length - 1];
    const vol = done.reduce((a, s) => a + s.w * s.r, 0) + rec.lift.acc.reduce((a, q) => a + q.sets.reduce((b, s) => b + (Number(s.w) || 0) * (Number(s.r) || 0), 0), 0);
    const accReps = rec.lift.acc.reduce((a, q) => a + q.sets.reduce((b, s) => b + (Number(s.r) || 0), 0), 0);
    stats = [[`${done.length}/3`, 'work sets'], [top ? `${top.w}×${top.r}` : '–', 'top set'], [vol.toLocaleString(), 'lb moved'], [accReps, 'accessory reps'], [mins + ' min', 'duration']];
  } else if (rec.run) {
    const r = rec.run;
    stats = [[fmtTime(r.timeSec), r.tt ? 'trial time' : 'time'], [r.miles ? r.miles.toFixed(2) : '–', 'miles']];
    if (r.miles && r.timeSec) stats.push([fmtTime(r.timeSec / r.miles), 'per mile']);
    if (r.effort) stats.push([r.effort + '/10', 'effort']);
    if (rec.maxTest) stats.push([rec.maxTest.pushups ?? '–', 'push-ups'], [rec.maxTest.situps ?? '–', 'sit-ups']);
  } else if (rec.pt) {
    stats = [[fmtTime(rec.pt.run2mi), '2-mile'], [rec.pt.pushups ?? '–', 'push-ups'], [rec.pt.situps ?? '–', 'sit-ups']];
  }
  const fresh = view.fresh || [];
  const dots = Array.from({ length: 6 }, (_, i) => `<i class="${i < wk.done ? 'on' : ''}"></i>`).join('');
  return `
  <div class="screen summary">
    <div class="hero">
      <div class="hero-emoji pop">${rec.pt ? '🦅' : '✅'}</div>
      <h1>MISSION COMPLETE</h1>
      <p class="muted">${esc(rec.title)}<br>${esc(rec.detail)}</p>
    </div>
    <div class="statgrid">${stats.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>
    ${rec.prs.length ? `<div class="card prs">${rec.prs.map((p) => `<div class="pr">🏆 ${esc(p)}</div>`).join('')}</div>` : ''}
    ${fresh.length ? `<div class="card"><h3>Badges unlocked!</h3>${fresh.map((b) => `<div class="unlocked"><span class="bicon">${BADGE_BY_ID[b.id].icon}</span><div><b>${esc(BADGE_BY_ID[b.id].name)}</b><br><span class="muted small">${esc(b.text !== BADGE_BY_ID[b.id].name ? b.text : BADGE_BY_ID[b.id].desc)}</span></div></div>`).join('')}</div>` : ''}
    <div class="card streak">
      ${flameHtml(st)}
      <div><div class="streak-num">${st.days}<span> day streak</span></div><div class="muted">Best ${st.best} · ${wk.done}/6 this week</div><div class="dots">${dots}</div></div>
    </div>
    ${(rec.notesPlan || []).map((n) => `<div class="card note">📣 ${esc(n)}</div>`).join('')}
    <div class="card next ${nx.kind}">
      <div class="nx-label">NEXT UP</div>
      <div class="nx-title">${KIND_ICON[nx.kind]} ${esc(sessionHeading(nx))}</div>
      <div class="muted">${esc(nx.kind === 'lift' ? nx.detail : nx.title)}</div>
    </div>
    <button class="btn big primary" data-a="go" data-v="home">DONE</button>
  </div>`;
}

// ---------- Progress ----------
function renderProgress() {
  const s = state.settings, p = state.plan, t = today();
  const ptDays = s.nextTestDate ? diffDays(t, s.nextTestDate) : null;
  const doneDays = {};
  for (const x of realSessions(state)) doneDays[x.date] = (doneDays[x.date] || 0) + 1;
  const level = (d) => doneDays[d] ? (doneDays[d] > 1 || state.mobility[d] ? 3 : 2) : state.mobility[d] ? 1 : 0;
  const yearCount = realSessions(state).filter((x) => x.date.startsWith(String(hmYear))).length;

  // weight
  const ws = weightSeries(state);
  const g = s.goal;
  const wChart = lineChart({
    series: [
      { points: ws.map((w) => ({ date: w.date, y: w.lb })), color: '#7c8aa5', line: false, r: 2.5, dotOpacity: 0.6, label: 'Daily' },
      { points: ws.map((w) => ({ date: w.date, y: w.avg })), color: '#ff7a1a', dots: false, width: 3, label: '7-day avg' },
    ],
    yFmt: (v) => Math.round(v),
    goal: g.type === 'lose' ? { y: g.target, label: `Goal ${g.target}` } : null,
    band: g.type === 'maintain' ? { min: g.min, max: g.max } : null,
    emptyText: 'Log your morning weight to see your trend',
  });
  const colors = { bench: '#ff7a1a', squat: '#3fb8ff', deadlift: '#b07cff', press: '#3ddc84' };
  const eChart = lineChart({
    series: LIFT_ORDER.map((l) => ({ points: e1rmHistory(state, l).map((q) => ({ date: q.date, y: q.v })), color: colors[l], label: LIFTS[l].replace('Trap bar ', '') })).filter((x) => x.points.length),
    emptyText: 'Finish a lift session to start tracking',
  });
  const t1 = trialHistory(state, '1mi'), t2 = trialHistory(state, '2mi');
  const rChart = lineChart({
    series: [
      { points: t2.map((q) => ({ date: q.date, y: q.sec })), color: '#ff7a1a', label: '2-mile' },
      { points: t1.map((q) => ({ date: q.date, y: q.sec })), color: '#3fb8ff', label: '1-mile' },
    ].filter((x) => x.points.length),
    yFmt: (v) => fmtTime(v),
    goal: t2.length ? { y: s.goal2mi, label: `Goal ${fmtTime(s.goal2mi)}` } : null,
    emptyText: 'Time trials will show up here',
  });
  const mChart = lineChart({
    series: [
      { points: state.maxTests.filter((m) => m.pushups != null).map((m) => ({ date: m.date, y: m.pushups })), color: '#ff7a1a', label: 'Push-ups' },
      { points: state.maxTests.filter((m) => m.situps != null).map((m) => ({ date: m.date, y: m.situps })), color: '#3ddc84', label: 'Sit-ups' },
    ].filter((x) => x.points.length),
    emptyText: 'Max tests are in weeks 1 and 5',
  });
  const hist = [...state.sessions].reverse().slice(0, view.allHist ? 400 : 12);
  const best2 = bestTrial(state, '2mi'), best1 = bestTrial(state, '1mi');
  const years = [...new Set(realSessions(state).map((x) => Number(x.date.slice(0, 4))))].sort((a, b) => b - a);

  return `
  <div class="screen">
    <h2>Progress</h2>
    <div class="card countdown">
      ${ptDays != null && ptDays >= 0
        ? `<div class="cd-big">${ptDays}<span>days</span></div><div><b>Next PT test</b><br>${fmtDate(s.nextTestDate, true)}<br><span class="muted small">${esc(weekLabel(p))}</span></div>`
        : `<div class="cd-big">∞</div><div><b>${esc(weekLabel(p))}</b><br><span class="muted small">No PT test scheduled. Add one in Settings — the app switches to the 8-week test block automatically.</span></div>`}
    </div>
    <div class="card">
      <div class="row between"><h3>${hmYear} · ${yearCount} sessions</h3>
        <div><button class="btn small ghost" data-a="hmYear" data-d="-1">◀︎</button> <button class="btn small ghost" data-a="hmYear" data-d="1">▶︎</button></div></div>
      ${heatmap(hmYear, level, t)}
      <div class="legend"><span><i class="hm1"></i>Mobility</span><span><i class="hm2"></i>Trained</span><span><i class="hm3"></i>Trained + extra</span></div>
    </div>
    <div class="card"><h3>Bodyweight</h3>${weightLine()}${wChart}</div>
    <div class="card"><h3>Estimated 1RM</h3>
      <div class="pbs">${LIFT_ORDER.map((l) => { const v = bestE1rm(state, l); return v ? `<div><b>${Math.round(v)}</b><span>${LIFTS[l].replace('Trap bar ', '')}</span></div>` : ''; }).join('')}</div>
      ${eChart}</div>
    <div class="card"><h3>Time trials</h3>
      <div class="pbs">${best2 ? `<div><b>${fmtTime(best2)}</b><span>2-mile best</span></div>` : ''}${best1 ? `<div><b>${fmtTime(best1)}</b><span>1-mile best</span></div>` : ''}<div><b>${totalMiles(state).toFixed(1)}</b><span>total miles</span></div></div>
      ${rChart}</div>
    <div class="card"><h3>Push-up & sit-up max</h3>${mChart}</div>
    <div class="card"><h3>PT test history</h3>
      ${state.ptResults.length ? state.ptResults.map((r) => `<div class="hist"><div><b>${fmtDate(r.date, true)}</b><br><span class="muted small">2-mile ${fmtTime(r.run2mi)} · ${r.pushups ?? '–'} push-ups · ${r.situps ?? '–'} sit-ups</span></div><span>${r.passed ? '✅' : r.passed === false ? '—' : ''}</span></div>`).join('') : '<p class="muted small">Your PT test results will be saved here.</p>'}
    </div>
    <div class="card"><h3>Year in review</h3>
      ${years.length ? years.map((y) => `<button class="btn ghost" data-a="yearReview" data-y="${y}">🎊 ${y} recap</button>`).join(' ') : '<p class="muted small">Your first recap unlocks after your first session.</p>'}
    </div>
    <div class="card"><h3>History</h3>
      ${hist.length ? hist.map((x, i) => `
        <div class="hist">
          <div><b>${KIND_ICON[x.kind] || ''} ${esc(x.title)}</b>${x.skipped ? ' <span class="muted">(skipped)</span>' : ''}<br><span class="muted small">${fmtDate(x.date)} · ${esc(histLine(x))}</span></div>
          ${i === 0 ? '<button class="btn small ghost" data-a="undo">Undo</button>' : ''}
        </div>`).join('') : '<p class="muted small">Nothing logged yet.</p>'}
      ${!view.allHist && state.sessions.length > 12 ? '<button class="btn ghost" data-a="allHist">Show all</button>' : ''}
    </div>
  </div>`;
}

function histLine(x) {
  if (x.skipped) return x.detail || '';
  if (x.lift) return x.lift.sets.filter((s) => s.done).map((s) => `${s.w}×${s.r}`).join(', ') || x.detail;
  if (x.run) return [x.detail, x.run.timeSec ? fmtTime(x.run.timeSec) : '', x.run.miles ? x.run.miles + ' mi' : ''].filter(Boolean).join(' · ');
  if (x.pt) return `2-mile ${fmtTime(x.pt.run2mi)}`;
  return '';
}

// ---------- Badges ----------
function renderBadges() {
  const unlocked = BADGES.filter((b) => badgeCount(state, b.id) > 0).length;
  return `
  <div class="screen">
    <h2>Badges</h2>
    <p class="muted">${unlocked} of ${BADGES.length} unlocked · ${state.badges.length} earned in total</p>
    <div class="shelf">
      ${BADGES.map((b) => {
        const c = badgeCount(state, b.id);
        return `<button class="badge ${c ? 'got' : 'locked'}" data-a="badgeInfo" data-id="${b.id}">
          <span class="bicon">${b.icon}</span>
          <b>${esc(b.name)}</b>
          ${c > 1 ? `<span class="bcount">×${c}</span>` : ''}
        </button>`;
      }).join('')}
    </div>
  </div>`;
}

// ---------- Settings ----------
function renderSettings() {
  const s = state.settings, p = state.plan;
  const tmRow = (lift) => `
    <div class="field"><label>${LIFTS[lift]}</label>
      <div class="row">
        <input type="number" inputmode="decimal" data-s="tm.${lift}" value="${s.tm[lift] ?? ''}" placeholder="lb">
        <button class="btn small ghost" data-a="tmHelper" data-lift="${lift}">Calc</button>
      </div>
      ${s.stalled[lift] ? '<div class="warn-text small">Marked stalled — you\'ll be offered a 10% reset at the next cycle.</div>' : ''}
    </div>`;
  const swapRow = (slot) => {
    const def = ACCESSORY_SLOTS[slot];
    const cur = accName(s, slot);
    const opts = def.options.includes(cur) ? def.options : [...def.options, cur];
    return `<div class="field"><label>${def.day} · slot ${slot.slice(1)}</label>
      <select data-swap="${slot}">${opts.map((o) => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}<option value="__custom">Custom…</option></select></div>`;
  };
  const g = s.goal;
  const weekMax = p.mode === 'pt' ? 8 : 4;
  const curWeek = p.mode === 'pt' ? p.ptWeek : ((p.ongoingWeek - 1) % 4) + 1;
  const sess = weekSessions(state);
  return `
  <div class="screen">
    <h2>Settings</h2>
    <div class="card"><h3>PT test & running</h3>
      <div class="field"><label>Next PT test date</label><input type="date" data-s="nextTestDate" value="${s.nextTestDate || ''}">
        <p class="muted small">8 weeks before the test, the plan switches to the PT block automatically (with a test-week taper), then returns to normal training afterward.</p>
        ${s.nextTestDate ? '<button class="btn small ghost" data-a="clearTest">Remove test date</button>' : ''}</div>
      <div class="field"><label>Goal 2-mile time (mm:ss)</label><input type="text" inputmode="numeric" data-s="goal2mi" data-type="time" value="${fmtTime(s.goal2mi)}">
        <p class="muted small">Goal pace: ${fmtTime(s.goal2mi / 8)} per 400 m lap · ${fmtTime(s.goal2mi / 2)} per mile</p></div>
    </div>
    <div class="card"><h3>Training Maxes (lb)</h3>
      <p class="muted small">Work-set weights = TM × the week's %, rounded to 5 lb.</p>
      ${LIFT_ORDER.map(tmRow).join('')}
      ${state.tmHistory.length ? `<details><summary class="muted small">TM change history</summary>${state.tmHistory.slice().reverse().map((h) => `<div class="small muted">${h.date}: ${LIFTS[h.lift]} ${h.from} → ${h.to} (${esc(h.reason)})</div>`).join('')}</details>` : ''}
    </div>
    <div class="card"><h3>Exercises</h3>${Object.keys(ACCESSORY_SLOTS).map(swapRow).join('')}</div>
    <div class="card"><h3>Bodyweight goal</h3>
      <div class="field"><label>Starting weight (lb)</label><input type="number" inputmode="decimal" data-s="startWeight" value="${s.startWeight ?? ''}"></div>
      <div class="field"><label>Goal type</label><select data-a2="goalType"><option value="lose" ${g.type === 'lose' ? 'selected' : ''}>Reach a target weight</option><option value="maintain" ${g.type === 'maintain' ? 'selected' : ''}>Maintain a range</option></select></div>
      ${g.type === 'lose' ? `<div class="field"><label>Target (lb)</label><input type="number" inputmode="decimal" data-s="goal.target" value="${g.target ?? ''}"></div>`
        : `<div class="two"><div class="field"><label>Min (lb)</label><input type="number" inputmode="decimal" data-s="goal.min" value="${g.min ?? ''}"></div><div class="field"><label>Max (lb)</label><input type="number" inputmode="decimal" data-s="goal.max" value="${g.max ?? ''}"></div></div>`}
    </div>
    <div class="card"><h3>Schedule</h3>
      <div class="field"><label>Rest / catch-up day</label><select data-s="restDay" data-type="int">${DAY_FULL.map((d, i) => `<option value="${i}" ${i === s.restDay ? 'selected' : ''}>${d}</option>`).join('')}</select>
      <p class="muted small">Sessions roll in order (Lift A → Run 1 → Lift B → Run 2 → Lift C → Run 3). This day doesn't count against your streak.</p></div>
      <details><summary class="muted small">Adjust plan position (if something got out of sync)</summary>
        <div class="field"><label>Phase</label><select id="adjMode"><option value="pt" ${p.mode === 'pt' ? 'selected' : ''}>PT test block</option><option value="ongoing" ${p.mode === 'ongoing' ? 'selected' : ''}>Ongoing cycle</option></select></div>
        <div class="two">
          <div class="field"><label>Week</label><input id="adjWeek" type="number" min="1" max="${weekMax}" value="${curWeek}"></div>
          <div class="field"><label>Session</label><select id="adjIdx">${sess.map((x, i) => `<option value="${i}" ${i === p.idx ? 'selected' : ''}>${i + 1}. ${esc(sessionHeading(x))}</option>`).join('')}</select></div>
        </div>
        <button class="btn ghost" data-a="adjustPlan">Apply</button>
      </details>
    </div>
    <div class="card"><h3>Sound & feel</h3>
      <label class="toggle-row"><input type="checkbox" data-s="sound" data-type="bool" ${s.sound ? 'checked' : ''}> Beeps</label>
      <label class="toggle-row"><input type="checkbox" data-s="voice" data-type="bool" ${s.voice !== false ? 'checked' : ''}> Voice cues in the run timer ("Run", "Walk")</label>
      <label class="toggle-row"><input type="checkbox" data-s="vibrate" data-type="bool" ${s.vibrate ? 'checked' : ''}> Vibration <span class="muted small">(Android only — iPhones don't allow it)</span></label>
      <button class="btn small ghost" data-a="testSound">Test sound</button>
    </div>
    <div class="card"><h3>Your data</h3>
      <p class="muted small">Everything is stored only on this phone. Export a backup now and then (save it to Files, iCloud Drive, Google Drive, or email it to yourself).${state.lastBackup ? ` Last backup: ${fmtDate(state.lastBackup, true)}.` : ''}</p>
      <button class="btn primary" data-a="export">💾 Export backup</button>
      <button class="btn ghost" data-a="import">📂 Import backup</button>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
    </div>
    <div class="card"><h3>Help</h3>
      <p class="small muted"><b>Install on iPhone:</b> open in Safari → Share button → "Add to Home Screen".<br><b>Android:</b> open in Chrome → ⋮ menu → "Install app" / "Add to Home screen".<br>Works offline once installed.</p>
    </div>
    <button class="btn ghost danger" data-a="reset">Erase all data</button>
    <p class="muted small center">Workout Log v${window.APP_VERSION || ''}</p>
  </div>`;
}

// ================= MODALS =================
function openModal(html, onClose) {
  $modal.innerHTML = `<div class="modal-bg" data-a="closeModal"></div><div class="modal-card">${html}</div>`;
  $modal.classList.add('show');
  $modal._onClose = onClose;
  const inp = $modal.querySelector('[autofocus]');
  if (inp) setTimeout(() => inp.focus(), 50);
}
function closeModal() {
  $modal.classList.remove('show');
  $modal.innerHTML = '';
  const f = $modal._onClose; $modal._onClose = null;
  if (f) f();
}

function weightModal() {
  const t = today();
  const lw = latestWeight(state);
  const cur = state.weights[t] ?? (lw ? lw.lb : state.settings.startWeight || '');
  openModal(`
    <h3>Morning weight</h3>
    <p class="muted small">${fmtDate(t)} · after the bathroom, before eating</p>
    <div class="wrow">
      <button class="btn step" data-a="wStep" data-d="-0.2">−</button>
      <input id="wIn" type="number" inputmode="decimal" step="0.1" value="${cur}" class="hugein">
      <button class="btn step" data-a="wStep" data-d="0.2">+</button>
    </div>
    <button class="btn big primary" data-a="saveWeight">SAVE</button>
    ${state.weights[t] ? '<button class="btn ghost" data-a="delWeight">Delete today\'s entry</button>' : ''}
  `);
}

function tmHelperModal(lift) {
  openModal(`
    <h3>Training Max calculator</h3>
    <p class="muted small">Enter a recent hard set (ideally 3–8 reps). Est. 1RM = weight × reps × 0.0333 + weight. TM = 85% of that.</p>
    <div class="two">
      <div class="field"><label>Weight (lb)</label><input id="hW" type="number" inputmode="decimal" autofocus></div>
      <div class="field"><label>Reps</label><input id="hR" type="number" inputmode="numeric"></div>
    </div>
    <div id="hOut" class="calc-out muted">—</div>
    <div class="field"><label>Use for</label><select id="hLift">${LIFT_ORDER.map((l) => `<option value="${l}" ${l === lift ? 'selected' : ''}>${LIFTS[l]}</option>`).join('')}</select></div>
    <button class="btn big primary" data-a="useTM">Use this TM</button>
  `);
}
function calcHelper() {
  const w = num(document.getElementById('hW')?.value), r = num(document.getElementById('hR')?.value);
  const out = document.getElementById('hOut');
  if (!out) return null;
  if (!w || !r) { out.textContent = '—'; return null; }
  const est = e1rm(w, r);
  const tm = round5(est * 0.85);
  out.innerHTML = `Est. 1RM <b>${Math.round(est)} lb</b> → TM <b>${tm} lb</b>`;
  return tm;
}

function cyclePromptModal() {
  const s = state.settings;
  const rows = LIFT_ORDER.map((l) => {
    const tm = s.tm[l];
    if (!tm) return '';
    const up = l === 'bench' || l === 'press' ? 5 : 10;
    const stalled = s.stalled[l];
    const lower = round5(tm * 0.9);
    return `<div class="cyc">
      <b>${LIFTS[l]}</b> <span class="muted">now ${tm}</span>
      <div class="seg">
        <label><input type="radio" name="cy_${l}" value="${tm + up}" ${!stalled ? 'checked' : ''}> +${up} → ${tm + up}</label>
        <label><input type="radio" name="cy_${l}" value="${tm}"> Keep ${tm}</label>
        <label><input type="radio" name="cy_${l}" value="${lower}" ${stalled ? 'checked' : ''}> −10% → ${lower}${stalled ? ' <span class="warn-text">(stalled)</span>' : ''}</label>
      </div></div>`;
  }).join('');
  openModal(`
    <h3>🔁 New cycle — level up</h3>
    <p class="muted small">Standard 5/3/1 progression: +5 lb upper body, +10 lb lower body. If a lift felt like a grind, reset it 10% and build back up.</p>
    ${rows || '<p class="muted">Set your Training Maxes in Settings first.</p>'}
    <button class="btn big primary" data-a="applyCycle">APPLY</button>
    <button class="btn ghost" data-a="dismissCycle">Not now</button>
  `);
}

function badgeInfoModal(id) {
  const b = BADGE_BY_ID[id];
  const got = state.badges.filter((x) => x.id === id);
  openModal(`
    <div class="center"><div class="bicon xl ${got.length ? '' : 'locked'}">${b.icon}</div>
    <h3>${esc(b.name)}</h3><p class="muted">${esc(b.desc)}</p></div>
    ${got.length ? got.slice().reverse().slice(0, 12).map((x) => `<div class="hist"><span>${esc(x.text)}</span><span class="muted small">${fmtShort(x.date)}</span></div>`).join('') : `<p class="center muted small">Locked — ${esc(nextHint(b))}</p>`}
    <button class="btn big ghost" data-a="closeModal">Close</button>
  `);
}
function nextHint(b) {
  const n = realSessions(state).length;
  if (b.count) return `${b.count - n} more session${b.count - n === 1 ? '' : 's'} to go`;
  if (b.days) { const st = streakInfo(state); return `${Math.max(0, b.days - st.days)} more days of streak`; }
  return 'keep going!';
}

function celebrate(list) {
  if (!list.length) return;
  confetti(2);
  buzz([60, 40, 60, 40, 200]);
  openModal(`
    <div class="center"><h2>🎉 Unlocked!</h2></div>
    ${list.map((b) => `<div class="unlocked big"><span class="bicon">${BADGE_BY_ID[b.id].icon}</span><div><b>${esc(BADGE_BY_ID[b.id].name)}</b><br><span class="muted small">${esc(b.text)}</span></div></div>`).join('')}
    ${list.some((b) => b.id === 'goal_weight') ? `<p class="center">You hit your goal! Your new goal is to <b>maintain ${state.settings.goal.min}–${state.settings.goal.max} lb</b>. You can change it in Settings.</p>` : ''}
    <button class="btn big primary" data-a="closeModal">AWESOME</button>
  `);
}

function yearReviewModal(y) {
  const from = `${y}-01-01`, to = `${y}-12-31`;
  const ss = realSessions(state).filter((x) => x.date >= from && x.date <= to);
  const lifts = ss.filter((x) => x.lift).length, runs = ss.filter((x) => x.run || x.pt).length;
  const miles = totalMiles(state, from, to);
  const bs = bestStreakInRange(state, from, to);
  const badges = state.badges.filter((b) => b.date >= from && b.date <= to);
  const prs = badges.filter((b) => /^(pr_|best_|pushup|situp)/.test(b.id));
  const wk = Object.keys(state.weights).filter((k) => k >= from && k <= to).sort();
  const wchange = wk.length > 1 ? state.weights[wk[wk.length - 1]] - state.weights[wk[0]] : null;
  const mob = Object.keys(state.mobility).filter((k) => k >= from && k <= to).length;
  if (!(state.seenReview || []).includes(y)) { state.seenReview = [...(state.seenReview || []), y]; persist(); }
  confetti(1);
  openModal(`
    <div class="center"><div class="hero-emoji">🎊</div><h2>${y} in review</h2></div>
    <div class="statgrid">
      <div><b>${ss.length}</b><span>sessions</span></div>
      <div><b>${lifts}</b><span>lifts</span></div>
      <div><b>${runs}</b><span>runs</span></div>
      <div><b>${miles.toFixed(1)}</b><span>miles run</span></div>
      <div><b>${bs}</b><span>best streak (days)</span></div>
      <div><b>${mob}</b><span>mobility days</span></div>
      <div><b>${wchange == null ? '–' : (wchange > 0 ? '+' : '') + wchange.toFixed(1)}</b><span>lb change</span></div>
      <div><b>${prs.length}</b><span>PRs</span></div>
    </div>
    ${badges.length ? `<h3>Badges earned (${badges.length})</h3><div class="mini-badges">${badges.map((b) => `<span title="${esc(b.text)}">${BADGE_BY_ID[b.id].icon}</span>`).join('')}</div>` : ''}
    ${prs.length ? `<h3>PRs</h3>${prs.slice(-10).map((b) => `<div class="small">🏆 ${esc(b.text)}</div>`).join('')}` : ''}
    <button class="btn big primary" data-a="closeModal">ON TO THE NEXT YEAR 💪</button>
  `);
}

// ================= ACTIONS =================
const actions = {
  go(el) { view = { name: el.dataset.v }; render(); window.scrollTo(0, 0); },
  closeModal,
  finishOnboard() {
    state.onboarded = true;
    state.plan.testDate = state.settings.nextTestDate || state.plan.testDate;
    syncPlan(state, today());
    view = { name: 'home' };
    commit();
    requestPersist();
  },
  start() {
    const nx = nextSession(state);
    if (!(state.draft && state.draft.sig === planSig())) {
      if (nx.kind === 'lift' && !state.settings.tm[nx.lift]) return tmQuickModal(nx.lift, true);
      state.draft = makeDraft(nx);
    }
    unlockAudio();
    view = { name: 'session' };
    commit();
    window.scrollTo(0, 0);
  },
  skip() {
    const nx = nextSession(state);
    if (!confirm(`Skip ${sessionHeading(nx)} and move on to the next session? Skipped sessions don't count toward your streak.`)) return;
    const t = today();
    const rec = { id: uid(), date: t, key: nx.key, kind: nx.kind, title: sessionHeading(nx), detail: nx.kind === 'lift' ? nx.detail : nx.title, skipped: true, before: snapshot(), badgeKeys: [] };
    state.sessions.push(rec);
    if (state.draft && state.draft.sig === planSig()) state.draft = null;
    const notes = advance(state, t);
    commit();
    toast(notes[0] || 'Skipped — next session is up');
  },
  leaveSession() { view = { name: 'home' }; commit(); },
  toggleWarm(el) { const w = state.draft.warm[el.dataset.i]; w.done = !w.done; buzz(15); commit(); },
  toggleSet(el) {
    const s = state.draft.sets[el.dataset.i];
    s.done = !s.done;
    if (s.done) { state.draft.lastCheck = Date.now(); buzz(30); }
    commit();
  },
  accStep(el) {
    const a = state.draft.acc[el.dataset.i];
    a.addR = clamp((Number(a.addR) || 0) + Number(el.dataset.d), 1, 200);
    commit();
  },
  accAdd(el) {
    const a = state.draft.acc[el.dataset.i];
    const r = Number(a.addR);
    if (!r) return;
    a.sets.push({ r, w: num(a.addW) });
    state.draft.lastCheck = Date.now();
    buzz(20);
    commit();
  },
  accDel(el) { state.draft.acc[el.dataset.i].sets.splice(Number(el.dataset.j), 1); commit(); },
  effort(el) { const v = Number(el.dataset.v); state.draft.effort = state.draft.effort === v ? null : v; commit(); },
  ptPass(el) { state.draft.passed = el.dataset.v === '1'; commit(); },
  finish: finishSession,
  startTimer() {
    const d = state.draft.desc;
    unlockAudio();
    $overlay.classList.add('show');
    document.body.classList.add('noscroll');
    timer = new IntervalTimer(d.steps, {
      root: $overlay, sound: state.settings.sound, vibrate: state.settings.vibrate, voice: state.settings.voice !== false,
      onDone(res) {
        $overlay.classList.remove('show');
        document.body.classList.remove('noscroll');
        $overlay.innerHTML = '';
        timer = null;
        const dr = state.draft;
        if (!dr) return;
        dr.timerResult = res;
        if (!dr.time) dr.time = fmtTime(d.tt ? res.ttSec || res.totalSec : res.totalSec);
        if (!dr.miles && d.estMiles) dr.miles = d.estMiles.toFixed(2);
        commit();
      },
    });
    timer.start();
  },
  weight: weightModal,
  wStep(el) { const i = document.getElementById('wIn'); i.value = (Math.round(((num(i.value) || 0) + Number(el.dataset.d)) * 10) / 10).toFixed(1); },
  saveWeight() {
    const v = num(document.getElementById('wIn').value);
    if (!v || v < 50 || v > 700) return toast('Enter a weight in lb');
    state.weights[today()] = Math.round(v * 10) / 10;
    closeModal();
    const fresh = evaluate(state);
    commit();
    buzz(30);
    const a = avg7(state);
    toast(`Saved ${v} lb · 7-day avg ${a.toFixed(1)}`);
    celebrate(fresh);
  },
  delWeight() { delete state.weights[today()]; closeModal(); commit(); },
  mobility() {
    const t = today();
    if (state.mobility[t]) { delete state.mobility[t]; commit(); return; }
    state.mobility[t] = true;
    buzz(40);
    commit();
    toast('Mobility done ✓ Nice.');
  },
  tmHelper(el) { tmHelperModal(el.dataset.lift); },
  tmQuick(el) { tmQuickModal(el.dataset.lift, false); },
  useTM() {
    const tm = calcHelper();
    if (!tm) return toast('Enter weight and reps');
    const lift = document.getElementById('hLift').value;
    setTM(lift, tm, 'Calculator');
    closeModal();
    commit();
    toast(`${LIFTS[lift]} TM set to ${tm} lb`);
  },
  saveQuickTM(el) {
    const v = num(document.getElementById('qTM').value);
    if (!v) return toast('Enter a Training Max');
    setTM(el.dataset.lift, round5(v), 'Manual');
    if (state.draft && state.draft.desc.kind === 'lift') refreshDraftWeights();
    const thenStart = el.dataset.start === '1';
    closeModal();
    if (thenStart) actions.start(); else commit();
  },
  cyclePrompt: cyclePromptModal,
  applyCycle() {
    for (const l of LIFT_ORDER) {
      const r = $modal.querySelector(`input[name="cy_${l}"]:checked`);
      if (r) {
        const v = Number(r.value);
        if (v !== state.settings.tm[l]) setTM(l, v, 'New cycle');
        state.settings.stalled[l] = false;
      }
    }
    state.pending.cycleTM = false;
    closeModal();
    commit();
    toast('Training Maxes updated 💪');
  },
  dismissCycle() { state.pending.cycleTM = false; closeModal(); commit(); },
  badgeInfo(el) { badgeInfoModal(el.dataset.id); },
  yearReview(el) { yearReviewModal(Number(el.dataset.y)); render(); },
  hmYear(el) { hmYear += Number(el.dataset.d); render(); },
  undo: undoLast,
  allHist() { view.allHist = true; render(); },
  clearTest() { state.settings.nextTestDate = null; commit(); },
  adjustPlan() {
    const mode = document.getElementById('adjMode').value;
    const wk = Number(document.getElementById('adjWeek').value) || 1;
    const idx = Number(document.getElementById('adjIdx').value) || 0;
    const p = state.plan;
    if (mode === 'pt') {
      p.mode = 'pt'; p.ptWeek = clamp(wk, 1, 8);
      if (!p.testDate) p.testDate = state.settings.nextTestDate || addDays(today(), 56);
    } else {
      const base = p.mode === 'ongoing' && p.ongoingWeek > 0 ? Math.floor((p.ongoingWeek - 1) / 4) * 4 : 0;
      p.mode = 'ongoing'; p.ongoingWeek = base + clamp(wk, 1, 4);
    }
    p.idx = clamp(idx, 0, weekSessions(state).length - 1);
    state.draft = null;
    commit();
    toast('Plan position updated');
  },
  testSound() { unlockAudio(); beep(988, 0.18); beep(1319, 0.3, 0.2); vibrate([200, 100, 200]); },
  async export() {
    const data = JSON.stringify(state, null, 1);
    const name = `workout-backup-${today()}.json`;
    const file = new File([data], name, { type: 'application/json' });
    let ok = false;
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        await navigator.share({ files: [file], title: 'Workout backup' });
        ok = true;
      }
    } catch (e) { if (e.name === 'AbortError') return; }
    if (!ok) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    state.lastBackup = today();
    commit();
    toast('Backup saved 💾');
  },
  import() { document.getElementById('importFile').click(); },
  reset() {
    if (!confirm('Erase ALL data on this phone? This cannot be undone. (Export a backup first!)')) return;
    if (!confirm('Really erase everything?')) return;
    state = defaultState();
    view = { name: 'onboard' };
    commit();
  },
};

function setTM(lift, v, reason) {
  const from = state.settings.tm[lift];
  state.settings.tm[lift] = v;
  if (from !== v) state.tmHistory.push({ date: today(), lift, from, to: v, reason });
}
function refreshDraftWeights() {
  const dr = state.draft;
  const tm = state.settings.tm[dr.desc.lift];
  if (!tm) return;
  dr.sets.forEach((s) => { if (!s.done) s.w = Math.max(45, round5(tm * s.pct / 100)); });
  const nx = nextSession(state);
  if (nx.key === dr.key) { dr.desc = nx; dr.warm = nx.warmups.map((w) => ({ ...w, done: false })); }
}
function tmQuickModal(lift, thenStart) {
  openModal(`
    <h3>${LIFTS[lift]} Training Max</h3>
    <p class="muted small">Enter your TM, or use the calculator with a recent set.</p>
    <input id="qTM" type="number" inputmode="decimal" class="hugein" placeholder="lb" autofocus>
    <button class="btn big primary" data-a="saveQuickTM" data-lift="${lift}" data-start="${thenStart ? 1 : 0}">SAVE</button>
    <button class="btn ghost" data-a="tmHelper" data-lift="${lift}">Use calculator</button>
  `);
}

// ================= EVENTS =================
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-t]');
  if (t && timer) { timer.handle(t.dataset.t); return; }
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const fn = actions[el.dataset.a];
  if (fn) { e.preventDefault(); fn(el); }
});

function setPath(obj, path, val) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = val;
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'hW' || el.id === 'hR') { calcHelper(); return; }
  if (el.dataset.f && state.draft) {
    const v = el.dataset.type === 'bool' ? el.checked : el.value;
    setPath(state.draft, el.dataset.f, v);
    persist();
    if (/^sets\.\d+\.w$/.test(el.dataset.f)) {
      const p = el.closest('.setrow')?.querySelector('.plates');
      if (p) p.textContent = num(v) ? plates(num(v)) : '';
    }
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'importFile') return handleImport(el);
  if (el.dataset.f && el.dataset.type === 'bool' && state.draft) { setPath(state.draft, el.dataset.f, el.checked); persist(); return; }
  if (el.dataset.s) {
    let v = el.value;
    const type = el.dataset.type || (el.type === 'number' ? 'num' : el.type === 'checkbox' ? 'bool' : 'str');
    if (type === 'num') v = num(v);
    else if (type === 'int') v = parseInt(v, 10);
    else if (type === 'bool') v = el.checked;
    else if (type === 'time') { v = parseTime(v); if (!v) return toast('Use mm:ss, e.g. 16:00'); }
    else if (v === '') v = null;
    if (el.dataset.s.startsWith('tm.')) {
      setTM(el.dataset.s.slice(3), v == null ? null : round5(v), 'Settings');
    } else {
      setPath(state.settings, el.dataset.s, v);
    }
    if (el.dataset.s === 'nextTestDate') {
      const notes = syncPlan(state, today());
      if (notes.length) toast(notes[0], 3500);
    }
    if (view.name === 'onboard') { persist(); return; }
    commit();
    return;
  }
  if (el.dataset.swap) {
    let v = el.value;
    if (v === '__custom') {
      v = prompt('Exercise name:');
      if (!v) return render();
    }
    state.settings.swaps[el.dataset.swap] = v;
    commit();
    toast(`Swapped to ${v}`);
    return;
  }
  if (el.dataset.a2 === 'goalType') {
    const a = avg7(state) || state.settings.startWeight || 185;
    state.settings.goal = el.value === 'lose' ? { type: 'lose', target: 185 } : { type: 'maintain', min: Math.round(a) - 5, max: Math.round(a) + 5 };
    commit();
  }
});

async function handleImport(el) {
  const f = el.files && el.files[0];
  el.value = '';
  if (!f) return;
  try {
    const obj = validateImport(JSON.parse(await f.text()));
    const n = (obj.sessions || []).filter((x) => !x.skipped).length;
    if (!confirm(`Replace all data on this phone with this backup (${n} sessions, ${Object.keys(obj.weights || {}).length} weigh-ins)?`)) return;
    state = obj;
    state.onboarded = true;
    view = { name: 'home' };
    commit();
    toast('Backup restored ✓');
  } catch (err) {
    alert('Could not import: ' + err.message);
  }
}

// Live "time since" counters (session duration, rest timer)
function tickSince() {
  const now = Date.now();
  document.querySelectorAll('[data-since]').forEach((el) => {
    const t = Number(el.dataset.since);
    el.textContent = t ? fmtTime(Math.floor((now - t) / 1000)) : '';
  });
}
setInterval(tickSince, 1000);

// When coming back to the app on a new day, refresh the screen
let lastDay = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && today() !== lastDay) {
    lastDay = today();
    syncPlan(state, today());
    const fresh = evaluate(state);
    commit();
    celebrate(fresh);
  }
});

// ================= START =================
if (state.onboarded) {
  syncPlan(state, today());
  const fresh = evaluate(state);
  save(state);
  render();
  celebrate(fresh);
} else {
  render();
}
if (state.draft && view.name === 'home') {
  // resume an unfinished session after the app was closed
  if (state.draft.sig === planSig()) { view = { name: 'session' }; render(); toast('Resumed your session in progress'); }
}

// Offline support
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('App updated — close and reopen to get the new version', 5000);
        }
      });
    });
  }).catch(() => {});
}

// for debugging in the browser console
window.__app = { get state() { return state; }, render };
