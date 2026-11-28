import {
  AudioFrameMetrics,
  ClipTransform,
  KeyframeEasing,
  LutPresetId,
  MediaColorFilter,
  StudioConfig,
  VisualMediaState,
} from '../types/studio';
import {
  computeFadeEnvelope,
  resolveActiveSlideshowSlice,
  resolveOverlayWindow,
} from './audioAnalyzer';
import { DEFAULT_CLIP_TRANSFORM, resolveColorScheme } from './presets';
import { proceduralShaderEngine } from './proceduralShaders';

export interface RenderFrameParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  localTime: number;
  absTime?: number;
  clipDuration: number;
  metrics: AudioFrameMetrics;
  config: StudioConfig;
  mediaItems: VisualMediaState[];
  beatCutTimestamps: number[];
  reducedMotion?: boolean;
  isExport?: boolean;
}

let txCanvasA: HTMLCanvasElement | null = null;
let txCanvasB: HTMLCanvasElement | null = null;
const videoFrameCache = new WeakMap<HTMLVideoElement, HTMLCanvasElement>();

function getOffscreenContext(
  slot: 'a' | 'b',
  width: number,
  height: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  let canvas = slot === 'a' ? txCanvasA : txCanvasB;
  if (!canvas) {
    canvas = document.createElement('canvas');
    if (slot === 'a') txCanvasA = canvas;
    else txCanvasB = canvas;
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
  return { canvas, ctx };
}

function updateVideoFrameCache(video: HTMLVideoElement, srcW: number, srcH: number): void {
  if (srcW <= 0 || srcH <= 0) return;
  let cached = videoFrameCache.get(video);
  if (!cached) {
    cached = document.createElement('canvas');
    videoFrameCache.set(video, cached);
  }
  const maxCacheW = 960;
  const scale = srcW > maxCacheW ? maxCacheW / srcW : 1;
  const cw = Math.max(2, Math.round(srcW * scale));
  const ch = Math.max(2, Math.round(srcH * scale));
  if (cached.width !== cw || cached.height !== ch) {
    cached.width = cw;
    cached.height = ch;
  }
  const cctx = cached.getContext('2d');
  if (!cctx) return;
  try {
    cctx.drawImage(video, 0, 0, cw, ch);
  } catch {
    // ignore transient decode errors
  }
}

function buildFilterString(
  filter: MediaColorFilter,
  brightness: number,
  blurPx: number,
  extraBlurPx = 0
): string {
  const parts: string[] = [];
  if (Math.abs(brightness - 1) > 0.01) {
    parts.push(`brightness(${brightness.toFixed(2)})`);
  }
  if (filter === 'bw') {
    parts.push('grayscale(1) contrast(1.08)');
  } else if (filter === 'warm_film') {
    parts.push('sepia(0.28) saturate(1.18) contrast(1.04)');
  } else if (filter === 'cool_noir') {
    parts.push('saturate(0.75) hue-rotate(12deg) contrast(1.12)');
  } else if (filter === 'high_contrast') {
    parts.push('contrast(1.26) saturate(1.12)');
  }
  const totalBlur = blurPx + extraBlurPx;
  if (totalBlur > 0.2) {
    parts.push(`blur(${totalBlur.toFixed(1)}px)`);
  }
  return parts.length > 0 ? parts.join(' ') : 'none';
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  scaleFactor: number,
  panX: number,
  panY: number
) {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;
  let drawW: number;
  let drawH: number;

  if (srcRatio > dstRatio) {
    drawH = dstH * scaleFactor;
    drawW = drawH * srcRatio;
  } else {
    drawW = dstW * scaleFactor;
    drawH = drawW / srcRatio;
  }

  const x = (dstW - drawW) / 2 + panX;
  const y = (dstH - drawH) / 2 + panY;
  ctx.drawImage(source as CanvasImageSource, x, y, drawW, drawH);
}

let cachedFilterSupport: boolean | null = null;
let blurCanvasTemp: HTMLCanvasElement | null = null;

function supportsCanvasFilter(ctx: CanvasRenderingContext2D): boolean {
  if (cachedFilterSupport !== null) return cachedFilterSupport;
  try {
    if (!('filter' in ctx)) {
      cachedFilterSupport = false;
      return false;
    }
    const prev = ctx.filter;
    ctx.filter = 'brightness(0.5)';
    cachedFilterSupport = ctx.filter === 'brightness(0.5)';
    ctx.filter = prev;
    return cachedFilterSupport;
  } catch {
    cachedFilterSupport = false;
    return false;
  }
}

export function isCanvasFilterSupported(): boolean {
  if (cachedFilterSupport !== null) return cachedFilterSupport;
  if (typeof document === 'undefined') return true;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 4;
  const ctx = c.getContext('2d');
  return ctx ? supportsCanvasFilter(ctx) : true;
}

/**
 * Safari lacks CanvasRenderingContext2D.filter support; downsample into a tiny offscreen
 * buffer and upscale with imageSmoothingEnabled for fast, soft hardware-bilinear blur.
 */
function drawDownscaledBlurFallback(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  srcW: number,
  srcH: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  blurStrengthPx: number,
  scaleFactor = 1,
  panX = 0,
  panY = 0,
  useCover = true
) {
  if (!blurCanvasTemp) blurCanvasTemp = document.createElement('canvas');
  const factor = Math.max(0.03, Math.min(0.28, 1 / (1 + blurStrengthPx * 0.65)));
  const bw = Math.max(12, Math.round(dw * factor));
  const bh = Math.max(12, Math.round(dh * factor));
  if (blurCanvasTemp.width !== bw || blurCanvasTemp.height !== bh) {
    blurCanvasTemp.width = bw;
    blurCanvasTemp.height = bh;
  }
  const bctx = blurCanvasTemp.getContext('2d', { alpha: false });
  if (!bctx) {
    if (useCover) drawCoverImage(ctx, source, srcW, srcH, dw, dh, scaleFactor, panX, panY);
    else ctx.drawImage(source as CanvasImageSource, dx, dy, dw, dh);
    return;
  }
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'low';
  if (useCover) {
    drawCoverImage(bctx, source, srcW, srcH, bw, bh, scaleFactor, panX * factor, panY * factor);
  } else {
    bctx.drawImage(source as CanvasImageSource, 0, 0, bw, bh);
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(blurCanvasTemp, dx, dy, dw, dh);
  ctx.restore();
}

function applyFallbackColorAndBrightness(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  filter: MediaColorFilter,
  brightness: number
) {
  if (filter === 'bw') {
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  } else if (filter === 'warm_film') {
    ctx.save();
    ctx.fillStyle = 'rgba(180, 110, 40, 0.16)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  } else if (filter === 'cool_noir') {
    ctx.save();
    ctx.fillStyle = 'rgba(30, 80, 145, 0.18)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  } else if (filter === 'high_contrast') {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = 'rgba(128, 128, 128, 0.24)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  if (brightness < 0.99) {
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.85, 1 - brightness)})`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  } else if (brightness > 1.02) {
    ctx.save();
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.35, (brightness - 1) * 0.5)})`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
}

function drawFitBlurBackdrop(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  scaleFactor: number,
  panX: number,
  panY: number,
  config: StudioConfig,
  allowForegroundMotion: boolean
) {
  const hasFilter = supportsCanvasFilter(ctx);
  const bgExtraBlur = Math.round(Math.min(dstW, dstH) * 0.032);
  ctx.save();
  if (hasFilter) {
    ctx.filter = buildFilterString(
      config.mediaFilter,
      config.mediaBrightness * 0.48,
      config.mediaBlur,
      bgExtraBlur
    );
    drawCoverImage(ctx, source, srcW, srcH, dstW, dstH, 1.14, 0, 0);
  } else {
    drawDownscaledBlurFallback(
      ctx,
      source,
      srcW,
      srcH,
      0,
      0,
      dstW,
      dstH,
      Math.max(12, config.mediaBlur + bgExtraBlur),
      1.14,
      0,
      0,
      true
    );
    applyFallbackColorAndBrightness(
      ctx,
      0,
      0,
      dstW,
      dstH,
      config.mediaFilter,
      config.mediaBrightness * 0.48
    );
  }
  ctx.restore();

  const padding = Math.min(dstW, dstH) * 0.08;
  const availW = dstW - padding * 2;
  const availH = dstH - padding * 2;
  const srcRatio = srcW / srcH;
  const availRatio = availW / availH;

  let baseW: number;
  let baseH: number;
  if (srcRatio > availRatio) {
    baseW = availW;
    baseH = baseW / srcRatio;
  } else {
    baseH = availH;
    baseW = baseH * srcRatio;
  }

  const clampedScale = Math.max(0.2, scaleFactor);
  const outerScale = Math.min(1, clampedScale);
  const innerScale = Math.max(1, clampedScale);
  const cardW = baseW * outerScale;
  const cardH = baseH * outerScale;
  const cardX = (dstW - cardW) / 2;
  const cardY = (dstH - cardH) / 2;

  const drawW = cardW * innerScale;
  const drawH = cardH * innerScale;
  const maxPanX = Math.max(0, (drawW - cardW) * 0.45);
  const maxPanY = Math.max(0, (drawH - cardH) * 0.45);
  const clampedPanX = allowForegroundMotion ? Math.max(-maxPanX, Math.min(maxPanX, panX)) : 0;
  const clampedPanY = allowForegroundMotion ? Math.max(-maxPanY, Math.min(maxPanY, panY)) : 0;
  const drawX = (dstW - drawW) / 2 + clampedPanX;
  const drawY = (dstH - drawH) / 2 + clampedPanY;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = Math.min(dstW, dstH) * 0.04;
  ctx.shadowOffsetY = Math.min(dstW, dstH) * 0.015;
  ctx.fillStyle = '#000000';
  ctx.fillRect(cardX, cardY, cardW, cardH);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(cardX, cardY, cardW, cardH);
  ctx.clip();
  if (hasFilter) {
    ctx.filter = buildFilterString(config.mediaFilter, config.mediaBrightness, config.mediaBlur);
  }
  if (!hasFilter && config.mediaBlur > 0.4) {
    drawDownscaledBlurFallback(
      ctx,
      source,
      srcW,
      srcH,
      drawX,
      drawY,
      drawW,
      drawH,
      config.mediaBlur,
      1,
      0,
      0,
      false
    );
  } else {
    ctx.drawImage(source as CanvasImageSource, drawX, drawY, drawW, drawH);
  }
  if (!hasFilter) {
    applyFallbackColorAndBrightness(
      ctx,
      cardX,
      cardY,
      cardW,
      cardH,
      config.mediaFilter,
      config.mediaBrightness
    );
  }
  ctx.restore();
}

function applyEasing(t: number, easing: KeyframeEasing): number {
  const clamped = Math.max(0, Math.min(1, t));
  if (easing === 'linear') return clamped;
  if (easing === 'ease_out') return 1 - Math.pow(1 - clamped, 2.5);
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
}

function drawSingleClipLayer(
  ctx: CanvasRenderingContext2D,
  media: VisualMediaState,
  width: number,
  height: number,
  totalScale: number,
  pulseScale: number,
  panX: number,
  panY: number,
  config: StudioConfig,
  localTime: number,
  clipProgress: number,
  metrics: AudioFrameMetrics,
  accentColor: string,
  secondaryColor: string,
  offsetX = 0,
  alpha = 1,
  isExport = false
) {
  const tr: ClipTransform = media.transform || DEFAULT_CLIP_TRANSFORM;
  const easedP = applyEasing(clipProgress, tr.easing);
  const rawInterpScale = tr.scale + (tr.endScale - tr.scale) * easedP;
  const interpOffX = tr.offsetX + (tr.endOffsetX - tr.offsetX) * easedP;
  const interpOffY = tr.offsetY + (tr.endOffsetY - tr.offsetY) * easedP;
  // Auto edge-protection overscan whenever full-frame camera panning is active so frame borders never leak black
  const minPanSafeScale =
    rawInterpScale >= 0.98 && (Math.abs(interpOffX) > 0.001 || Math.abs(interpOffY) > 0.001)
      ? 1 + 2.02 * Math.max(Math.abs(interpOffX), Math.abs(interpOffY))
      : rawInterpScale;
  const interpScale = Math.max(rawInterpScale, minPanSafeScale);

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha * tr.opacity));
  if (offsetX !== 0) ctx.translate(offsetX, 0);

  const hasTransform =
    Math.abs(interpScale - 1) > 0.002 ||
    Math.abs(interpOffX) > 0.001 ||
    Math.abs(interpOffY) > 0.001 ||
    Math.abs(tr.rotationDeg) > 0.05;

  if (hasTransform) {
    ctx.translate(width * (0.5 + interpOffX), height * (0.5 + interpOffY));
    if (Math.abs(tr.rotationDeg) > 0.05) {
      ctx.rotate((tr.rotationDeg * Math.PI) / 180);
    }
    if (Math.abs(interpScale - 1) > 0.002) {
      ctx.scale(interpScale, interpScale);
    }
    ctx.translate(-width * 0.5, -height * 0.5);
  }

  if (media.kind === 'generator') {
    const genEffect =
      media.generatorId && media.generatorId !== 'none'
        ? media.generatorId
        : 'galaxy_spiral';
    const gp = media.generatorParams;
    proceduralShaderEngine.renderToCanvas2D(ctx, {
      effect: genEffect,
      width,
      height,
      time: localTime,
      metrics,
      accentHex: accentColor,
      secondaryHex: secondaryColor,
      speed: gp?.speed ?? config.generatorSpeed,
      scale: gp?.scale ?? config.generatorScale,
      beatReact: gp?.beatReact ?? config.generatorBeatReact,
      complexity: gp?.complexity ?? config.generatorComplexity,
      warp: gp?.warp ?? config.generatorWarp,
      symmetry: gp?.symmetry ?? config.generatorSymmetry,
      rotationSpeed: gp?.rotationSpeed ?? config.generatorRotationSpeed,
      hueShiftDeg: gp?.hueShift ?? config.generatorHueShift,
      glow: gp?.glow ?? config.generatorGlow,
    });
    if (media.overlayEffect) {
      ctx.save();
      ctx.filter = 'none';
      ctx.globalCompositeOperation = media.overlayEffect.blend;
      ctx.globalAlpha = Math.max(
        0,
        Math.min(1, alpha * tr.opacity * media.overlayEffect.opacity)
      );
      const ogp = media.overlayEffect.params;
      proceduralShaderEngine.renderToCanvas2D(ctx, {
        effect: media.overlayEffect.effect,
        width,
        height,
        time: localTime,
        metrics,
        accentHex: accentColor,
        secondaryHex: secondaryColor,
        speed: ogp?.speed ?? config.generatorSpeed,
        scale: ogp?.scale ?? config.generatorScale,
        beatReact: ogp?.beatReact ?? config.generatorBeatReact,
        complexity: ogp?.complexity ?? config.generatorComplexity,
        warp: ogp?.warp ?? config.generatorWarp,
        symmetry: ogp?.symmetry ?? config.generatorSymmetry,
        rotationSpeed: ogp?.rotationSpeed ?? config.generatorRotationSpeed,
        hueShiftDeg: ogp?.hueShift ?? config.generatorHueShift,
        glow: ogp?.glow ?? config.generatorGlow,
      });
      ctx.restore();
    }
    ctx.restore();
    return;
  }

  let drawSource: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | undefined =
    media.kind === 'video' ? media.videoElement : media.imageElement;
  let drawSrcW = media.width;
  let drawSrcH = media.height;

  if (media.kind === 'image') {
    const imgEl = drawSource as HTMLImageElement | undefined;
    if (!imgEl || !imgEl.complete || imgEl.naturalWidth <= 0 || drawSrcW <= 0 || drawSrcH <= 0) {
      ctx.restore();
      return;
    }
  } else {
    const vidEl = drawSource as HTMLVideoElement | undefined;
    if (!vidEl || drawSrcW <= 0 || drawSrcH <= 0) {
      ctx.restore();
      return;
    }
    const videoReady = vidEl.readyState >= 2 && (!vidEl.seeking || isExport);
    if (videoReady) {
      if (!isExport) {
        updateVideoFrameCache(vidEl, drawSrcW, drawSrcH);
      }
    } else {
      const cached = videoFrameCache.get(vidEl);
      if (cached && cached.width > 0 && cached.height > 0) {
        drawSource = cached;
        drawSrcW = cached.width;
        drawSrcH = cached.height;
      } else if (vidEl.readyState < 2) {
        ctx.restore();
        return;
      }
    }
  }

  if (!drawSource) {
    ctx.restore();
    return;
  }

  if (config.framingMode === 'fit_blur') {
    drawFitBlurBackdrop(
      ctx,
      drawSource,
      drawSrcW,
      drawSrcH,
      width,
      height,
      totalScale,
      panX,
      panY,
      config,
      true
    );
  } else {
    const baseScale = pulseScale > 0.01 ? totalScale / pulseScale : totalScale;
    const safeHeadroom = Math.max(0, baseScale - 1);
    const maxPanX = width * safeHeadroom * 0.42;
    const maxPanY = height * safeHeadroom * 0.42;
    const clampedPanX = Math.max(-maxPanX, Math.min(maxPanX, panX));
    const clampedPanY = Math.max(-maxPanY, Math.min(maxPanY, panY));
    const hasFilter = supportsCanvasFilter(ctx);
    if (hasFilter) {
      ctx.filter = buildFilterString(config.mediaFilter, config.mediaBrightness, config.mediaBlur);
      drawCoverImage(
        ctx,
        drawSource,
        drawSrcW,
        drawSrcH,
        width,
        height,
        totalScale,
        clampedPanX,
        clampedPanY
      );
    } else if (config.mediaBlur > 0.4) {
      drawDownscaledBlurFallback(
        ctx,
        drawSource,
        drawSrcW,
        drawSrcH,
        0,
        0,
        width,
        height,
        config.mediaBlur,
        totalScale,
        clampedPanX,
        clampedPanY,
        true
      );
      applyFallbackColorAndBrightness(
        ctx,
        0,
        0,
        width,
        height,
        config.mediaFilter,
        config.mediaBrightness
      );
    } else {
      drawCoverImage(
        ctx,
        drawSource,
        drawSrcW,
        drawSrcH,
        width,
        height,
        totalScale,
        clampedPanX,
        clampedPanY
      );
      applyFallbackColorAndBrightness(
        ctx,
        0,
        0,
        width,
        height,
        config.mediaFilter,
        config.mediaBrightness
      );
    }
  }

  if (media.overlayEffect) {
    ctx.save();
    ctx.filter = 'none';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = media.overlayEffect.blend;
    ctx.globalAlpha = Math.max(
      0,
      Math.min(1, alpha * tr.opacity * media.overlayEffect.opacity)
    );
    const ogp = media.overlayEffect.params;
    proceduralShaderEngine.renderToCanvas2D(ctx, {
      effect: media.overlayEffect.effect,
      width,
      height,
      time: localTime,
      metrics,
      accentHex: accentColor,
      secondaryHex: secondaryColor,
      speed: ogp?.speed ?? config.generatorSpeed,
      scale: ogp?.scale ?? config.generatorScale,
      beatReact: ogp?.beatReact ?? config.generatorBeatReact,
      complexity: ogp?.complexity ?? config.generatorComplexity,
      warp: ogp?.warp ?? config.generatorWarp,
      symmetry: ogp?.symmetry ?? config.generatorSymmetry,
      rotationSpeed: ogp?.rotationSpeed ?? config.generatorRotationSpeed,
      hueShiftDeg: ogp?.hueShift ?? config.generatorHueShift,
      glow: ogp?.glow ?? config.generatorGlow,
    });
    ctx.restore();
  }

  ctx.restore();
}

