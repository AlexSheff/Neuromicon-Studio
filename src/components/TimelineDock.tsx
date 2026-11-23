import {
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Crosshair,
  Flag,
  GripHorizontal,
  Layers,
  Magnet,
  Maximize2,
  Minus,
  MoreHorizontal,
  Orbit,
  Plus,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Volume2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tFor } from '../i18n';
import {
  AudioTrackState,
  BeatSyncMode,
  GeneratorEffectId,
  Language,
  OverlayBlendMode,
  OverlayLayer,
  SlideTransitionType,
  SlideshowMode,
  StudioConfig,
  TimelineGeneratorOverlay,
  VisualMediaState,
} from '../types/studio';
import {
  computeClipTimelineSegments,
  getTimelineSpanSec,
  packTimelineLanes,
  snapTimeToBeat,
} from '../utils/audioAnalyzer';
import { GENERATOR_EFFECTS } from '../utils/presets';

interface TimelineDockProps {
  lang: Language;
  audio: AudioTrackState | null;
  mediaItems: VisualMediaState[];
  selectedClipId: string | null;
  selectedFxId: string | null;
  beatCutTimestamps: number[];
  config: StudioConfig;
  currentTime: number;
  onSeekAbsolute: (sec: number) => void;
  onSelectClip: (id: string) => void;
  onSelectFx: (id: string | null) => void;
  onInspectClip: (id: string) => void;
  onInspectFx: (id: string) => void;
  onUpdateClip: (id: string, patch: Partial<VisualMediaState>) => void;
  onMoveClipPosition?: (clipId: string, rawStartSec: number) => void;
  onTrimClipLeftEdge?: (
    clipId: string,
    nextStartSec: number,
    nextDurSec: number,
    nextSourceStartSec?: number
  ) => void;
  onDropBinItemToTimeline?: (binItemId: string, atTimeSec: number) => void;
  onDropFilesToTimeline?: (files: File[], atTimeSec: number) => void;
  onApplyClipOverlay: (
    clipId: string,
    effect: GeneratorEffectId,
    blend?: OverlayBlendMode,
    opacity?: number,
    snapshotGlobalParams?: boolean
  ) => void;
  onVisualFiles: (files: File[]) => void;
  onDuplicateClip: (id: string) => void;
  onReorderClip: (fromIdx: number, toIdx: number) => void;
  onReverseClips: () => void;
  onCycleClipTransition: (id: string) => void;
  onSetClipTransition: (id: string, tr: SlideTransitionType, applyAll?: boolean) => void;
  onAddGeneratorScene: (
    effect: Exclude<GeneratorEffectId, 'none'>,
    snapshotGlobalParams?: boolean
  ) => void;
  onAddFxOverlay: (
    effect: Exclude<GeneratorEffectId, 'none'>,
    target?: 'clip' | 'playhead',
    snapshotGlobalParams?: boolean
  ) => void;
  onUpdateFxOverlay: (id: string, patch: Partial<TimelineGeneratorOverlay>) => void;
  onDuplicateFxOverlay: (id: string) => void;
  onRemoveFxOverlay: (id: string) => void;
  onFitFxToSelectedClip: (fxId: string) => void;
  onSnapFxOverlaysToBeats: () => void;
  onUpdateOverlay?: (id: string, patch: Partial<OverlayLayer>) => void;
  onMaterializeLoopSegment?: (upToStepIndex: number) => void;
  onSplitClipAtPlayhead: () => void;
  onRippleDeleteSelected: () => void;
  onToggleSnapToBeats: () => void;
  onAddBeatMarker: () => void;
  onToggleBeatMarkerAt: (absSec: number) => void;
  onClearBeatMarkers: () => void;
  onAutoBeatSyncClips: (mode?: BeatSyncMode, applyMotionAndTrans?: boolean) => void;
  trackBpm: number;
  beatGridPoints: number[];
  onSetTrimStart: (sec: number) => void;
  onSetTrimEnd: (sec: number) => void;
  onChangeSlideshowMode?: (mode: SlideshowMode) => void;
  autoZoomSignal?: { nonce: number; targetZoom: number; focusStartSec?: number } | null;
}

type GenAddTarget = 'fx_track' | 'clip_overlay' | 'clip_scene';

interface TimelineTrackDesc {
  id: 'ruler' | 'clips' | 'fx' | 'overlays' | 'audio' | 'subtitles';
  heightPx: number;
}

interface PopoverCoords {
  left: number;
  bottom: number;
}

const DOCK_COLLAPSED_STORAGE = 'neuromicon_timeline_collapsed_v1';
const DOCK_HEIGHT_STORAGE = 'neuromicon_timeline_height_v1';

function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // ignore storage errors
  }
  return fallback;
}

function readStoredHeight(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const num = raw ? Number(raw) : NaN;
    if (Number.isFinite(num) && num >= 140 && num <= 360) return num;
  } catch {
    // ignore
  }
  return fallback;
}

function formatRulerTick(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.round((safe % 1) * 10);
  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  return tenths > 0 && tenths < 10 ? `${secs}.${tenths}s` : `${secs}s`;
}

function transitionShortTag(tr: SlideTransitionType): string {
  switch (tr) {
    case 'crossfade':
      return 'CF';
    case 'zoom_cross':
      return 'ZM';
    case 'wipe_right':
      return 'WP';
    case 'dip_black':
      return 'DIP';
    case 'slide':
      return 'SLD';
    case 'cut':
      return 'CUT';
  }
}

function drawWaveformCanvas(
  canvas: HTMLCanvasElement | null,
  peaks: number[],
  options: {
    duration: number;
    playedSec: number;
    trimStartSec?: number;
    trimEndSec?: number;
    showTrimHighlight: boolean;
  }
) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(10, Math.floor(rect.width));
  const h = Math.max(8, Math.floor(rect.height));
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (peaks.length === 0 || options.duration <= 0) {
    // Subtle baseline dots when no audio loaded
    const count = Math.max(24, Math.floor(w / 10));
    const barW = Math.max(2, w / count - 2);
    ctx.fillStyle = '#1D2230';
    for (let i = 0; i < count; i++) {
      const x = (i / count) * w + 1;
      ctx.fillRect(x, h / 2 - 1, barW, 2);
    }
    ctx.restore();
    return;
  }

  const maxBars = Math.min(peaks.length, Math.max(24, Math.floor(w / 3)));
  const stride = peaks.length / maxBars;
  const slotW = w / maxBars;
  const barW = Math.max(1.2, slotW - 1);

  for (let i = 0; i < maxBars; i++) {
    const startSample = Math.floor(i * stride);
    const endSample = Math.min(peaks.length, Math.max(startSample + 1, Math.floor((i + 1) * stride)));
    let maxPeak = 0;
    for (let j = startSample; j < endSample; j++) {
      if (peaks[j] > maxPeak) maxPeak = peaks[j];
    }

    const barSec = ((i + 0.5) / maxBars) * options.duration;
    const isPlayed = barSec <= options.playedSec;
    const insideTrim = options.showTrimHighlight
      ? barSec >= (options.trimStartSec ?? 0) && barSec <= (options.trimEndSec ?? options.duration)
      : true;

    ctx.fillStyle = isPlayed
      ? '#F59E0B'
      : insideTrim
        ? options.showTrimHighlight
          ? '#6B7280'
          : '#525B70'
        : '#262B38';

    const barH = Math.max(2, maxPeak * (h * 0.84));
    const x = i * slotW + 0.5;
    const y = (h - barH) * 0.5;
    ctx.fillRect(x, y, barW, barH);
  }
  ctx.restore();
}

