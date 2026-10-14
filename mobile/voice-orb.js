// Flowing light ribbons on a dimensional sphere. No microphone stream is captured
// here: listening follows recognition events; speaking follows playback amplitude.
function mountVoiceOrb(canvas, isVisible, mode, audioLevel = () => 0) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const size = 360, centre = size / 2, ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = size * ratio; canvas.height = size * ratio;
  ctx.scale(ratio, ratio);
  const dust = Array.from({ length: 620 }, (_, i) => {
    const y = 1 - 2 * i / 619, r = Math.sqrt(1 - y * y), a = i * 2.399963;
    return { x: Math.cos(a) * r, y, z: Math.sin(a) * r, phase: i * .73 };
  });
  let frame = 0, previous = 0, elapsedTime = 0, envelope = 0, stopped = false;
  function project(x, y, z, rotation, radius) {
    const px = x * Math.cos(rotation) - z * Math.sin(rotation);
    const pz = x * Math.sin(rotation) + z * Math.cos(rotation);
    const tilt = -.24;
    const py = y * Math.cos(tilt) - pz * Math.sin(tilt);
    const depth = y * Math.sin(tilt) + pz * Math.cos(tilt);
    const perspective = 1 / (1 - depth * .12);
    return { x: centre + px * radius * perspective, y: centre + py * radius * perspective, depth };
  }
  function paint(time) {
    if (stopped) return;
    if (!isVisible() || document.hidden || time - previous < (reduced.matches ? 120 : 33)) {
      frame = requestAnimationFrame(paint); return;
    }
    const dt = Math.min(previous ? time - previous : 33, 100); previous = time;
    if (!reduced.matches) elapsedTime += dt;
    const t = elapsedTime / 1000, state = mode();
    const level = state === 'speaking' ? Math.max(0, Math.min(1, audioLevel())) : 0;
    envelope += (level - envelope) * (1 - Math.exp(-dt / (level > envelope ? 65 : 200)));
    const radius = 119 + (reduced.matches ? 0 : Math.sin(t * 1.4) * 2.4 + envelope * 14);
    const rotation = reduced.matches ? 0 : t * (state === 'thinking' ? .24 : .085);
    const listening = state === 'listening';
    ctx.clearRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
    const aura = ctx.createRadialGradient(centre, centre, 45, centre, centre, 177);
    aura.addColorStop(0, listening ? '#21ccbd22' : '#6646ed26');
    aura.addColorStop(.65, listening ? '#28ead526' : '#8c4eff27');
    aura.addColorStop(1, '#00000000');
    ctx.fillStyle = aura; ctx.fillRect(0, 0, size, size);
    const body = ctx.createRadialGradient(155, 142, 8, centre, centre, radius);
    body.addColorStop(0, '#32387035'); body.addColorStop(.72, '#17204424'); body.addColorStop(1, '#0b112100');
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(centre, centre, radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    // Each ribbon is a bundle of continuous curves, not a dotted globe.
    // Draw the rear half first to retain depth across the luminous front.
    for (const front of [false, true]) {
      for (let ribbon = 0; ribbon < 6; ribbon++) {
        const colour = listening ? (ribbon % 2 ? '95,255,210' : '63,232,255')
          : ribbon % 3 === 0 ? '189,110,255' : ribbon % 3 === 1 ? '60,221,255' : '125,142,255';
        for (let strand = -2; strand <= 2; strand++) {
          ctx.beginPath(); let joined = false;
          for (let step = 0; step <= 150; step++) {
            const a = step / 150 * Math.PI * 2;
            const latitude = Math.sin(a * 2 + ribbon * .83 + t * .3) * .57 + (ribbon - 2.5) * .10 + strand * .022;
            const longitude = a + ribbon * .63;
            const p = project(Math.cos(longitude) * Math.cos(latitude), Math.sin(latitude), Math.sin(longitude) * Math.cos(latitude), rotation, radius);
            if ((p.depth >= 0) !== front) { joined = false; continue; }
            if (!joined) { ctx.moveTo(p.x, p.y); joined = true; } else ctx.lineTo(p.x, p.y);
          }
          ctx.strokeStyle = `rgba(${colour},${front ? (strand === 0 ? .84 : .32) : .10})`;
          ctx.lineWidth = strand === 0 ? (front ? 1.6 : .8) : .7;
          ctx.shadowColor = `rgba(${colour},.65)`; ctx.shadowBlur = front && strand === 0 ? 9 : 0; ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      for (const p of dust) {
        const v = project(p.x, p.y, p.z, rotation, radius * 1.015);
        if ((v.depth >= 0) !== front) continue;
        const twinkle = .5 + .5 * Math.sin(p.phase + t * 1.8);
        ctx.fillStyle = `rgba(${listening ? '117,255,227' : p.y > 0 ? '99,227,255' : '184,149,255'},${front ? .25 + twinkle * .5 : .08})`;
        ctx.beginPath(); ctx.arc(v.x, v.y, front ? .6 + twinkle * .5 : .5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
    // Orbital particles and state rings distinguish real recognition from work.
    for (let i = 0; i < 30; i++) {
      const a = i * 2.399 + t * .06, r = 133 + i % 7 * 3;
      ctx.fillStyle = i % 2 ? '#b493ff8a' : '#7bf5ff9a';
      ctx.beginPath(); ctx.arc(centre + Math.cos(a) * r, centre + Math.sin(a) * r, i % 6 === 0 ? 1.4 : .7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (['thinking', 'preparing', 'connecting'].includes(state)) {
      const a = reduced.matches ? -.8 : t * 1.9;
      ctx.lineWidth = 2; ctx.strokeStyle = '#c7a4ffe0';
      ctx.beginPath(); ctx.arc(centre, centre, 153, a, a + 1.4); ctx.stroke();
      ctx.strokeStyle = '#78e8ffe0'; ctx.beginPath(); ctx.arc(centre, centre, 153, a + Math.PI, a + Math.PI + .7); ctx.stroke();
    } else if (listening || state === 'speaking') {
      ctx.strokeStyle = listening ? '#75ffe2a0' : '#95b0ff80'; ctx.lineWidth = 1.5;
      const r = reduced.matches ? 146 : 144 + (listening ? (Math.sin(t * 3) + 1) * 4 : envelope * 9);
      ctx.beginPath(); ctx.arc(centre, centre, r, 0, Math.PI * 2); ctx.stroke();
    }
    frame = requestAnimationFrame(paint);
  }
  frame = requestAnimationFrame(paint);
  const resume = () => { if (!stopped) { previous = 0; cancelAnimationFrame(frame); frame = requestAnimationFrame(paint); } };
  document.addEventListener('visibilitychange', resume); reduced.addEventListener('change', resume);
  return () => { stopped = true; cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', resume); reduced.removeEventListener('change', resume); };
}
