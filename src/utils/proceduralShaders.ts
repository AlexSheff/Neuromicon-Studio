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
}

const VERTEX_SHADER_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Unified high-craft procedural GLSL shader supporting Fractals, Deep Space Nebula, Spiral Galaxy, and Cosmic Particle Warp
const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform int uMode; // 1=fractal_julia, 2=fractal_kaleido, 3=space_nebula, 4=galaxy_spiral, 5=cosmic_particles
uniform vec2 uRes;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uBeat;
uniform float uScale;
uniform vec3 uAccent;
uniform vec3 uSecondary;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
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
  for (int i = 0; i < 44; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    float r2 = dot(z, z);
    minTrap = min(minTrap, abs(length(z) - 0.65));
    if (r2 > 16.0) break;
    smoothIter += 1.0;
  }
  float t = smoothIter / 44.0;
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
  for (float i = 0.0; i < 4.0; i++) {
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

  // Multi-layer crisp starfield
  for (float layer = 1.0; layer <= 3.0; layer += 1.0) {
    vec2 suv = uv * (14.0 * layer / max(0.5, uScale)) + vec2(uTime * 0.03 * layer, -uTime * 0.015 * layer);
    vec2 id = floor(suv);
    vec2 gv = fract(suv) - 0.5;
    float rnd = hash21(id + layer * 19.3);
    if (rnd > 0.84) {
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

  float arms = cos(atan(sp.y, sp.x) * 2.0 + r * 3.5);
  float armMask = smoothstep(-0.3, 0.95, arms);
  float dust = fbm(sp * 3.2 + vec2(uTime * 0.12));

  float disk = exp(-r * (1.85 - uBeat * 0.35));
  float core = exp(-r * r * (14.0 - uBeat * 4.0));

  vec3 col = vec3(0.01, 0.012, 0.025);
  vec3 armCol = mix(uAccent, uSecondary, clamp(dust, 0.0, 1.0));
  col += armCol * disk * (0.35 + 0.9 * armMask * dust) * (0.9 + uBass * 0.65);
  col += mix(uSecondary, vec3(1.0, 0.96, 0.9), 0.6) * core * (1.1 + uBeat * 0.8);

  // Galaxy star clusters + outer field
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

vec3 renderParticles(vec2 uv) {
  vec3 col = vec3(0.012, 0.015, 0.024);
  vec2 p = uv / max(0.4, uScale);
  float warpTime = uTime * 0.75;

  for (float i = 0.0; i < 6.0; i += 1.0) {
    float depth = fract(i / 6.0 + warpTime * 0.18);
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
  // Subtle central warp horizon glow
  float centerGlow = exp(-length(uv) * 2.8) * (0.18 + uBass * 0.35);
  col += uAccent * centerGlow;
  return col;
}

void main() {
  vec2 uv = (vUv - 0.5) * vec2(uRes.x / max(1.0, uRes.y), 1.0) * 2.0;
  vec3 col = vec3(0.0);
  if (uMode == 1) col = renderJulia(uv);
  else if (uMode == 2) col = renderKaleido(uv);
  else if (uMode == 3) col = renderNebula(uv);
  else if (uMode == 4) col = renderGalaxy(uv);
  else if (uMode == 5) col = renderParticles(uv);

  // Soft filmic tone map
  col = col / (1.0 + col * 0.45);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function hexToRgbNorm(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [0.96, 0.62, 0.04];
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  ];
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
  }
}

class ProceduralShaderEngine {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private initialized = false;
  private webglFailed = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 360;
  }

  private initGL(): boolean {
    if (this.webglFailed) return false;
    if (this.initialized) return Boolean(this.gl && this.program);
    this.initialized = true;

    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      this.webglFailed = true;
      return false;
    }

    const compileShader = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('Shader compile warning:', gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const vs = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    if (!vs || !fs) {
      this.webglFailed = true;
      return false;
    }

    const prog = gl.createProgram();
    if (!prog) {
      this.webglFailed = true;
      return false;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('Program link warning:', gl.getProgramInfoLog(prog));
      this.webglFailed = true;
      return false;
    }

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const buf = gl.createBuffer();
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
    ];
    for (const n of names) {
      this.uniforms[n] = gl.getUniformLocation(prog, n);
    }

    this.gl = gl;
    this.program = prog;
    return true;
  }

  public renderToCanvas2D(
    targetCtx: CanvasRenderingContext2D,
    opts: ProceduralRenderOptions
  ): void {
    const ok = this.initGL();
    if (ok && this.gl && this.program) {
      // Cap internal render resolution during live preview for high framerate, use full resolution on export
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

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      targetCtx.drawImage(this.canvas, 0, 0, w, h);
      return;
    }

    // 2D Canvas Fallback if WebGL2 is unavailable in headless environment
    this.renderFallback2D(targetCtx, opts);
  }

  private renderFallback2D(ctx: CanvasRenderingContext2D, opts: ProceduralRenderOptions): void {
    const { width, height, time, metrics, accentHex, secondaryHex, speed, scale, beatReact } = opts;
    const minDim = Math.min(width, height);
    const t = time * speed;
    const pulse = 1 + metrics.beatPulse * 0.22 * beatReact;

    ctx.save();
    const bg = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      minDim * 0.04,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.72
    );
    bg.addColorStop(0, accentHex + '55');
    bg.addColorStop(0.5, secondaryHex + '22');
    bg.addColorStop(1, '#07090F');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const count = 90;
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996 + t * 0.35;
      const r = Math.sqrt(i / count) * minDim * 0.48 * scale * pulse;
      const px = width * 0.5 + Math.cos(a) * r;
      const py = height * 0.5 + Math.sin(a) * r;
      const size = Math.max(1.5, (minDim * 0.004) * (1 + (i % 3) * 0.4) * pulse);
      ctx.fillStyle = i % 2 === 0 ? accentHex : secondaryHex;
      ctx.globalAlpha = 0.45 + 0.45 * Math.sin(t * 2 + i);
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export const proceduralShaderEngine = new ProceduralShaderEngine();
