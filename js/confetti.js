// Lightweight confetti burst on a full-screen canvas.
export function confetti(intensity = 1) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.appendChild(c);
  const dpr = window.devicePixelRatio || 1;
  const W = innerWidth, H = innerHeight;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const colors = ['#ff7a1a', '#ffd23f', '#3ddc84', '#3fb8ff', '#ff4d6d', '#b07cff'];
  const n = Math.round(120 * intensity);
  const parts = Array.from({ length: n }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    s: 5 + Math.random() * 6,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  function frame(t) {
    const el = t - t0;
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.35; p.vx *= 0.99;
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save();
      g.translate(p.x, p.y); g.rotate(p.r);
      g.globalAlpha = Math.max(0, 1 - el / 3200);
      g.fillStyle = p.c;
      g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      g.restore();
    }
    if (el < 3200) requestAnimationFrame(frame); else c.remove();
  }
  requestAnimationFrame(frame);
}