export function TimelineDock({
  lang,
  audio,
  mediaItems,
  selectedClipId,
  selectedFxId,
  beatCutTimestamps,
  config,
  currentTime,
  onSeekAbsolute,
  onSelectClip,
  onSelectFx,
  onInspectClip,
  onInspectFx,
  onUpdateClip,
  onMoveClipPosition,
  onTrimClipLeftEdge,
  onDropBinItemToTimeline,
  onDropFilesToTimeline,
  onApplyClipOverlay,
  onVisualFiles,
  onDuplicateClip,
  onReorderClip,
  onReverseClips,
  onSetClipTransition,
  onAddGeneratorScene,
  onAddFxOverlay,
  onUpdateFxOverlay,
  onDuplicateFxOverlay,
  onRemoveFxOverlay,
  onFitFxToSelectedClip,
  onSnapFxOverlaysToBeats,
  onUpdateOverlay,
  onMaterializeLoopSegment,
  onSplitClipAtPlayhead,
  onRippleDeleteSelected,
  onToggleSnapToBeats,
  onAddBeatMarker,
  onToggleBeatMarkerAt,
  onClearBeatMarkers,
  onAutoBeatSyncClips,
  trackBpm,
  beatGridPoints,
  onSetTrimStart,
  onSetTrimEnd,
  onChangeSlideshowMode,
  autoZoomSignal,
}: TimelineDockProps) {
  const t = tFor(lang);

  const [collapsed, setCollapsed] = useState(() => readStoredBool(DOCK_COLLAPSED_STORAGE, false));
  const [dockHeightPx, setDockHeightPx] = useState(() => readStoredHeight(DOCK_HEIGHT_STORAGE, 210));
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const [selectedLoopSegIdx, setSelectedLoopSegIdx] = useState<number | null>(null);

  const [genMenuOpen, setGenMenuOpen] = useState(false);
  const [genCoords, setGenCoords] = useState<PopoverCoords | null>(null);
  const [genTarget, setGenTarget] = useState<GenAddTarget>('fx_track');

  const [beatSyncOpen, setBeatSyncOpen] = useState(false);
  const [beatSyncCoords, setBeatSyncCoords] = useState<PopoverCoords | null>(null);
  const [beatSyncMotion, setBeatSyncMotion] = useState(true);

  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moreCoords, setMoreCoords] = useState<PopoverCoords | null>(null);

  const [transMenu, setTransMenu] = useState<{
    clipId: string;
    coords: PopoverCoords;
  } | null>(null);

  const [timelineZoom, setTimelineZoom] = useState(1);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [clipDropPreview, setClipDropPreview] = useState<{
    pct: number;
    anchoredToPlayhead: boolean;
  } | null>(null);
  const [clipDragHud, setClipDragHud] = useState<{
    clipId: string;
    mode: 'move' | 'left' | 'right';
    startSec: number;
    endSec: number;
    durSec: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const masterTimelineRef = useRef<HTMLDivElement>(null);
  const masterCanvasRef = useRef<HTMLCanvasElement>(null);
  const seqScrollRef = useRef<HTMLDivElement>(null);
  const seqInnerRef = useRef<HTMLDivElement>(null);
  const seqAudioCanvasRef = useRef<HTMLCanvasElement>(null);

  const genBtnRef = useRef<HTMLButtonElement>(null);
  const beatSyncBtnRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  const genPortalRef = useRef<HTMLDivElement>(null);
  const beatSyncPortalRef = useRef<HTMLDivElement>(null);
  const morePortalRef = useRef<HTMLDivElement>(null);
  const transPortalRef = useRef<HTMLDivElement>(null);

  const trimDragModeRef = useRef<'in' | 'out' | null>(null);
  const dockResizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const clipResizeRef = useRef<{
    clipId: string;
    mode: 'move' | 'left' | 'right';
    kind: VisualMediaState['kind'];
    segStartSec: number;
    origSourceStartSec: number;
    playbackRate: number;
    startX: number;
    startDur: number;
    prevLimitSec: number;
    nextLimitSec: number;
    trackScaleSec: number;
    hasMoved: boolean;
  } | null>(null);
  const fxDragRef = useRef<{
    fxId: string;
    mode: 'move' | 'left' | 'right';
    startX: number;
    origStart: number;
    origDur: number;
    trackScaleSec: number;
  } | null>(null);
  const ovDragRef = useRef<{
    ovId: string;
    mode: 'move' | 'left' | 'right';
    startX: number;
    origStart: number;
    origDur: number;
    trackScaleSec: number;
  } | null>(null);

  const closeAllPopovers = useCallback(() => {
    setGenMenuOpen(false);
    setBeatSyncOpen(false);
    setMoreMenuOpen(false);
    setTransMenu(null);
  }, []);

  // Persist dock collapsed state & height
  useEffect(() => {
    try {
      window.localStorage.setItem(DOCK_COLLAPSED_STORAGE, collapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DOCK_HEIGHT_STORAGE, String(Math.round(dockHeightPx)));
    } catch {
      // ignore
    }
  }, [dockHeightPx]);

  // Global outside pointerdown & Escape/Resize handlers for portal popovers
  useEffect(() => {
    const hasOpen = genMenuOpen || beatSyncOpen || moreMenuOpen || Boolean(transMenu);
    if (!hasOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (
        genBtnRef.current?.contains(target) ||
        genPortalRef.current?.contains(target) ||
        beatSyncBtnRef.current?.contains(target) ||
        beatSyncPortalRef.current?.contains(target) ||
        moreBtnRef.current?.contains(target) ||
        morePortalRef.current?.contains(target) ||
        transPortalRef.current?.contains(target)
      ) {
        return;
      }
      closeAllPopovers();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeAllPopovers();
      }
    };

    const onViewportChange = () => {
      closeAllPopovers();
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [beatSyncOpen, closeAllPopovers, genMenuOpen, moreMenuOpen, transMenu]);

  // Dock vertical resize drag
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!dockResizeRef.current) return;
      const delta = dockResizeRef.current.startY - e.clientY;
      const nextH = Math.max(148, Math.min(360, dockResizeRef.current.startH + delta));
      setDockHeightPx(nextH);
    };
    const onPointerUp = () => {
      dockResizeRef.current = null;
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  const contentSpanSec = audio
    ? Math.max(0.5, config.trimEnd - config.trimStart)
    : getTimelineSpanSec(mediaItems, config);

  const clipDuration = audio
    ? contentSpanSec
    : Math.max(24, Math.ceil((contentSpanSec + Math.max(12, contentSpanSec * 0.35)) / 4) * 4);

  const trimBase = audio ? config.trimStart : 0;
  const localTime = Math.max(0, Math.min(clipDuration, currentTime - trimBase));

  const clipSegments = computeClipTimelineSegments(
    mediaItems,
    contentSpanSec,
    config,
    beatCutTimestamps
  );

  const selectedIndex = useMemo(() => {
    if (mediaItems.length === 0) return -1;
    const idx = mediaItems.findIndex((m) => m.id === selectedClipId);
    return idx >= 0 ? idx : 0;
  }, [mediaItems, selectedClipId]);

  const selectedClip = selectedIndex >= 0 ? mediaItems[selectedIndex] : null;
  const fxOverlays = config.fxOverlays || [];
  const selectedFx = useMemo(
    () => (selectedFxId ? fxOverlays.find((fx) => fx.id === selectedFxId) || null : null),
    [fxOverlays, selectedFxId]
  );

  // Clear loop-segment notice when switching away from a loop segment
  useEffect(() => {
    if (selectedLoopSegIdx === null) return;
    const seg = clipSegments[selectedLoopSegIdx];
    if (!seg || !seg.isLoopRepeat || mediaItems[seg.clipIndex]?.id !== selectedClipId) {
      setSelectedLoopSegIdx(null);
    }
  }, [clipSegments, mediaItems, selectedClipId, selectedLoopSegIdx]);

  // Multi-lane packing for FX Overlays & Overlay Layers
  const packedFx = useMemo(() => packTimelineLanes(fxOverlays), [fxOverlays]);

  const overlaySpans = useMemo(
    () =>
      config.overlays.map((ov) => {
        const startSec = Math.max(0, ov.startSec ?? 0);
        const rawDur =
          ov.durationSec && ov.durationSec > 0
            ? ov.durationSec
            : Math.max(0.4, contentSpanSec - startSec);
        return {
          ov,
          startSec,
          durationSec: Math.max(0.4, Math.min(clipDuration - startSec, rawDur)),
        };
      }),
    [clipDuration, config.overlays, contentSpanSec]
  );

  const packedOverlays = useMemo(() => packTimelineLanes(overlaySpans), [overlaySpans]);

  // Unified track height descriptor (keeps left labels & right tracks strictly aligned)
  const timelineTracks = useMemo<TimelineTrackDesc[]>(() => {
    const fxHeight = Math.max(32, packedFx.laneCount * 24 + 4);
    const tracks: TimelineTrackDesc[] = [
      { id: 'ruler', heightPx: 18 },
      { id: 'clips', heightPx: 44 },
      { id: 'fx', heightPx: fxHeight },
    ];
    if (config.overlays.length > 0) {
      tracks.push({
        id: 'overlays',
        heightPx: Math.max(28, packedOverlays.laneCount * 22 + 4),
      });
    }
    tracks.push({ id: 'audio', heightPx: 32 });
    if (config.subtitles.length > 0) {
      tracks.push({ id: 'subtitles', heightPx: 22 });
    }
    return tracks;
  }, [config.overlays.length, config.subtitles.length, packedFx.laneCount, packedOverlays.laneCount]);

  const absBeatPoints = useMemo(() => {
    const autoAbs = beatCutTimestamps.map((b) => trimBase + b);
    const gridAbs = beatGridPoints.map((b) => trimBase + b);
    return Array.from(new Set([...autoAbs, ...gridAbs, ...config.manualBeatMarkers])).sort(
      (a, b) => a - b
    );
  }, [beatCutTimestamps, beatGridPoints, config.manualBeatMarkers, trimBase]);

  const relSnapPoints = useMemo(() => {
    const manRel = config.manualBeatMarkers
      .map((m) => Number((m - trimBase).toFixed(3)))
      .filter((r) => r >= 0 && r <= clipDuration);
    const cutBounds = clipSegments.flatMap((s) => [s.startSec, s.endSec]);
    return Array.from(
      new Set([0, clipDuration, ...beatGridPoints, ...beatCutTimestamps, ...manRel, ...cutBounds])
    ).sort((a, b) => a - b);
  }, [beatCutTimestamps, beatGridPoints, clipDuration, clipSegments, config.manualBeatMarkers, trimBase]);

  const rulerTicks = useMemo(() => {
    const visibleSec = clipDuration / timelineZoom;
    const step =
      visibleSec <= 3
        ? 0.25
        : visibleSec <= 6
          ? 0.5
          : visibleSec <= 15
            ? 1
            : visibleSec <= 35
              ? 2
              : visibleSec <= 80
                ? 5
                : 10;
    const ticks: number[] = [];
    for (let s = 0; s <= clipDuration + 0.001; s += step) {
      ticks.push(Number(s.toFixed(2)));
    }
    return ticks;
  }, [clipDuration, timelineZoom]);

  const trimmedWaveformSlice = useMemo(() => {
    if (!audio || audio.duration <= 0) return [];
    const peaks = audio.waveformPeaks;
    const startIdx = Math.max(0, Math.floor((config.trimStart / audio.duration) * peaks.length));
    const endIdx = Math.min(
      peaks.length,
      Math.max(startIdx + 12, Math.ceil((config.trimEnd / audio.duration) * peaks.length))
    );
    return Array.from(peaks.slice(startIdx, endIdx));
  }, [audio, config.trimEnd, config.trimStart]);

  const playheadPct = Math.max(0, Math.min(100, (localTime / clipDuration) * 100));

  // Render crisp Master Waveform canvas
  useEffect(() => {
    if (collapsed || !audio || audio.duration <= 0) return;
    drawWaveformCanvas(masterCanvasRef.current, Array.from(audio.waveformPeaks), {
      duration: audio.duration,
      playedSec: currentTime,
      trimStartSec: config.trimStart,
      trimEndSec: config.trimEnd,
      showTrimHighlight: true,
    });
  }, [audio, collapsed, config.trimEnd, config.trimStart, currentTime]);

  // Render crisp Sequence Audio Slice Waveform canvas
  useEffect(() => {
    if (collapsed) return;
    drawWaveformCanvas(seqAudioCanvasRef.current, trimmedWaveformSlice, {
      duration: clipDuration,
      playedSec: localTime,
      showTrimHighlight: false,
    });
  }, [clipDuration, collapsed, localTime, timelineZoom, trimmedWaveformSlice]);

  // Repaint canvases on container resize
  useEffect(() => {
    if (collapsed) return;
    const observers: ResizeObserver[] = [];
    const masterEl = masterTimelineRef.current;
    const seqEl = seqScrollRef.current;

    if (masterEl && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (audio && audio.duration > 0) {
          drawWaveformCanvas(masterCanvasRef.current, Array.from(audio.waveformPeaks), {
            duration: audio.duration,
            playedSec: currentTime,
            trimStartSec: config.trimStart,
            trimEndSec: config.trimEnd,
            showTrimHighlight: true,
          });
        }
      });
      ro.observe(masterEl);
      observers.push(ro);
    }

    if (seqEl && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        drawWaveformCanvas(seqAudioCanvasRef.current, trimmedWaveformSlice, {
          duration: clipDuration,
          playedSec: localTime,
          showTrimHighlight: false,
        });
      });
      ro.observe(seqEl);
      observers.push(ro);
    }

    return () => {
      observers.forEach((ro) => ro.disconnect());
    };
  }, [audio, clipDuration, collapsed, config.trimEnd, config.trimStart, currentTime, localTime, trimmedWaveformSlice]);

  // Anchored zoom: preserve timeline second at anchor screen X when zoom changes
  const applyAnchoredZoom = useCallback(
    (rawNextZoom: number, viewportClientX?: number) => {
      const nextZoom = Math.max(1, Math.min(16, Number(rawNextZoom.toFixed(1))));
      const scrollEl = seqScrollRef.current;
      if (!scrollEl) {
        setTimelineZoom(nextZoom);
        return;
      }

      const rect = scrollEl.getBoundingClientRect();
      const viewW = Math.max(1, scrollEl.clientWidth);
      const oldContentW = Math.max(viewW, scrollEl.scrollWidth);
      const anchorViewX =
        viewportClientX !== undefined
          ? Math.max(0, Math.min(viewW, viewportClientX - rect.left))
          : Math.max(0, Math.min(viewW, (playheadPct / 100) * oldContentW - scrollEl.scrollLeft));

      const ratioInTimeline = Math.max(
        0,
        Math.min(1, (scrollEl.scrollLeft + anchorViewX) / oldContentW)
      );

      setTimelineZoom(nextZoom);
      requestAnimationFrame(() => {
        const el = seqScrollRef.current;
        if (!el) return;
        const newContentW = el.clientWidth * nextZoom;
        el.scrollLeft = Math.max(0, ratioInTimeline * newContentW - anchorViewX);
      });
    },
    [playheadPct]
  );

  // Auto-zoom cleanly when auto-clip generates dense or appended segments so clips stay readable
  useEffect(() => {
    if (!autoZoomSignal) return;
    const nextZoom = Math.max(1, Math.min(16, Number(autoZoomSignal.targetZoom.toFixed(1))));
    setTimelineZoom(nextZoom);
    const focusSec = autoZoomSignal.focusStartSec ?? 0;
    requestAnimationFrame(() => {
      const el = seqScrollRef.current;
      if (!el) return;
      const contentW = el.clientWidth * nextZoom;
      const targetX = clipDuration > 0 ? (focusSec / clipDuration) * contentW : 0;
      el.scrollLeft = Math.max(0, Math.min(contentW - el.clientWidth, targetX - el.clientWidth * 0.15));
    });
  }, [autoZoomSignal, clipDuration]);

  // Auto-follow playhead when zoomed in
  useEffect(() => {
    if (!followPlayhead || timelineZoom <= 1 || collapsed) return;
    const el = seqScrollRef.current;
    if (!el) return;
    const viewW = el.clientWidth;
    const contentW = viewW * timelineZoom;
    if (contentW <= viewW + 2) return;

    const playheadX = (playheadPct / 100) * contentW;
    if (playheadX < el.scrollLeft + viewW * 0.12 || playheadX > el.scrollLeft + viewW * 0.85) {
      el.scrollLeft = Math.max(0, Math.min(contentW - viewW, playheadX - viewW * 0.35));
    }
  }, [collapsed, followPlayhead, playheadPct, timelineZoom]);

  const jumpScrollToPlayhead = useCallback(() => {
    const el = seqScrollRef.current;
    if (!el) return;
    const viewW = el.clientWidth;
    const contentW = viewW * timelineZoom;
    const playheadX = (playheadPct / 100) * contentW;
    el.scrollLeft = Math.max(0, Math.min(contentW - viewW, playheadX - viewW * 0.4));
  }, [playheadPct, timelineZoom]);

  const scrubMasterAtClientX = (clientX: number) => {
    if (!audio || !masterTimelineRef.current) return;
    const rect = masterTimelineRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    let targetSec = ratio * audio.duration;
    if (config.snapToBeats && absBeatPoints.length > 0) {
      targetSec = snapTimeToBeat(targetSec, absBeatPoints, 0.25);
    }
    onSeekAbsolute(targetSec);
  };

  const scrubSequenceAtClientX = (clientX: number) => {
    if (!seqInnerRef.current) return;
    const rect = seqInnerRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    let targetSec = trimBase + ratio * clipDuration;
    if (config.snapToBeats && absBeatPoints.length > 0) {
      targetSec = snapTimeToBeat(targetSec, absBeatPoints, 0.22);
    }
    onSeekAbsolute(targetSec);
  };

  const handleMasterPointerDown = (e: React.PointerEvent) => {
    if (!audio || trimDragModeRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubMasterAtClientX(e.clientX);
  };

  const handleMasterPointerMove = (e: React.PointerEvent) => {
    if (!audio || !masterTimelineRef.current || (e.buttons & 1) === 0) return;
    if (trimDragModeRef.current) {
      const rect = masterTimelineRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const sec = Number((ratio * audio.duration).toFixed(2));
      if (trimDragModeRef.current === 'in') {
        onSetTrimStart(sec);
      } else {
        onSetTrimEnd(sec);
      }
      return;
    }
    scrubMasterAtClientX(e.clientX);
  };

  const handleMasterPointerUp = () => {
    trimDragModeRef.current = null;
  };

  const handleSeqScrubPointerDown = (e: React.PointerEvent) => {
    if (clipResizeRef.current || fxDragRef.current || ovDragRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubSequenceAtClientX(e.clientX);
  };

  const handleSeqScrubPointerMove = (e: React.PointerEvent) => {
    if ((e.buttons & 1) === 0 || clipResizeRef.current || fxDragRef.current || ovDragRef.current) return;
    scrubSequenceAtClientX(e.clientX);
  };

  const setClipDuration = (clipId: string, rawDur: number) => {
    const clamped = Math.max(0.5, Math.min(120, Number(rawDur.toFixed(2))));
    onUpdateClip(clipId, { durationSec: clamped });
  };

  const jumpToClipStart = (clipId: string) => {
    const seg = clipSegments.find((s) => mediaItems[s.clipIndex]?.id === clipId);
    if (seg) {
      onSeekAbsolute(trimBase + seg.startSec);
    }
  };

  const handlePickGenerator = (
    effect: Exclude<GeneratorEffectId, 'none'>,
    snapshotGlobal = false
  ) => {
    if (genTarget === 'fx_track') {
      onAddFxOverlay(effect, selectedClip ? 'clip' : 'playhead', snapshotGlobal);
    } else if (genTarget === 'clip_overlay' && selectedClip) {
      onApplyClipOverlay(selectedClip.id, effect, 'screen', 0.68, snapshotGlobal);
    } else {
      onAddGeneratorScene(effect, snapshotGlobal);
    }
    setGenMenuOpen(false);
  };

  const openAnchoredPopover = (el: HTMLElement | null, widthPx: number): PopoverCoords => {
    if (!el) return { left: 16, bottom: 180 };
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - widthPx - 8, r.left));
    const bottom = Math.max(12, window.innerHeight - r.top + 6);
    return { left, bottom };
  };

  const transitionOptions: { id: SlideTransitionType; label: string }[] = [
    { id: 'crossfade', label: t.transitionCrossfade },
    { id: 'zoom_cross', label: t.transitionZoomCross },
    { id: 'wipe_right', label: t.transitionWipeRight },
    { id: 'dip_black', label: t.transitionDipBlack },
    { id: 'slide', label: t.transitionSlide },
    { id: 'cut', label: t.transitionCut },
  ];

  const transMenuClip = transMenu
    ? mediaItems.find((m) => m.id === transMenu.clipId) || null
    : null;

  const activeLoopSeg =
    selectedLoopSegIdx !== null && clipSegments[selectedLoopSegIdx]?.isLoopRepeat
      ? clipSegments[selectedLoopSegIdx]
      : null;

  const handleTrimKeyDown = (side: 'in' | 'out', e: React.KeyboardEvent) => {
    if (!audio) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 1.0 : 0.25;
    const delta = e.key === 'ArrowRight' ? step : -step;
    if (side === 'in') {
      onSetTrimStart(Number(Math.max(0, Math.min(config.trimEnd - 0.5, config.trimStart + delta)).toFixed(2)));
    } else {
      onSetTrimEnd(
        Number(Math.min(audio.duration, Math.max(config.trimStart + 0.5, config.trimEnd + delta)).toFixed(2))
      );
    }
  };

  return (
    <section
      aria-label="Timeline"
      className="shrink-0 border-t border-[#262B38] bg-[#0E1016] px-3 lg:px-4 pb-2 pt-0.5 space-y-1.5 relative z-20"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/mp4,video/webm,video/quicktime,.mp4,.mov,.webm,.m4v"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) onVisualFiles(files);
          e.target.value = '';
        }}
      />

      {/* Top Vertical Resize Grip Handle */}
      {!collapsed && (
        <div
          onPointerDown={(e) => {
            dockResizeRef.current = { startY: e.clientY, startH: dockHeightPx };
          }}
          title={t.timelineCollapseBtn}
          className="h-2 -mt-0.5 flex items-center justify-center cursor-ns-resize group select-none"
        >
          <GripHorizontal className="w-4 h-2.5 text-[#323849] group-hover:text-amber-400 transition-colors" />
        </div>
      )}

      {/* Row 1: Compact Single-Bar Timeline Tools + Selected Item + Beat Sync + Zoom */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1.5 border-b border-[#1E2330]">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {/* Collapse / Expand Timeline */}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? t.timelineExpandBtn : t.timelineCollapseBtn}
            aria-label={collapsed ? t.timelineExpandBtn : t.timelineCollapseBtn}
            className="p-1 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-gray-300 cursor-pointer transition-colors"
          >
            {collapsed ? (
              <ChevronUp className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            )}
          </button>

          {/* Add Media */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[11px] font-medium text-gray-200 cursor-pointer transition-colors whitespace-nowrap"
          >
            <Plus className="w-3 h-3 text-amber-400" aria-hidden="true" />
            <span>{t.timelineAddMediaBtn}</span>
          </button>

          {/* Add Generator Portal Trigger */}
          <button
            ref={genBtnRef}
            type="button"
            onClick={() => {
              const nextOpen = !genMenuOpen;
              closeAllPopovers();
              if (nextOpen) {
                setGenCoords(openAnchoredPopover(genBtnRef.current, 320));
                setGenMenuOpen(true);
              }
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-cyan-500/50 bg-cyan-500/12 hover:bg-cyan-500/20 text-[11px] font-semibold text-cyan-200 cursor-pointer transition-colors whitespace-nowrap"
          >
            <Orbit className="w-3 h-3 text-cyan-300" aria-hidden="true" />
            <span>+ {t.timelineAddGenBtn}</span>
            <ChevronDown className="w-3 h-3 opacity-80" aria-hidden="true" />
          </button>

          <div className="h-4 w-px bg-[#262B38] mx-0.5 hidden sm:block" aria-hidden="true" />

          {/* Dynamic Contextual Selection Bar: Selected FX Overlay OR Selected Clip */}
          {selectedFx ? (
            <div className="inline-flex items-center gap-1 rounded border border-cyan-500/50 bg-cyan-500/10 px-2 py-0.5">
              <Layers className="w-3 h-3 text-cyan-300 shrink-0" aria-hidden="true" />
              <span className="text-[11px] font-semibold text-cyan-200 max-w-[115px] truncate">
                {selectedFx.name}
              </span>
              <select
                value={selectedFx.blend}
                onChange={(e) =>
                  onUpdateFxOverlay(selectedFx.id, { blend: e.target.value as OverlayBlendMode })
                }
                aria-label={t.generatorModeLabel}
                className="bg-[#0B0D11] border border-[#262B38] rounded px-1 py-0.5 text-[10px] text-gray-200 cursor-pointer"
              >
                <option value="screen">{t.overlayBlendScreen}</option>
                <option value="lighter">{t.overlayBlendLighter}</option>
                <option value="soft-light">{t.overlayBlendSoft}</option>
              </select>
              <button
                type="button"
                onClick={() =>
                  onUpdateFxOverlay(selectedFx.id, {
                    durationSec: Math.max(0.4, Number((selectedFx.durationSec - 0.5).toFixed(2))),
                  })
                }
                aria-label={t.trimMinusHalfAria}
                className="p-0.5 rounded hover:bg-[#1E2330] text-gray-300 cursor-pointer"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-[11px] font-mono tabular-nums text-cyan-200 px-0.5">
                {selectedFx.durationSec.toFixed(1)}s
              </span>
              <button
                type="button"
                onClick={() =>
                  onUpdateFxOverlay(selectedFx.id, {
                    durationSec: Math.min(
                      clipDuration,
                      Number((selectedFx.durationSec + 0.5).toFixed(2))
                    ),
                  })
                }
                aria-label={t.trimPlusHalfAria}
                className="p-0.5 rounded hover:bg-[#1E2330] text-gray-300 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
              </button>
              {selectedClip && (
                <button
                  type="button"
                  onClick={() => onFitFxToSelectedClip(selectedFx.id)}
                  className="px-1.5 py-0.5 rounded bg-[#0B0D11] border border-[#262B38] hover:border-cyan-400 text-[10px] text-cyan-200 cursor-pointer whitespace-nowrap"
                >
                  {t.fxSnapToClipBtn}
                </button>
              )}
              <button
                type="button"
                onClick={() => onInspectFx(selectedFx.id)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0B0D11] border border-[#262B38] hover:border-amber-500/60 text-[10px] font-medium text-gray-200 cursor-pointer"
              >
                <SlidersHorizontal className="w-2.5 h-2.5" aria-hidden="true" />
                <span className="hidden md:inline">{t.inspectClipBtn}</span>
              </button>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1 rounded border border-[#262B38] bg-[#141821] px-1.5 py-0.5">
              <button
                type="button"
                disabled={mediaItems.length <= 1}
                onClick={() => {
                  if (mediaItems.length === 0) return;
                  const prevIdx = (selectedIndex - 1 + mediaItems.length) % mediaItems.length;
                  onSelectClip(mediaItems[prevIdx].id);
                }}
                title={t.timelinePrevClip}
                aria-label={t.timelinePrevClip}
                className="p-0.5 text-gray-400 hover:text-amber-300 disabled:opacity-30 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <select
                value={selectedClip?.id || ''}
                disabled={mediaItems.length === 0}
                onChange={(e) => {
                  const nextId = e.target.value;
                  if (nextId) onSelectClip(nextId);
                }}
                aria-label={t.timelineSelectedClipLabel}
                className="bg-transparent text-[11px] font-medium text-gray-100 focus:outline-none max-w-[115px] sm:max-w-[155px] truncate cursor-pointer disabled:opacity-40"
              >
                {mediaItems.length === 0 ? (
                  <option value="" className="bg-[#141821]">
                    {t.timelineNoClipsOption}
                  </option>
                ) : (
                  mediaItems.map((m, idx) => (
                    <option key={m.id} value={m.id} className="bg-[#141821] text-gray-100">
                      #{idx + 1} {m.fileName} ({m.durationSec.toFixed(1)}s)
                    </option>
                  ))
                )}
              </select>

              <button
                type="button"
                disabled={mediaItems.length <= 1}
                onClick={() => {
                  if (mediaItems.length === 0) return;
                  const nextIdx = (selectedIndex + 1) % mediaItems.length;
                  onSelectClip(mediaItems[nextIdx].id);
                }}
                title={t.timelineNextClip}
                aria-label={t.timelineNextClip}
                className="p-0.5 text-gray-400 hover:text-amber-300 disabled:opacity-30 cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              {selectedClip && (
                <>
                  <div className="h-3.5 w-px bg-[#262B38] mx-0.5" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => setClipDuration(selectedClip.id, selectedClip.durationSec - 0.5)}
                    aria-label={t.trimMinusHalfAria}
                    className="p-0.5 rounded hover:bg-[#1E2330] text-gray-300 hover:text-amber-300 cursor-pointer"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
                    type="number"
                    min={0.5}
                    max={120}
                    step={0.5}
                    value={Number(selectedClip.durationSec.toFixed(1))}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!Number.isNaN(val)) setClipDuration(selectedClip.id, val);
                    }}
                    aria-label={t.clipDurationLabel}
                    className="w-11 bg-[#0B0D11] border border-[#262B38] focus:border-amber-500 rounded px-1 py-0.5 text-center text-[11px] font-mono tabular-nums text-amber-300 focus:outline-none"
                  />
                  <span className="text-[10px] font-mono text-gray-500">s</span>
                  <button
                    type="button"
                    onClick={() => setClipDuration(selectedClip.id, selectedClip.durationSec + 0.5)}
                    aria-label={t.trimPlusHalfAria}
                    className="p-0.5 rounded hover:bg-[#1E2330] text-gray-300 hover:text-amber-300 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>

                  {/* Quick Outgoing Transition selector right on bar */}
                  {mediaItems.length > 1 && (
                    <select
                      value={
                        config.slideshowMode === 'custom_durations' || config.slideshowMode === 'manual'
                          ? selectedClip.transitionOut
                          : config.transitionType
                      }
                      onChange={(e) =>
                        onSetClipTransition(
                          selectedClip.id,
                          e.target.value as SlideTransitionType,
                          false
                        )
                      }
                      aria-label={t.clipTransitionLabel}
                      title={t.clipTransitionLabel}
                      className="hidden sm:inline-block bg-[#0B0D11] border border-[#262B38] rounded px-1 py-0.5 text-[10px] text-amber-200 cursor-pointer max-w-[82px]"
                    >
                      {transitionOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  )}

                  {activeLoopSeg && selectedLoopSegIdx !== null && onMaterializeLoopSegment && (
                    <button
                      type="button"
                      onClick={() => {
                        onMaterializeLoopSegment(selectedLoopSegIdx);
                        setSelectedLoopSegIdx(null);
                      }}
                      title={t.loopSegmentNotice}
                      className="px-1.5 py-0.5 rounded border border-amber-500/60 bg-amber-500/15 hover:bg-amber-500/25 text-[10px] font-semibold text-amber-200 cursor-pointer whitespace-nowrap"
                    >
                      {t.materializeLoopBtn}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onInspectClip(selectedClip.id)}
                    title={t.inspectClipBtn}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0B0D11] border border-[#262B38] hover:border-amber-500/60 text-[10px] font-medium text-gray-300 hover:text-amber-300 cursor-pointer"
                  >
                    <SlidersHorizontal className="w-2.5 h-2.5" aria-hidden="true" />
                    <span className="hidden md:inline">{t.inspectClipBtn}</span>
                  </button>
                </>
              )}
            </div>
          )}

          {/* Core NLE Edit Tools */}
          {!selectedFx && (
            <button
              type="button"
              onClick={onSplitClipAtPlayhead}
              disabled={mediaItems.length === 0}
              title={`${t.splitClipBtn} (S)`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 disabled:opacity-35 text-[11px] font-medium text-gray-200 cursor-pointer transition-colors"
            >
              <Scissors className="w-3 h-3 text-amber-400" aria-hidden="true" />
              <span className="hidden xl:inline">{t.splitClipBtn}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (selectedFx) {
                onDuplicateFxOverlay(selectedFx.id);
              } else {
                const targetId = selectedClipId || mediaItems[0]?.id;
                if (targetId) onDuplicateClip(targetId);
              }
            }}
            disabled={!selectedFx && mediaItems.length === 0}
            title={`${t.duplicateClipLabel} (Ctrl+D)`}
            aria-label={t.duplicateClipLabel}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 disabled:opacity-35 text-[11px] font-medium text-gray-200 cursor-pointer transition-colors"
          >
            <Copy className="w-3 h-3 text-gray-300" aria-hidden="true" />
            <span className="hidden xl:inline">{t.duplicateSelectedBtn}</span>
          </button>

          <button
            type="button"
            onClick={onRippleDeleteSelected}
            disabled={!selectedFx && !selectedClipId && mediaItems.length === 0}
            title={`${t.rippleDeleteBtn} (Del)`}
            aria-label={t.rippleDeleteBtn}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-rose-500/60 disabled:opacity-35 text-[11px] font-medium text-gray-200 cursor-pointer transition-colors"
          >
            <Trash2 className="w-3 h-3 text-rose-400" aria-hidden="true" />
            <span className="hidden xl:inline">{t.rippleDeleteBtn}</span>
          </button>
        </div>

        {/* Right Side Controls: Timing Mode + Auto Beat Sync + Snap + Zoom + Auto-Follow + More */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {onChangeSlideshowMode && (
            <select
              value={config.slideshowMode}
              onChange={(e) => onChangeSlideshowMode(e.target.value as SlideshowMode)}
              title={t.slideshowModeLabel}
              aria-label={t.slideshowModeLabel}
              className={`rounded border px-1.5 py-1 text-[11px] font-medium cursor-pointer focus:outline-none ${
                config.slideshowMode === 'manual'
                  ? 'border-cyan-500/45 bg-cyan-500/10 text-cyan-200'
                  : 'border-amber-500/60 bg-amber-500/15 text-amber-300'
              }`}
            >
              <option value="manual" className="bg-[#141821] text-gray-100">
                {t.slideshowManual}
              </option>
              <option value="custom_durations" className="bg-[#141821] text-gray-100">
                {t.slideshowCustom}
              </option>
              <option value="even" className="bg-[#141821] text-gray-100">
                {t.slideshowEven}
              </option>
              <option value="fixed" className="bg-[#141821] text-gray-100">
                {t.slideshowFixed}
              </option>
              <option value="beat_cut" className="bg-[#141821] text-gray-100">
                {t.slideshowBeatCut}
              </option>
            </select>
          )}

          {audio && (
            <div ref={beatSyncBtnRef} className="inline-flex rounded border border-amber-500/55 bg-amber-500/15 overflow-hidden">
              <button
                type="button"
                onClick={() => onAutoBeatSyncClips('fit_track', beatSyncMotion)}
                disabled={mediaItems.length === 0}
                title={t.autoBeatSyncHint}
                className="inline-flex items-center gap-1 px-2 py-1 hover:bg-amber-500/25 disabled:opacity-35 text-[11px] font-semibold text-amber-300 cursor-pointer transition-colors whitespace-nowrap"
              >
                <Sparkles className="w-3 h-3" aria-hidden="true" />
                <span>{t.autoBeatSyncBtn}</span>
                {trackBpm > 0 && (
                  <span className="font-mono text-[10px] text-amber-200/90 hidden xl:inline">
                    · {trackBpm}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextOpen = !beatSyncOpen;
                  closeAllPopovers();
                  if (nextOpen) {
                    setBeatSyncCoords(openAnchoredPopover(beatSyncBtnRef.current, 260));
                    setBeatSyncOpen(true);
                  }
                }}
                aria-label={t.beatSyncTitle}
                className="px-1 border-l border-amber-500/35 hover:bg-amber-500/25 text-amber-300 cursor-pointer"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onToggleSnapToBeats}
            title={t.snapBeatsLabel}
            aria-label={t.snapBeatsLabel}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium cursor-pointer transition-colors ${
              config.snapToBeats
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
            }`}
          >
            <Magnet className="w-3 h-3" aria-hidden="true" />
            <span className="hidden lg:inline">{t.snapBeatsLabel}</span>
          </button>

          {/* Zoom + Follow Controls */}
          {!collapsed && (
            <div className="flex items-center gap-1 pl-1 border-l border-[#262B38]">
              <button
                type="button"
                onClick={() => setFollowPlayhead((f) => !f)}
                title={t.timelineFollowPlayhead}
                aria-label={t.timelineFollowPlayhead}
                className={`p-1 rounded border cursor-pointer transition-colors ${
                  followPlayhead
                    ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300'
                    : 'border-[#262B38] bg-[#141821] text-gray-400 hover:text-gray-200'
                }`}
              >
                <Crosshair className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => applyAnchoredZoom(timelineZoom - 0.5)}
                disabled={timelineZoom <= 1}
                title={t.timelineZoomOut}
                aria-label={t.timelineZoomOut}
                className="p-0.5 rounded border border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500 disabled:opacity-35 cursor-pointer"
              >
                <ZoomOut className="w-3 h-3" />
              </button>
              <input
                type="range"
                min={1}
                max={16}
                step={0.5}
                value={timelineZoom}
                onChange={(e) => applyAnchoredZoom(Number(e.target.value))}
                className="w-14 studio-slider"
                aria-label={t.timelineZoomLabel}
              />
              <button
                type="button"
                onClick={() => applyAnchoredZoom(timelineZoom + 0.5)}
                disabled={timelineZoom >= 16}
                title={t.timelineZoomIn}
                aria-label={t.timelineZoomIn}
                className="p-0.5 rounded border border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500 disabled:opacity-35 cursor-pointer"
              >
                <ZoomIn className="w-3 h-3" />
              </button>
              <span className="text-[10px] font-mono tabular-nums text-gray-300 w-7 text-right">
                {timelineZoom}×
              </span>
              {timelineZoom > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => applyAnchoredZoom(1)}
                    title={t.timelineFitAll}
                    className="px-1 py-0.5 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/50 text-[10px] text-gray-300 cursor-pointer"
                  >
                    1×
                  </button>
                  <button
                    type="button"
                    onClick={jumpScrollToPlayhead}
                    title={t.timelineJumpPlayhead}
                    aria-label={t.timelineJumpPlayhead}
                    className="p-0.5 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/50 text-amber-300 cursor-pointer"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* More Overflow Trigger (Portal Menu) */}
          <button
            ref={moreBtnRef}
            type="button"
            onClick={() => {
              const nextOpen = !moreMenuOpen;
              closeAllPopovers();
              if (nextOpen) {
                setMoreCoords(openAnchoredPopover(moreBtnRef.current, 210));
                setMoreMenuOpen(true);
              }
            }}
            title={t.timelineMoreBtn}
            aria-label={t.timelineMoreBtn}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-gray-500 text-[11px] font-medium text-gray-300 cursor-pointer transition-colors"
          >
            <MoreHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            {config.manualBeatMarkers.length > 0 && (
              <span className="font-mono text-[10px] text-cyan-300">
                {config.manualBeatMarkers.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Expanded Timeline Rows (Master Overview + Multi-Track Sequence) */}
      {!collapsed && (
        <div
          className="space-y-1.5 overflow-y-auto pr-0.5"
          style={{ maxHeight: `${dockHeightPx}px` }}
        >
          {/* Row 2: Master Full-Track Overview & Accessible Trim Brackets */}
          {audio && audio.duration > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-gray-500 w-20 shrink-0 truncate">
                {t.timelineMasterAudioLabel}
              </span>
              <div
                ref={masterTimelineRef}
                onPointerDown={handleMasterPointerDown}
                onPointerMove={handleMasterPointerMove}
                onPointerUp={handleMasterPointerUp}
                onPointerCancel={handleMasterPointerUp}
                className="flex-1 relative h-6 rounded border border-[#262B38] bg-[#0B0D11] overflow-hidden select-none cursor-ew-resize"
              >
                <canvas
                  ref={masterCanvasRef}
                  className="absolute inset-0 w-full h-full pointer-events-none"
                />

                {/* Active Trim Bracket Highlight & Expanded Accessible Handles */}
                <div
                  className="absolute top-0 bottom-0 bg-amber-500/12 border-y border-amber-500/45 pointer-events-none"
                  style={{
                    left: `${(config.trimStart / audio.duration) * 100}%`,
                    width: `${Math.max(1, ((config.trimEnd - config.trimStart) / audio.duration) * 100)}%`,
                  }}
                >
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={t.trimStartHandleAria}
                    aria-valuemin={0}
                    aria-valuemax={Number(Math.max(0, config.trimEnd - 0.5).toFixed(2))}
                    aria-valuenow={Number(config.trimStart.toFixed(2))}
                    onKeyDown={(e) => handleTrimKeyDown('in', e)}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      trimDragModeRef.current = 'in';
                      masterTimelineRef.current?.setPointerCapture(e.pointerId);
                    }}
                    title={`${t.trimStartLabel}: ${config.trimStart.toFixed(1)}s`}
                    className="pointer-events-auto absolute top-0 bottom-0 left-0 w-6 -ml-3 flex items-center justify-center cursor-ew-resize z-20 focus:outline-none group"
                  >
                    <div className="w-1.5 h-full bg-amber-500 group-hover:bg-amber-400 group-focus:ring-2 group-focus:ring-cyan-400 rounded-xs" />
                  </div>
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={t.trimEndHandleAria}
                    aria-valuemin={Number(Math.min(audio.duration, config.trimStart + 0.5).toFixed(2))}
                    aria-valuemax={Number(audio.duration.toFixed(2))}
                    aria-valuenow={Number(config.trimEnd.toFixed(2))}
                    onKeyDown={(e) => handleTrimKeyDown('out', e)}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      trimDragModeRef.current = 'out';
                      masterTimelineRef.current?.setPointerCapture(e.pointerId);
                    }}
                    title={`${t.trimEndLabel}: ${config.trimEnd.toFixed(1)}s`}
                    className="pointer-events-auto absolute top-0 bottom-0 right-0 w-6 -mr-3 flex items-center justify-center cursor-ew-resize z-20 focus:outline-none group"
                  >
                    <div className="w-1.5 h-full bg-amber-500 group-hover:bg-amber-400 group-focus:ring-2 group-focus:ring-cyan-400 rounded-xs" />
                  </div>
                </div>

                {/* Master Playhead */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none z-10"
                  style={{
                    left: `${Math.max(0, Math.min(100, (currentTime / audio.duration) * 100))}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Row 3: Synchronized Zoomable Multi-Track NLE Sequence */}
          <div className="flex gap-2 items-start">
            {/* Synchronized Left Track Label Column (heights strictly match TimelineTrackDesc[]) */}
            <div className="w-20 shrink-0 flex flex-col select-none">
              {timelineTracks.map((tr) => {
                if (tr.id === 'ruler') {
                  return (
                    <div
                      key={tr.id}
                      style={{ height: `${tr.heightPx}px` }}
                      className="flex items-center text-[9px] font-mono text-gray-500 border-b border-transparent"
                    >
                      0:00
                    </div>
                  );
                }
                if (tr.id === 'clips') {
                  return (
                    <div
                      key={tr.id}
                      style={{ height: `${tr.heightPx}px` }}
                      className="flex items-center text-[10px] font-medium text-gray-400 truncate"
                    >
                      {t.timelineClipsTrackLabel}
                    </div>
                  );
                }
                if (tr.id === 'fx') {
                  return (
                    <div
                      key={tr.id}
                      style={{ height: `${tr.heightPx}px` }}
                      className="flex items-center justify-between gap-1 text-[10px] font-medium text-cyan-300/90 border-t border-[#1E2330]"
                    >
                      <span className="truncate">{t.timelineFxTrackLabel}</span>
                      <button
                        type="button"
                        onClick={() =>
                          onAddFxOverlay(
                            config.generatorEffect !== 'none'
                              ? (config.generatorEffect as Exclude<GeneratorEffectId, 'none'>)
                              : 'cosmic_particles',
                            selectedClip ? 'clip' : 'playhead',
                            config.generatorEffect !== 'none'
                          )
                        }
                        title={t.timelineAddFxEmptyHint}
                        aria-label={t.timelineAddFxEmptyHint}
                        className="p-0.5 rounded bg-[#141821] border border-[#262B38] hover:border-cyan-400 text-cyan-300 cursor-pointer shrink-0"
                      >
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  );
                }
                if (tr.id === 'overlays') {
                  return (
                    <div
                      key={tr.id}
                      style={{ height: `${tr.heightPx}px` }}
                      className="flex items-center text-[10px] font-medium text-emerald-300/90 truncate border-t border-[#1E2330]"
                    >
                      {t.timelineOverlaysTrackLabel}
                    </div>
                  );
                }
                if (tr.id === 'audio') {
                  return (
                    <div
                      key={tr.id}
                      style={{ height: `${tr.heightPx}px` }}
                      className="flex items-center text-[10px] font-medium text-gray-400 truncate border-t border-[#1E2330]"
                    >
                      {t.timelineAudioTrackLabel}
                    </div>
                  );
                }
                return (
                  <div
                    key={tr.id}
                    style={{ height: `${tr.heightPx}px` }}
                    className="flex items-center text-[9px] font-medium text-amber-300/80 truncate border-t border-[#1E2330]"
                  >
                    {t.timelineSubtitlesTrackLabel}
                  </div>
                );
              })}
            </div>

            {/* Right Horizontal Scrollable Timeline Tracks Container */}
            <div
              ref={seqScrollRef}
              className="flex-1 min-w-0 overflow-x-auto rounded-md border border-[#262B38] bg-[#0B0D11] relative"
              onWheel={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  e.preventDefault();
                  applyAnchoredZoom(timelineZoom + (e.deltaY < 0 ? 0.5 : -0.5), e.clientX);
                  return;
                }
                const el = seqScrollRef.current;
                if (el && timelineZoom > 1 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                  el.scrollLeft += e.deltaY;
                }
              }}
            >
              <div
                ref={seqInnerRef}
                onDragOver={(e) => {
                  const hasBin = e.dataTransfer.types.includes('application/x-neuromicon-bin-id');
                  const hasFiles = e.dataTransfer.types.includes('Files');
                  if (!hasBin && !hasFiles) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  const rect = seqInnerRef.current?.getBoundingClientRect();
                  if (!rect || rect.width <= 0) return;
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const rawSec = Math.max(0, Number((ratio * clipDuration).toFixed(2)));
                  const overExisting =
                    config.slideshowMode === 'manual' &&
                    clipSegments.some(
                      (s) => rawSec >= s.startSec - 0.08 && rawSec <= s.endSec + 0.08
                    );
                  if (overExisting) {
                    setClipDropPreview({ pct: playheadPct, anchoredToPlayhead: true });
                    return;
                  }
                  let snappedSec = rawSec;
                  if (config.snapToBeats && relSnapPoints.length > 0) {
                    snappedSec = snapTimeToBeat(rawSec, relSnapPoints, 0.22);
                  }
                  setClipDropPreview({
                    pct: Math.max(0, Math.min(100, (snappedSec / clipDuration) * 100)),
                    anchoredToPlayhead: false,
                  });
                }}
                onDragLeave={(e) => {
                  if (
                    e.currentTarget === e.target ||
                    !e.currentTarget.contains(e.relatedTarget as Node | null)
                  ) {
                    setClipDropPreview(null);
                  }
                }}
                onDrop={(e) => {
                  const binId = e.dataTransfer.getData('application/x-neuromicon-bin-id');
                  const files = Array.from(e.dataTransfer.files || []);
                  if (!binId && files.length === 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setClipDropPreview(null);
                  const rect = seqInnerRef.current?.getBoundingClientRect();
                  let finalSec = localTime;
                  if (rect && rect.width > 0) {
                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    const rawSec = Math.max(0, Number((ratio * clipDuration).toFixed(2)));
                    finalSec =
                      config.snapToBeats && relSnapPoints.length > 0
                        ? Math.max(0, Number(snapTimeToBeat(rawSec, relSnapPoints, 0.22).toFixed(2)))
                        : rawSec;
                  }
                  if (binId && onDropBinItemToTimeline) {
                    onDropBinItemToTimeline(binId, finalSec);
                  } else if (files.length > 0) {
                    if (onDropFilesToTimeline) {
                      onDropFilesToTimeline(files, finalSec);
                    } else {
                      onVisualFiles(files);
                    }
                  }
                }}
                className="relative flex flex-col select-none"
                style={{ width: `${timelineZoom * 100}%`, minWidth: '100%' }}
              >
                {timelineTracks.map((tr) => {
                  if (tr.id === 'ruler') {
                    return (
                      <div
                        key={tr.id}
                        style={{ height: `${tr.heightPx}px` }}
                        onPointerDown={handleSeqScrubPointerDown}
                        onPointerMove={handleSeqScrubPointerMove}
                        className="relative border-b border-[#1E2330] bg-[#10131A] cursor-ew-resize"
                      >
                        {rulerTicks.map((tickSec) => {
                          const pct = (tickSec / clipDuration) * 100;
                          if (pct > 99.5) return null;
                          return (
                            <div
                              key={tickSec}
                              className="absolute top-0 bottom-0 border-l border-[#323849] pl-1 flex items-center pointer-events-none"
                              style={{ left: `${pct}%` }}
                            >
                              <span className="text-[9px] font-mono tabular-nums text-gray-400">
                                {formatRulerTick(tickSec)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }

                  if (tr.id === 'clips') {
                    const isManualMode = config.slideshowMode === 'manual';
                    const resolveDropInfo = (clientX: number) => {
                      const rect = seqInnerRef.current?.getBoundingClientRect();
                      if (!rect || rect.width <= 0) {
                        return {
                          dropSec: localTime,
                          previewPct: playheadPct,
                          anchoredToPlayhead: false,
                        };
                      }
                      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                      const rawSec = Math.max(0, Number((ratio * clipDuration).toFixed(2)));
                      const overExisting =
                        isManualMode &&
                        clipSegments.some(
                          (s) => rawSec >= s.startSec - 0.08 && rawSec <= s.endSec + 0.08
                        );
                      if (overExisting) {
                        return {
                          dropSec: rawSec,
                          previewPct: playheadPct,
                          anchoredToPlayhead: true,
                        };
                      }
                      let snappedSec = rawSec;
                      if (config.snapToBeats && relSnapPoints.length > 0) {
                        snappedSec = snapTimeToBeat(rawSec, relSnapPoints, 0.22);
                      }
                      const finalSec = Math.max(0, Number(snappedSec.toFixed(2)));
                      return {
                        dropSec: finalSec,
                        previewPct: Math.max(0, Math.min(100, (finalSec / clipDuration) * 100)),
                        anchoredToPlayhead: false,
                      };
                    };

                    return (
                      <div
                        key={tr.id}
                        style={{ height: `${tr.heightPx}px` }}
                        onDragOver={(e) => {
                          const hasBin = e.dataTransfer.types.includes('application/x-neuromicon-bin-id');
                          const hasFiles = e.dataTransfer.types.includes('Files');
                          if (!hasBin && !hasFiles) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'copy';
                          const info = resolveDropInfo(e.clientX);
                          setClipDropPreview({
                            pct: info.previewPct,
                            anchoredToPlayhead: info.anchoredToPlayhead,
                          });
                        }}
                        onDragLeave={(e) => {
                          if (
                            e.currentTarget === e.target ||
                            !e.currentTarget.contains(e.relatedTarget as Node | null)
                          ) {
                            setClipDropPreview(null);
                          }
                        }}
                        onDrop={(e) => {
                          const binId = e.dataTransfer.getData('application/x-neuromicon-bin-id');
                          const files = Array.from(e.dataTransfer.files || []);
                          if (!binId && files.length === 0) return;
                          e.preventDefault();
                          e.stopPropagation();
                          const info = resolveDropInfo(e.clientX);
                          setClipDropPreview(null);
                          if (binId && onDropBinItemToTimeline) {
                            onDropBinItemToTimeline(binId, info.dropSec);
                          } else if (files.length > 0) {
                            if (onDropFilesToTimeline) {
                              onDropFilesToTimeline(files, info.dropSec);
                            } else {
                              onVisualFiles(files);
                            }
                          }
                        }}
                        onPointerDown={(e) => {
                          if (e.target === e.currentTarget) {
                            handleSeqScrubPointerDown(e);
                          }
                        }}
                        className={`relative transition-colors ${
                          clipDropPreview !== null
                            ? 'bg-amber-500/10 ring-1 ring-inset ring-amber-400/70'
                            : 'bg-[#0B0D11]'
                        }`}
                      >
                        {clipDropPreview !== null && (
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.95)] z-30 pointer-events-none"
                            style={{ left: `${clipDropPreview.pct}%` }}
                          >
                            {clipDropPreview.anchoredToPlayhead && (
                              <span className="absolute top-1 left-1 px-1 py-0.5 rounded bg-amber-500 text-zinc-950 text-[8px] font-mono font-bold shadow whitespace-nowrap">
                                ▶+
                              </span>
                            )}
                          </div>
                        )}
                        {clipSegments.length > 0 ? (
                          clipSegments.map((seg, idx) => {
                            const clip = mediaItems[seg.clipIndex];
                            if (!clip) return null;
                            const segDur = seg.endSec - seg.startSec;
                            const leftPct = (seg.startSec / clipDuration) * 100;
                            const widthPct = (segDur / clipDuration) * 100;
                            const isSelected = !selectedFx && selectedClip?.id === clip.id;
                            const isPlayheadInside =
                              localTime >= seg.startSec && localTime < seg.endSec + 0.001;
                            const isDragOver =
                              dragOverIndex === seg.clipIndex && dragIndex !== seg.clipIndex;
                            const prevSeg = idx > 0 ? clipSegments[idx - 1] : null;
                            const nextSeg = idx < clipSegments.length - 1 ? clipSegments[idx + 1] : null;
                            const isTouchingNext = Boolean(
                              nextSeg && nextSeg.startSec - seg.endSec <= 0.08
                            );
                            const prevLimitSec = prevSeg ? prevSeg.endSec : 0;
                            const nextLimitSec = nextSeg
                              ? nextSeg.startSec
                              : audio
                                ? clipDuration
                                : 3600;
                            const segLeftPct = (seg.endSec / clipDuration) * 100;
                            const activeHud =
                              clipDragHud && clipDragHud.clipId === clip.id ? clipDragHud : null;

                            return (
                              <React.Fragment key={`${clip.id}-${idx}`}>
                                <div
                                  draggable={!isManualMode && !seg.isLoopRepeat}
                                  onDragStart={() => {
                                    if (!isManualMode) setDragIndex(seg.clipIndex);
                                  }}
                                  onDragOver={(e) => {
                                    if (isManualMode) return;
                                    e.preventDefault();
                                    setDragOverIndex(seg.clipIndex);
                                  }}
                                  onDragLeave={() => setDragOverIndex(null)}
                                  onDrop={(e) => {
                                    if (isManualMode) return;
                                    if (dragIndex !== null && dragIndex !== seg.clipIndex) {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      onReorderClip(dragIndex, seg.clipIndex);
                                    }
                                    setDragIndex(null);
                                    setDragOverIndex(null);
                                  }}
                                  onDragEnd={() => {
                                    setDragIndex(null);
                                    setDragOverIndex(null);
                                  }}
                                  onPointerDown={(e) => {
                                    if (!isManualMode) return;
                                    e.stopPropagation();
                                    onSelectClip(clip.id);
                                    setSelectedLoopSegIdx(null);
                                    if (onMoveClipPosition) {
                                      clipResizeRef.current = {
                                        clipId: clip.id,
                                        mode: 'move',
                                        kind: clip.kind,
                                        segStartSec: seg.startSec,
                                        origSourceStartSec: clip.sourceStartSec || 0,
                                        playbackRate: clip.playbackRate || 1,
                                        startX: e.clientX,
                                        startDur: segDur,
                                        prevLimitSec,
                                        nextLimitSec,
                                        trackScaleSec: clipDuration,
                                        hasMoved: false,
                                      };
                                      e.currentTarget.setPointerCapture(e.pointerId);
                                    }
                                  }}
                                  onPointerMove={(e) => {
                                    const drag = clipResizeRef.current;
                                    if (!drag || drag.clipId !== clip.id) return;
                                    if ((e.buttons & 1) === 0) return;
                                    if (drag.mode === 'move' && onMoveClipPosition) {
                                      if (!drag.hasMoved && Math.abs(e.clientX - drag.startX) < 3) {
                                        return;
                                      }
                                      drag.hasMoved = true;
                                      const seqW =
                                        seqInnerRef.current?.getBoundingClientRect().width || 600;
                                      const deltaSec =
                                        ((e.clientX - drag.startX) / seqW) * drag.trackScaleSec;
                                      const proposed = Math.max(0, drag.segStartSec + deltaSec);
                                      onMoveClipPosition(clip.id, proposed);
                                      setClipDragHud({
                                        clipId: clip.id,
                                        mode: 'move',
                                        startSec: Number(proposed.toFixed(1)),
                                        endSec: Number((proposed + drag.startDur).toFixed(1)),
                                        durSec: Number(drag.startDur.toFixed(1)),
                                      });
                                    }
                                  }}
                                  onPointerUp={(e) => {
                                    if (clipResizeRef.current?.clipId === clip.id) {
                                      e.stopPropagation();
                                      clipResizeRef.current = null;
                                      setClipDragHud(null);
                                    }
                                  }}
                                  onPointerCancel={() => {
                                    if (clipResizeRef.current?.clipId === clip.id) {
                                      clipResizeRef.current = null;
                                      setClipDragHud(null);
                                    }
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectClip(clip.id);
                                    setSelectedLoopSegIdx(seg.isLoopRepeat ? idx : null);
                                  }}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    onSelectClip(clip.id);
                                    setSelectedLoopSegIdx(seg.isLoopRepeat ? idx : null);
                                    jumpToClipStart(clip.id);
                                  }}
                                  style={{
                                    left: `${leftPct}%`,
                                    width: `${widthPct}%`,
                                    minWidth: '3px',
                                  }}
                                  title={`${clip.fileName} · ${seg.startSec.toFixed(1)}s–${seg.endSec.toFixed(1)}s (${segDur.toFixed(1)}s)`}
                                  className={`absolute top-0 bottom-0 border-x border-[#262B38] px-1.5 flex items-center gap-1 overflow-hidden text-left transition-colors group ${
                                    isManualMode
                                      ? 'cursor-grab active:cursor-grabbing'
                                      : 'cursor-pointer'
                                  } ${
                                    seg.isLoopRepeat
                                      ? 'bg-[#11141C]/80 opacity-85 border-dashed text-gray-400'
                                      : isDragOver
                                        ? 'ring-2 ring-inset ring-amber-400 bg-amber-500/25'
                                        : isSelected
                                          ? 'bg-amber-500/20 text-amber-100 ring-1 ring-inset ring-amber-400 z-[5]'
                                          : isPlayheadInside
                                            ? 'bg-[#1D2434] text-gray-100'
                                            : 'bg-[#141821] hover:bg-[#191E2A] text-gray-300'
                                  }`}
                                >
                                  <span className="text-[9px] font-mono text-gray-500 shrink-0 pointer-events-none">
                                    #{seg.clipIndex + 1}
                                  </span>
                                  {clip.kind === 'image' ? (
                                    <img
                                      src={clip.url}
                                      alt=""
                                      referrerPolicy="no-referrer"
                                      className="w-6 h-6 rounded-xs object-cover shrink-0 pointer-events-none"
                                    />
                                  ) : clip.kind === 'generator' ? (
                                    <Orbit
                                      className="w-3.5 h-3.5 text-amber-400 shrink-0 pointer-events-none"
                                      aria-hidden="true"
                                    />
                                  ) : null}
                                  <span className="text-[10px] font-medium truncate pointer-events-none">
                                    {clip.fileName}
                                  </span>
                                  {seg.isLoopRepeat && (
                                    <span className="px-1 py-0.2 rounded bg-[#0B0D11]/90 border border-[#262B38] text-[8px] font-mono text-amber-300/90 shrink-0 pointer-events-none">
                                      {t.loopRepeatBadge}
                                    </span>
                                  )}
                                  {clip.overlayEffect && (
                                    <span
                                      title={`${t.clipOverlayTitle}: ${clip.overlayEffect.effect}`}
                                      className="px-1 py-0.2 rounded bg-cyan-500/20 border border-cyan-500/50 text-[8px] font-mono text-cyan-200 shrink-0 pointer-events-none"
                                    >
                                      FX
                                    </span>
                                  )}
                                  {clip.kind === 'video' && !clip.clipAudioMuted && (
                                    <Volume2 className="w-2.5 h-2.5 text-amber-300 shrink-0 pointer-events-none" />
                                  )}
                                  <span className="ml-auto mr-1.5 px-1 py-0.5 rounded bg-[#0B0D11]/80 border border-[#262B38] text-[9px] font-mono tabular-nums text-amber-300 shrink-0 pointer-events-none">
                                    {segDur.toFixed(1)}s
                                  </span>

                                  {/* Live Edge Trim / Move Readout */}
                                  {activeHud && (
                                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 z-30 px-1.5 py-0 rounded bg-[#0B0D11]/95 border border-amber-400/80 text-[8.5px] font-mono tabular-nums text-amber-200 shadow pointer-events-none whitespace-nowrap">
                                      {activeHud.mode === 'left'
                                        ? `In ${activeHud.startSec.toFixed(1)}s · ${activeHud.durSec.toFixed(1)}s`
                                        : activeHud.mode === 'right'
                                          ? `Out ${activeHud.endSec.toFixed(1)}s · ${activeHud.durSec.toFixed(1)}s`
                                          : `${activeHud.startSec.toFixed(1)}–${activeHud.endSec.toFixed(1)}s`}
                                    </span>
                                  )}

                                  {/* Left-Edge Trim Handle (Hover edge to trim start & video in-point) */}
                                  {isManualMode && !seg.isLoopRepeat && (
                                    <div
                                      onPointerDown={(e) => {
                                        e.stopPropagation();
                                        clipResizeRef.current = {
                                          clipId: clip.id,
                                          mode: 'left',
                                          kind: clip.kind,
                                          segStartSec: seg.startSec,
                                          origSourceStartSec: clip.sourceStartSec || 0,
                                          playbackRate: clip.playbackRate || 1,
                                          startX: e.clientX,
                                          startDur: segDur,
                                          prevLimitSec,
                                          nextLimitSec,
                                          trackScaleSec: clipDuration,
                                          hasMoved: true,
                                        };
                                        e.currentTarget.setPointerCapture(e.pointerId);
                                        onSelectClip(clip.id);
                                      }}
                                      onPointerMove={(e) => {
                                        const drag = clipResizeRef.current;
                                        if (!drag || drag.clipId !== clip.id || drag.mode !== 'left')
                                          return;
                                        if ((e.buttons & 1) === 0) return;
                                        const seqW =
                                          seqInnerRef.current?.getBoundingClientRect().width || 600;
                                        const deltaSec =
                                          ((e.clientX - drag.startX) / seqW) * drag.trackScaleSec;
                                        const fixedEnd = drag.segStartSec + drag.startDur;
                                        let nextStart = Math.max(
                                          drag.prevLimitSec,
                                          Math.min(fixedEnd - 0.5, drag.segStartSec + deltaSec)
                                        );
                                        if (config.snapToBeats && relSnapPoints.length > 0) {
                                          const snapped = snapTimeToBeat(
                                            nextStart,
                                            [...relSnapPoints, drag.prevLimitSec],
                                            0.22
                                          );
                                          nextStart = Math.max(
                                            drag.prevLimitSec,
                                            Math.min(fixedEnd - 0.5, snapped)
                                          );
                                        }
                                        const roundedStart = Number(nextStart.toFixed(2));
                                        const nextDur = Number(
                                          Math.max(0.5, fixedEnd - roundedStart).toFixed(2)
                                        );
                                        const nextSourceStart =
                                          drag.kind === 'video'
                                            ? Math.max(
                                                0,
                                                Number(
                                                  (
                                                    drag.origSourceStartSec +
                                                    (roundedStart - drag.segStartSec) *
                                                      drag.playbackRate
                                                  ).toFixed(2)
                                                )
                                              )
                                            : undefined;
                                        setClipDragHud({
                                          clipId: clip.id,
                                          mode: 'left',
                                          startSec: roundedStart,
                                          endSec: fixedEnd,
                                          durSec: nextDur,
                                        });
                                        if (onTrimClipLeftEdge) {
                                          onTrimClipLeftEdge(
                                            clip.id,
                                            roundedStart,
                                            nextDur,
                                            nextSourceStart
                                          );
                                        } else {
                                          onUpdateClip(clip.id, {
                                            startSec: roundedStart,
                                            durationSec: nextDur,
                                            ...(nextSourceStart !== undefined
                                              ? { sourceStartSec: nextSourceStart }
                                              : {}),
                                          });
                                        }
                                      }}
                                      onPointerUp={(e) => {
                                        e.stopPropagation();
                                        clipResizeRef.current = null;
                                        setClipDragHud(null);
                                      }}
                                      onPointerCancel={() => {
                                        clipResizeRef.current = null;
                                        setClipDragHud(null);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      title={t.trimStartHandleAria}
                                      className="group/trim-l absolute top-0 left-0 bottom-0 w-3 max-w-[28%] z-20 cursor-ew-resize flex items-center justify-start pl-0.5 hover:bg-amber-400/35 transition-colors"
                                    >
                                      <span
                                        className={`w-0.5 h-5 rounded-full transition-all ${
                                          isSelected
                                            ? 'bg-amber-300/90 group-hover/trim-l:w-1 group-hover/trim-l:bg-amber-200 group-hover/trim-l:shadow-[0_0_6px_rgba(245,158,11,0.9)]'
                                            : 'bg-gray-500/45 group-hover:bg-amber-400/80 group-hover/trim-l:w-1 group-hover/trim-l:bg-amber-300'
                                        }`}
                                      />
                                    </div>
                                  )}

                                  {/* Right-Edge Duration Resize Handle (Hover edge to trim end) */}
                                  {!seg.isLoopRepeat && (
                                    <div
                                      onPointerDown={(e) => {
                                        e.stopPropagation();
                                        clipResizeRef.current = {
                                          clipId: clip.id,
                                          mode: 'right',
                                          kind: clip.kind,
                                          segStartSec: seg.startSec,
                                          origSourceStartSec: clip.sourceStartSec || 0,
                                          playbackRate: clip.playbackRate || 1,
                                          startX: e.clientX,
                                          startDur: segDur,
                                          prevLimitSec,
                                          nextLimitSec,
                                          trackScaleSec: clipDuration,
                                          hasMoved: true,
                                        };
                                        e.currentTarget.setPointerCapture(e.pointerId);
                                        onSelectClip(clip.id);
                                      }}
                                      onPointerMove={(e) => {
                                        const drag = clipResizeRef.current;
                                        if (!drag || drag.clipId !== clip.id || drag.mode !== 'right')
                                          return;
                                        if ((e.buttons & 1) === 0) return;
                                        const seqW =
                                          seqInnerRef.current?.getBoundingClientRect().width || 600;
                                        const deltaSec =
                                          ((e.clientX - drag.startX) / seqW) * drag.trackScaleSec;
                                        const maxDur = Math.max(600, drag.trackScaleSec);
                                        let nextDur = Math.max(
                                          0.5,
                                          Math.min(maxDur, drag.startDur + deltaSec)
                                        );
                                        if (config.snapToBeats && relSnapPoints.length > 0) {
                                          const proposedEnd = drag.segStartSec + nextDur;
                                          const snappedEnd = snapTimeToBeat(
                                            proposedEnd,
                                            isManualMode
                                              ? [...relSnapPoints, drag.nextLimitSec]
                                              : relSnapPoints,
                                            0.22
                                          );
                                          nextDur = Math.max(
                                            0.5,
                                            Math.min(maxDur, snappedEnd - drag.segStartSec)
                                          );
                                        }
                                        const roundedDur = Number(nextDur.toFixed(2));
                                        setClipDragHud({
                                          clipId: clip.id,
                                          mode: 'right',
                                          startSec: drag.segStartSec,
                                          endSec: drag.segStartSec + roundedDur,
                                          durSec: roundedDur,
                                        });
                                        onUpdateClip(clip.id, {
                                          durationSec: roundedDur,
                                        });
                                      }}
                                      onPointerUp={(e) => {
                                        e.stopPropagation();
                                        clipResizeRef.current = null;
                                        setClipDragHud(null);
                                      }}
                                      onPointerCancel={() => {
                                        clipResizeRef.current = null;
                                        setClipDragHud(null);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      title={t.trimEndHandleAria}
                                      className="group/trim-r absolute top-0 right-0 bottom-0 w-3 max-w-[28%] z-20 cursor-ew-resize flex items-center justify-end pr-0.5 hover:bg-amber-400/35 transition-colors"
                                    >
                                      <span
                                        className={`w-0.5 h-5 rounded-full transition-all ${
                                          isSelected
                                            ? 'bg-amber-300/90 group-hover/trim-r:w-1 group-hover/trim-r:bg-amber-200 group-hover/trim-r:shadow-[0_0_6px_rgba(245,158,11,0.9)]'
                                            : 'bg-gray-500/45 group-hover:bg-amber-400/80 group-hover/trim-r:w-1 group-hover/trim-r:bg-amber-300'
                                        }`}
                                      />
                                    </div>
                                  )}
                                </div>

                                {/* Boundary Transition Pill positioned cleanly on top seam so trim edges remain unobstructed */}
                                {isTouchingNext && mediaItems.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const isSame = transMenu?.clipId === clip.id;
                                      closeAllPopovers();
                                      if (!isSame) {
                                        setTransMenu({
                                          clipId: clip.id,
                                          coords: openAnchoredPopover(e.currentTarget, 224),
                                        });
                                      }
                                    }}
                                    style={{ left: `${segLeftPct}%` }}
                                    title={`${t.clipTransitionLabel}: ${clip.transitionOut}`}
                                    className={`absolute top-0.5 -translate-x-1/2 z-30 px-1 py-0 rounded border text-[7.5px] leading-[13px] font-mono cursor-pointer shadow ${
                                      transMenu?.clipId === clip.id
                                        ? 'bg-amber-500 text-zinc-950 border-amber-300 font-bold'
                                        : 'bg-[#0E1016]/95 border-[#323849] hover:border-amber-400 text-amber-300'
                                    }`}
                                  >
                                    {transitionShortTag(
                                      config.slideshowMode === 'custom_durations' ||
                                        config.slideshowMode === 'manual'
                                        ? clip.transitionOut
                                        : config.transitionType
                                    )}
                                  </button>
                                )}
                              </React.Fragment>
                            );
                          })
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[11px] text-gray-500 px-2 truncate pointer-events-none">
                            {isManualMode ? t.timelineGapHint : t.timelineEmptyHint}
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (tr.id === 'fx') {
                    return (
                      <div
                        key={tr.id}
                        style={{ height: `${tr.heightPx}px` }}
                        className="relative bg-[#090B10] border-t border-[#1E2330]"
                      >
                        {fxOverlays.length === 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              onAddFxOverlay(
                                config.generatorEffect !== 'none'
                                  ? (config.generatorEffect as Exclude<GeneratorEffectId, 'none'>)
                                  : 'cosmic_particles',
                                selectedClip ? 'clip' : 'playhead',
                                config.generatorEffect !== 'none'
                              )
                            }
                            className="w-full h-full flex items-center justify-center gap-1.5 text-[10px] text-cyan-300/75 hover:text-cyan-200 hover:bg-cyan-500/8 transition-colors cursor-pointer"
                          >
                            <Orbit className="w-3 h-3" aria-hidden="true" />
                            <span>{t.timelineAddFxEmptyHint}</span>
                          </button>
                        ) : (
                          fxOverlays.map((fx, fxIdx) => {
                            const leftPct = Math.max(
                              0,
                              Math.min(99, (fx.startSec / clipDuration) * 100)
                            );
                            const widthPct = Math.max(
                              2,
                              Math.min(100 - leftPct, (fx.durationSec / clipDuration) * 100)
                            );
                            const laneIdx = packedFx.laneByIndex[fxIdx] ?? 0;
                            const isSel = selectedFx?.id === fx.id;

                            return (
                              <div
                                key={fx.id}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  onSelectFx(fx.id);
                                  fxDragRef.current = {
                                    fxId: fx.id,
                                    mode: 'move',
                                    startX: e.clientX,
                                    origStart: fx.startSec,
                                    origDur: fx.durationSec,
                                    trackScaleSec: clipDuration,
                                  };
                                  e.currentTarget.setPointerCapture(e.pointerId);
                                }}
                                onPointerMove={(e) => {
                                  if (!fxDragRef.current || fxDragRef.current.fxId !== fx.id)
                                    return;
                                  if ((e.buttons & 1) === 0) return;
                                  const seqW =
                                    seqInnerRef.current?.getBoundingClientRect().width || 600;
                                  const deltaSec =
                                    ((e.clientX - fxDragRef.current.startX) / seqW) *
                                    fxDragRef.current.trackScaleSec;
                                  const mode = fxDragRef.current.mode;

                                  if (mode === 'move') {
                                    let nextStart = Math.max(
                                      0,
                                      Math.min(
                                        clipDuration - fxDragRef.current.origDur,
                                        fxDragRef.current.origStart + deltaSec
                                      )
                                    );
                                    if (config.snapToBeats && relSnapPoints.length > 0) {
                                      nextStart = snapTimeToBeat(nextStart, relSnapPoints, 0.22);
                                      nextStart = Math.max(
                                        0,
                                        Math.min(clipDuration - fxDragRef.current.origDur, nextStart)
                                      );
                                    }
                                    onUpdateFxOverlay(fx.id, {
                                      startSec: Number(nextStart.toFixed(2)),
                                    });
                                  } else if (mode === 'left') {
                                    const fixedEnd =
                                      fxDragRef.current.origStart + fxDragRef.current.origDur;
                                    let nextStart = Math.max(
                                      0,
                                      Math.min(fixedEnd - 0.4, fxDragRef.current.origStart + deltaSec)
                                    );
                                    if (config.snapToBeats && relSnapPoints.length > 0) {
                                      nextStart = Math.min(
                                        fixedEnd - 0.4,
                                        snapTimeToBeat(nextStart, relSnapPoints, 0.22)
                                      );
                                    }
                                    onUpdateFxOverlay(fx.id, {
                                      startSec: Number(nextStart.toFixed(2)),
                                      durationSec: Number((fixedEnd - nextStart).toFixed(2)),
                                    });
                                  } else if (mode === 'right') {
                                    let nextDur = Math.max(
                                      0.4,
                                      Math.min(
                                        clipDuration - fxDragRef.current.origStart,
                                        fxDragRef.current.origDur + deltaSec
                                      )
                                    );
                                    if (config.snapToBeats && relSnapPoints.length > 0) {
                                      const proposedEnd = fxDragRef.current.origStart + nextDur;
                                      const snappedEnd = snapTimeToBeat(
                                        proposedEnd,
                                        relSnapPoints,
                                        0.22
                                      );
                                      nextDur = Math.max(
                                        0.4,
                                        Math.min(
                                          clipDuration - fxDragRef.current.origStart,
                                          snappedEnd - fxDragRef.current.origStart
                                        )
                                      );
                                    }
                                    onUpdateFxOverlay(fx.id, {
                                      durationSec: Number(nextDur.toFixed(2)),
                                    });
                                  }
                                }}
                                onPointerUp={(e) => {
                                  e.stopPropagation();
                                  fxDragRef.current = null;
                                }}
                                onPointerCancel={() => {
                                  fxDragRef.current = null;
                                }}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  onInspectFx(fx.id);
                                  onSeekAbsolute(trimBase + fx.startSec);
                                }}
                                style={{
                                  left: `${leftPct}%`,
                                  width: `${widthPct}%`,
                                  top: `${2 + laneIdx * 24}px`,
                                  height: '20px',
                                }}
                                title={`${fx.name} · ${fx.startSec.toFixed(1)}s → ${(
                                  fx.startSec + fx.durationSec
                                ).toFixed(1)}s`}
                                className={`absolute rounded-xs border px-1.5 flex items-center gap-1 overflow-hidden cursor-grab active:cursor-grabbing transition-colors ${
                                  isSel
                                    ? 'border-cyan-300 bg-cyan-500/25 text-cyan-50 ring-1 ring-cyan-300/60 z-10'
                                    : 'border-cyan-500/45 bg-cyan-500/12 hover:bg-cyan-500/18 text-cyan-200'
                                }`}
                              >
                                <Orbit
                                  className="w-2.5 h-2.5 text-cyan-300 shrink-0 pointer-events-none"
                                  aria-hidden="true"
                                />
                                <span className="text-[9.5px] font-medium truncate pointer-events-none">
                                  {fx.name}
                                </span>
                                <span className="ml-auto mr-1 text-[8.5px] font-mono tabular-nums text-cyan-200/80 shrink-0 pointer-events-none">
                                  {fx.durationSec.toFixed(1)}s
                                </span>

                                {/* Left Edge Trim Handle */}
                                <div
                                  onPointerDown={(e) => {
                                    e.stopPropagation();
                                    onSelectFx(fx.id);
                                    fxDragRef.current = {
                                      fxId: fx.id,
                                      mode: 'left',
                                      startX: e.clientX,
                                      origStart: fx.startSec,
                                      origDur: fx.durationSec,
                                      trackScaleSec: clipDuration,
                                    };
                                    e.currentTarget.setPointerCapture(e.pointerId);
                                  }}
                                  className="absolute top-0 left-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-cyan-300/80"
                                />

                                {/* Right Edge Resize Handle */}
                                <div
                                  onPointerDown={(e) => {
                                    e.stopPropagation();
                                    onSelectFx(fx.id);
                                    fxDragRef.current = {
                                      fxId: fx.id,
                                      mode: 'right',
                                      startX: e.clientX,
                                      origStart: fx.startSec,
                                      origDur: fx.durationSec,
                                      trackScaleSec: clipDuration,
                                    };
                                    e.currentTarget.setPointerCapture(e.pointerId);
                                  }}
                                  className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-cyan-300/80"
                                />
                              </div>
                            );
                          })
                        )}
                      </div>
                    );
                  }

                  if (tr.id === 'overlays') {
                    return (
                      <div
                        key={tr.id}
                        style={{ height: `${tr.heightPx}px` }}
                        className="relative bg-[#090C11] border-t border-[#1E2330]"
                      >
                        {overlaySpans.map((item, ovIdx) => {
                          const { ov, startSec, durationSec } = item;
                          const leftPct = Math.max(0, Math.min(99, (startSec / clipDuration) * 100));
                          const widthPct = Math.max(
                            2,
                            Math.min(100 - leftPct, (durationSec / clipDuration) * 100)
                          );
                          const laneIdx = packedOverlays.laneByIndex[ovIdx] ?? 0;
                          return (
                            <div
                              key={ov.id}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                if (!onUpdateOverlay) return;
                                ovDragRef.current = {
                                  ovId: ov.id,
                                  mode: 'move',
                                  startX: e.clientX,
                                  origStart: startSec,
                                  origDur: durationSec,
                                  trackScaleSec: clipDuration,
                                };
                                e.currentTarget.setPointerCapture(e.pointerId);
                              }}
                              onPointerMove={(e) => {
                                if (!onUpdateOverlay || !ovDragRef.current || ovDragRef.current.ovId !== ov.id)
                                  return;
                                if ((e.buttons & 1) === 0) return;
                                const seqW = seqInnerRef.current?.getBoundingClientRect().width || 600;
                                const deltaSec =
                                  ((e.clientX - ovDragRef.current.startX) / seqW) *
                                  ovDragRef.current.trackScaleSec;
                                if (ovDragRef.current.mode === 'move') {
                                  let nextStart = Math.max(
                                    0,
                                    Math.min(
                                      clipDuration - ovDragRef.current.origDur,
                                      ovDragRef.current.origStart + deltaSec
                                    )
                                  );
                                  if (config.snapToBeats && relSnapPoints.length > 0) {
                                    nextStart = Math.max(
                                      0,
                                      Math.min(
                                        clipDuration - ovDragRef.current.origDur,
                                        snapTimeToBeat(nextStart, relSnapPoints, 0.22)
                                      )
                                    );
                                  }
                                  onUpdateOverlay(ov.id, {
                                    startSec: Number(nextStart.toFixed(2)),
                                  });
                                } else if (ovDragRef.current.mode === 'left') {
                                  const fixedEnd =
                                    ovDragRef.current.origStart + ovDragRef.current.origDur;
                                  let nextStart = Math.max(
                                    0,
                                    Math.min(fixedEnd - 0.4, ovDragRef.current.origStart + deltaSec)
                                  );
                                  if (config.snapToBeats && relSnapPoints.length > 0) {
                                    nextStart = Math.min(
                                      fixedEnd - 0.4,
                                      snapTimeToBeat(nextStart, relSnapPoints, 0.22)
                                    );
                                  }
                                  onUpdateOverlay(ov.id, {
                                    startSec: Number(nextStart.toFixed(2)),
                                    durationSec: Number((fixedEnd - nextStart).toFixed(2)),
                                  });
                                } else {
                                  let nextDur = Math.max(
                                    0.4,
                                    Math.min(
                                      clipDuration - ovDragRef.current.origStart,
                                      ovDragRef.current.origDur + deltaSec
                                    )
                                  );
                                  if (config.snapToBeats && relSnapPoints.length > 0) {
                                    const proposedEnd = ovDragRef.current.origStart + nextDur;
                                    const snappedEnd = snapTimeToBeat(
                                      proposedEnd,
                                      relSnapPoints,
                                      0.22
                                    );
                                    nextDur = Math.max(
                                      0.4,
                                      Math.min(
                                        clipDuration - ovDragRef.current.origStart,
                                        snappedEnd - ovDragRef.current.origStart
                                      )
                                    );
                                  }
                                  onUpdateOverlay(ov.id, {
                                    durationSec: Number(nextDur.toFixed(2)),
                                  });
                                }
                              }}
                              onPointerUp={(e) => {
                                e.stopPropagation();
                                ovDragRef.current = null;
                              }}
                              onPointerCancel={() => {
                                ovDragRef.current = null;
                              }}
                              onClick={() => onSeekAbsolute(trimBase + startSec)}
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                                top: `${2 + laneIdx * 22}px`,
                                height: '18px',
                              }}
                              title={`${ov.text || ov.label} · ${startSec.toFixed(1)}s`}
                              className="group absolute rounded-xs border border-emerald-500/45 bg-emerald-500/15 hover:bg-emerald-500/25 px-1.5 flex items-center gap-1 overflow-hidden cursor-grab active:cursor-grabbing text-emerald-200"
                            >
                              <div
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  if (!onUpdateOverlay) return;
                                  ovDragRef.current = {
                                    ovId: ov.id,
                                    mode: 'left',
                                    startX: e.clientX,
                                    origStart: startSec,
                                    origDur: durationSec,
                                    trackScaleSec: clipDuration,
                                  };
                                  e.currentTarget.setPointerCapture(e.pointerId);
                                }}
                                className="absolute top-0 left-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-emerald-300/80"
                              />
                              <span className="text-[9px] font-medium truncate pointer-events-none">
                                {ov.text || ov.label}
                              </span>
                              <div
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  if (!onUpdateOverlay) return;
                                  ovDragRef.current = {
                                    ovId: ov.id,
                                    mode: 'right',
                                    startX: e.clientX,
                                    origStart: startSec,
                                    origDur: durationSec,
                                    trackScaleSec: clipDuration,
                                  };
                                  e.currentTarget.setPointerCapture(e.pointerId);
                                }}
                                className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-emerald-300/80"
                              />
                            </div>
                          );
                        })}
                      </div>
                    );
                  }

                  if (tr.id === 'audio') {
                    return (
                      <div
                        key={tr.id}
                        style={{ height: `${tr.heightPx}px` }}
                        onPointerDown={handleSeqScrubPointerDown}
                        onPointerMove={handleSeqScrubPointerMove}
                        onDoubleClick={(e) => {
                          if (!seqInnerRef.current) return;
                          const rect = seqInnerRef.current.getBoundingClientRect();
                          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                          onToggleBeatMarkerAt(trimBase + ratio * clipDuration);
                        }}
                        title={t.audioTrackDoubleClickHint}
                        className="relative bg-[#0B0D11] border-t border-[#1E2330] cursor-ew-resize"
                      >
                        {audio && config.fadeOutSec > 0.1 && (
                          <div
                            className="absolute top-0 bottom-0 right-0 bg-gradient-to-r from-transparent to-black/75 pointer-events-none"
                            style={{
                              width: `${Math.min(100, (config.fadeOutSec / clipDuration) * 100)}%`,
                            }}
                          />
                        )}

                        <canvas
                          ref={seqAudioCanvasRef}
                          className="absolute inset-0 w-full h-full pointer-events-none"
                        />

                        {beatGridPoints
                          .filter((b) => b > 0.05 && b < clipDuration)
                          .map((b, idx) => (
                            <div
                              key={`grid-${idx}-${b}`}
                              className="absolute bottom-0 h-1.5 w-px bg-gray-400/35 pointer-events-none"
                              style={{ left: `${(b / clipDuration) * 100}%` }}
                            />
                          ))}

                        {beatCutTimestamps
                          .filter((b) => b > 0.05 && b < clipDuration)
                          .map((b, idx) => (
                            <div
                              key={`auto-${idx}-${b}`}
                              className="absolute top-0 h-2 w-px bg-amber-400/75 pointer-events-none"
                              style={{ left: `${(b / clipDuration) * 100}%` }}
                            />
                          ))}

                        {config.manualBeatMarkers
                          .filter((m) => m >= trimBase && m <= trimBase + clipDuration)
                          .map((markerSec, idx) => (
                            <button
                              key={`man-${markerSec}-${idx}`}
                              type="button"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleBeatMarkerAt(markerSec);
                              }}
                              title={`${markerSec.toFixed(2)}s`}
                              className="absolute top-0 bottom-0 w-px bg-cyan-400/90 cursor-pointer group z-10"
                              style={{
                                left: `${((markerSec - trimBase) / clipDuration) * 100}%`,
                              }}
                            >
                              <div className="w-2 h-2 -ml-[3px] bg-cyan-300 group-hover:bg-rose-400 rotate-45 transition-colors" />
                            </button>
                          ))}
                      </div>
                    );
                  }

                  // Subtitles lane
                  return (
                    <div
                      key={tr.id}
                      style={{ height: `${tr.heightPx}px` }}
                      className="relative bg-[#0A0C10] border-t border-[#1E2330]"
                    >
                      {config.subtitles.map((cue) => {
                        const relStart = cue.startSec - trimBase;
                        const relEnd = cue.endSec - trimBase;
                        if (relEnd <= 0 || relStart >= clipDuration) return null;
                        const clampedStart = Math.max(0, relStart);
                        const clampedEnd = Math.min(clipDuration, relEnd);
                        const leftPct = (clampedStart / clipDuration) * 100;
                        const widthPct = Math.max(
                          1.5,
                          ((clampedEnd - clampedStart) / clipDuration) * 100
                        );
                        return (
                          <button
                            key={cue.id}
                            type="button"
                            onClick={() => onSeekAbsolute(cue.startSec)}
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            title={cue.text}
                            className="absolute top-0.5 bottom-0.5 rounded-xs border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/30 px-1 text-[9px] text-amber-200 truncate text-left cursor-pointer"
                          >
                            {cue.text}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}

                {/* End-of-Project Boundary Marker (when no audio gives free workspace headroom) */}
                {!audio && mediaItems.length > 0 && contentSpanSec < clipDuration - 0.05 && (
                  <div
                    className="absolute top-0 bottom-0 border-l border-dashed border-amber-500/45 pointer-events-none z-10"
                    style={{ left: `${(contentSpanSec / clipDuration) * 100}%` }}
                  />
                )}

                {/* Unified Continuous Vertical Playhead */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none z-20"
                  style={{ left: `${playheadPct}%` }}
                >
                  <div className="w-2 h-2 -ml-[3px] bg-amber-400 rotate-45 -mt-0.5" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Portal: + Generator Menu */}
      {genMenuOpen &&
        genCoords &&
        createPortal(
          <div
            ref={genPortalRef}
            style={{ left: `${genCoords.left}px`, bottom: `${genCoords.bottom}px` }}
            className="fixed z-50 w-80 rounded-lg border border-[#323849] bg-[#141822] shadow-2xl p-2.5 space-y-2"
          >
            <div className="grid grid-cols-3 gap-1 rounded-md bg-[#0B0D11] p-0.5 border border-[#262B38]">
              <button
                type="button"
                onClick={() => setGenTarget('fx_track')}
                className={`px-1.5 py-1 rounded text-[10px] font-medium cursor-pointer truncate ${
                  genTarget === 'fx_track'
                    ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {t.genTargetFxTrack}
              </button>
              <button
                type="button"
                disabled={!selectedClip}
                onClick={() => setGenTarget('clip_overlay')}
                className={`px-1.5 py-1 rounded text-[10px] font-medium cursor-pointer truncate disabled:opacity-35 ${
                  genTarget === 'clip_overlay'
                    ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {t.genTargetClipOverlay}
              </button>
              <button
                type="button"
                onClick={() => setGenTarget('clip_scene')}
                className={`px-1.5 py-1 rounded text-[10px] font-medium cursor-pointer truncate ${
                  genTarget === 'clip_scene'
                    ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {t.genTargetClipScene}
              </button>
            </div>

            {config.generatorEffect !== 'none' && (
              <button
                type="button"
                onClick={() =>
                  handlePickGenerator(
                    config.generatorEffect as Exclude<GeneratorEffectId, 'none'>,
                    true
                  )
                }
                className="w-full text-left px-2.5 py-1.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-[11px] font-semibold text-amber-300 cursor-pointer truncate"
              >
                + {t.timelineAddCurrentGen}
              </button>
            )}

            <div className="grid grid-cols-2 gap-1 max-h-60 overflow-y-auto pr-0.5">
              {GENERATOR_EFFECTS.filter((g) => g.id !== 'none').map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() =>
                    handlePickGenerator(g.id as Exclude<GeneratorEffectId, 'none'>)
                  }
                  className="text-left px-2 py-1.5 rounded border border-[#262B38] bg-[#0E1016] hover:border-cyan-500/50 hover:bg-[#191E2A] text-[11px] text-gray-200 cursor-pointer truncate"
                >
                  {lang === 'ru' ? g.nameRu : g.nameEn}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}

      {/* Portal: Auto Beat-Sync Popover */}
      {beatSyncOpen &&
        beatSyncCoords &&
        createPortal(
          <div
            ref={beatSyncPortalRef}
            style={{ left: `${beatSyncCoords.left}px`, bottom: `${beatSyncCoords.bottom}px` }}
            className="fixed z-50 w-64 rounded-lg border border-[#323849] bg-[#141822] shadow-2xl p-2.5 space-y-2"
          >
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-amber-300">{t.beatSyncTitle}</span>
              {trackBpm > 0 && (
                <span className="font-mono text-[10px] text-gray-300">
                  {trackBpm} {t.detectedBpmLabel}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-1">
              {(
                [
                  { id: 'fit_track', label: t.beatSyncFitTrack },
                  { id: 'beats_1', label: t.beatSync1Beat },
                  { id: 'beats_2', label: t.beatSync2Beats },
                  { id: 'beats_4', label: t.beatSync4Beats },
                  { id: 'beats_8', label: t.beatSync8Beats },
                ] as { id: BeatSyncMode; label: string }[]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={mediaItems.length === 0}
                  onClick={() => {
                    onAutoBeatSyncClips(m.id, beatSyncMotion);
                    setBeatSyncOpen(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded border border-[#262B38] bg-[#0E1016] hover:border-amber-500/60 hover:bg-amber-500/10 disabled:opacity-35 text-[11px] font-medium text-gray-200 cursor-pointer"
                >
                  {m.label}
                </button>
              ))}
            </div>

            <label className="flex items-center justify-between text-[11px] text-gray-300 pt-1 border-t border-[#262B38] cursor-pointer">
              <span>{t.beatSyncAutoMotion}</span>
              <input
                type="checkbox"
                checked={beatSyncMotion}
                onChange={(e) => setBeatSyncMotion(e.target.checked)}
                className="accent-amber-500 w-3.5 h-3.5 rounded cursor-pointer"
              />
            </label>

            {fxOverlays.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onSnapFxOverlaysToBeats();
                  setBeatSyncOpen(false);
                }}
                className="w-full py-1.5 px-2.5 rounded border border-cyan-500/50 bg-cyan-500/12 hover:bg-cyan-500/20 text-[11px] font-medium text-cyan-200 cursor-pointer"
              >
                {t.fxSnapToBeatsBtn}
              </button>
            )}
          </div>,
          document.body
        )}

      {/* Portal: Transition Picker Popover */}
      {transMenu &&
        transMenuClip &&
        createPortal(
          <div
            ref={transPortalRef}
            style={{ left: `${transMenu.coords.left}px`, bottom: `${transMenu.coords.bottom}px` }}
            className="fixed z-50 w-56 rounded-lg border border-[#323849] bg-[#141822] shadow-2xl p-2 space-y-2"
          >
            <div className="flex items-center justify-between text-[10px] text-gray-400">
              <span className="font-semibold text-gray-200">{t.clipTransitionLabel}</span>
              <span className="font-mono text-amber-300">
                {transMenuClip.transitionDurationSec.toFixed(2)}s
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {transitionOptions.map((opt) => {
                const active =
                  (config.slideshowMode === 'custom_durations' || config.slideshowMode === 'manual'
                    ? transMenuClip.transitionOut
                    : config.transitionType) === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onSetClipTransition(transMenuClip.id, opt.id, false);
                    }}
                    className={`px-1.5 py-1 rounded border text-[10px] font-medium cursor-pointer truncate ${
                      active
                        ? 'border-amber-500 bg-amber-500/20 text-amber-200'
                        : 'border-[#262B38] bg-[#0E1016] text-gray-300 hover:border-gray-500'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <input
              type="range"
              min={0.1}
              max={2.0}
              step={0.05}
              value={transMenuClip.transitionDurationSec}
              onChange={(e) =>
                onUpdateClip(transMenuClip.id, {
                  transitionDurationSec: Number(e.target.value),
                })
              }
              className="w-full studio-slider"
              aria-label={t.clipTransDurationLabel}
            />
            <button
              type="button"
              onClick={() => {
                onSetClipTransition(transMenuClip.id, transMenuClip.transitionOut, true);
                setTransMenu(null);
              }}
              className="w-full py-1 px-2 rounded border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-[10px] font-medium text-amber-300 cursor-pointer"
            >
              {t.applyTransToAllBtn}
            </button>
          </div>,
          document.body
        )}

      {/* Portal: More Tools Menu */}
      {moreMenuOpen &&
        moreCoords &&
        createPortal(
          <div
            ref={morePortalRef}
            style={{ left: `${moreCoords.left}px`, bottom: `${moreCoords.bottom}px` }}
            className="fixed z-50 w-52 rounded-lg border border-[#323849] bg-[#141822] shadow-2xl p-1.5 space-y-1"
          >
            <button
              type="button"
              onClick={() => {
                onAddBeatMarker();
                setMoreMenuOpen(false);
              }}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#1E2330] text-[11px] text-cyan-300 cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5">
                <Flag className="w-3 h-3" />
                {t.tapTempoBtn}
              </span>
              {config.manualBeatMarkers.length > 0 && (
                <span className="font-mono text-[10px]">({config.manualBeatMarkers.length})</span>
              )}
            </button>

            {config.manualBeatMarkers.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onClearBeatMarkers();
                  setMoreMenuOpen(false);
                }}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1E2330] text-[11px] text-rose-300 cursor-pointer"
              >
                {t.clearMarkersBtn}
              </button>
            )}

            {audio && (
              <>
                <div className="h-px bg-[#262B38] my-0.5" />
                <button
                  type="button"
                  onClick={() => {
                    onSetTrimStart(currentTime);
                    setMoreMenuOpen(false);
                  }}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1E2330] text-[11px] font-mono text-gray-200 cursor-pointer"
                >
                  {t.setTrimInBtn}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSetTrimEnd(currentTime);
                    setMoreMenuOpen(false);
                  }}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1E2330] text-[11px] font-mono text-gray-200 cursor-pointer"
                >
                  {t.setTrimOutBtn}
                </button>
              </>
            )}

            {mediaItems.length > 1 && (
              <>
                <div className="h-px bg-[#262B38] my-0.5" />
                <button
                  type="button"
                  onClick={() => {
                    onReverseClips();
                    setMoreMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-[#1E2330] text-[11px] text-gray-200 cursor-pointer"
                >
                  <ArrowLeftRight className="w-3 h-3 text-gray-400" />
                  <span>{t.reverseClipsBtn}</span>
                </button>
                {selectedIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      onReorderClip(selectedIndex, selectedIndex - 1);
                      setMoreMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-[#1E2330] text-[11px] text-gray-200 cursor-pointer"
                  >
                    <ChevronLeft className="w-3 h-3" />
                    <span>{t.clipMoveLeftBtn}</span>
                  </button>
                )}
                {selectedIndex >= 0 && selectedIndex < mediaItems.length - 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      onReorderClip(selectedIndex, selectedIndex + 1);
                      setMoreMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-[#1E2330] text-[11px] text-gray-200 cursor-pointer"
                  >
                    <ChevronRight className="w-3 h-3" />
                    <span>{t.clipMoveRightBtn}</span>
                  </button>
                )}
              </>
            )}
          </div>,
          document.body
        )}
    </section>
  );
}
