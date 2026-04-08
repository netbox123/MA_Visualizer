<template>
  <canvas ref="canvasRef" class="vis-canvas"></canvas>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  analyser: { type: Object, default: null },
  type:     { type: String,  default: 'radial' },
});

const canvasRef = ref(null);
let ctx = null, rafId = null;
let freqData = null, timeData = null;
let hue = 200, time = 0;

// ── Shared state per type ──────────────────────────────────────────────────────
// Radial
let lastBeat = 0;
const particles = [];

// iTunes
let itunesAngle = 0;

// Nebula
const nebParticles = [];

// Spectrum
// (stateless)

// ── Particle (radial type) ────────────────────────────────────────────────────
class Particle {
  constructor(x, y, angle, speed, h) {
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.hue = h;
    this.life = 1.0;
    this.decay = 0.018 + Math.random() * 0.018;
    this.size = 1.5 + Math.random() * 2.5;
  }
  tick() {
    this.x  += this.vx; this.y  += this.vy;
    this.vx *= 0.97;    this.vy *= 0.97;
    this.life -= this.decay;
  }
  draw(c) {
    const r = Math.max(0, this.size * this.life);
    if (r <= 0) return;
    c.save();
    c.globalAlpha = Math.max(0, this.life);
    c.fillStyle = `hsl(${this.hue}, 100%, 65%)`;
    c.beginPath();
    c.arc(this.x, this.y, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function avg(arr, s, e) {
  let sum = 0;
  for (let i = s; i < e; i++) sum += arr[i];
  return sum / (e - s);
}

function resize() {
  if (!canvasRef.value) return;
  canvasRef.value.width  = window.innerWidth;
  canvasRef.value.height = window.innerHeight;
}

// ── Audio data helper ─────────────────────────────────────────────────────────
function pullAudio() {
  let bass = 0, mid = 0, high = 0, hasSignal = false;
  if (props.analyser) {
    const bins = props.analyser.frequencyBinCount;
    if (!freqData || freqData.length !== bins) {
      freqData = new Uint8Array(bins);
      timeData = new Uint8Array(bins);
    }
    props.analyser.getByteFrequencyData(freqData);
    props.analyser.getByteTimeDomainData(timeData);
    bass = avg(freqData, 0, 5)    / 255;
    mid  = avg(freqData, 5, 50)   / 255;
    high = avg(freqData, 50, 120) / 255;
    hasSignal = (bass + mid + high) > 0.01;
  }
  if (!hasSignal && props.analyser) {
    bass = (Math.sin(time * 0.018) * 0.5 + 0.5) * 0.04;
    mid  = 0;
  } else if (!props.analyser) {
    bass = (Math.sin(time * 0.018) * 0.5 + 0.5) * 0.12;
    mid  = (Math.sin(time * 0.025 + 1.5) * 0.5 + 0.5) * 0.08;
  }
  return { bass, mid, high };
}

// ── Draw: Radial ──────────────────────────────────────────────────────────────
function drawRadial(W, H) {
  const cx = W / 2, cy = H / 2, R = Math.min(W, H);
  const { bass, mid, high } = pullAudio();

  ctx.fillStyle = `rgba(0,0,0,${0.10 + bass * 0.06})`;
  ctx.fillRect(0, 0, W, H);
  hue = (hue + 0.2 + bass * 1.0) % 360;

  // Background bloom
  const br = Math.max(1, R * (0.22 + bass * 0.14));
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, br);
  bg.addColorStop(0, `hsla(${hue}, 85%, 18%, ${0.18 + bass * 0.25})`);
  bg.addColorStop(1, 'transparent');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  const BARS  = 128, minR = R * 0.09, maxBH = R * 0.36;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';

  // Outer bars
  for (let i = 0; i < BARS; i++) {
    const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
    const val   = freqData ? freqData[i] / 255 : 0;
    const bh    = val * maxBH;
    if (bh < 0.8) continue;
    const bHue = (hue + i * 2.8) % 360;
    ctx.strokeStyle = `hsl(${bHue}, 88%, ${38 + val * 28}%)`;
    ctx.lineWidth   = Math.max(1.2, (W / BARS) * 0.52);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * minR,        cy + Math.sin(angle) * minR);
    ctx.lineTo(cx + Math.cos(angle) * (minR + bh), cy + Math.sin(angle) * (minR + bh));
    ctx.stroke();
  }

  // Inner reflected bars
  const IBARS = 64, maxIH = minR * 0.72;
  for (let i = 0; i < IBARS; i++) {
    const angle = (i / IBARS) * Math.PI * 2 - Math.PI / 2;
    const val   = freqData ? freqData[i * 2] / 255 : 0;
    const bh    = val * maxIH;
    if (bh < 0.5) continue;
    const bHue = (hue + 180 + i * 2.8) % 360;
    ctx.strokeStyle = `hsl(${bHue}, 80%, ${30 + val * 20}%)`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * minR,        cy + Math.sin(angle) * minR);
    ctx.lineTo(cx + Math.cos(angle) * (minR - bh), cy + Math.sin(angle) * (minR - bh));
    ctx.stroke();
  }
  ctx.restore();

