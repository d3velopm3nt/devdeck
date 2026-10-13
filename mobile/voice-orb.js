// Original canvas renderer, inspired by the approved particle-orb reference.
// No remote assets, microphone access, or made-up listening state.
function mountVoiceOrb(canvas, isVisible, mode, audioLevel = () => 0) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const points = Array.from({ length: 1350 }, (_, i) => {
    const y = 1 - (i / 1349) * 2;
    const radius = Math.sqrt(1 - y * y);
    const longitude = i * Math.PI * (3 - Math.sqrt(5));
    return { x: Math.cos(longitude) * radius, y, z: Math.sin(longitude) * radius, phase: i * .17, strand: false };
  });
  // Curved internal ribbons give the orb the flowing, luminous reference shape.
  for (let strand = 0; strand < 3; strand++) {
    for (let i = 0; i < 240; i++) {
      const t = i / 239 * Math.PI * 2;
      const spread = Math.sin(i * 2.399 + strand) * .045;
      const latitude = Math.sin(t * 2 + strand * 2.1) * .8;
      const longitude = t + strand * 2.1;
      const radius = .76 + Math.sin(t * 3 + strand) * .12;
      const x = Math.cos(longitude) * Math.cos(latitude) * radius;
      const y = Math.sin(latitude) * radius + spread;
      const z = Math.sin(longitude) * Math.cos(latitude) * radius;
      points.push({ x, y, z, phase: i * .17 + strand, strand: true });
    }
  }
  let frame = 0, previous = 0, angle = 0, envelope = 0, thinkingAngle = 0, stopped = false;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = 300 * ratio; canvas.height = 300 * ratio;
  ctx.scale(ratio, ratio);
  function paint(time) {
    if (stopped) return;
    if (!isVisible() || document.hidden || time - previous < (reduced.matches ? 100 : 33)) {
      frame = requestAnimationFrame(paint); return;
    }
    const elapsed = Math.min(previous ? time - previous : 33, 100);
    previous = time;
    const state = mode();
    const target = state === 'speaking' ? Math.max(0, Math.min(1, audioLevel())) : 0;
    // Smooth syllables with a soft attack and slower release, independent of frame rate.
    envelope += (target - envelope) * (1 - Math.exp(-elapsed / (target > envelope ? 160 : 320)));
    if (!reduced.matches && state === 'thinking') thinkingAngle += elapsed * .000025;
    // Bounded sway avoids the relentless full rotation while idle or speaking.
    angle = reduced.matches ? 0 : thinkingAngle + Math.sin(time * .00045) * .06;
    const pulse = reduced.matches ? 0 : envelope * 6 + Math.sin(time * .001) * (state === 'thinking' ? 1.8 : .7);
    ctx.clearRect(0, 0, 300, 300);
    const glow = ctx.createRadialGradient(150, 150, 80, 150, 150, 148);
    glow.addColorStop(0, '#287fff06'); glow.addColorStop(.65, '#6e4bff22'); glow.addColorStop(1, '#13142300');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 300, 300);
    ctx.globalCompositeOperation = 'lighter';
    const projected = points.map(p => {
      const wave = 1 + Math.sin(p.y * 7 + angle * 4 + p.phase * .08) * .02;
      const twist = angle + p.y * .7 + (reduced.matches ? 0 : Math.sin(time * .0003 + p.y * 3) * .08);
      const x = p.x * Math.cos(twist) - p.z * Math.sin(twist);
      const z = p.x * Math.sin(twist) + p.z * Math.cos(twist);
      const radius = (105 + pulse) * wave;
      const perspective = 1 / (1 - z * .12);
      return { x: 150 + x * radius * perspective, y: 150 + p.y * radius * perspective, z, phase:p.phase, strand:p.strand };
    }).sort((a, b) => a.z - b.z);
    for (const p of projected) {
      const front = (p.z + 1) / 2;
      const purple = .5 + Math.sin((p.x - p.y) * .017 + angle) * .5;
      const rim = 1 - Math.abs(p.z);
      const red = Math.round(65 + purple * 110 + rim * 40), green = Math.round(207 - purple * 99 + rim * 40);
      const opacity = p.strand ? .45 + front * .5 : .15 + front * .35 + rim * .3;
      const size = p.strand ? .65 + front * .6 : .35 + front * .55 + Math.pow(Math.sin(p.phase), 12) * .5;
      if (p.strand && front > .5) {
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 4);
        halo.addColorStop(0, `rgba(${red},${green},255,.12)`);
        halo.addColorStop(1, `rgba(${red},${green},255,0)`);
        ctx.fillStyle = halo; ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      }
      ctx.fillStyle = `rgba(${red},${green},255,${opacity})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
    }
    // A few outward sparks keep the shape organic without covering controls.
    for (let i = 0; i < 65; i++) {
      const a = i * 2.399 + angle * .4, distance = 111 + (i % 9) * 2.2;
      ctx.fillStyle = i % 2 ? '#936bff70' : '#71d7ff60';
      ctx.fillRect(150 + Math.cos(a) * distance, 150 + Math.sin(a) * distance, 1, 1);
    }
    ctx.globalCompositeOperation = 'source-over';
    frame = requestAnimationFrame(paint);
  }
  frame = requestAnimationFrame(paint);
  const visibility = () => { if (!document.hidden && !stopped) { cancelAnimationFrame(frame); frame = requestAnimationFrame(paint); } };
  document.addEventListener('visibilitychange', visibility);
  const preference = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(paint); };
  reduced.addEventListener('change', preference);
  return () => { stopped = true; cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', preference); };
}
