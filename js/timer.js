// Interval timer with big countdown, beeps, vibration and voice cues.
import { fmtTime, esc } from './util.js';

let ctx = null;
export function unlockAudio() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback'; // play even with iPhone silent switch
  } catch (e) { /* ignore */ }
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
  } catch (e) { /* ignore */ }
}
export function beep(freq = 880, dur = 0.15, when = 0, vol = 0.5) {
  if (!ctx) return;
  try {
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* ignore */ }
}
export function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ }
}
function say(text) {
  try {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

const KIND_INFO = {
  warm: { word: 'WARM UP', cls: 'k-warm', say: 'Warm up' },
  run: { word: 'RUN', cls: 'k-run', say: 'Run' },
  walk: { word: 'WALK', cls: 'k-walk', say: 'Walk' },
  rest: { word: 'RECOVER', cls: 'k-walk', say: 'Walk and recover' },
  rep: { word: 'GO', cls: 'k-run', say: 'Go' },
  stride: { word: 'STRIDE', cls: 'k-run', say: 'Stride' },
  tt: { word: 'TIME TRIAL', cls: 'k-tt', say: 'Time trial. Go!' },
};

export class IntervalTimer {
  constructor(steps, opts) {
    this.steps = steps;
    this.opts = opts; // { root, sound, vibrate, voice, onDone(result), onCancel() }
    this.i = 0;
    this.acc = 0; // ms elapsed in current step before last resume
    this.seg = null; // ms timestamp of last resume
    this.log = []; // { label, kind, sec, target, full }
    this.lastWhole = null;
    this.wakeLock = null;
  }
  get running() { return this.seg != null; }
  elapsedMs() { return this.acc + (this.seg != null ? Date.now() - this.seg : 0); }

  start() {
    unlockAudio();
    this.seg = Date.now();
    this.cue(true);
    this.loop = setInterval(() => this.tick(), 200);
    this.onVis = () => { if (document.visibilityState === 'visible') { this.lock(); this.tick(); } };
    document.addEventListener('visibilitychange', this.onVis);
    this.lock();
    this.render();
  }
  async lock() {
    try { if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
  }
  stop() {
    clearInterval(this.loop);
    document.removeEventListener('visibilitychange', this.onVis);
    try { if (this.wakeLock) this.wakeLock.release(); } catch (e) { /* ignore */ }
  }
  cue(first = false) {
    const st = this.steps[this.i];
    if (!st) return;
    const info = KIND_INFO[st.kind] || KIND_INFO.run;
    if (this.opts.sound) { beep(988, 0.18); beep(1319, 0.3, 0.2); }
    if (this.opts.vibrate) vibrate([250, 100, 250]);
    if (this.opts.voice) say(first ? `${info.say}. ${st.label}` : info.say);
  }
  tick() {
    const st = this.steps[this.i];
    if (!st || !this.running) return this.update();
    if (st.sec) {
      let el = this.elapsedMs();
      // catch up if the phone was asleep through several steps
      while (st.sec && el >= this.steps[this.i].sec * 1000) {
        const cur = this.steps[this.i];
        const over = el - cur.sec * 1000;
        this.record(cur, cur.sec, true);
        this.i++;
        if (this.i >= this.steps.length) return this.finish();
        this.acc = over; this.seg = Date.now();
        this.lastWhole = null;
        this.cue();
        this.render();
        if (!this.steps[this.i].sec) break;
        el = this.elapsedMs();
      }
      const cur = this.steps[this.i];
      if (cur.sec) {
        const remain = Math.ceil(cur.sec - this.elapsedMs() / 1000);
        if (remain !== this.lastWhole && remain <= 3 && remain >= 1 && this.opts.sound) beep(660, 0.1);
        this.lastWhole = remain;
      }
    }
    this.update();
  }
  record(st, sec, full) {
    this.log.push({ label: st.label, kind: st.kind, sec, target: st.target || null, full });
  }
  lap() { // manual step done, or skip
    const st = this.steps[this.i];
    if (!st) return;
    const sec = this.elapsedMs() / 1000;
    this.record(st, sec, !st.sec || sec >= st.sec - 1);
    this.i++;
    this.acc = 0; this.seg = Date.now(); this.lastWhole = null;
    if (this.i >= this.steps.length) return this.finish();
    this.cue();
    this.render();
  }
  back() {
    if (this.i === 0) { this.acc = 0; this.seg = this.running ? Date.now() : null; return this.render(); }
    this.log.pop();
    this.i--;
    this.acc = 0; this.seg = this.running ? Date.now() : null;
    this.render();
  }
  toggle() {
    if (this.running) { this.acc = this.elapsedMs(); this.seg = null; }
    else { this.seg = Date.now(); unlockAudio(); }
    this.render();
  }
  finish(early = false) {
    if (early) {
      const st = this.steps[this.i];
      if (st) this.record(st, this.elapsedMs() / 1000, false);
    }
    this.stop();
    if (this.opts.sound) { beep(784, 0.15); beep(988, 0.15, 0.17); beep(1319, 0.4, 0.34); }
    if (this.opts.vibrate) vibrate([300, 100, 300, 100, 500]);
    if (this.opts.voice) say(early ? 'Workout ended' : 'Workout complete. Nice work!');
    const total = this.log.reduce((a, l) => a + l.sec, 0);
    const tt = this.log.find((l) => l.kind === 'tt');
    const longest = Math.max(0, ...this.log.filter((l) => (l.kind === 'run' || l.kind === 'tt') && l.full).map((l) => l.sec));
    this.opts.onDone({
      totalSec: Math.round(total),
      laps: this.log.filter((l) => l.kind === 'rep').map((l) => ({ label: l.label, sec: Math.round(l.sec), target: l.target })),
      ttSec: tt ? Math.round(tt.sec) : null,
      longestRunSec: Math.round(longest),
      completedAll: !early,
    });
  }
  render() {
    const root = this.opts.root;
    if (!root) return;
    const st = this.steps[this.i];
    if (!st) return;
    const info = KIND_INFO[st.kind] || KIND_INFO.run;
    const countdown = !!st.sec;
    const nx = this.steps[this.i + 1];
    const lastLap = [...this.log].reverse().find((l) => l.kind === 'rep' || l.kind === 'tt');
    root.innerHTML = `
      <div class="timer ${info.cls} ${this.running ? '' : 'paused'}">
        <div class="t-top">
          <button class="t-x" data-t="end">End</button>
          <div class="t-step"></div>
        </div>
        <div class="t-word">${this.running ? info.word : 'PAUSED'}</div>
        <div class="t-label">${esc(st.label)}</div>
        <div class="t-big"></div>
        <div class="t-target"></div>
        ${countdown ? `<div class="t-bar"><i></i></div>` : ''}
        ${lastLap ? `<div class="t-last">Last: ${esc(lastLap.label)} — <b>${fmtTime(Math.round(lastLap.sec))}</b>${lastLap.target ? ` (target ${fmtTime(lastLap.target)})` : ''}</div>` : ''}
        <div class="t-next">${nx ? `Next: ${esc(nx.label)}${nx.sec ? ' · ' + fmtTime(nx.sec) : ''}` : 'Last step!'}</div>
        <div class="t-btns">
          ${countdown ? '' : `<button class="btn t-done" data-t="lap">DONE ✓</button>`}
          <div class="t-row">
            <button class="btn ghost" data-t="back">◀︎ Back</button>
            <button class="btn ghost" data-t="toggle">${this.running ? '❚❚ Pause' : '▶︎ Resume'}</button>
            ${countdown ? '<button class="btn ghost" data-t="lap">Skip ▶︎</button>' : ''}
          </div>
        </div>
      </div>`;
    this.update();
  }
  // Only change numbers (keeps buttons in place so taps are never lost)
  update() {
    const root = this.opts.root;
    const st = this.steps[this.i];
    if (!root || !st) return;
    const q = (c) => root.querySelector(c);
    const el = this.elapsedMs() / 1000;
    const countdown = !!st.sec;
    const big = countdown ? fmtTime(Math.max(0, Math.ceil(st.sec - el))) : fmtTime(Math.floor(el));
    const total = this.log.reduce((a, l) => a + l.sec, 0) + el;
    if (q('.t-big')) q('.t-big').textContent = big;
    if (q('.t-step')) q('.t-step').textContent = `Step ${this.i + 1} / ${this.steps.length} · total ${fmtTime(Math.floor(total))}`;
    if (countdown && q('.t-bar i')) q('.t-bar i').style.width = Math.min(100, (el / st.sec) * 100) + '%';
    const tg = q('.t-target');
    if (tg) {
      if (!countdown && st.target) {
        const diff = el - st.target;
        tg.innerHTML = `Target ${fmtTime(st.target)} <span class="${diff > 0 ? 'over' : 'under'}">${diff > 0 ? '+' : ''}${fmtTime(Math.round(diff))}</span>`;
      } else tg.textContent = countdown ? '' : 'Tap DONE when you finish';
    }
  }
  handle(action) {
    if (action === 'lap') this.lap();
    else if (action === 'toggle') this.toggle();
    else if (action === 'back') this.back();
    else if (action === 'end') {
      if (confirm('End the timer now? You can still log the session.')) this.finish(true);
    }
  }
}
