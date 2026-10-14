// Shared renderer and appearance contract; used by React and the mobile host.
(function(root){
  const defaults=Object.freeze({style:'flow',primary:'#54ddff',secondary:'#b87aff',glow:1,size:1,movement:1});
  const styles=Object.freeze([{id:'flow',name:'Flowing sphere',description:'Soft parallel bands, a calm round silhouette.'},{id:'ribbons',name:'Light ribbons',description:'Vivid crossing ribbons with stronger motion.'}]);
  function normalize(value){const v=value||{};const color=(x,fallback)=>typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x)?x:fallback;const bound=(x,min,max,fallback)=>Number.isFinite(x)?Math.max(min,Math.min(max,x)):fallback;return {style:styles.some(s=>s.id===v.style)?v.style:defaults.style,primary:color(v.primary,defaults.primary),secondary:color(v.secondary,defaults.secondary),glow:bound(v.glow,0,2,1),size:bound(v.size,.7,1.3,1),movement:bound(v.movement,0,2,1)};}
function mount(canvas, isVisible, mode, audioLevel = () => 0, preferences = () => defaults) {
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
    const config = normalize(preferences());
    const t = elapsedTime / 1000 * config.movement, state = mode();
    const rgb = hex => hex.match(/\w\w/g).map(v=>parseInt(v,16)).join(',');
    const primary = rgb(config.primary.slice(1)), secondary = rgb(config.secondary.slice(1));
    const level = state === 'speaking' ? Math.max(0, Math.min(1, audioLevel())) : 0;
    envelope += (level - envelope) * (1 - Math.exp(-dt / (level > envelope ? 65 : 200)));
    const radius = 119 + (reduced.matches ? 0 : Math.sin(t * 1.4) * 2.4 + envelope * 14);
    const rotation = reduced.matches ? 0 : t * (state === 'thinking' ? .24 : .085);
    const listening = state === 'listening';
    ctx.clearRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
    const aura = ctx.createRadialGradient(centre, centre, 45, centre, centre, 177);
    aura.addColorStop(0, `rgba(${listening?'33,204,189':secondary},${.15*config.glow})`);
    aura.addColorStop(.65, `rgba(${listening?'40,234,213':secondary},${.15*config.glow})`);
    aura.addColorStop(1, '#00000000');
    ctx.fillStyle = aura; ctx.fillRect(0, 0, size, size);
    const body = ctx.createRadialGradient(155, 142, 8, centre, centre, radius);
    body.addColorStop(0, '#32387035'); body.addColorStop(.72, '#17204424'); body.addColorStop(1, '#0b112100');
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(centre, centre, radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    // Each ribbon is a bundle of continuous curves, not a dotted globe.
    // Draw the rear half first to retain depth across the luminous front.
    for (const front of [false, true]) {
      for (let ribbon = 0; ribbon < (config.style==='flow'?9:6); ribbon++) {
        const colour = listening ? (ribbon % 2 ? '95,255,210' : '63,232,255')
          : ribbon % 2 ? primary : secondary;
        for (let strand = -2; strand <= 2; strand++) {
          ctx.beginPath(); let joined = false;
          for (let step = 0; step <= 150; step++) {
            const a = step / 150 * Math.PI * 2;
            const latitude = config.style==='flow'
              ? (ribbon-4)*.17 + Math.sin(a*2+t*.3)*.095 + strand*.018
              : Math.sin(a * 2 + ribbon * .83 + t * .3) * .57 + (ribbon - 2.5) * .10 + strand * .022;
            const longitude = a + ribbon * .63;
            const p = project(Math.cos(longitude) * Math.cos(latitude), Math.sin(latitude), Math.sin(longitude) * Math.cos(latitude), rotation, radius);
            if ((p.depth >= 0) !== front) { joined = false; continue; }
            if (!joined) { ctx.moveTo(p.x, p.y); joined = true; } else ctx.lineTo(p.x, p.y);
          }
          ctx.strokeStyle = `rgba(${colour},${front ? (strand === 0 ? .84 : .32) : .10})`;
          ctx.lineWidth = strand === 0 ? (front ? 1.6 : .8) : .7;
          ctx.shadowColor = `rgba(${colour},.65)`; ctx.shadowBlur = front && strand === 0 ? 9*config.glow : 0; ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      for (const p of dust) {
        const v = project(p.x, p.y, p.z, rotation, radius * 1.015);
        if ((v.depth >= 0) !== front) continue;
        const twinkle = .5 + .5 * Math.sin(p.phase + t * 1.8);
        ctx.fillStyle = `rgba(${listening ? '117,255,227' : p.y > 0 ? primary : secondary},${front ? .25 + twinkle * .5 : .08})`;
        ctx.beginPath(); ctx.arc(v.x, v.y, front ? .6 + twinkle * .5 : .5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
    // Orbital particles and state rings distinguish real recognition from work.
    for (let i = 0; i < 30; i++) {
      const a = i * 2.399 + t * .06, r = 133 + i % 7 * 3;
      ctx.fillStyle = `rgba(${i%2?secondary:primary},.55)`;
      ctx.beginPath(); ctx.arc(centre + Math.cos(a) * r, centre + Math.sin(a) * r, i % 6 === 0 ? 1.4 : .7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (['thinking', 'preparing', 'connecting'].includes(state)) {
      const a = reduced.matches ? -.8 : t * 1.9;
      ctx.lineWidth = 2; ctx.strokeStyle = `rgba(${secondary},.9)`;
      ctx.beginPath(); ctx.arc(centre, centre, 153, a, a + 1.4); ctx.stroke();
      ctx.strokeStyle = `rgba(${primary},.9)`; ctx.beginPath(); ctx.arc(centre, centre, 153, a + Math.PI, a + Math.PI + .7); ctx.stroke();
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

root.DevOrb={mount,normalize,defaults,styles};
})(globalThis);
