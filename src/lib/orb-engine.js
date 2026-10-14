// Shared renderer and appearance contract; used by React and the mobile host.
(function(root){
  const defaults=Object.freeze({style:'flow',primary:'#54ddff',secondary:'#b87aff',glow:1,size:1,movement:1});
  const styles=Object.freeze([{id:'flow',name:'Flowing sphere',description:'Soft parallel bands, a calm round silhouette.'},{id:'ribbons',name:'Light ribbons',description:'Vivid crossing ribbons with stronger motion.'},{id:'particles',name:'Particle surface',description:'Fine luminous dots with state colors, inspired by Ship Notes.'}]);
  function normalize(value){const v=value||{};const color=(x,fallback)=>typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x)?x:fallback;const bound=(x,min,max,fallback)=>Number.isFinite(x)?Math.max(min,Math.min(max,x)):fallback;return {style:styles.some(s=>s.id===v.style)?v.style:defaults.style,primary:color(v.primary,defaults.primary),secondary:color(v.secondary,defaults.secondary),glow:bound(v.glow,0,2,1),size:bound(v.size,.7,1.3,1),movement:bound(v.movement,0,2,1)};}
// Particle surface adapted from Voice Orb / Ship Notes (MIT).
// https://aqualang89.github.io/shipnotes-components/components/voice-orb/demo.html
/*
MIT License

Copyright (c) 2026 Ship Notes

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


*/
function createParticleSurface(size) {
  const surface = document.createElement('canvas');
  surface.width = surface.height = size;
  const vertex = `
  precision highp float;
  attribute vec4 seed;
  uniform float time, pixels, density, onset, reduced;
  uniform vec4 weights;
  uniform vec3 bands;
  uniform vec3 primary, secondary;
  uniform float customPalette;
  varying vec3 tint;
  varying float strength, spark;
  float hash(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
  float noise(vec3 p) {
    vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    float a=mix(hash(i),hash(i+vec3(1,0,0)),f.x);
    float b=mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x);
    float c=mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x);
    float d=mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x);
    return mix(mix(a,b,f.y),mix(c,d,f.y),f.z)*2.0-1.0;
  }
  vec3 turn(vec3 p,float a) { float c=cos(a),s=sin(a);return vec3(c*p.x+s*p.z,p.y,c*p.z-s*p.x); }
  void main() {
    float t=time;
    vec3 n=seed.xyz;
    float angle=acos(clamp(n.z,-1.0,1.0));
    float drift=noise(n*2.7+vec3(t*.19,-t*.11,t*.08));
    float bass=noise(n*1.8+vec3(t*.32,0,-t*.2));
    float grain=noise(n*17.0+vec3(-t*1.8,t*.7,t));
    float low=bands.x, mid=bands.y, high=bands.z;
    float idleR=1.0+.018*drift+.008*sin(t*.85);
    float inward=sin(angle*13.0+t*5.4+drift*1.6);
    float outward=sin(angle*12.0-t*6.2+drift*1.6);
    float listenR=1.0-.045*low+.10*low*bass+(.018+.12*mid)*inward+.032*high*grain;
    float speakR=1.0+.065*low+.16*low*bass+(.018+.16*mid)*outward+.055*high*grain;
    // The transient is supplied separately from sustained bass. No frame history in this shader.
    speakR+=onset*(.08+.18*max(0.0,outward))*(.4+.6*seed.w);
    float twist=t*.55+n.y*1.45+drift*.12;
    vec3 thought=turn(n,twist)*(1.0+.035*drift);
    thought.y*=.92;
    vec3 pos=turn(n,t*.11)*idleR*weights.x;
    pos+=turn(n,t*.16)*listenR*weights.y;
    pos+=thought*weights.z;
    pos+=turn(n,t*.20)*speakR*weights.w;
    float active=weights.y+weights.w;
    float rim=pow(max(0.0,1.0-abs(n.z)),2.2);
    float pop=pow(max(0.0,sin(t*8.0+seed.w*149.0)),18.0)*step(.90,seed.w);
    pos*=1.0+active*high*pop*.17;
    // Three narrow belts stay on the sphere, with bright heads moving along them.
    vec3 q=turn(n,t*.33);
    float b1=exp(-pow((dot(q,normalize(vec3(.24,.83,.50)))-.13)*23.0,2.0));
    float b2=exp(-pow((dot(q,normalize(vec3(-.71,.48,.39)))+.16)*23.0,2.0));
    float b3=exp(-pow((dot(q,normalize(vec3(.69,.58,-.41)))-.06)*23.0,2.0));
    float belts=min(1.5,b1+b2+b3)*(.6+.4*sin(atan(n.y,n.x)*2.0-t*2.3));
    float flow=pow(.5+.5*sin(angle*13.0+(weights.y-weights.w)*t*5.8+drift*2.0),7.0);
    float depth=clamp((pos.z+1.35)/2.7,0.0,1.0);
    float perspective=3.8/(3.8-pos.z*.60);
    gl_Position=vec4(pos.xy*perspective*.61,0,1);
    float point=(2.0+1.8*depth+.85*rim)*density;
    point+=active*high*pop*1.8;
    gl_PointSize=max(1.8,point*pixels/720.0);
    float cool=.5+.5*sin(n.y*2.1+n.x*1.6+drift*.65);
    vec3 ci=mix(vec3(.42,.49,.77),vec3(.80,.69,.98),cool);
    vec3 cl=mix(vec3(.07,.54,.68),vec3(.43,1.0,.67),cool);
    vec3 ct=mix(vec3(.71,.25,.06),vec3(1.0,.79,.38),cool);
    vec3 cs=mix(vec3(.36,.22,1.0),vec3(1.0,.45,.63),cool);
    tint=ci*weights.x+cl*weights.y+ct*weights.z+cs*weights.w;
    tint=mix(tint,mix(secondary,primary,cool),customPalette);
    strength=(.22+.45*depth+.70*rim)*(.65+.35*seed.w);
    strength+=active*(mid*flow*.95+onset*rim*.9)+weights.z*belts*2.0;
    strength*=mix(1.0,.78,weights.z);
    spark=active*(high*pop*.8+onset*rim*.22)+weights.z*belts*.13;
  }`;
  const fragment = `
  precision mediump float;
  uniform float glow;
  varying vec3 tint;
  varying float strength, spark;
  void main() {
    float r=length(gl_PointCoord-.5)*2.0;
    if(r>1.0)discard;
    float core=1.0-smoothstep(.18,.64,r);
    float halo=exp(-r*r*4.0)*.24*(1.0-smoothstep(.75,1.0,r));
    float a=(core+halo)*strength;
    vec3 color=tint*a+vec3(1.0,.92,.86)*spark*core;
    gl_FragColor=vec4(color*(.7+.3*glow),min(1.0,a+spark*core));
  }`;
  const palette = [[.62,.60,.87], [.16,.91,.71], [1,.57,.18], [.96,.27,.62]];
  const count = matchMedia('(pointer: coarse)').matches ? 6000 : 12000;
  const points = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const y = 1 - 2 * (i + .5) / count, r = Math.sqrt(1 - y * y), a = i * 2.399963229728653;
    points.set([r * Math.cos(a), y, r * Math.sin(a), (Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1 + .5], i * 4);
    points[i * 4 + 3] = Math.abs(points[i * 4 + 3] % 1);
  }
  let gl, program, buffer, uniforms, lost = false;
  const shaders = [];
  function release() {
    if (!gl) return;
    for (const shader of shaders.splice(0)) gl.deleteShader(shader);
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    buffer = program = null;
  }
  function setup() {
    try {
      gl = surface.getContext('webgl', {alpha:true, premultipliedAlpha:true, antialias:false});
      if (!gl) return;
      release();
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type); shaders.push(shader);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      }
      program = gl.createProgram();
      for (const shader of shaders) gl.attachShader(program, shader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      for (const shader of shaders.splice(0)) gl.deleteShader(shader);
      gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, points, gl.STATIC_DRAW);
      const attr = gl.getAttribLocation(program, 'seed');
      gl.enableVertexAttribArray(attr); gl.vertexAttribPointer(attr, 4, gl.FLOAT, false, 0, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.disable(gl.DEPTH_TEST);
      uniforms = Object.fromEntries(['time','pixels','density','weights','bands','onset','glow','primary','secondary','customPalette'].map(n=>[n,gl.getUniformLocation(program,n)]));
    } catch { release(); gl = null; }
  }
  setup();
  const lostHandler = event => { event.preventDefault(); lost = true; };
  const restoreHandler = () => { lost = false; setup(); };
  surface.addEventListener('webglcontextlost', lostHandler);
  surface.addEventListener('webglcontextrestored', restoreHandler);
  let weights = [1,0,0,0], onset = 0, previousLevel = 0;
  function draw(ctx, t, state, level, config, dt) {
    const index = state === 'listening' ? 1 : ['thinking','preparing','connecting'].includes(state) ? 2 : state === 'speaking' ? 3 : 0;
    const blend = 1 - Math.exp(-dt / 240);
    weights = weights.map((w,i)=>w+((i===index?1:0)-w)*blend);
    onset = Math.max(Math.min(1, Math.max(0,level-previousLevel)*5), onset*Math.exp(-dt/180));
    previousLevel = level;
    const bands = [level,level*.7,level*.3];
    const custom = config.primary !== '#54ddff' || config.secondary !== '#b87aff';
    const rgb = hex => hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255);
    if (gl && !lost) {
      gl.viewport(0,0,size,size); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform1f(uniforms.time,t); gl.uniform1f(uniforms.pixels,size);
      gl.uniform1f(uniforms.density,Math.pow(12000/count,.32));
      gl.uniform4fv(uniforms.weights,weights); gl.uniform3fv(uniforms.bands,bands);
      gl.uniform1f(uniforms.onset,onset); gl.uniform1f(uniforms.glow,config.glow);
      gl.uniform1f(uniforms.customPalette,custom?1:0);
      gl.uniform3fv(uniforms.primary,rgb(config.primary)); gl.uniform3fv(uniforms.secondary,rgb(config.secondary));
      gl.drawArrays(gl.POINTS,0,count);
      ctx.drawImage(surface,0,0,360,360);
    } else {
      // Keep the same particle silhouette when WebGL is unavailable or lost.
      const color = custom ? rgb(config.primary) : [0,1,2].map(c=>palette.reduce((sum,p,i)=>sum+p[c]*weights[i],0));
      ctx.fillStyle = `rgb(${color.map(c=>Math.round(c*255)).join(',')})`;
      ctx.globalCompositeOperation = 'lighter';
      for (let i=0;i<count;i+=4) {
        const x=points[i*4], y=points[i*4+1], z=points[i*4+2];
        const a=t*(.11*weights[0]+.16*weights[1]+.55*weights[2]+.2*weights[3])+y*1.45*weights[2];
        const c=Math.cos(a), s=Math.sin(a), depth=z*c-x*s;
        const wave=Math.sin(Math.acos(z)*13+(weights[1]-weights[3])*t*5.8);
        const r=1+.015*Math.sin(y*3+t*.3)+level*wave*.13+weights[3]*onset*.08;
        const perspective=3.8/(3.8-depth*.6), rim=Math.pow(1-Math.abs(z),2);
        ctx.globalAlpha=Math.min(1,(.2+.24*(depth+1)+rim*.3)*(.7+config.glow*.3));
        ctx.beginPath();ctx.arc(180+(x*c+z*s)*r*perspective*110,180-y*r*perspective*110,.45+rim*.3,0,Math.PI*2);ctx.fill();
      }
      ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
    }
  }
  return {draw, dispose() { surface.removeEventListener('webglcontextlost',lostHandler);surface.removeEventListener('webglcontextrestored',restoreHandler);release();gl?.getExtension('WEBGL_lose_context')?.loseContext(); }};
}

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
  let frame = 0, previous = 0, elapsedTime = 0, envelope = 0, stopped = false, particles = null;
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
    const level = state === 'speaking' || state === 'listening' ? Math.max(0, Math.min(1, audioLevel())) : 0;
    envelope += (level - envelope) * (1 - Math.exp(-dt / (level > envelope ? 65 : 200)));
    const radius = 119 + (reduced.matches ? 0 : Math.sin(t * 1.4) * 2.4 + envelope * 14);
    const rotation = reduced.matches ? 0 : t * (state === 'thinking' ? .24 : .085);
    const listening = state === 'listening';
    ctx.clearRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
    if (config.style === 'particles') {
      particles ||= createParticleSurface(size * ratio);
      particles.draw(ctx, t, state, reduced.matches ? 0 : envelope, config, reduced.matches ? 10000 : dt);
      frame = requestAnimationFrame(paint); return;
    }
    if (particles) { particles.dispose(); particles = null; }
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
      const r = reduced.matches ? 146 : 144 + envelope * 9;
      ctx.beginPath(); ctx.arc(centre, centre, r, 0, Math.PI * 2); ctx.stroke();
    }
    frame = requestAnimationFrame(paint);
  }
  frame = requestAnimationFrame(paint);
  const resume = () => { if (!stopped) { previous = 0; cancelAnimationFrame(frame); frame = requestAnimationFrame(paint); } };
  document.addEventListener('visibilitychange', resume); reduced.addEventListener('change', resume);
  return () => { stopped = true; cancelAnimationFrame(frame); particles?.dispose(); document.removeEventListener('visibilitychange', resume); reduced.removeEventListener('change', resume); };
}

root.DevOrb={mount,normalize,defaults,styles};
})(globalThis);
