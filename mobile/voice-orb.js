// Original canvas renderer, inspired by the approved particle-orb reference.
// No remote assets, microphone access, or made-up listening state.
function mountVoiceOrb(canvas, isVisible, mode) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const points = Array.from({ length: 1800 }, (_, i) => {
    const y = 1 - (i / 1799) * 2;
    const radius = Math.sqrt(1 - y * y);
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius, phase: i * .17 };
  });
  let frame = 0, previous = 0, angle = 0, stopped = false;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = 300 * ratio; canvas.height = 300 * ratio;
  ctx.scale(ratio, ratio);
  function paint(time) {
    if (stopped) return;
    if (!isVisible() || document.hidden || time - previous < 33) {
      frame = requestAnimationFrame(paint); return;
    }
    previous = time;
    const state = mode();
    const speed = state === 'thinking' ? .014 : state === 'speaking' ? .009 : .002;
    if (!reduced.matches) angle += speed;
    const pulse = reduced.matches ? 0 : Math.sin(time * (state === 'speaking' ? .008 : .0015)) * (state ? 5 : 1.5);
    ctx.clearRect(0, 0, 300, 300);
    const glow = ctx.createRadialGradient(150, 150, 80, 150, 150, 148);
    glow.addColorStop(0, '#5479ff08'); glow.addColorStop(.65, '#8f62ff30'); glow.addColorStop(1, '#13142300');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 300, 300);
    ctx.globalCompositeOperation = 'lighter';
    const projected = points.map(p => {
      const wave = 1 + Math.sin(p.y * 7 + angle * 4 + p.phase * .08) * .045;
      const x = p.x * Math.cos(angle) - p.z * Math.sin(angle);
      const z = p.x * Math.sin(angle) + p.z * Math.cos(angle);
      const radius = (105 + pulse) * wave;
      const perspective = 1 / (1 - z * .12);
      return { x: 150 + x * radius * perspective, y: 150 + p.y * radius * perspective, z, phase:p.phase };
    }).sort((a, b) => a.z - b.z);
    for (const p of projected) {
      const front = (p.z + 1) / 2;
      const purple = .5 + Math.sin(p.y * .03 + angle * 2) * .5;
      const rim = 1 - Math.abs(p.z);
      const red = Math.round(65 + purple * 110 + rim * 40), green = Math.round(207 - purple * 99 + rim * 40);
      ctx.fillStyle = `rgba(${red},${green},255,${.3 + front * .7})`;
      const size = .6 + front * .95 + Math.pow(Math.sin(p.phase), 12) * .8;
      ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
    }
    // A few outward sparks keep the shape organic without covering controls.
    for (let i = 0; i < 65; i++) {
      const a = i * 2.399 + angle * .4, distance = 111 + (i % 9) * 2.2;
      ctx.fillStyle = i % 2 ? '#936bff70' : '#71d7ff60';
      ctx.fillRect(150 + Math.cos(a) * distance, 150 + Math.sin(a) * distance, 1, 1);
    }
    ctx.globalCompositeOperation = 'source-over';
    if (!reduced.matches) frame = requestAnimationFrame(paint);
  }
  frame = requestAnimationFrame(paint);
  const visibility = () => { if (!document.hidden && !stopped) { cancelAnimationFrame(frame); frame = requestAnimationFrame(paint); } };
  document.addEventListener('visibilitychange', visibility);
  const preference = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(paint); };
  reduced.addEventListener('change', preference);
  return () => { stopped = true; cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', preference); };
}
