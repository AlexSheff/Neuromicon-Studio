import { AudioFrameMetrics, GeneratorEffectId } from '../types/studio';

export interface ProceduralRenderOptions {
  effect: Exclude<GeneratorEffectId, 'none'>;
  width: number;
  height: number;
  time: number;
  metrics: AudioFrameMetrics;
  accentHex: string;
  secondaryHex: string;
  speed: number;
  scale: number;
  beatReact: number;
  complexity?: number;
  warp?: number;
  symmetry?: number;
  rotationSpeed?: number;
  hueShiftDeg?: number;
  glow?: number;
}

const VERTEX_SHADER_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Unified high-craft procedural GLSL shader supporting Fractals, Deep Space Nebula, Spiral Galaxy, Cosmic Particle Warp, and Custom GLSL
const buildFragmentShaderSource = (customHelper: string) => `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform int uMode; // 1..11
uniform vec2 uRes;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uBeat;
uniform float uScale;
uniform vec3 uAccent;
uniform vec3 uSecondary;
uniform float uComplexity;
uniform float uWarp;
uniform float uSymmetry;
uniform float uRotSpeed;
uniform float uHueShift;
uniform float uGlow;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += amp * noise2(p);
    p = rot * p * 2.02;
    amp *= 0.5;
  }
  return v;
}

vec2 rot2d(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

vec2 applySymmetry(vec2 uv, float folds) {
  if (folds <= 1.5) return uv;
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float sector = 6.283185307 / folds;
  a = mod(a, sector);
  a = abs(a - sector * 0.5);
  return vec2(cos(a), sin(a)) * r;
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-6;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 hueShiftColor(vec3 col, float rad) {
  float turns = fract(rad / 6.28318530718);
  if (turns < 0.0005 || turns > 0.9995) return col;
  vec3 safeCol = max(vec3(0.0), col);
  float maxC = max(1.0, max(safeCol.r, max(safeCol.g, safeCol.b)));
  vec3 hsv = rgb2hsv(safeCol / maxC);
  hsv.x = fract(hsv.x + turns);
  return hsv2rgb(hsv) * maxC;
}

vec3 renderJulia(vec2 uv) {
  vec2 z = uv * (1.55 / max(0.35, uScale));
  z = rot2d(z, uTime * 0.14);
  float angle = uTime * 0.32;
  vec2 c = vec2(
    -0.745 + 0.11 * cos(angle) + uBeat * 0.04,
    0.186 + 0.11 * sin(angle * 1.3) - uMid * 0.03
  );
  float minTrap = 100.0;
  float smoothIter = 0.0;
  float maxSteps = clamp(18.0 + uComplexity * 24.0, 16.0, 56.0);
  for (int i = 0; i < 56; i++) {
    if (float(i) >= maxSteps) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    float r2 = dot(z, z);
    minTrap = min(minTrap, abs(length(z) - 0.65));
    if (r2 > 16.0) break;
    smoothIter += 1.0;
  }
  float t = smoothIter / maxSteps;
  float glow = exp(-minTrap * (4.5 - uBeat * 1.5));
  vec3 deep = vec3(0.02, 0.025, 0.045);
  vec3 col = mix(deep, uAccent * 0.85, pow(t, 0.75));
  col += uSecondary * glow * (0.45 + uBeat * 0.85);
  col += uAccent * pow(t, 2.5) * (0.6 + uTreble * 0.7);
  return col;
}

vec3 renderKaleido(vec2 uv) {
  vec2 p = uv * (1.4 / max(0.4, uScale));
  vec3 col = vec3(0.015, 0.018, 0.03);
  vec2 p0 = p;
  int steps = int(clamp(2.0 + uComplexity * 2.0, 2.0, 5.0));
  for (int idx = 0; idx < 5; idx++) {
    if (idx >= steps) break;
    float i = float(idx);
    p = fract(p * (1.45 + uBeat * 0.08)) - 0.5;
    p = rot2d(p, uTime * 0.18 + i * 0.6);
    float d = length(p) * exp(-length(p0) * 0.9);
    d = sin(d * 9.0 - uTime * (1.8 + uBass * 1.2)) / 9.0;
    d = abs(d);
    d = pow(0.014 / max(0.002, d), 1.25);
    vec3 pal = mix(uAccent, uSecondary, 0.5 + 0.5 * sin(length(p0) * 2.5 + i + uTime * 0.5));
    col += pal * d * (0.28 + uBeat * 0.35);
  }
  return col;
}

vec3 renderMandelbrot(vec2 uv) {
  float cycle = fract(uTime * 0.06);
  float zoom = exp(mix(0.4, 5.2, 0.5 - 0.5 * cos(cycle * 6.2831853)));
  vec2 target = vec2(-0.743643887, 0.131825904);
  vec2 c = target + (uv / max(0.4, uScale)) / zoom;
  vec2 z = vec2(0.0);
  float iter = 0.0;
  float maxSteps = clamp(24.0 + uComplexity * 28.0, 20.0, 64.0);
  for (int i = 0; i < 64; i++) {
    if (float(i) >= maxSteps) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 256.0) break;
    iter += 1.0;
  }
  if (iter >= maxSteps - 0.5) {
    return vec3(0.01, 0.012, 0.024) + uAccent * uBeat * 0.08;
  }
  float smoothVal = iter - log2(max(1.0, log2(max(1.0, dot(z, z)))));
  float band = 0.5 + 0.5 * sin(smoothVal * 0.45 - uTime * 1.5 + uBass * 2.0);
  vec3 col = mix(vec3(0.02, 0.03, 0.06), uAccent, band);
  col = mix(col, uSecondary, pow(band, 3.0) * (0.55 + uTreble * 0.65));
  return col;
}

vec3 renderNebula(vec2 uv) {
  vec2 p = uv * (1.8 / max(0.4, uScale));
  float t = uTime * 0.09;
  vec2 q = vec2(fbm(p + vec2(t, t * 0.5)), fbm(p + vec2(5.2, 1.3 - t * 0.4)));
  vec2 r = vec2(
    fbm(p + 2.4 * q + vec2(1.7, 9.2) + 0.15 * t),
    fbm(p + 2.4 * q + vec2(8.3, 2.8) - 0.12 * t)
  );
  float f = fbm(p + 2.2 * r);

  vec3 spaceBg = vec3(0.012, 0.015, 0.028);
  vec3 nebA = uAccent * 0.82;
  vec3 nebB = mix(uSecondary, vec3(0.18, 0.32, 0.68), 0.55);
  vec3 col = mix(spaceBg, nebB, clamp(f * f * 2.1, 0.0, 1.0));
  col = mix(col, nebA, clamp(length(q) * (0.55 + uBeat * 0.45), 0.0, 0.9));
  col += uSecondary * pow(max(0.0, f), 3.4) * (0.55 + uBass * 0.7);

  for (float layer = 1.0; layer <= 3.0; layer += 1.0) {
    vec2 suv = uv * (14.0 * layer / max(0.5, uScale)) + vec2(uTime * 0.03 * layer, -uTime * 0.015 * layer);
    vec2 id = floor(suv);
    vec2 gv = fract(suv) - 0.5;
    float rnd = hash21(id + layer * 19.3);
    if (rnd > mix(0.89, 0.78, clamp(uComplexity * 0.5, 0.0, 1.0))) {
      vec2 offset = vec2(hash21(id * 2.1) - 0.5, hash21(id * 3.7) - 0.5) * 0.65;
      float d = length(gv - offset);
      float twinkle = 0.65 + 0.35 * sin(uTime * 3.5 + rnd * 40.0);
      float star = smoothstep(0.065, 0.0, d) * twinkle * (0.8 + uTreble * 0.9);
      col += mix(vec3(1.0), uSecondary, 0.4) * star;
    }
  }
  return col;
}

vec3 renderGalaxy(vec2 uv) {
  vec2 p = uv * (1.6 / max(0.4, uScale));
  float r = length(p);
  float spin = uTime * 0.28 - 1.9 * log(max(0.05, r));
  vec2 sp = rot2d(p, spin);

  float armCount = floor(clamp(1.5 + uComplexity * 1.5, 2.0, 5.0));
  float arms = cos(atan(sp.y, sp.x) * armCount + r * 3.5);
  float armMask = smoothstep(-0.3, 0.95, arms);
  float dust = fbm(sp * 3.2 + vec2(uTime * 0.12));

  float disk = exp(-r * (1.85 - uBeat * 0.35));
  float core = exp(-r * r * (14.0 - uBeat * 4.0));

  vec3 col = vec3(0.01, 0.012, 0.025);
  vec3 armCol = mix(uAccent, uSecondary, clamp(dust, 0.0, 1.0));
  col += armCol * disk * (0.35 + 0.9 * armMask * dust) * (0.9 + uBass * 0.65);
  col += mix(uSecondary, vec3(1.0, 0.96, 0.9), 0.6) * core * (1.1 + uBeat * 0.8);

  vec2 starGrid = sp * 22.0;
  vec2 sid = floor(starGrid);
  vec2 sgv = fract(starGrid) - 0.5;
  float sr = hash21(sid);
  if (sr > 0.78) {
    float sd = length(sgv - (vec2(hash21(sid + 3.1), hash21(sid + 7.4)) - 0.5) * 0.6);
    float sBright = smoothstep(0.075, 0.0, sd) * (0.35 + disk * 0.9) * (0.7 + uTreble * 0.9);
    col += mix(vec3(1.0), uSecondary, 0.35) * sBright;
  }
  return col;
}

vec3 renderAurora(vec2 uv) {
  vec2 p = uv / max(0.4, uScale);
  vec3 col = vec3(0.01, 0.014, 0.03);
  int bands = int(clamp(3.0 + uComplexity * 2.0, 3.0, 6.0));
  for (int i = 0; i < 6; i++) {
    if (i >= bands) break;
    float fi = float(i);
    float offset = sin(p.x * (1.8 + fi * 0.4) + uTime * (0.45 + fi * 0.12) + fbm(p * 1.4 + fi) * 1.5);
    float ribbon = exp(-abs(p.y * 1.6 - offset * 0.55 + (fi - 2.0) * 0.22) * (5.2 - uBeat * 1.6));
    float curtain = fbm(vec2(p.x * 3.5 + uTime * 0.2, p.y * 0.8 - uTime * 0.3 + fi));
    vec3 tint = mix(uAccent, uSecondary, fi / max(1.0, float(bands - 1)));
    col += tint * ribbon * (0.45 + curtain * 0.85) * (0.65 + uMid * 0.8);
  }
  // Crisp stars in deep sky
  vec2 sg = p * 26.0;
  vec2 sid = floor(sg);
  if (hash21(sid) > 0.93) {
    float d = length(fract(sg) - 0.5);
    col += vec3(0.95) * smoothstep(0.09, 0.0, d) * (0.4 + uTreble * 0.8);
  }
  return col;
}

vec3 renderBlackHole(vec2 uv) {
  vec2 p = uv / max(0.4, uScale);
  float r = length(p);
  float a = atan(p.y, p.x);

  // Gravitational lensing distortion around photon sphere
  float horizon = 0.26 - uBeat * 0.025;
  float ringDist = abs(r - horizon * 1.28);
  float photonRing = exp(-ringDist * (26.0 - uBeat * 8.0));

  vec2 diskUv = vec2(p.x, p.y * 2.45);
  float diskR = length(diskUv);
  float swirl = fbm(vec2(diskR * 6.0 - uTime * 0.9, a * 2.0 + uTime * 0.6));
  float diskBand = exp(-abs(diskR - 0.52) * (6.5 - uComplexity * 1.5)) * (0.4 + swirl * 1.2);
  float doppler = 0.72 + 0.38 * cos(a + 0.6);

  vec3 col = vec3(0.008, 0.01, 0.022);
  // Lensed background stars
  vec2 starUv = p / max(0.12, r - horizon * 0.6) * 6.0;
  vec2 sid = floor(starUv);
  if (hash21(sid) > 0.9) {
    float sd = length(fract(starUv) - 0.5);
    col += mix(vec3(0.85), uSecondary, 0.4) * smoothstep(0.1, 0.0, sd) * 0.7;
  }

  col += mix(uAccent, uSecondary, swirl) * diskBand * doppler * (1.1 + uBass * 0.8);
  col += mix(uSecondary, vec3(1.0, 0.95, 0.85), 0.5) * photonRing * (1.35 + uBeat * 0.9);
  float shadowMask = smoothstep(horizon * 0.95, horizon * 1.08, r);
  return col * shadowMask;
}

vec3 renderParticles(vec2 uv) {
  vec3 col = vec3(0.012, 0.015, 0.024);
  vec2 p = uv / max(0.4, uScale);
  float warpTime = uTime * 0.75;
  int layers = int(clamp(4.0 + uComplexity * 2.0, 4.0, 7.0));

  for (int idx = 0; idx < 7; idx++) {
    if (idx >= layers) break;
    float i = float(idx);
    float depth = fract(i / float(layers) + warpTime * 0.18);
    float scale = mix(18.0, 1.4, depth);
    float fade = smoothstep(0.0, 0.25, depth) * smoothstep(1.0, 0.78, depth);
    vec2 grid = rot2d(p * scale, depth * 0.35 + i * 0.4);
    vec2 id = floor(grid);
    vec2 gv = fract(grid) - 0.5;
    float rnd = hash21(id + i * 31.7);
    if (rnd > 0.66) {
      vec2 jitter = vec2(hash21(id * 1.7) - 0.5, hash21(id * 2.9) - 0.5) * 0.62;
      float d = length(gv - jitter);
      float size = (0.045 + 0.055 * rnd) * (1.0 + uBeat * 0.85);
      float glow = smoothstep(size, 0.0, d) * fade;
      vec3 pCol = mix(uAccent, uSecondary, fract(rnd * 13.7));
      col += pCol * glow * (0.75 + uTreble * 0.6);
    }
  }
  float centerGlow = exp(-length(uv) * 2.8) * (0.18 + uBass * 0.35);
  col += uAccent * centerGlow;
  return col;
}

vec3 renderCyberGrid(vec2 uv) {
  vec2 p = uv / max(0.4, uScale);
  vec3 col = vec3(0.018, 0.012, 0.036);
  float horizonY = 0.05;
  // Neon retro sun above horizon
  float sunD = length(p - vec2(0.0, 0.34));
  if (sunD < 0.42) {
    float stripes = step(0.0, sin((p.y - 0.04) * 48.0 - uTime * 2.0)) + step(0.16, p.y);
    vec3 sunCol = mix(uAccent, uSecondary, clamp((p.y - 0.05) * 2.2, 0.0, 1.0));
    col += sunCol * smoothstep(0.42, 0.38, sunD) * clamp(stripes, 0.15, 1.0) * (0.85 + uBeat * 0.45);
  }
  // Infinite perspective ground & ceiling grid
  float py = abs(p.y - horizonY);
  if (py > 0.02) {
    float z = 0.55 / py;
    vec2 gridUv = vec2(p.x * z, z + uTime * 2.4);
    float freq = clamp(2.5 + uComplexity * 2.5, 2.0, 7.0);
    vec2 g = abs(fract(gridUv * freq * 0.35) - 0.5);
    float line = smoothstep(0.075, 0.0, min(g.x, g.y));
    float distFade = exp(-py * 0.9);
    float horFade = smoothstep(0.02, 0.14, py);
    vec3 gridTint = p.y < horizonY ? uAccent : uSecondary;
    col += gridTint * line * horFade * (0.55 + uBass * 0.95) * (0.65 + 0.35 * distFade);
  }
  col += mix(uAccent, uSecondary, 0.5) * exp(-py * 18.0) * (0.7 + uBeat * 0.8);
  return col;
}

vec3 renderVoronoi(vec2 uv) {
  vec2 p = uv * (2.8 / max(0.4, uScale)) * (0.7 + uComplexity * 0.4);
  vec2 n = floor(p);
  vec2 f = fract(p);
  float md1 = 8.0;
  float md2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      o = 0.5 + 0.42 * sin(uTime * 1.1 + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md1) {
        md2 = md1;
        md1 = d;
      } else if (d < md2) {
        md2 = d;
      }
    }
  }
  float edge = sqrt(md2) - sqrt(md1);
  float ridge = exp(-edge * (9.5 - uBeat * 3.5));
  float cellGlow = exp(-sqrt(md1) * 2.6);
  vec3 col = vec3(0.012, 0.018, 0.032);
  col += uAccent * ridge * (0.9 + uBass * 0.8);
  col += uSecondary * cellGlow * (0.45 + uTreble * 0.7);
  return col;
}

${customHelper}

void main() {
  vec2 uv = (vUv - 0.5) * vec2(uRes.x / max(1.0, uRes.y), 1.0) * 2.0;
  if (abs(uRotSpeed) > 0.001) {
    uv = rot2d(uv, uTime * uRotSpeed);
  }
  if (uWarp > 0.005) {
    float wAmp = uWarp * 0.24 * (1.0 + uBeat * 0.4);
    uv += vec2(
      sin(uv.y * 3.2 + uTime * 1.3),
      cos(uv.x * 3.2 - uTime * 1.1)
    ) * wAmp;
  }
  uv = applySymmetry(uv, uSymmetry);

  vec3 col = vec3(0.0);
  if (uMode == 1) col = renderJulia(uv);
  else if (uMode == 2) col = renderKaleido(uv);
  else if (uMode == 3) col = renderNebula(uv);
  else if (uMode == 4) col = renderGalaxy(uv);
  else if (uMode == 5) col = renderParticles(uv);
  else if (uMode == 6) col = renderCustom(uv);
  else if (uMode == 7) col = renderMandelbrot(uv);
  else if (uMode == 8) col = renderAurora(uv);
  else if (uMode == 9) col = renderBlackHole(uv);
  else if (uMode == 10) col = renderCyberGrid(uv);
  else if (uMode == 11) col = renderVoronoi(uv);

  col = hueShiftColor(col, uHueShift);
  col *= uGlow;

  // Soft filmic tone map
  col = col / (1.0 + col * 0.45);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const FALLBACK_CUSTOM_HELPER = `
