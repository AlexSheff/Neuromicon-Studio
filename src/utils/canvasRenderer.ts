import {
  AudioFrameMetrics,
  MediaColorFilter,
  StudioConfig,
  VisualMediaState,
} from '../types/studio';
import { computeFadeEnvelope, resolveActiveSlideshowSlice } from './audioAnalyzer';
import { resolveColorScheme } from './presets';
import { proceduralShaderEngine } from './proceduralShaders';

export interface RenderFrameParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  localTime: number;
  clipDuration: number;
  metrics: AudioFrameMetrics;
  config: StudioConfig;
  mediaItems: VisualMediaState[];
  beatCutTimestamps: number[];
  reducedMotion?: boolean;
  isExport?: boolean;
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
  source: HTMLImageElement | HTMLVideoElement,
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

function drawFitBlurBackdrop(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLVideoElement,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  scaleFactor: number,
  config: StudioConfig
) {
  ctx.save();
  ctx.filter = buildFilterString(
    config.mediaFilter,
    config.mediaBrightness * 0.48,
    config.mediaBlur,
    Math.round(Math.min(dstW, dstH) * 0.032)
  );
  drawCoverImage(ctx, source, srcW, srcH, dstW, dstH, 1.14, 0, 0);
  ctx.restore();

  const padding = Math.min(dstW, dstH) * 0.08;
  const availW = dstW - padding * 2;
  const availH = dstH - padding * 2;
  const srcRatio = srcW / srcH;
  const availRatio = availW / availH;

  let drawW: number;
  let drawH: number;
  if (srcRatio > availRatio) {
    drawW = availW * scaleFactor;
    drawH = drawW / srcRatio;
  } else {
    drawH = availH * scaleFactor;
    drawW = drawH * srcRatio;
  }

  const x = (dstW - drawW) / 2;
  const y = (dstH - drawH) / 2;

  ctx.save();
  ctx.filter = buildFilterString(config.mediaFilter, config.mediaBrightness, config.mediaBlur);
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = Math.min(dstW, dstH) * 0.04;
  ctx.shadowOffsetY = Math.min(dstW, dstH) * 0.015;
  ctx.drawImage(source as CanvasImageSource, x, y, drawW, drawH);
  ctx.restore();
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
  metrics: AudioFrameMetrics,
  accentColor: string,
  secondaryColor: string,
  offsetX = 0,
  alpha = 1
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (offsetX !== 0) ctx.translate(offsetX, 0);

  if (media.kind === 'generator') {
    const genEffect =
      media.generatorId && media.generatorId !== 'none'
        ? media.generatorId
        : 'galaxy_spiral';
    proceduralShaderEngine.renderToCanvas2D(ctx, {
      effect: genEffect,
      width,
      height,
      time: localTime,
      metrics,
      accentHex: accentColor,
      secondaryHex: secondaryColor,
      speed: config.generatorSpeed,
      scale: config.generatorScale,
      beatReact: config.generatorBeatReact,
    });
    ctx.restore();
    return;
  }

  const sourceEl = media.kind === 'video' ? media.videoElement : media.imageElement;
  const mediaReady =
    sourceEl &&
    (media.kind === 'image'
      ? (sourceEl as HTMLImageElement).complete && (sourceEl as HTMLImageElement).naturalWidth > 0
      : (sourceEl as HTMLVideoElement).readyState >= 2);

  if (!sourceEl || !mediaReady || media.width <= 0 || media.height <= 0) {
    ctx.restore();
    return;
  }

  if (config.framingMode === 'fit_blur') {
    drawFitBlurBackdrop(ctx, sourceEl, media.width, media.height, width, height, pulseScale, config);
  } else {
    ctx.filter = buildFilterString(config.mediaFilter, config.mediaBrightness, config.mediaBlur);
    drawCoverImage(
      ctx,
      sourceEl,
      media.width,
      media.height,
      width,
      height,
      totalScale,
      panX,
      panY
    );
  }
  ctx.restore();
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

export function renderStudioFrame(params: RenderFrameParams): void {
  const {
    ctx,
    width,
    height,
    localTime,
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
  ctx.fillStyle = '#090b10';
  ctx.fillRect(0, 0, width, height);

  if (
    config.generatorEffect !== 'none' &&
    (mediaItems.length === 0 || config.generatorBlend === 'backdrop')
  ) {
    ctx.save();
    ctx.globalAlpha = mediaItems.length === 0 ? Math.max(0.45, config.generatorOpacity) : config.generatorOpacity;
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
    });
    ctx.restore();
  }

  const pulseScale =
    config.beatPreset === 'beat_zoom'
      ? 1 + metrics.beatPulse * 0.085 * config.visualizerScale
      : 1 + metrics.beatPulse * 0.032 * config.backgroundPulse;

  const progress = clipDuration > 0 ? Math.min(1, localTime / clipDuration) : 0;
  const kenBurnsScale = config.kenBurnsMotion && !reducedMotion ? 1 + progress * 0.065 : 1;
  const totalScale = pulseScale * kenBurnsScale;

  const panX =
    config.kenBurnsMotion && !reducedMotion
      ? Math.sin(localTime * 0.18) * width * 0.012
      : 0;
  const panY =
    config.kenBurnsMotion && !reducedMotion
      ? Math.cos(localTime * 0.14) * height * 0.012
      : 0;

  // 2. Multi-Clip Sequence Layer
  if (mediaItems.length > 0) {
    const slice = resolveActiveSlideshowSlice(
      mediaItems,
      localTime,
      clipDuration,
      config,
      beatCutTimestamps
    );
    const activeMedia = mediaItems[slice.activeIndex];
    const prevMedia = slice.prevIndex !== null ? mediaItems[slice.prevIndex] : null;
    const p = slice.transitionProgress;

    const slideKenActive =
      config.kenBurnsMotion && !reducedMotion
        ? pulseScale * (1 + Math.min(0.08, slice.slideLocalTime * 0.012))
        : pulseScale;
    const slideKenPrev =
      config.kenBurnsMotion && !reducedMotion
        ? pulseScale * (1 + Math.min(0.08, slice.prevSlideLocalTime * 0.012))
        : pulseScale;

    if (prevMedia && p < 0.999) {
      if (slice.transitionType === 'crossfade') {
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
          metrics,
          scheme.accentColor,
          scheme.visualizerSecondary,
          0,
          1 - p
        );
        drawSingleClipLayer(
          ctx,
          activeMedia,
          width,
          height,
          mediaItems.length > 1 ? slideKenActive : totalScale,
          pulseScale,
          panX,
          panY,
          config,
          localTime,
          metrics,
          scheme.accentColor,
          scheme.visualizerSecondary,
          0,
          p
        );
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
            metrics,
            scheme.accentColor,
            scheme.visualizerSecondary,
            0,
            1 - p * 2
          );
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
            metrics,
            scheme.accentColor,
            scheme.visualizerSecondary,
            0,
            (p - 0.5) * 2
          );
        }
      } else if (slice.transitionType === 'slide') {
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
          metrics,
          scheme.accentColor,
          scheme.visualizerSecondary,
          -p * width,
          1
        );
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
          metrics,
          scheme.accentColor,
          scheme.visualizerSecondary,
          (1 - p) * width,
          1
        );
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
          metrics,
          scheme.accentColor,
          scheme.visualizerSecondary
        );
      }
    } else if (activeMedia) {
      drawSingleClipLayer(
        ctx,
        activeMedia,
        width,
        height,
        mediaItems.length > 1 ? slideKenActive : totalScale,
        pulseScale,
        panX,
        panY,
        config,
        localTime,
        metrics,
        scheme.accentColor,
        scheme.visualizerSecondary
      );
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

  if (metrics.beatPulse > 0.08 && (config.backgroundPulse > 0.05 || config.beatPreset === 'beat_zoom')) {
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
      grad.addColorStop(0, scheme.visualizerSecondary);
      grad.addColorStop(1, scheme.accentColor);
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

    ctx.strokeStyle = hexToRgba(scheme.accentColor, 0.35 + metrics.beatPulse * 0.45);
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

      ctx.strokeStyle = i % 2 === 0 ? scheme.accentColor : scheme.visualizerSecondary;
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
    ctx.strokeStyle = scheme.accentColor;
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
    ctx.strokeStyle = hexToRgba(scheme.visualizerSecondary, config.mirrorVisualizer ? 0.85 : 0.5);
    ctx.lineWidth = Math.max(1, minDim * (config.mirrorVisualizer ? 0.0038 : 0.0022) * visThick);
    ctx.stroke();
  } else if (config.beatPreset === 'beat_zoom') {
    const spanW = width * visWidth;
    const leftX = (width - spanW) / 2 + minDim * 0.03;
    const rightX = (width + spanW) / 2 - minDim * 0.03;
    const railH = (height - minDim * 0.09) * (0.15 + metrics.bass * 0.65) * visScale;
    const railW = Math.max(2, minDim * 0.0055 * visThick);
    ctx.fillStyle = scheme.accentColor;
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
          ? hexToRgba(scheme.accentColor, 0.35 + metrics.treble * 0.55)
          : hexToRgba(scheme.visualizerSecondary, 0.25 + metrics.mid * 0.45);
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (config.beatPreset === 'editorial_frame') {
    const frameW = width * (0.45 + visWidth * 0.47);
    const frameX = (width - frameW) / 2;
    const padY = minDim * 0.05;
    const frameH = height - padY * 2;
    ctx.strokeStyle = hexToRgba(scheme.textColor, 0.22 + metrics.beatPulse * 0.35);
    ctx.lineWidth = Math.max(1, minDim * 0.0022 * visThick);
    ctx.strokeRect(frameX, padY, frameW, frameH);

    const progPad = minDim * 0.04;
    const progW = Math.max(20, frameW - progPad * 2);
    const progY = height - padY - progPad * 0.65;
    const barH = Math.max(2, minDim * 0.003 * visThick);
    ctx.fillStyle = hexToRgba(scheme.textColor, 0.18);
    ctx.fillRect(frameX + progPad, progY, progW, barH);
    ctx.fillStyle = scheme.accentColor;
    ctx.fillRect(frameX + progPad, progY, progW * progress, barH);
  }

  ctx.restore();

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