  // Circular waveform
  if (timeData) {
    const wR = minR + maxBH * 0.36;
    ctx.beginPath();
    ctx.strokeStyle = `hsla(${(hue + 140) % 360}, 80%, 72%, 0.5)`;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < timeData.length; i++) {
      const angle = (i / timeData.length) * Math.PI * 2 - Math.PI / 2;
      const wv = (timeData[i] - 128) / 128;
      const r  = wR + wv * R * 0.045;
      const x  = cx + Math.cos(angle) * r, y = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.stroke();
  }

  // Center glow
  const cr = Math.max(1, R * (0.013 + bass * 0.028));
  const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 5);
  cg.addColorStop(0,    `hsla(${hue}, 100%, 92%, ${0.55 + bass * 0.35})`);
  cg.addColorStop(0.35, `hsla(${hue}, 100%, 62%, ${0.20 + bass * 0.20})`);
  cg.addColorStop(1,    'transparent');
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.arc(cx, cy, cr * 5, 0, Math.PI * 2); ctx.fill();

  // Beat particles
  const now = Date.now();
  if (bass > 0.60 && now - lastBeat > 160) {
    lastBeat = now;
    const count = Math.floor(6 + bass * 14);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5 + bass * 5;
      const ph = (hue + (Math.random() * 70 - 35) + 360) % 360;
      particles.push(new Particle(cx, cy, angle, speed, ph));
    }
  }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].tick(); particles[i].draw(ctx);
    if (particles[i].life <= 0) particles.splice(i, 1);
  }
  ctx.restore();

  // High-freq ring
  if (freqData && high > 0.05) {
    const HBARS = 64, hMinR = minR + maxBH * 0.55, hMaxH = R * 0.06;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (let i = 0; i < HBARS; i++) {
      const angle = (i / HBARS) * Math.PI * 2 - Math.PI / 2;
      const val   = freqData[64 + i] / 255;
      const bh    = val * hMaxH;
      if (bh < 0.3) continue;
      const bHue = (hue + 60 + i * 2.8) % 360;
      ctx.strokeStyle = `hsl(${bHue}, 90%, ${40 + val * 25}%)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * hMinR,        cy + Math.sin(angle) * hMinR);
      ctx.lineTo(cx + Math.cos(angle) * (hMinR + bh), cy + Math.sin(angle) * (hMinR + bh));
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ── Draw: iTunes ──────────────────────────────────────────────────────────────
// Flowing kaleidoscope tendrils — classic iTunes feel
function drawItunes(W, H) {
  const cx = W / 2, cy = H / 2, R = Math.min(W, H);
  const { bass, mid } = pullAudio();

  // Very slow fade — long trails
  ctx.fillStyle = `rgba(0,0,0,${0.04 + bass * 0.04})`;
  ctx.fillRect(0, 0, W, H);
  hue = (hue + 0.15 + bass * 0.8) % 360;

  // Slowly rotate the whole pattern
  itunesAngle += 0.003 + bass * 0.012;

  const SYMMETRY = 8;
  const len = timeData ? timeData.length : 256;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (let s = 0; s < SYMMETRY; s++) {
    const baseAngle = (s / SYMMETRY) * Math.PI * 2 + itunesAngle;
    const mirror    = s % 2 === 1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(baseAngle);
    if (mirror) ctx.scale(1, -1);

    ctx.beginPath();
    const pts = timeData ? timeData.length : 256;
    for (let i = 0; i < pts; i++) {
      const t   = i / pts;
      const wv  = timeData ? (timeData[i] - 128) / 128 : Math.sin(t * Math.PI * 4 + time * 0.05) * 0.3;
      const freq = freqData ? freqData[Math.floor(t * 80)] / 255 : 0.3;

      // Map to a tendril shape: x goes outward, y is the waveform deviation
      const x = t * R * (0.35 + bass * 0.15 + mid * 0.1);
      const y = wv * R * (0.04 + freq * 0.08 + bass * 0.06);

      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }

    const sHue = (hue + s * (360 / SYMMETRY)) % 360;
    const alpha = 0.25 + bass * 0.4 + mid * 0.2;
    ctx.strokeStyle = `hsla(${sHue}, 100%, 65%, ${alpha})`;
    ctx.lineWidth   = 1.0 + bass * 2.0;
    ctx.lineCap     = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // Center bloom
  const cr = Math.max(1, R * (0.015 + bass * 0.04));
  const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 6);
  cg.addColorStop(0,   `hsla(${hue}, 100%, 95%, ${0.5 + bass * 0.4})`);
  cg.addColorStop(0.4, `hsla(${hue}, 100%, 55%, ${0.12 + bass * 0.15})`);
  cg.addColorStop(1,   'transparent');
  ctx.fillStyle = cg;
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath(); ctx.arc(cx, cy, cr * 6, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

// ── Draw: Spectrum ────────────────────────────────────────────────────────────
function drawSpectrum(W, H) {
  const { bass, mid, high } = pullAudio();

  ctx.fillStyle = `rgba(0,0,0,${0.12 + bass * 0.06})`;
  ctx.fillRect(0, 0, W, H);
  hue = (hue + 0.3 + bass * 1.2) % 360;

  if (!freqData) return;

  const BARS    = 128;
  const barW    = W / BARS;
  const maxH    = H * 0.75;
  const baseY   = H * 0.85;

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, `hsla(${hue}, 80%, 8%, 0.6)`);
  bg.addColorStop(1, 'transparent');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < BARS; i++) {
    const val  = freqData[i] / 255;
    const barH = val * maxH;
    if (barH < 1) continue;

    const x    = i * barW;
    const bHue = (hue + (i / BARS) * 120) % 360;
    const lit  = 35 + val * 30;

    // Bar
    const grad = ctx.createLinearGradient(0, baseY - barH, 0, baseY);
    grad.addColorStop(0, `hsla(${bHue}, 90%, ${lit + 20}%, 0.9)`);
    grad.addColorStop(1, `hsla(${bHue}, 90%, ${lit}%, 0.4)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x + 1, baseY - barH, barW - 2, barH);

    // Reflection
    const reflGrad = ctx.createLinearGradient(0, baseY, 0, baseY + barH * 0.4);
    reflGrad.addColorStop(0, `hsla(${bHue}, 90%, ${lit}%, 0.2)`);
    reflGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = reflGrad;
    ctx.fillRect(x + 1, baseY, barW - 2, barH * 0.4);
  }
  ctx.restore();

  // Center glow
  const cx = W / 2;
  const pg = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, W * 0.4);
  pg.addColorStop(0, `hsla(${hue}, 100%, 60%, ${0.08 + bass * 0.12})`);
  pg.addColorStop(1, 'transparent');
  ctx.fillStyle = pg; ctx.fillRect(0, 0, W, H);
}