vec3 renderCustom(vec2 uv) {
  float r = length(uv * uScale);
  float wave = sin(r * 10.0 - uTime * 2.5);
  return mix(vec3(0.02, 0.02, 0.04), uAccent, smoothstep(0.35, 0.0, abs(wave)));
}
`;

export function normalizeHueDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return Math.round((((deg % 360) + 360) % 360) * 1000) / 1000;
}

export function hexToRgbNorm(hex: string): [number, number, number] {
  const clean = hex.trim().replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [0.96, 0.62, 0.04];
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

export function rgbToHexNorm(r: number, g: number, b: number): string {
  const clampByte = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${clampByte(r)}${clampByte(g)}${clampByte(b)}`;
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) {
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    } else if (max === g) {
      h = ((b - r) / d + 2) / 6;
    } else {
      h = ((r - g) / d + 4) / 6;
    }
  }
  const s = max > 1e-6 ? d / max : 0;
  return [normalizeHueDeg(h * 360), s, max];
}

export function hsvToRgb(hDeg: number, s: number, v: number): [number, number, number] {
  const h = normalizeHueDeg(hDeg) / 60;
  const sat = Math.max(0, Math.min(1, s));
  const val = Math.max(0, Math.min(1, v));
  const i = Math.floor(h) % 6;
  const f = h - Math.floor(h);
  const p = val * (1 - sat);
  const q = val * (1 - f * sat);
  const t = val * (1 - (1 - f) * sat);
  switch (i) {
    case 0:
      return [val, t, p];
    case 1:
      return [q, val, p];
    case 2:
      return [p, val, t];
    case 3:
      return [p, q, val];
    case 4:
      return [t, p, val];
    default:
      return [val, p, q];
  }
}