function drawBackdropIntoContext(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  localTime: number,
  metrics: AudioFrameMetrics,
  config: StudioConfig,
  mediaCount: number,
  accentColor: string,
  secondaryColor: string
) {
  ctx.fillStyle = '#090b10';
  ctx.fillRect(0, 0, width, height);

  if (
    config.generatorEffect !== 'none' &&
    (mediaCount === 0 || config.generatorBlend === 'backdrop')
  ) {
    ctx.save();
    ctx.globalAlpha = mediaCount === 0 ? Math.max(0.45, config.generatorOpacity) : config.generatorOpacity;
    proceduralShaderEngine.renderToCanvas2D(ctx, {
      effect: config.generatorEffect,
      width,
      height,
      time: localTime,
      metrics,
      accentHex: accentColor,
      secondaryHex: secondaryColor,
      speed: config.generatorSpeed,
      scale: config.generatorScale,
      beatReact: config.generatorBeatReact,
      complexity: config.generatorComplexity,
      warp: config.generatorWarp,
      symmetry: config.generatorSymmetry,
      rotationSpeed: config.generatorRotationSpeed,
      hueShiftDeg: config.generatorHueShift,
      glow: config.generatorGlow,
    });
    ctx.restore();
  }
}

function drawLutAndGlitch(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lutPreset: LutPresetId,
  glitchStrength: number,
  beatPulse: number,
  localTime: number,
  accentColor: string,
  secondaryColor: string
) {
  if (lutPreset !== 'none') {
    ctx.save();
    if (lutPreset === 'teal_orange') {
      ctx.globalCompositeOperation = 'soft-light';
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, 'rgba(13, 148, 136, 0.36)');
      g.addColorStop(0.55, 'rgba(20, 40, 56, 0.14)');
      g.addColorStop(1, 'rgba(234, 88, 12, 0.38)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'screen';
      const hi = ctx.createRadialGradient(width * 0.5, height * 0.35, 0, width * 0.5, height * 0.45, Math.max(width, height) * 0.7);
      hi.addColorStop(0, 'rgba(251, 146, 60, 0.09)');
      hi.addColorStop(1, 'rgba(13, 148, 136, 0.03)');
      ctx.fillStyle = hi;
      ctx.fillRect(0, 0, width, height);
    } else if (lutPreset === 'cyber_magenta') {
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createLinearGradient(0, height, width, 0);
      g.addColorStop(0, 'rgba(192, 38, 211, 0.22)');
      g.addColorStop(1, 'rgba(14, 165, 233, 0.24)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    } else if (lutPreset === 'vintage_gold') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(246, 224, 182, 0.9)';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = 'rgba(217, 119, 6, 0.14)';
      ctx.fillRect(0, 0, width, height);
    } else if (lutPreset === 'deep_ocean') {
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = 'rgba(15, 76, 129, 0.32)';
      ctx.fillRect(0, 0, width, height);
    } else if (lutPreset === 'bleach_bypass') {
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = 'rgba(128, 128, 128, 0.45)';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'soft-light';
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, 'rgba(226, 232, 240, 0.28)');
      g.addColorStop(1, 'rgba(15, 23, 42, 0.38)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    } else if (lutPreset === 'crimson_noir') {
      ctx.globalCompositeOperation = 'overlay';
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, 'rgba(190, 18, 60, 0.32)');
      g.addColorStop(1, 'rgba(17, 12, 24, 0.44)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    } else if (lutPreset === 'sunset_amber') {
      ctx.globalCompositeOperation = 'screen';
      const flare = ctx.createRadialGradient(width * 0.18, height * 0.15, 0, width * 0.25, height * 0.2, Math.max(width, height) * 0.72);
      flare.addColorStop(0, 'rgba(251, 146, 60, 0.24)');
      flare.addColorStop(1, 'rgba(251, 146, 60, 0)');
      ctx.fillStyle = flare;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'soft-light';
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, 'rgba(245, 158, 11, 0.3)');
      g.addColorStop(1, 'rgba(124, 45, 18, 0.28)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
  }

  if (glitchStrength > 0.02 && beatPulse > 0.22) {
    const intensity = glitchStrength * beatPulse;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const bands = 5;
    for (let i = 0; i < bands; i++) {
      const seed = Math.sin(localTime * 42 + i * 17.3) * 43758.5453;
      const frac = seed - Math.floor(seed);
      const y = frac * height;
      const bandH = Math.max(3, height * (0.012 + (i % 3) * 0.01));
      const shift = (frac - 0.5) * width * 0.045 * intensity;
      ctx.fillStyle = i % 2 === 0 ? hexToRgba(accentColor, 0.22 * intensity) : hexToRgba(secondaryColor, 0.22 * intensity);
      ctx.fillRect(Math.max(0, shift), y, width - Math.abs(shift), bandH);
    }
    ctx.restore();
  }
}

function measureTextWithSpacing(ctx: CanvasRenderingContext2D, text: string, spacingPx: number): number {
  if (Math.abs(spacingPx) < 0.2) return ctx.measureText(text).width;
  const chars = Array.from(text);
  let w = 0;
  for (let i = 0; i < chars.length; i++) {
    w += ctx.measureText(chars[i]).width;
  }
  return w + spacingPx * Math.max(0, chars.length - 1);
}

function drawAlignedTextWithSpacing(
  ctx: CanvasRenderingContext2D,
  text: string,
  anchorX: number,
  y: number,
  spacingPx: number,
  align: 'left' | 'center' | 'right'
) {
  if (Math.abs(spacingPx) < 0.2) {
    ctx.textAlign = align;
    ctx.fillText(text, anchorX, y);
    return;
  }
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const totalWidth =
    widths.reduce((acc, v) => acc + v, 0) + spacingPx * Math.max(0, chars.length - 1);

  let cursorX = anchorX;
  if (align === 'center') cursorX = anchorX - totalWidth / 2;
  else if (align === 'right') cursorX = anchorX - totalWidth;

  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cursorX, y);
    cursorX += widths[i] + spacingPx;
  }
  ctx.textAlign = prevAlign;
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  spacingPx: number
): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (measureTextWithSpacing(ctx, candidate, spacingPx) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return `rgba(245, 158, 11, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function resolveBeatPulseScale(config: StudioConfig, beatPulse: number): number {
  if (config.beatPreset === 'none' || config.disableBeatPulse || config.stabilizeMotion) return 1;
  if (config.beatPreset === 'beat_zoom') {
    return config.backgroundPulse <= 0.005 ? 1 : 1 + beatPulse * 0.085 * config.visualizerScale;
  }
  if (config.backgroundPulse <= 0.005) return 1;
  return 1 + beatPulse * 0.032 * config.backgroundPulse;
}

export function renderStudioFrame(params: RenderFrameParams): void {
  const {
    ctx,
    width,
    height,
    localTime,
    absTime = localTime,
    clipDuration,
    metrics,
    config,
    mediaItems,
    beatCutTimestamps,
    reducedMotion,
    isExport,
  } = params;
  const minDim = Math.min(width, height);
  const isVertical = height > width;
  const scheme = resolveColorScheme(
    config.colorSchemeId,
    config.customTextColor,
    config.customAccentColor
  );

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // 1. Base Canvas & Generative Backdrop (when no media or generatorBlend === 'backdrop')
  drawBackdropIntoContext(
    ctx,
    width,
    height,
    localTime,
    metrics,
    config,
    mediaItems.length,
    scheme.accentColor,
    scheme.visualizerSecondary
  );

  const beatPulseOff = Boolean(
    config.beatPreset === 'none' ||
      config.disableBeatPulse ||
      config.stabilizeMotion ||
      config.backgroundPulse <= 0.005
  );
  const pulseScale = resolveBeatPulseScale(config, metrics.beatPulse);
  const allowKenBurns = Boolean(config.kenBurnsMotion && !reducedMotion && !config.stabilizeMotion);

  const progress = clipDuration > 0 ? Math.min(1, localTime / clipDuration) : 0;
  const kenBurnsScale = allowKenBurns ? 1 + progress * 0.035 : 1;
  const totalScale = pulseScale * kenBurnsScale;

  const panX = allowKenBurns ? Math.sin(localTime * 0.16) * width * 0.008 : 0;
  const panY = allowKenBurns ? Math.cos(localTime * 0.12) * height * 0.008 : 0;

  // 2. Multi-Clip Sequence Layer
  if (mediaItems.length > 0) {
    const slice = resolveActiveSlideshowSlice(
      mediaItems,
      localTime,
      clipDuration,
      config,
      beatCutTimestamps
    );
    const activeMedia = slice.activeIndex !== null ? mediaItems[slice.activeIndex] : null;
    const prevMedia = slice.prevIndex !== null ? mediaItems[slice.prevIndex] : null;
    const p = slice.transitionProgress;

    const activeClipDur = Math.max(0.2, slice.activeSegmentDuration || activeMedia?.durationSec || clipDuration);
    const prevClipDur = Math.max(0.2, slice.prevSegmentDuration || prevMedia?.durationSec || clipDuration);
    const hasExplicitZoom = (m: VisualMediaState | null) =>
      Boolean(m?.transform && Math.abs((m.transform.endScale ?? 1) - (m.transform.scale ?? 1)) > 0.004);

    // Avoid stacking Ken Burns zoom on top of clip keyframes or jumping on short <1.8s beat photos
    const slideKenActive =
      allowKenBurns && activeMedia?.kind === 'image' && activeClipDur >= 1.8 && !hasExplicitZoom(activeMedia)
        ? pulseScale * (1 + Math.min(0.025, slice.slideLocalTime * 0.006))
        : pulseScale;
    const slideKenPrev =
      allowKenBurns && prevMedia?.kind === 'image' && prevClipDur >= 1.8 && !hasExplicitZoom(prevMedia)
        ? pulseScale * (1 + Math.min(0.025, slice.prevSlideLocalTime * 0.006))
        : pulseScale;
    const activeTotalScale =
      mediaItems.length > 1
        ? slideKenActive
        : activeMedia?.kind === 'image' && hasExplicitZoom(activeMedia)
          ? pulseScale
          : totalScale;
    const activeProgress = Math.min(1, slice.slideLocalTime / activeClipDur);
    const prevProgress = Math.min(1, slice.prevSlideLocalTime / prevClipDur);

    if (prevMedia && activeMedia && p < 0.999 && slice.transitionType !== 'cut') {
      if (slice.transitionType === 'crossfade' || slice.transitionType === 'zoom_cross') {
        const isZoomCross = slice.transitionType === 'zoom_cross';
        const zoomInAmt = isZoomCross && (!reducedMotion && !config.stabilizeMotion)
          ? 1 + (1 - applyEasing(p, 'ease_out')) * 0.065
          : 1;
        if (Math.abs(zoomInAmt - 1) > 0.001) {
          ctx.save();
          ctx.translate(width * 0.5, height * 0.5);
          ctx.scale(zoomInAmt, zoomInAmt);
          ctx.translate(-width * 0.5, -height * 0.5);
        }
        drawSingleClipLayer(
          ctx,
          activeMedia,
          width,
          height,
          activeTotalScale,
          pulseScale,
          panX,
          panY,
          config,
          localTime,
          activeProgress,
          metrics,
          scheme.accentColor,
          scheme.visualizerSecondary,
          0,
          1,
          Boolean(isExport)
        );
        if (Math.abs(zoomInAmt - 1) > 0.001) {
          ctx.restore();
        }

        // Render outgoing clip into isolated offscreen buffer at alpha=1, then composite (1-p)
        // Guarantees (1-p)*Prev + p*Next with zero dark dip and zero filter+alpha artifacts
        const bufA = getOffscreenContext('a', width, height);
        if (bufA) {
          drawBackdropIntoContext(
            bufA.ctx,
            width,
            height,
            localTime,
            metrics,
            config,
            mediaItems.length,
            scheme.accentColor,
            scheme.visualizerSecondary
          );
          drawSingleClipLayer(
            bufA.ctx,
            prevMedia,
            width,
            height,
            mediaItems.length > 1 ? slideKenPrev : totalScale,
            pulseScale,
            panX,
            panY,
            config,
            localTime,
            prevProgress,
            metrics,
            scheme.accentColor,
            scheme.visualizerSecondary,
            0,
            1,
            Boolean(isExport)
          );
          ctx.save();
          ctx.filter = 'none';
          const easedAlpha = isZoomCross ? 1 - applyEasing(p, 'ease_in_out') : 1 - p;
          ctx.globalAlpha = Math.max(0, Math.min(1, easedAlpha));
          if (isZoomCross && !reducedMotion && !config.stabilizeMotion) {
            const outZoom = 1 + applyEasing(p, 'ease_out') * 0.12;
            ctx.translate(width * 0.5, height * 0.5);
            ctx.scale(outZoom, outZoom);
            ctx.translate(-width * 0.5, -height * 0.5);
          }
          ctx.drawImage(bufA.canvas, 0, 0, width, height);
          ctx.restore();
        }
      } else if (slice.transitionType === 'wipe_right') {
        drawSingleClipLayer(
          ctx,
          prevMedia,
          width,
          height,
          mediaItems.length > 1 ? slideKenPrev : totalScale,
          pulseScale,
          panX,
          panY,
          config,
          localTime,
          prevProgress,
          metrics,
          scheme.accentColor,
          scheme.visualizerSecondary,
          0,
          1,
          Boolean(isExport)
        );
        const bufA = getOffscreenContext('a', width, height);
        if (bufA) {
          drawBackdropIntoContext(
            bufA.ctx,
            width,
            height,
            localTime,
            metrics,
            config,
            mediaItems.length,
            scheme.accentColor,
            scheme.visualizerSecondary
          );
          drawSingleClipLayer(
            bufA.ctx,
            activeMedia,
            width,
            height,
            mediaItems.length > 1 ? slideKenActive : totalScale,
            pulseScale,
            panX,
            panY,
            config,
            localTime,
            activeProgress,
            metrics,
            scheme.accentColor,
            scheme.visualizerSecondary,
            0,
            1,
            Boolean(isExport)
          );
          const wipeP = applyEasing(p, 'ease_in_out');
          const edgeX = width * wipeP;
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, edgeX, height);
          ctx.clip();
          ctx.filter = 'none';
          ctx.drawImage(bufA.canvas, 0, 0, width, height);
          ctx.restore();

          // Soft luminous feather along the wipe boundary
          const seamW = Math.max(10, minDim * 0.028);
          const seamGrad = ctx.createLinearGradient(edgeX - seamW, 0, edgeX + seamW * 0.4, 0);
          seamGrad.addColorStop(0, 'rgba(255,255,255,0)');
          seamGrad.addColorStop(0.75, hexToRgba(scheme.accentColor, 0.22 * (1 - wipeP * 0.4)));
          seamGrad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = seamGrad;
          ctx.fillRect(edgeX - seamW, 0, seamW * 1.4, height);
        }
      } else if (slice.transitionType === 'dip_black') {
        if (p < 0.5) {
          drawSingleClipLayer(
            ctx,
            prevMedia,
            width,
            height,
            slideKenPrev,
            pulseScale,
            panX,
            panY,
            config,
            localTime,
            prevProgress,
            metrics,
            scheme.accentColor,
            scheme.visualizerSecondary,
            0,
            1,
            Boolean(isExport)
          );
          const dipAlpha = Math.min(1, Math.pow(Math.max(0, p * 2), 1.35));
          ctx.fillStyle = `rgba(0, 0, 0, ${dipAlpha})`;
          ctx.fillRect(0, 0, width, height);
        } else {
          drawSingleClipLayer(
            ctx,
            activeMedia,
            width,
            height,
            slideKenActive,
            pulseScale,
            panX,
            panY,
            config,
            localTime,
            activeProgress,
            metrics,
            scheme.accentColor,
            scheme.visualizerSecondary,
            0,
            1,
            Boolean(isExport)
          );
          const dipAlpha = Math.min(1, Math.pow(Math.max(0, (1 - p) * 2), 1.35));
          ctx.fillStyle = `rgba(0, 0, 0, ${dipAlpha})`;
          ctx.fillRect(0, 0, width, height);
        }
      } else if (slice.transitionType === 'slide') {
        const bufA = getOffscreenContext('a', width, height);
        const bufB = getOffscreenContext('b', width, height);
        if (bufA && bufB) {
          drawBackdropIntoContext(
            bufA.ctx,
            width,
            height,
            localTime,
            metrics,
            config,
            mediaItems.length,
            scheme.accentColor,
            scheme.visualizerSecondary
          );
          drawSingleClipLayer(
            bufA.ctx,
            prevMedia,
            width,
            height,
            slideKenPrev,
            pulseScale,
            panX,
            panY,
            config,
            localTime,
            prevProgress,
            metrics,
            scheme.accentColor,
            scheme.visualizerSecondary,
            0,
            1,
            Boolean(isExport)
          );
          drawBackdropIntoContext(
            bufB.ctx,
            width,
            height,
            localTime,
            metrics,
            config,
            mediaItems.length,
            scheme.accentColor,
            scheme.visualizerSecondary
          );
          drawSingleClipLayer(
            bufB.ctx,
            activeMedia,
            width,
            height,
            slideKenActive,
            pulseScale,
            panX,
            panY,
            config,
            localTime,
            activeProgress,
            metrics,
            scheme.accentColor,
            scheme.visualizerSecondary,
            0,
            1,
            Boolean(isExport)
          );
          const whipP = applyEasing(p, 'ease_in_out');
          const boundaryX = (1 - whipP) * width;
          ctx.save();
          ctx.filter = 'none';
          ctx.drawImage(bufA.canvas, -whipP * width, 0, width, height);
          ctx.drawImage(bufB.canvas, boundaryX, 0, width, height);
          const shadowW = Math.max(12, width * 0.032);
          const shadowGrad = ctx.createLinearGradient(boundaryX - shadowW, 0, boundaryX + shadowW * 0.35, 0);
          shadowGrad.addColorStop(0, 'rgba(0,0,0,0)');
          shadowGrad.addColorStop(0.7, 'rgba(0,0,0,0.34)');
          shadowGrad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = shadowGrad;
          ctx.fillRect(boundaryX - shadowW, 0, shadowW * 1.35, height);
          ctx.restore();
        }
      }
    } else if (activeMedia) {
      drawSingleClipLayer(
        ctx,
        activeMedia,
        width,
        height,
        activeTotalScale,
        pulseScale,
        panX,
        panY,
        config,
        localTime,
        activeProgress,
        metrics,
        scheme.accentColor,
        scheme.visualizerSecondary,
        0,
        1,
        Boolean(isExport)
      );
    }

    // Subtle 110ms optical cut-impact glint on high-energy drop hard cuts (respects stabilized/reduced motion)
    if (
      activeMedia &&
      slice.transitionType === 'cut' &&
      (activeMedia.cutImpact ?? 0) >= 0.72 &&
      slice.slideLocalTime < 0.11 &&
      !config.stabilizeMotion &&
      !config.disableBeatPulse &&
      !reducedMotion
    ) {
      const impactEnv = (1 - slice.slideLocalTime / 0.11) * Math.min(1, activeMedia.cutImpact ?? 0.72);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `rgba(255, 255, 255, ${(impactEnv * 0.075).toFixed(4)})`;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // Generative Blend Overlay on top of uploaded clips (Screen / Additive Glow)
    if (config.generatorEffect !== 'none' && config.generatorBlend !== 'backdrop') {
      ctx.save();
      ctx.globalCompositeOperation = config.generatorBlend;
      ctx.globalAlpha = config.generatorOpacity;
      proceduralShaderEngine.renderToCanvas2D(ctx, {
        effect: config.generatorEffect,
        width,
        height,
        time: localTime,
        metrics,
        accentHex: scheme.accentColor,
        secondaryHex: scheme.visualizerSecondary,
        speed: config.generatorSpeed,
        scale: config.generatorScale,
        beatReact: config.generatorBeatReact,
        complexity: config.generatorComplexity,
        warp: config.generatorWarp,
        symmetry: config.generatorSymmetry,
        rotationSpeed: config.generatorRotationSpeed,
        hueShiftDeg: config.generatorHueShift,
        glow: config.generatorGlow,
      });
      ctx.restore();
    }
  } else if (config.generatorEffect === 'none') {
    // Clean studio grid when neither media nor generator is active
    const grad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.42,
      minDim * 0.05,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.78
    );
    grad.addColorStop(0, '#181c26');
    grad.addColorStop(1, '#090b10');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = Math.max(1, minDim * 0.0012);
    const step = minDim * 0.1;
    for (let gx = step; gx < width; gx += step) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height);
      ctx.stroke();
    }
    for (let gy = step; gy < height; gy += step) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(width, gy);
      ctx.stroke();
    }
  }

  // 2b. Timeline FX Generator Overlays Track (plays smoothly over clips across any range)
  if (config.fxOverlays && config.fxOverlays.length > 0) {
    for (const fx of config.fxOverlays) {
      if (localTime < fx.startSec || localTime > fx.startSec + fx.durationSec) continue;
      const relT = localTime - fx.startSec;
      const env = computeFadeEnvelope(relT, fx.durationSec, fx.fadeSec, fx.fadeSec);
      const effAlpha = fx.opacity * env;
      if (effAlpha <= 0.005) continue;
      const fxp = fx.params;
      ctx.save();
      ctx.filter = 'none';
      ctx.globalCompositeOperation = fx.blend;
      ctx.globalAlpha = Math.max(0, Math.min(1, effAlpha));
      proceduralShaderEngine.renderToCanvas2D(ctx, {
        effect: fx.generatorId,
        width,
        height,
        time: localTime,
        metrics,
        accentHex: scheme.accentColor,
        secondaryHex: scheme.visualizerSecondary,
        speed: fxp?.speed ?? config.generatorSpeed,
        scale: fxp?.scale ?? config.generatorScale,
        beatReact: fxp?.beatReact ?? config.generatorBeatReact,
        complexity: fxp?.complexity ?? config.generatorComplexity,
        warp: fxp?.warp ?? config.generatorWarp,
        symmetry: fxp?.symmetry ?? config.generatorSymmetry,
        rotationSpeed: fxp?.rotationSpeed ?? config.generatorRotationSpeed,
        hueShiftDeg: fxp?.hueShift ?? config.generatorHueShift,
        glow: fxp?.glow ?? config.generatorGlow,
      });
      ctx.restore();
    }
  }

  // 3. Contrast Scrim & Cinematic Vignette
  const scrimAlpha = config.scrimStrength;
  if (scrimAlpha > 0.01) {
    const scrimGrad = ctx.createLinearGradient(0, 0, 0, height);
    scrimGrad.addColorStop(0, hexToRgba(scheme.scrimTint, scrimAlpha * 0.55));
    scrimGrad.addColorStop(0.42, hexToRgba(scheme.scrimTint, scrimAlpha * 0.22));
    scrimGrad.addColorStop(0.75, hexToRgba(scheme.scrimTint, scrimAlpha * 0.68));
    scrimGrad.addColorStop(1, hexToRgba(scheme.scrimTint, Math.min(0.92, scrimAlpha * 1.15)));
    ctx.fillStyle = scrimGrad;
    ctx.fillRect(0, 0, width, height);
  }

  if (config.vignetteAmount > 0.02) {
    const vigDark = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      minDim * 0.26,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.74
    );
    vigDark.addColorStop(0, 'rgba(0,0,0,0)');
    vigDark.addColorStop(1, `rgba(0,0,0,${Math.min(0.85, config.vignetteAmount * 0.75)})`);
    ctx.fillStyle = vigDark;
    ctx.fillRect(0, 0, width, height);
  }

  if (
    config.beatPreset !== 'none' &&
    !beatPulseOff &&
    metrics.beatPulse > 0.08 &&
    (config.backgroundPulse > 0.05 || config.beatPreset === 'beat_zoom')
  ) {
    const vig = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      minDim * 0.2,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.72
    );
    const edgeGlow =
      metrics.beatPulse * 0.18 * (config.beatPreset === 'beat_zoom' ? 1.4 : config.backgroundPulse);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, hexToRgba(scheme.accentColor, Math.min(0.32, edgeGlow)));
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, width, height);
  }

  // 4. Beat-Synced Visualizer Layer
  if (config.showVisualizer !== false && config.beatPreset !== 'none') {
  const useCustomVis = config.visualizerColor && config.visualizerColor !== 'auto';
  const visPrimary = useCustomVis ? config.visualizerColor : scheme.accentColor;
  const visSecondary = useCustomVis ? config.visualizerColor : scheme.visualizerSecondary;
  const visAlpha = config.visualizerOpacity;
  const visScale = config.visualizerScale;
  const visWidth = Math.max(0.25, Math.min(1.0, config.visualizerWidth));
  const visThick = Math.max(0.4, Math.min(2.5, config.visualizerThickness));
  const visY =
    config.visualizerPlacement === 'top'
      ? height * (isVertical ? 0.18 : 0.22)
      : config.visualizerPlacement === 'center'
        ? height * 0.5
        : height * (isVertical ? 0.76 : 0.8);

  ctx.save();
  ctx.globalAlpha = visAlpha;

  if (config.beatPreset === 'spectrum_bars') {
    const barCount = 48;
    const areaW = width * 0.92 * visWidth;
    const startX = (width - areaW) / 2;
    const slotW = areaW / barCount;
    const barW = Math.max(1.5, Math.min(slotW * 0.94, slotW * 0.55 * visThick));
    const maxBarH = minDim * 0.22 * visScale;

    for (let i = 0; i < barCount; i++) {
      const specIdx = config.mirrorVisualizer
        ? Math.min(47, Math.floor((Math.abs(i - (barCount - 1) / 2) / ((barCount - 1) / 2)) * 47))
        : i;
      const energy = metrics.spectrum[specIdx];
      const h = Math.max(minDim * 0.005, energy * maxBarH);
      const bx = startX + i * slotW + (slotW - barW) / 2;
      const by =
        config.visualizerPlacement === 'center' || config.mirrorVisualizer
          ? visY - h / 2
          : config.visualizerPlacement === 'top'
            ? visY
            : visY - h;

      const grad = ctx.createLinearGradient(bx, by, bx, by + h);
      grad.addColorStop(0, visSecondary);
      grad.addColorStop(1, visPrimary);
      ctx.fillStyle = grad;

      const radius = Math.min(barW / 2, h / 2);
      ctx.beginPath();
      ctx.roundRect(bx, by, barW, h, radius);
      ctx.fill();
    }
  } else if (config.beatPreset === 'radial_pulse') {
    const cx = width * 0.5;
    const cy = config.visualizerPlacement === 'center' ? height * 0.48 : visY - minDim * 0.06;
    const baseRadius =
      minDim * 0.16 * visScale * (0.55 + visWidth * 0.65) * (1 + metrics.beatPulse * 0.08);
    const bins = 48;

    ctx.strokeStyle = hexToRgba(visPrimary, 0.35 + metrics.beatPulse * 0.45);
    ctx.lineWidth = Math.max(1.2, minDim * 0.003 * visThick);
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius * 0.94, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < bins; i++) {
      const angle = (i / bins) * Math.PI * 2 - Math.PI / 2;
      const specIdx = config.mirrorVisualizer ? (i < bins / 2 ? i * 2 : (bins - 1 - i) * 2) : i;
      const amp = metrics.spectrum[Math.min(47, specIdx)] * minDim * 0.13 * visScale;
      const r1 = config.mirrorVisualizer ? baseRadius - amp * 0.35 : baseRadius;
      const r2 = baseRadius + Math.max(minDim * 0.006, amp);

      const x1 = cx + Math.cos(angle) * r1;
      const y1 = cy + Math.sin(angle) * r1;
      const x2 = cx + Math.cos(angle) * r2;
      const y2 = cy + Math.sin(angle) * r2;

      ctx.strokeStyle = i % 2 === 0 ? visPrimary : visSecondary;
      ctx.lineWidth = Math.max(1.5, minDim * 0.0052 * visThick);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  } else if (config.beatPreset === 'horizon_wave') {
    const areaW = width * 0.94 * visWidth;
    const startX = (width - areaW) / 2;
    const points = metrics.waveform.length;
    const ampScale = minDim * 0.14 * visScale * (0.75 + metrics.beatPulse * 0.55);

    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const px = startX + (i / (points - 1)) * areaW;
      const py = visY + metrics.waveform[i] * ampScale;
      if (i === 0) ctx.moveTo(px, py);
      else {
        const prevX = startX + ((i - 1) / (points - 1)) * areaW;
        const prevY = visY + metrics.waveform[i - 1] * ampScale;
        ctx.quadraticCurveTo(prevX, prevY, (prevX + px) / 2, (prevY + py) / 2);
      }
    }
    ctx.strokeStyle = visPrimary;
    ctx.lineWidth = Math.max(1.5, minDim * 0.0045 * visThick);
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const px = startX + (i / (points - 1)) * areaW;
      const py = visY - metrics.waveform[i] * ampScale * (config.mirrorVisualizer ? 1.0 : 0.55);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = hexToRgba(visSecondary, config.mirrorVisualizer ? 0.85 : 0.5);
    ctx.lineWidth = Math.max(1, minDim * (config.mirrorVisualizer ? 0.0038 : 0.0022) * visThick);
    ctx.stroke();
  } else if (config.beatPreset === 'beat_zoom') {
    const spanW = width * visWidth;
    const leftX = (width - spanW) / 2 + minDim * 0.03;
    const rightX = (width + spanW) / 2 - minDim * 0.03;
    const railH = (height - minDim * 0.09) * (0.15 + metrics.bass * 0.65) * visScale;
    const railW = Math.max(2, minDim * 0.0055 * visThick);
    ctx.fillStyle = visPrimary;
    ctx.beginPath();
    ctx.roundRect(leftX, (height - railH) / 2, railW, railH, railW / 2);
    ctx.roundRect(rightX - railW, (height - railH) / 2, railW, railH, railW / 2);
    ctx.fill();
  } else if (config.beatPreset === 'particle_drift') {
    const count = 68;
    const speedBoost = 1 + metrics.beatPulse * 1.8;
    const bandStart = (1 - visWidth) * 0.5;
    for (let i = 0; i < count; i++) {
      const seed1 = Math.sin(i * 12.9898) * 43758.5453;
      const seed2 = Math.sin(i * 78.233) * 43758.5453;
      const rx = seed1 - Math.floor(seed1);
      const ry = seed2 - Math.floor(seed2);

      const driftX = (rx + localTime * (0.015 + (i % 5) * 0.006) * speedBoost * 0.25) % 1;
      const driftY = (ry - localTime * (0.02 + (i % 7) * 0.005)) % 1;
      const px = (bandStart + driftX * visWidth) * width;
      const py = (driftY < 0 ? 1 + driftY : driftY) * height;
      const radius =
        minDim *
        (0.0025 + (i % 4) * 0.0014) *
        visScale *
        visThick *
        (1 + metrics.beatPulse * 0.75);

      ctx.fillStyle =
        i % 3 === 0
          ? hexToRgba(visPrimary, 0.35 + metrics.treble * 0.55)
          : hexToRgba(visSecondary, 0.25 + metrics.mid * 0.45);
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (config.beatPreset === 'editorial_frame') {
    const frameW = width * (0.45 + visWidth * 0.47);
    const frameX = (width - frameW) / 2;
    const padY = minDim * 0.05;
    const frameH = height - padY * 2;
    ctx.strokeStyle = hexToRgba(useCustomVis ? visPrimary : scheme.textColor, 0.22 + metrics.beatPulse * 0.35);
    ctx.lineWidth = Math.max(1, minDim * 0.0022 * visThick);
    ctx.strokeRect(frameX, padY, frameW, frameH);

    const progPad = minDim * 0.04;
    const progW = Math.max(20, frameW - progPad * 2);
    const progY = height - padY - progPad * 0.65;
    const barH = Math.max(2, minDim * 0.003 * visThick);
    ctx.fillStyle = hexToRgba(useCustomVis ? visPrimary : scheme.textColor, 0.18);
    ctx.fillRect(frameX + progPad, progY, progW, barH);
    ctx.fillStyle = visPrimary;
    ctx.fillRect(frameX + progPad, progY, progW * progress, barH);
  }

  ctx.restore();
  }

  // 5. Animated Typography Layer
  if (config.showText && (config.titleText || config.artistText || config.albumText)) {
    ctx.save();

    const safeBottomOffset = isVertical ? 0.18 : 0.11;
    let anchorY: number;
    if (config.textPlacement === 'top') {
      anchorY = height * (isVertical ? 0.15 : 0.14);
    } else if (config.textPlacement === 'center') {
      anchorY = height * 0.48;
    } else {
      const extraLift =
        config.showVisualizer !== false &&
        config.visualizerPlacement === 'bottom' &&
        (config.beatPreset === 'spectrum_bars' || config.beatPreset === 'horizon_wave')
          ? minDim * 0.18
          : 0;
      anchorY = height * (1 - safeBottomOffset) - extraLift;
    }

    let textOpacity = 1;
    let offsetY = 0;
    let scaleMod = 1;
    let extraSpacingEm = 0;
    let rawTitle = config.textUppercase ? config.titleText.toUpperCase() : config.titleText;
    const rawArtist = config.textUppercase ? config.artistText.toUpperCase() : config.artistText;
    const rawAlbum = config.textUppercase ? config.albumText.toUpperCase() : config.albumText;
    let glitchOffset = 0;

    if (!reducedMotion) {
      if (config.textAnimation === 'fade_rise') {
        const enter = Math.min(1, localTime / 1.1);
        const eased = 1 - Math.pow(1 - enter, 3);
        textOpacity = eased;
        offsetY = (1 - eased) * minDim * 0.035;
      } else if (config.textAnimation === 'beat_pop') {
        scaleMod = 1 + metrics.beatPulse * 0.075;
      } else if (config.textAnimation === 'typewriter') {
        const charsCount = Math.max(
          1,
          Math.floor(Math.min(1, localTime / 1.6) * rawTitle.length)
        );
        rawTitle = rawTitle.slice(0, charsCount);
      } else if (config.textAnimation === 'chromatic_shift') {
        glitchOffset = metrics.beatPulse > 0.35 ? metrics.beatPulse * minDim * 0.007 : 0;
      } else if (config.textAnimation === 'kerning_breathe') {
        extraSpacingEm = 0.04 * (0.5 + 0.5 * Math.sin(localTime * 1.4)) + metrics.bass * 0.035;
      }
    }

    ctx.globalAlpha = textOpacity;
    ctx.textBaseline = 'middle';

    const sideMargin = width * 0.08;
    const anchorX =
      config.textAlign === 'left'
        ? sideMargin
        : config.textAlign === 'right'
          ? width - sideMargin
          : width * 0.5;

    const titleSize = Math.round(minDim * 0.056 * config.fontSizeScale * scaleMod);
    const artistSize = Math.round(minDim * 0.028 * config.fontSizeScale);
    const albumSize = Math.round(minDim * 0.02 * config.fontSizeScale);
    const maxTextWidth = width * 0.84;

    ctx.font = `${config.fontWeight} ${titleSize}px "${config.fontFamily}", sans-serif`;
    const titleSpacingPx = titleSize * (config.letterSpacingEm + extraSpacingEm);
    const titleLines = rawTitle ? wrapTextLines(ctx, rawTitle, maxTextWidth, titleSpacingPx) : [];

    const lineHeight = titleSize * 1.18;
    const titleBlockHeight = titleLines.length * lineHeight;

    const artistY = anchorY - titleBlockHeight * 0.5 - artistSize * 1.05 + offsetY;
    const titleStartY = anchorY - ((titleLines.length - 1) * lineHeight) / 2 + offsetY;
    const albumY = anchorY + titleBlockHeight * 0.5 + albumSize * 1.15 + offsetY;

    if (config.textBackdrop === 'glass_box') {
      const boxTop =
        (rawArtist.trim() ? artistY - artistSize : titleStartY - lineHeight * 0.6) - minDim * 0.022;
      const boxBottom =
        (rawAlbum.trim()
          ? albumY + albumSize
          : titleStartY + (titleLines.length - 0.5) * lineHeight) +
        minDim * 0.022;
      const boxW = width * 0.88;
      const boxX = (width - boxW) / 2;
      ctx.fillStyle = hexToRgba(scheme.scrimTint, 0.55);
      ctx.strokeStyle = hexToRgba(scheme.accentColor, 0.35);
      ctx.lineWidth = Math.max(1, minDim * 0.0018);
      ctx.beginPath();
      ctx.roundRect(boxX, boxTop, boxW, boxBottom - boxTop, minDim * 0.016);
      ctx.fill();
      ctx.stroke();
    } else if (config.textBackdrop === 'accent_line') {
      const lineW = minDim * 0.18;
      const lineY =
        (rawAlbum.trim() ? albumY + albumSize * 0.85 : anchorY + titleBlockHeight * 0.55) + offsetY;
      const lineX =
        config.textAlign === 'left'
          ? anchorX
          : config.textAlign === 'right'
            ? anchorX - lineW
            : anchorX - lineW / 2;
      ctx.fillStyle = scheme.accentColor;
      ctx.fillRect(lineX, lineY, lineW, Math.max(2, minDim * 0.004));
    }

    if (config.textShadowStrength > 0.02) {
      ctx.shadowColor = `rgba(0, 0, 0, ${Math.min(0.95, config.textShadowStrength * 0.9)})`;
      ctx.shadowBlur = minDim * 0.022 * config.textShadowStrength;
      ctx.shadowOffsetY = minDim * 0.004 * config.textShadowStrength;
    }

    if (rawArtist.trim()) {
      ctx.font = `600 ${artistSize}px "${config.fontFamily}", sans-serif`;
      ctx.fillStyle = scheme.accentColor;
      drawAlignedTextWithSpacing(
        ctx,
        rawArtist.trim(),
        anchorX,
        artistY,
        artistSize * (config.letterSpacingEm + 0.06),
        config.textAlign
      );
    }

    ctx.font = `${config.fontWeight} ${titleSize}px "${config.fontFamily}", sans-serif`;
    titleLines.forEach((line, idx) => {
      const ly = titleStartY + idx * lineHeight;
      if (glitchOffset > 0.5) {
        ctx.fillStyle = hexToRgba(scheme.accentColor, 0.65);
        drawAlignedTextWithSpacing(ctx, line, anchorX - glitchOffset, ly, titleSpacingPx, config.textAlign);
        ctx.fillStyle = hexToRgba(scheme.visualizerSecondary, 0.55);
        drawAlignedTextWithSpacing(ctx, line, anchorX + glitchOffset, ly, titleSpacingPx, config.textAlign);
      }
      ctx.fillStyle = scheme.textColor;
      drawAlignedTextWithSpacing(ctx, line, anchorX, ly, titleSpacingPx, config.textAlign);
    });

    if (rawAlbum.trim()) {
      ctx.font = `400 ${albumSize}px "${config.fontFamily}", sans-serif`;
      ctx.fillStyle = hexToRgba(scheme.secondaryTextColor, 0.85);
      drawAlignedTextWithSpacing(
        ctx,
        rawAlbum.trim(),
        anchorX,
        albumY,
        albumSize * (config.letterSpacingEm + 0.04),
        config.textAlign
      );
    }

    ctx.restore();
  }

  // 5b. Color LUTs & Beat RGB Glitch
  drawLutAndGlitch(
    ctx,
    width,
    height,
    config.lutPreset,
    config.stabilizeMotion ? 0 : config.glitchStrength,
    beatPulseOff ? 0 : metrics.beatPulse,
    localTime,
    scheme.accentColor,
    scheme.visualizerSecondary
  );

  // 5b-2. Cinema Widescreen Letterbox Bars (2.39:1 / user matte)
  const letterboxRatio = Math.max(0, Math.min(0.14, config.letterboxAmount ?? 0));
  if (letterboxRatio > 0.004) {
    const barH = Math.round(height * letterboxRatio);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, barH);
    ctx.fillRect(0, height - barH, width, barH);
  }

  // 5c. Multi-Layer Text & Image Overlays (respect startSec / durationSec timing and optional fadeSec)
  if (config.overlays && config.overlays.length > 0) {
    for (const ov of config.overlays) {
      const win = resolveOverlayWindow(ov, localTime, clipDuration);
      if (!win.visible) continue;
      const fadeSec = Math.max(0, Math.min(1.5, ov.fadeSec ?? 0));
      const fadeInEnv =
        fadeSec > 0.01 ? computeFadeEnvelope(win.relTime, win.durationSec, fadeSec, 0) : 1;
      const fadeOutEnv =
        fadeSec > 0.01 && (win.endSec !== null || (ov.startSec ?? 0) > 0)
          ? computeFadeEnvelope(win.relTime, win.durationSec, 0, fadeSec)
          : 1;
      const alpha = Math.max(0, Math.min(1, ov.opacity * fadeInEnv * fadeOutEnv));
      if (alpha <= 0.005) continue;

      ctx.save();
      ctx.globalAlpha = alpha;
      const ox = ov.xPct * width;
      const oy = ov.yPct * height;
      if (ov.kind === 'image' && ov.imageElement && ov.imageElement.complete && ov.imageElement.naturalWidth > 0) {
        const baseW = minDim * 0.18 * ov.scale;
        const aspect = ov.imageElement.naturalWidth / Math.max(1, ov.imageElement.naturalHeight);
        const drawW = baseW;
        const drawH = baseW / aspect;
        ctx.drawImage(ov.imageElement, ox - drawW / 2, oy - drawH / 2, drawW, drawH);
      } else if (ov.kind === 'text' && ov.text) {
        const fontSize = Math.round(minDim * 0.032 * ov.scale);
        ctx.font = `600 ${fontSize}px "${config.fontFamily}", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = fontSize * 0.35;
        ctx.fillStyle = ov.color || scheme.textColor;
        ctx.fillText(ov.text, ox, oy);
      }
      ctx.restore();
    }
  }

  // 5d. Synchronized Subtitles (SRT / VTT)
  if (config.showSubtitles && config.subtitles && config.subtitles.length > 0) {
    const activeCue = config.subtitles.find(
      (c) => absTime >= c.startSec && absTime <= c.endSec
    );
    if (activeCue) {
      ctx.save();
      const subSize = Math.round(minDim * 0.034 * (config.subtitleSizeScale || 1));
      ctx.font = `600 ${subSize}px "${config.fontFamily}", sans-serif`;
      const maxSubW = width * 0.84;
      const lines = wrapTextLines(ctx, activeCue.text, maxSubW, 0);
      const lineH = subSize * 1.28;
      const blockH = lines.length * lineH;
      const padX = subSize * 0.7;
      const padY = subSize * 0.38;
      const subY =
        config.textPlacement === 'bottom' && config.showText
          ? height * (isVertical ? 0.65 : 0.72)
          : height * (isVertical ? 0.82 : 0.88);
      const widest = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
      const boxW = Math.min(maxSubW + padX * 2, widest + padX * 2);
      const boxH = blockH + padY * 2;

      ctx.fillStyle = 'rgba(8, 10, 14, 0.76)';
      ctx.beginPath();
      ctx.roundRect((width - boxW) / 2, subY - boxH / 2, boxW, boxH, subSize * 0.3);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach((line, idx) => {
        const ly = subY - ((lines.length - 1) * lineH) / 2 + idx * lineH;
        ctx.fillText(line, width * 0.5, ly);
      });
      ctx.restore();
    }
  }

  // 6. Synchronized Fade-In & Fade-Out Blackout Overlay
  const envelope = computeFadeEnvelope(
    localTime,
    clipDuration,
    config.fadeInSec,
    config.fadeOutSec
  );
  if (envelope < 0.999) {
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, Math.min(1, 1 - envelope))})`;
    ctx.fillRect(0, 0, width, height);
  }

  // 7. Preview-Only Reels / TikTok Safe Zone Overlay
  if (!isExport && config.showSafeZones) {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.72)';
    ctx.lineWidth = Math.max(1, minDim * 0.002);
    const topSafe = height * (isVertical ? 0.12 : 0.08);
    const botSafe = height * (isVertical ? 0.22 : 0.12);
    const rightSafe = width * (isVertical ? 0.14 : 0.06);
    const leftSafe = width * 0.06;
    ctx.strokeRect(leftSafe, topSafe, width - leftSafe - rightSafe, height - topSafe - botSafe);
    ctx.restore();
  }

  ctx.restore();
}