// ── Draw: Oscilloscope ────────────────────────────────────────────────────────
function drawOscilloscope(W, H) {
  const { bass } = pullAudio();

  ctx.fillStyle = `rgba(0,0,0,${0.15 + bass * 0.05})`;
  ctx.fillRect(0, 0, W, H);
  hue = (hue + 0.4 + bass * 1.5) % 360;

  if (!timeData) return;

  const cy = H / 2;

  // Grid lines
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, cy - (cy * 0.5 * i)); ctx.lineTo(W, cy - (cy * 0.5 * i)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, cy + (cy * 0.5 * i)); ctx.lineTo(W, cy + (cy * 0.5 * i)); ctx.stroke();
  }
  for (let i = 1; i < 8; i++) {
    ctx.beginPath(); ctx.moveTo((W / 8) * i, 0); ctx.lineTo((W / 8) * i, H); ctx.stroke();
  }
  ctx.restore();

  // Draw 3 waveform layers (slight offset/color shift for depth)
  for (let layer = 2; layer >= 0; layer--) {
    const lHue   = (hue + layer * 30) % 360;
    const alpha  = 0.15 + (2 - layer) * 0.3 + bass * 0.2;
    const yScale = H * (0.25 + bass * 0.15) * (1 + layer * 0.15);

    ctx.beginPath();
    ctx.strokeStyle = `hsla(${lHue}, 100%, 65%, ${alpha})`;
    ctx.lineWidth   = layer === 0 ? 1.5 + bass * 1.5 : 0.8;
    ctx.lineJoin    = 'round';

    for (let i = 0; i < timeData.length; i++) {
      const x  = (i / timeData.length) * W;
      const wv = (timeData[i] - 128) / 128;
      const y  = cy + wv * yScale;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Glow at zero-cross
  const midGrad = ctx.createLinearGradient(0, cy - 2, 0, cy + 2);
  midGrad.addColorStop(0, 'transparent');
  midGrad.addColorStop(0.5, `hsla(${hue}, 100%, 70%, ${0.06 + bass * 0.08})`);
  midGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = midGrad; ctx.fillRect(0, 0, W, H);
}

// ── Draw: Nebula ──────────────────────────────────────────────────────────────
function drawNebula(W, H) {
  const cx = W / 2, cy = H / 2, R = Math.min(W, H);
  const { bass, mid, high } = pullAudio();

  ctx.fillStyle = `rgba(0,0,0,${0.06 + bass * 0.03})`;
  ctx.fillRect(0, 0, W, H);
  hue = (hue + 0.1 + bass * 0.6) % 360;

  // Spawn particles on beats and continuously
  const spawnRate = 2 + Math.floor(bass * 8) + Math.floor(mid * 4);
  for (let i = 0; i < spawnRate; i++) {
    if (nebParticles.length > 600) break;
    const angle = Math.random() * Math.PI * 2;
    const dist  = Math.random() * R * (0.08 + mid * 0.12);
    const speed = 0.3 + Math.random() * 1.2 + bass * 2.5;
    const ph    = (hue + Math.random() * 120 - 60 + 360) % 360;
    nebParticles.push({
      x: cx + Math.cos(angle) * dist,
      y: cy + Math.sin(angle) * dist,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      hue: ph,
      life: 1.0,
      decay: 0.008 + Math.random() * 0.012,
      size: 1.5 + Math.random() * 3.5 + bass * 3,
    });
  }

  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = nebParticles.length - 1; i >= 0; i--) {
    const p = nebParticles[i];
    p.x    += p.vx; p.y += p.vy;
    p.vx   *= 0.995; p.vy *= 0.995;
    p.life -= p.decay;
    if (p.life <= 0) { nebParticles.splice(i, 1); continue; }

    const r = Math.max(0, p.size * p.life);
    if (r <= 0) continue;
    const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
    pg.addColorStop(0, `hsla(${p.hue}, 100%, 75%, ${p.life * 0.8})`);
    pg.addColorStop(1, 'transparent');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2); ctx.fill();
  }

  // Core glow
  const cr = Math.max(1, R * (0.04 + bass * 0.08 + high * 0.04));
  const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
  cg.addColorStop(0,   `hsla(${hue}, 100%, 95%, ${0.6 + bass * 0.3})`);
  cg.addColorStop(0.5, `hsla(${(hue + 60) % 360}, 100%, 55%, ${0.15 + bass * 0.2})`);
  cg.addColorStop(1,   'transparent');
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ── Main draw loop ────────────────────────────────────────────────────────────
function draw() {
  rafId = requestAnimationFrame(draw);
  time++;
  const W = canvasRef.value.width, H = canvasRef.value.height;

  switch (props.type) {
    case 'itunes':       drawItunes(W, H); break;
    case 'spectrum':     drawSpectrum(W, H); break;
    case 'oscilloscope': drawOscilloscope(W, H); break;
    case 'nebula':       drawNebula(W, H); break;
    default:             drawRadial(W, H); break;
  }
}

onMounted(() => {
  ctx = canvasRef.value.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  draw();
});

onUnmounted(() => {
  cancelAnimationFrame(rafId);
  window.removeEventListener('resize', resize);
});
</script>

<style scoped>
.vis-canvas {
  position: fixed;
  inset: 0;
  display: block;
  background: #000;
}
</style>