export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgbNorm(hex);
  return rgbToHsv(r, g, b);
}

export function hsvToHex(hDeg: number, s = 0.9, v = 0.96): string {
  const [r, g, b] = hsvToRgb(hDeg, s, v);
  return rgbToHexNorm(r, g, b);
}

export function hexToHueDeg(hex: string): number {
  return Math.round(hexToHsv(hex)[0]);
}

export function shiftHexHue(hex: string, deg: number): string {
  const shift = normalizeHueDeg(deg);
  if (shift < 0.05 || shift > 359.95) return hex;
  const [h, s, v] = hexToHsv(hex);
  const [r, g, b] = hsvToRgb(h + shift, s, v);
  return rgbToHexNorm(r, g, b);
}

function modeToInt(effect: Exclude<GeneratorEffectId, 'none'>): number {
  switch (effect) {
    case 'fractal_julia':
      return 1;
    case 'fractal_kaleido':
      return 2;
    case 'space_nebula':
      return 3;
    case 'galaxy_spiral':
      return 4;
    case 'cosmic_particles':
      return 5;
    case 'custom_glsl':
      return 6;
    case 'mandelbrot_zoom':
      return 7;
    case 'aurora_ribbons':
      return 8;
    case 'blackhole_accretion':
      return 9;
    case 'cyber_grid_tunnel':
      return 10;
    case 'voronoi_plasma':
      return 11;
  }
}

class ProceduralShaderEngine {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private initialized = false;
  private webglFailed = false;
  private contextLost = false;
  private lastError: string | null = null;
  private customHelperCode: string = FALLBACK_CUSTOM_HELPER;

  constructor() {
    if (typeof document === 'undefined') return;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 360;

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.cleanupGLResources();
    });

    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.initialized = false;
      this.webglFailed = false;
      this.initGL();
    });
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public updateCustomShader(helperSrc: string): { ok: boolean; error: string | null } {
    const trimmed = helperSrc.trim();
    if (!trimmed) {
      this.lastError = 'Shader code cannot be empty';
      return { ok: false, error: this.lastError };
    }
    const prevHelper = this.customHelperCode;
    this.customHelperCode = trimmed;
    this.cleanupGLResources();
    this.webglFailed = false;
    const ok = this.initGL();
    if (!ok) {
      const err = this.lastError || 'WebGL2 shader compile failed';
      // Restore previous working helper so built-in effects stay alive
      this.customHelperCode = prevHelper;
      this.cleanupGLResources();
      this.webglFailed = false;
      this.initGL();
      this.lastError = err;
      return { ok: false, error: err };
    }
    return { ok: true, error: null };
  }

  private cleanupGLResources(): void {
    const gl = this.gl;
    if (gl) {
      if (this.vertexBuffer) {
        gl.deleteBuffer(this.vertexBuffer);
        this.vertexBuffer = null;
      }
      if (this.program) {
        gl.deleteProgram(this.program);
        this.program = null;
      }
    }
    this.uniforms = {};
    this.gl = null;
    this.initialized = false;
  }

  public dispose(): void {
    this.cleanupGLResources();
  }

  private initGL(): boolean {
    if (this.webglFailed || this.contextLost || !this.canvas) return false;
    if (this.initialized) return Boolean(this.gl && this.program);
    this.initialized = true;

    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl || gl.isContextLost()) {
      this.webglFailed = true;
      return false;
    }

    const compileShader = (type: number, label: string, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) || 'Unknown shader compile error';
        this.lastError = `${label}: ${log}`;
        console.warn('Shader compile error:', this.lastError);
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const vs = compileShader(gl.VERTEX_SHADER, 'VertexShader', VERTEX_SHADER_SRC);
    const fs = compileShader(
      gl.FRAGMENT_SHADER,
      'FragmentShader',
      buildFragmentShaderSource(this.customHelperCode)
    );
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      this.webglFailed = true;
      return false;
    }

    const prog = gl.createProgram();
    if (!prog) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      this.webglFailed = true;
      return false;
    }

    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    // Individual shaders can be marked for deletion once linked into program
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) || 'Unknown program link error';
      this.lastError = `ProgramLink: ${log}`;
      console.warn('Program link error:', this.lastError);
      gl.deleteProgram(prog);
      this.webglFailed = true;
      return false;
    }

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const buf = gl.createBuffer();
    if (!buf) {
      gl.deleteProgram(prog);
      this.webglFailed = true;
      return false;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(prog);
    const names = [
      'uMode',
      'uRes',
      'uTime',
      'uBass',
      'uMid',
      'uTreble',
      'uBeat',
      'uScale',
      'uAccent',
      'uSecondary',
      'uComplexity',
      'uWarp',
      'uSymmetry',
      'uRotSpeed',
      'uHueShift',
      'uGlow',
    ];
    for (const n of names) {
      this.uniforms[n] = gl.getUniformLocation(prog, n);
    }

    this.gl = gl;
    this.program = prog;
    this.vertexBuffer = buf;
    this.lastError = null;
    return true;
  }

  public renderToCanvas2D(
    targetCtx: CanvasRenderingContext2D,
    opts: ProceduralRenderOptions
  ): void {
    const ok = this.initGL();
    if (ok && this.canvas && this.gl && this.program && !this.gl.isContextLost()) {
      const w = opts.width;
      const h = opts.height;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }

      const gl = this.gl;
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.program);

      const accent = hexToRgbNorm(opts.accentHex);
      const secondary = hexToRgbNorm(opts.secondaryHex);
      const hueRad = (normalizeHueDeg(opts.hueShiftDeg ?? 0) * Math.PI) / 180;

      gl.uniform1i(this.uniforms.uMode, modeToInt(opts.effect));
      gl.uniform2f(this.uniforms.uRes, w, h);
      gl.uniform1f(this.uniforms.uTime, opts.time * opts.speed);
      gl.uniform1f(this.uniforms.uBass, opts.metrics.bass * opts.beatReact);
      gl.uniform1f(this.uniforms.uMid, opts.metrics.mid * opts.beatReact);
      gl.uniform1f(this.uniforms.uTreble, opts.metrics.treble * opts.beatReact);
      gl.uniform1f(this.uniforms.uBeat, opts.metrics.beatPulse * opts.beatReact);
      gl.uniform1f(this.uniforms.uScale, opts.scale);
      gl.uniform3f(this.uniforms.uAccent, accent[0], accent[1], accent[2]);
      gl.uniform3f(this.uniforms.uSecondary, secondary[0], secondary[1], secondary[2]);
      gl.uniform1f(this.uniforms.uComplexity, opts.complexity ?? 1.0);
      gl.uniform1f(this.uniforms.uWarp, opts.warp ?? 0.35);
      gl.uniform1f(this.uniforms.uSymmetry, opts.symmetry ?? 1);
      gl.uniform1f(this.uniforms.uRotSpeed, opts.rotationSpeed ?? 0.15);
      gl.uniform1f(this.uniforms.uHueShift, hueRad);
      gl.uniform1f(this.uniforms.uGlow, opts.glow ?? 1.1);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      targetCtx.drawImage(this.canvas, 0, 0, w, h);
      return;
    }

    // 2D Canvas Fallback if WebGL2 is unavailable or context was lost
    this.renderFallback2D(targetCtx, opts);
  }

  private renderFallback2D(ctx: CanvasRenderingContext2D, opts: ProceduralRenderOptions): void {
    const {
      effect,
      width,
      height,
      time,
      metrics,
      accentHex: rawAccentHex,
      secondaryHex: rawSecondaryHex,
      hueShiftDeg = 0,
      speed,
      scale,
      beatReact,
    } = opts;
    const accentHex = shiftHexHue(rawAccentHex, hueShiftDeg);
    const secondaryHex = shiftHexHue(rawSecondaryHex, hueShiftDeg);
    const minDim = Math.min(width, height);
    const t = time * speed;
    const pulse = 1 + metrics.beatPulse * 0.24 * beatReact;
    const cx = width * 0.5;
    const cy = height * 0.5;

    ctx.save();
    const bg = ctx.createRadialGradient(
      cx,
      cy,
      minDim * 0.04,
      cx,
      cy,
      Math.max(width, height) * 0.72
    );
    bg.addColorStop(0, `${accentHex}55`);
    bg.addColorStop(0.55, `${secondaryHex}22`);
    bg.addColorStop(1, '#07090F');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    if (effect === 'fractal_kaleido' || effect === 'fractal_julia' || effect === 'mandelbrot_zoom') {
      const arms = effect === 'fractal_kaleido' ? 8 : effect === 'mandelbrot_zoom' ? 6 : 5;
      for (let ring = 1; ring <= 4; ring++) {
        const radius = (ring / 4) * minDim * 0.36 * scale * pulse;
        ctx.strokeStyle = ring % 2 === 0 ? accentHex : secondaryHex;
        ctx.globalAlpha = 0.25 + metrics.bass * 0.45;
        ctx.lineWidth = Math.max(1.2, minDim * 0.003);
        ctx.beginPath();
        for (let i = 0; i <= 64; i++) {
          const theta = (i / 64) * Math.PI * 2;
          const mod = 1 + 0.24 * Math.sin(theta * arms + t * (ring % 2 === 0 ? 1.1 : -0.9));
          const x = cx + Math.cos(theta) * radius * mod;
          const y = cy + Math.sin(theta) * radius * mod;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    } else if (effect === 'blackhole_accretion') {
      ctx.strokeStyle = secondaryHex;
      ctx.lineWidth = Math.max(2, minDim * 0.008 * pulse);
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(cx, cy, minDim * 0.16 * scale * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#050608';
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, minDim * 0.12 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (effect === 'cyber_grid_tunnel') {
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = Math.max(1, minDim * 0.002);
      ctx.globalAlpha = 0.45 + metrics.bass * 0.4;
      for (let i = 1; i <= 8; i++) {
        const y = cy + ((i / 8) * (height - cy));
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    } else if (effect === 'cosmic_particles' || effect === 'voronoi_plasma') {
      const count = 110;
      for (let i = 0; i < count; i++) {
        const angle = (i * 2.39996 + t * 0.15) % (Math.PI * 2);
        const depth = ((i / count + t * 0.25) % 1);
        const r = depth * minDim * 0.65 * scale * pulse;
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        const size = Math.max(1.2, minDim * 0.006 * depth * pulse);
        ctx.fillStyle = i % 2 === 0 ? accentHex : secondaryHex;
        ctx.globalAlpha = Math.sin(depth * Math.PI) * (0.55 + metrics.treble * 0.4);
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // space_nebula / galaxy_spiral / aurora_ribbons parity fallback
      const count = 96;
      const swirl = effect === 'galaxy_spiral' ? 1.8 : 0.45;
      for (let i = 0; i < count; i++) {
        const frac = i / count;
        const a = i * 2.39996 + t * 0.35 + frac * swirl * Math.PI;
        const r = Math.sqrt(frac) * minDim * 0.48 * scale * pulse;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        const size = Math.max(1.5, minDim * 0.004 * (1 + (i % 3) * 0.45) * pulse);
        ctx.fillStyle = i % 2 === 0 ? accentHex : secondaryHex;
        ctx.globalAlpha = 0.4 + 0.45 * Math.sin(t * 2 + i);
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

export const proceduralShaderEngine = new ProceduralShaderEngine();
