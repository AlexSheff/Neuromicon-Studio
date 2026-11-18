import {
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Flag,
  Layers,
  Magnet,
  Minus,
  Orbit,
  Plus,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Volume2,
  ZoomIn,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { tFor } from '../i18n';
import {
  AudioTrackState,
  BeatSyncMode,
  GeneratorEffectId,
  Language,
  OverlayBlendMode,
  SlideTransitionType,
  StudioConfig,
  TimelineGeneratorOverlay,
  VisualMediaState,
} from '../types/studio';
import { computeClipTimelineSegments, snapTimeToBeat } from '../utils/audioAnalyzer';
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
}

type GenAddTarget = 'fx_track' | 'clip_overlay' | 'clip_scene';

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
}: TimelineDockProps) {
  const t = tFor(lang);
  const [genMenuOpen, setGenMenuOpen] = useState(false);
  const [genTarget, setGenTarget] = useState<GenAddTarget>('fx_track');
  const [beatSyncOpen, setBeatSyncOpen] = useState(false);
  const [beatSyncMotion, setBeatSyncMotion] = useState(true);
  const [transMenu, setTransMenu] = useState<{ clipId: string; leftPct: number } | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const masterTimelineRef = useRef<HTMLDivElement>(null);
  const seqInnerRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const trimDragModeRef = useRef<'in' | 'out' | null>(null);
  const clipResizeRef = useRef<{
    clipId: string;
    segStartSec: number;
    startX: number;
    startDur: number;
  } | null>(null);
  const fxDragRef = useRef<{
    fxId: string;
    mode: 'move' | 'left' | 'right';
    startX: number;
    origStart: number;
    origDur: number;
  } | null>(null);

  // Close popovers when clicking outside
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (dockRef.current && !dockRef.current.contains(e.target as Node)) {
        setGenMenuOpen(false);
        setBeatSyncOpen(false);
        setTransMenu(null);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const rawClipsTotal = useMemo(
    () => mediaItems.reduce((acc, m) => acc + Math.max(0.5, m.durationSec || 4), 0),
    [mediaItems]
  );

  const clipDuration = audio
    ? Math.max(0.5, config.trimEnd - config.trimStart)
    : mediaItems.length > 0
      ? Math.max(0.5, rawClipsTotal)
      : 12;

  const trimBase = audio ? config.trimStart : 0;
  const localTime = Math.max(0, Math.min(clipDuration, currentTime - trimBase));

  const clipSegments = computeClipTimelineSegments(
    mediaItems,
    clipDuration,
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
      visibleSec <= 6
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
    if (clipResizeRef.current || fxDragRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubSequenceAtClientX(e.clientX);
  };

  const handleSeqScrubPointerMove = (e: React.PointerEvent) => {
    if ((e.buttons & 1) === 0 || clipResizeRef.current || fxDragRef.current) return;
    scrubSequenceAtClientX(e.clientX);
  };

  const setClipDuration = (clipId: string, rawDur: number) => {
    const clamped = Math.max(0.5, Math.min(30, Number(rawDur.toFixed(2))));
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

  const playheadPct = Math.max(0, Math.min(100, (localTime / clipDuration) * 100));

  return (
    <section
      ref={dockRef}
      aria-label="Timeline"
      className="shrink-0 border-t border-[#262B38] bg-[#0E1016] px-3 lg:px-4 py-2 space-y-1.5 relative z-20"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/mp4,video/webm,video/quicktime"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) onVisualFiles(files);
          e.target.value = '';
        }}
      />

      {/* Row 1: Timeline Tools + Selected Item Quick Bar + Beat Sync + Zoom */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-[#1E2330]">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Add Media */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[11px] font-medium text-gray-200 cursor-pointer transition-colors whitespace-nowrap"
          >
            <Plus className="w-3 h-3 text-amber-400" aria-hidden="true" />
            <span>{t.timelineAddMediaBtn}</span>
          </button>

          {/* Unified Add Generator Menu (FX Track / On Selected Clip / Scene Clip) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setBeatSyncOpen(false);
                setTransMenu(null);
                setGenMenuOpen((v) => !v);
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-cyan-500/50 bg-cyan-500/12 hover:bg-cyan-500/20 text-[11px] font-semibold text-cyan-200 cursor-pointer transition-colors whitespace-nowrap"
            >
              <Orbit className="w-3 h-3 text-cyan-300" aria-hidden="true" />
              <span>+ {t.timelineAddGenBtn}</span>
              <ChevronDown className="w-3 h-3 opacity-80" aria-hidden="true" />
            </button>

            {genMenuOpen && (
              <div className="absolute bottom-full left-0 mb-1.5 z-40 w-80 rounded-lg border border-[#323849] bg-[#141822] shadow-2xl p-2.5 space-y-2">
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
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-[#262B38] mx-0.5 hidden sm:block" aria-hidden="true" />

          {/* Dynamic Contextual Selection Bar: Selected FX Overlay OR Selected Clip */}
          {selectedFx ? (
            <div className="inline-flex items-center gap-1 rounded border border-cyan-500/50 bg-cyan-500/10 px-2 py-0.5">
              <Layers className="w-3 h-3 text-cyan-300 shrink-0" aria-hidden="true" />
              <span className="text-[11px] font-semibold text-cyan-200 max-w-[120px] truncate">
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
                aria-label="-0.5s"
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
                    durationSec: Math.min(clipDuration, Number((selectedFx.durationSec + 0.5).toFixed(2))),
                  })
                }
                aria-label="+0.5s"
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
              <span className="text-[10px] text-gray-500 font-medium hidden md:inline">
                {t.timelineSelectedClipLabel}:
              </span>
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
                className="bg-transparent text-[11px] font-medium text-gray-100 focus:outline-none max-w-[130px] sm:max-w-[165px] truncate cursor-pointer disabled:opacity-40"
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
                    aria-label="-0.5s"
                    className="p-0.5 rounded hover:bg-[#1E2330] text-gray-300 hover:text-amber-300 cursor-pointer"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
                    type="number"
                    min={0.5}
                    max={30}
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
                    aria-label="+0.5s"
                    className="p-0.5 rounded hover:bg-[#1E2330] text-gray-300 hover:text-amber-300 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>

                  {mediaItems.length > 1 && (
                    <div className="hidden lg:flex items-center gap-0.5 ml-0.5">
                      <button
                        type="button"
                        disabled={selectedIndex <= 0}
                        onClick={() => onReorderClip(selectedIndex, selectedIndex - 1)}
                        title={t.clipMoveLeftBtn}
                        aria-label={t.clipMoveLeftBtn}
                        className="p-0.5 rounded hover:bg-[#1E2330] text-gray-400 hover:text-gray-100 disabled:opacity-25 cursor-pointer"
                      >
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={selectedIndex >= mediaItems.length - 1}
                        onClick={() => onReorderClip(selectedIndex, selectedIndex + 1)}
                        title={t.clipMoveRightBtn}
                        aria-label={t.clipMoveRightBtn}
                        className="p-0.5 rounded hover:bg-[#1E2330] text-gray-400 hover:text-gray-100 disabled:opacity-25 cursor-pointer"
                      >
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => onInspectClip(selectedClip.id)}
                    title={t.inspectClipBtn}
                    className="ml-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0B0D11] border border-[#262B38] hover:border-amber-500/60 text-[10px] font-medium text-gray-300 hover:text-amber-300 cursor-pointer"
                  >
                    <SlidersHorizontal className="w-2.5 h-2.5" aria-hidden="true" />
                    <span className="hidden md:inline">{t.inspectClipBtn}</span>
                  </button>
                </>
              )}
            </div>
          )}

          {/* NLE Edit Tools */}
          {!selectedFx && (
            <button
              type="button"
              onClick={onSplitClipAtPlayhead}
              disabled={mediaItems.length === 0}
              title={`${t.splitClipBtn} (S)`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 disabled:opacity-35 text-[11px] font-medium text-gray-200 cursor-pointer transition-colors"
            >
              <Scissors className="w-3 h-3 text-amber-400" aria-hidden="true" />
              <span className="hidden sm:inline">{t.splitClipBtn}</span>
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
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 disabled:opacity-35 text-[11px] font-medium text-gray-200 cursor-pointer transition-colors"
          >
            <Copy className="w-3 h-3 text-gray-300" aria-hidden="true" />
            <span className="hidden md:inline">{t.duplicateSelectedBtn}</span>
          </button>

          <button
            type="button"
            onClick={onRippleDeleteSelected}
            disabled={!selectedFx && !selectedClipId && mediaItems.length === 0}
            title={`${t.rippleDeleteBtn} (Del)`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-rose-500/60 disabled:opacity-35 text-[11px] font-medium text-gray-200 cursor-pointer transition-colors"
          >
            <Trash2 className="w-3 h-3 text-rose-400" aria-hidden="true" />
            <span className="hidden md:inline">{t.rippleDeleteBtn}</span>
          </button>

          {mediaItems.length > 1 && !selectedFx && (
            <button
              type="button"
              onClick={onReverseClips}
              title={t.reverseClipsBtn}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-gray-500 text-[11px] font-medium text-gray-300 cursor-pointer transition-colors"
            >
              <ArrowLeftRight className="w-3 h-3 text-gray-400" aria-hidden="true" />
              <span className="hidden xl:inline">{t.reverseClipsBtn}</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {audio && (
            <>
              <button
                type="button"
                onClick={() => onSetTrimStart(currentTime)}
                title={t.setTrimInBtn}
                className="px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[11px] font-mono text-gray-200 cursor-pointer transition-colors"
              >
                {t.setTrimInBtn}
              </button>
              <button
                type="button"
                onClick={() => onSetTrimEnd(currentTime)}
                title={t.setTrimOutBtn}
                className="px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[11px] font-mono text-gray-200 cursor-pointer transition-colors"
              >
                {t.setTrimOutBtn}
              </button>
            </>
          )}

          {/* Smart Auto Beat-Sync Split Button & Mode Popover */}
          {audio && (
            <div className="relative">
              <div className="inline-flex rounded border border-amber-500/55 bg-amber-500/15 overflow-hidden">
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
                    setGenMenuOpen(false);
                    setTransMenu(null);
                    setBeatSyncOpen((v) => !v);
                  }}
                  aria-label={t.beatSyncTitle}
                  className="px-1 border-l border-amber-500/35 hover:bg-amber-500/25 text-amber-300 cursor-pointer"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>

              {beatSyncOpen && (
                <div className="absolute bottom-full right-0 mb-1.5 z-40 w-64 rounded-lg border border-[#323849] bg-[#141822] shadow-2xl p-2.5 space-y-2">
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
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onToggleSnapToBeats}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium cursor-pointer transition-colors ${
              config.snapToBeats
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
            }`}
          >
            <Magnet className="w-3 h-3" aria-hidden="true" />
            <span className="hidden md:inline">{t.snapBeatsLabel}</span>
          </button>

          <button
            type="button"
            onClick={onAddBeatMarker}
            title={`${t.tapTempoBtn} (M)`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-cyan-400/60 text-[11px] font-medium text-cyan-300 cursor-pointer transition-colors"
          >
            <Flag className="w-3 h-3" aria-hidden="true" />
            <span className="hidden lg:inline">{t.tapTempoBtn}</span>
            {config.manualBeatMarkers.length > 0 && (
              <span className="font-mono">({config.manualBeatMarkers.length})</span>
            )}
          </button>

          {config.manualBeatMarkers.length > 0 && (
            <button
              type="button"
              onClick={onClearBeatMarkers}
              className="px-1.5 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-rose-500/50 text-[11px] text-gray-400 hover:text-rose-300 cursor-pointer transition-colors"
            >
              {t.clearMarkersBtn}
            </button>
          )}

          <div className="flex items-center gap-1.5 pl-1 border-l border-[#262B38]">
            <ZoomIn className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={timelineZoom}
              onChange={(e) => setTimelineZoom(Number(e.target.value))}
              className="w-16 studio-slider"
              aria-label={t.timelineZoomLabel}
            />
            <span className="text-[11px] font-mono tabular-nums text-gray-300 w-7 text-right">
              {timelineZoom}×
            </span>
          </div>
        </div>
      </div>

      {/* Row 2: Master Full-Track Overview & Draggable Trim Brackets (shown when audio loaded) */}
      {audio && audio.duration > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-gray-500 w-12 shrink-0 truncate">
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
            <div
              className="absolute top-0 bottom-0 bg-amber-500/12 border-y border-amber-500/40"
              style={{
                left: `${(config.trimStart / audio.duration) * 100}%`,
                width: `${Math.max(1, ((config.trimEnd - config.trimStart) / audio.duration) * 100)}%`,
              }}
            >
              <div
                role="slider"
                aria-label={t.trimStartLabel}
                aria-valuenow={config.trimStart}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  trimDragModeRef.current = 'in';
                  masterTimelineRef.current?.setPointerCapture(e.pointerId);
                }}
                className="absolute top-0 bottom-0 left-0 w-2 bg-amber-500 hover:bg-amber-400 cursor-ew-resize z-20"
                title={`${t.trimStartLabel}: ${config.trimStart.toFixed(1)}s`}
              />
              <div
                role="slider"
                aria-label={t.trimEndLabel}
                aria-valuenow={config.trimEnd}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  trimDragModeRef.current = 'out';
                  masterTimelineRef.current?.setPointerCapture(e.pointerId);
                }}
                className="absolute top-0 bottom-0 right-0 w-2 bg-amber-500 hover:bg-amber-400 cursor-ew-resize z-20"
                title={`${t.trimEndLabel}: ${config.trimEnd.toFixed(1)}s`}
              />
            </div>

            <div className="absolute inset-0 flex items-center gap-px px-1 pointer-events-none">
              {Array.from(audio.waveformPeaks).map((peak, idx) => {
                const barSec = (idx / audio.waveformPeaks.length) * audio.duration;
                const insideTrim = barSec >= config.trimStart && barSec <= config.trimEnd;
                const isPlayed = barSec <= currentTime;
                return (
                  <div
                    key={idx}
                    className="flex-1 rounded-xs"
                    style={{
                      height: `${Math.max(12, peak * 82)}%`,
                      backgroundColor: isPlayed
                        ? '#F59E0B'
                        : insideTrim
                          ? '#6B7280'
                          : '#262B38',
                    }}
                  />
                );
              })}
            </div>

            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none z-10"
              style={{
                left: `${Math.max(0, Math.min(100, (currentTime / audio.duration) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Row 3: Synchronized Zoomable NLE Sequence (Ruler + Clips + FX Overlays + Audio + Subtitles) */}
      <div className="flex gap-2">
        <div className="w-12 shrink-0 flex flex-col gap-1 select-none">
          <div className="h-4 flex items-center text-[9px] font-mono text-gray-500">0:00</div>
          <div className="h-11 flex items-center text-[10px] font-medium text-gray-400 truncate">
            {t.timelineClipsTrackLabel}
          </div>
          <div className="h-8 flex items-center justify-between gap-0.5 text-[10px] font-medium text-cyan-300/90">
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
          <div className="h-8 flex items-center text-[10px] font-medium text-gray-400 truncate">
            {t.timelineAudioTrackLabel}
          </div>
          {config.subtitles.length > 0 && (
            <div className="h-5 flex items-center text-[9px] font-medium text-gray-400 truncate">
              {t.timelineSubtitlesTrackLabel}
            </div>
          )}
        </div>

        <div
          className="flex-1 min-w-0 overflow-x-auto overflow-y-visible rounded-md border border-[#262B38] bg-[#0B0D11] relative"
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              setTimelineZoom((z) =>
                Math.max(1, Math.min(8, Number((z + (e.deltaY < 0 ? 0.5 : -0.5)).toFixed(1))))
              );
            }
          }}
        >
          <div
            ref={seqInnerRef}
            className="relative flex flex-col gap-1 select-none"
            style={{ width: `${timelineZoom * 100}%`, minWidth: '100%' }}
          >
            {/* Ruler Track */}
            <div
              onPointerDown={handleSeqScrubPointerDown}
              onPointerMove={handleSeqScrubPointerMove}
              className="h-4 relative border-b border-[#1E2330] bg-[#10131A] cursor-ew-resize"
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

            {/* Track 1: Clips & Generative Scenes */}
            <div className="h-11 relative flex items-center bg-[#0B0D11]">
              {clipSegments.length > 0 ? (
                clipSegments.map((seg, idx) => {
                  const clip = mediaItems[seg.clipIndex];
                  if (!clip) return null;
                  const segDur = seg.endSec - seg.startSec;
                  const widthPct = (segDur / clipDuration) * 100;
                  const isSelected = !selectedFx && selectedClip?.id === clip.id;
                  const isPlayheadInside =
                    localTime >= seg.startSec && localTime < seg.endSec + 0.001;
                  const isDragOver =
                    dragOverIndex === seg.clipIndex && dragIndex !== seg.clipIndex;
                  const hasNext = idx < clipSegments.length - 1;
                  const segLeftPct = (seg.endSec / clipDuration) * 100;

                  return (
                    <React.Fragment key={`${clip.id}-${idx}`}>
                      <div
                        draggable={!seg.isLoopRepeat}
                        onDragStart={() => setDragIndex(seg.clipIndex)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOverIndex(seg.clipIndex);
                        }}
                        onDragLeave={() => setDragOverIndex(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragIndex !== null && dragIndex !== seg.clipIndex) {
                            onReorderClip(dragIndex, seg.clipIndex);
                          }
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        onClick={() => onSelectClip(clip.id)}
                        onDoubleClick={() => {
                          onSelectClip(clip.id);
                          jumpToClipStart(clip.id);
                        }}
                        style={{ width: `${Math.max(1.5, widthPct)}%` }}
                        title={`${clip.fileName} · ${segDur.toFixed(1)}s`}
                        className={`relative h-full border-r border-[#262B38] px-1.5 flex items-center gap-1 overflow-hidden text-left cursor-pointer transition-colors group ${
                          seg.isLoopRepeat
                            ? 'bg-[#11141C]/80 opacity-80 border-dashed text-gray-400'
                            : isDragOver
                              ? 'ring-2 ring-inset ring-amber-400 bg-amber-500/25'
                              : isSelected
                                ? 'bg-amber-500/20 text-amber-100 ring-1 ring-inset ring-amber-400'
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
                          <span className="px-1 py-0.2 rounded bg-[#0B0D11]/90 border border-[#262B38] text-[8px] font-mono text-gray-400 shrink-0 pointer-events-none">
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
                        <span className="ml-auto mr-1 px-1 py-0.5 rounded bg-[#0B0D11]/80 border border-[#262B38] text-[9px] font-mono tabular-nums text-amber-300 shrink-0 pointer-events-none">
                          {segDur.toFixed(1)}s
                        </span>

                        {/* Right-Edge Duration Resize Handle (with Beat Snapping) */}
                        {!seg.isLoopRepeat && (
                          <div
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              clipResizeRef.current = {
                                clipId: clip.id,
                                segStartSec: seg.startSec,
                                startX: e.clientX,
                                startDur: clip.durationSec,
                              };
                              e.currentTarget.setPointerCapture(e.pointerId);
                              onSelectClip(clip.id);
                            }}
                            onPointerMove={(e) => {
                              if (!clipResizeRef.current || clipResizeRef.current.clipId !== clip.id)
                                return;
                              if ((e.buttons & 1) === 0) return;
                              const seqW = seqInnerRef.current?.getBoundingClientRect().width || 600;
                              const deltaSec =
                                ((e.clientX - clipResizeRef.current.startX) / seqW) * clipDuration;
                              let nextDur = Math.max(
                                0.5,
                                Math.min(30, clipResizeRef.current.startDur + deltaSec)
                              );
                              if (config.snapToBeats && relSnapPoints.length > 0) {
                                const proposedEnd = clipResizeRef.current.segStartSec + nextDur;
                                const snappedEnd = snapTimeToBeat(proposedEnd, relSnapPoints, 0.22);
                                nextDur = Math.max(
                                  0.5,
                                  Math.min(30, snappedEnd - clipResizeRef.current.segStartSec)
                                );
                              }
                              onUpdateClip(clip.id, { durationSec: Number(nextDur.toFixed(2)) });
                            }}
                            onPointerUp={(e) => {
                              e.stopPropagation();
                              clipResizeRef.current = null;
                            }}
                            onClick={(e) => e.stopPropagation()}
                            title={t.clipDurationLabel}
                            className="absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize bg-transparent hover:bg-amber-400/80 transition-colors"
                          />
                        )}
                      </div>

                      {/* Boundary Transition Pill (Click opens direct Transition Picker Popover) */}
                      {hasNext && mediaItems.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setGenMenuOpen(false);
                            setBeatSyncOpen(false);
                            setTransMenu((cur) =>
                              cur?.clipId === clip.id
                                ? null
                                : { clipId: clip.id, leftPct: segLeftPct }
                            );
                          }}
                          style={{ left: `${segLeftPct}%` }}
                          title={`${t.clipTransitionLabel}: ${clip.transitionOut}`}
                          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 px-1 py-0.5 rounded border text-[8px] font-mono cursor-pointer shadow ${
                            transMenu?.clipId === clip.id
                              ? 'bg-amber-500 text-zinc-950 border-amber-300 font-bold'
                              : 'bg-[#0E1016] border-[#323849] hover:border-amber-400 text-amber-300'
                          }`}
                        >
                          {transitionShortTag(
                            config.slideshowMode === 'custom_durations'
                              ? clip.transitionOut
                              : config.transitionType
                          )}
                        </button>
                      )}
                    </React.Fragment>
                  );
                })
              ) : (
                <div className="w-full text-center text-[11px] text-gray-500 px-2 truncate">
                  {t.timelineEmptyHint}
                </div>
              )}

              {/* Transition Picker Popover anchored cleanly above clicked boundary */}
              {transMenu && transMenuClip && (
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{
                    left: `${Math.max(12, Math.min(88, transMenu.leftPct))}%`,
                  }}
                  className="absolute bottom-full -translate-x-1/2 mb-1.5 z-40 w-56 rounded-lg border border-[#323849] bg-[#141822] shadow-2xl p-2 space-y-2"
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
                        (config.slideshowMode === 'custom_durations'
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
                </div>
              )}
            </div>

            {/* Track 2: Generator FX Overlays Lane (spans over clips, draggable & resizable) */}
            <div className="h-8 relative bg-[#090B10] border-t border-[#1E2330]">
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
                fxOverlays.map((fx) => {
                  const leftPct = Math.max(0, Math.min(99, (fx.startSec / clipDuration) * 100));
                  const widthPct = Math.max(2, Math.min(100 - leftPct, (fx.durationSec / clipDuration) * 100));
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
                        };
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }}
                      onPointerMove={(e) => {
                        if (!fxDragRef.current || fxDragRef.current.fxId !== fx.id) return;
                        if ((e.buttons & 1) === 0) return;
                        const seqW = seqInnerRef.current?.getBoundingClientRect().width || 600;
                        const deltaSec =
                          ((e.clientX - fxDragRef.current.startX) / seqW) * clipDuration;
                        const mode = fxDragRef.current.mode;

                        if (mode === 'move') {
                          let nextStart = Math.max(
                            0,
                            Math.min(clipDuration - fxDragRef.current.origDur, fxDragRef.current.origStart + deltaSec)
                          );
                          if (config.snapToBeats && relSnapPoints.length > 0) {
                            nextStart = snapTimeToBeat(nextStart, relSnapPoints, 0.22);
                            nextStart = Math.max(0, Math.min(clipDuration - fxDragRef.current.origDur, nextStart));
                          }
                          onUpdateFxOverlay(fx.id, { startSec: Number(nextStart.toFixed(2)) });
                        } else if (mode === 'left') {
                          const fixedEnd = fxDragRef.current.origStart + fxDragRef.current.origDur;
                          let nextStart = Math.max(0, Math.min(fixedEnd - 0.4, fxDragRef.current.origStart + deltaSec));
                          if (config.snapToBeats && relSnapPoints.length > 0) {
                            nextStart = Math.min(fixedEnd - 0.4, snapTimeToBeat(nextStart, relSnapPoints, 0.22));
                          }
                          onUpdateFxOverlay(fx.id, {
                            startSec: Number(nextStart.toFixed(2)),
                            durationSec: Number((fixedEnd - nextStart).toFixed(2)),
                          });
                        } else if (mode === 'right') {
                          let nextDur = Math.max(
                            0.4,
                            Math.min(clipDuration - fxDragRef.current.origStart, fxDragRef.current.origDur + deltaSec)
                          );
                          if (config.snapToBeats && relSnapPoints.length > 0) {
                            const proposedEnd = fxDragRef.current.origStart + nextDur;
                            const snappedEnd = snapTimeToBeat(proposedEnd, relSnapPoints, 0.22);
                            nextDur = Math.max(
                              0.4,
                              Math.min(clipDuration - fxDragRef.current.origStart, snappedEnd - fxDragRef.current.origStart)
                            );
                          }
                          onUpdateFxOverlay(fx.id, { durationSec: Number(nextDur.toFixed(2)) });
                        }
                      }}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        fxDragRef.current = null;
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onInspectFx(fx.id);
                        onSeekAbsolute(trimBase + fx.startSec);
                      }}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      title={`${fx.name} · ${fx.startSec.toFixed(1)}s → ${(fx.startSec + fx.durationSec).toFixed(1)}s`}
                      className={`absolute top-0.5 bottom-0.5 rounded-xs border px-1.5 flex items-center gap-1 overflow-hidden cursor-grab active:cursor-grabbing transition-colors ${
                        isSel
                          ? 'border-cyan-300 bg-cyan-500/25 text-cyan-50 ring-1 ring-cyan-300/60 z-10'
                          : 'border-cyan-500/45 bg-cyan-500/12 hover:bg-cyan-500/18 text-cyan-200'
                      }`}
                    >
                      <Orbit className="w-3 h-3 text-cyan-300 shrink-0 pointer-events-none" aria-hidden="true" />
                      <span className="text-[10px] font-medium truncate pointer-events-none">
                        {fx.name}
                      </span>
                      <span className="ml-auto mr-1 text-[9px] font-mono tabular-nums text-cyan-200/80 shrink-0 pointer-events-none">
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

            {/* Track 3: Zoomed Active Audio Waveform Slice + Beat Grid (double-click adds/removes marker) */}
            <div
              onPointerDown={handleSeqScrubPointerDown}
              onPointerMove={handleSeqScrubPointerMove}
              onDoubleClick={(e) => {
                if (!seqInnerRef.current) return;
                const rect = seqInnerRef.current.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                onToggleBeatMarkerAt(trimBase + ratio * clipDuration);
              }}
              title={t.audioTrackDoubleClickHint}
              className="h-8 relative bg-[#0B0D11] border-t border-[#1E2330] cursor-ew-resize"
            >
              {audio && config.fadeOutSec > 0.1 && (
                <div
                  className="absolute top-0 bottom-0 right-0 bg-gradient-to-r from-transparent to-black/75 pointer-events-none"
                  style={{
                    width: `${Math.min(100, (config.fadeOutSec / clipDuration) * 100)}%`,
                  }}
                />
              )}

              <div className="absolute inset-0 flex items-center gap-px px-1 pointer-events-none">
                {trimmedWaveformSlice.length > 0
                  ? trimmedWaveformSlice.map((peak, idx) => {
                      const ratio = idx / trimmedWaveformSlice.length;
                      const isPlayed = ratio * clipDuration <= localTime;
                      return (
                        <div
                          key={idx}
                          className="flex-1 rounded-xs"
                          style={{
                            height: `${Math.max(10, peak * 84)}%`,
                            backgroundColor: isPlayed ? '#F59E0B' : '#525B70',
                          }}
                        />
                      );
                    })
                  : Array.from({ length: 80 }).map((_, idx) => (
                      <div key={idx} className="flex-1 h-0.5 bg-[#1D2230] rounded-xs" />
                    ))}
              </div>

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

            {/* Track 4: Subtitles Lane */}
            {config.subtitles.length > 0 && (
              <div className="h-5 relative bg-[#0A0C10] border-t border-[#1E2330]">
                {config.subtitles.map((cue) => {
                  const relStart = cue.startSec - trimBase;
                  const relEnd = cue.endSec - trimBase;
                  if (relEnd <= 0 || relStart >= clipDuration) return null;
                  const clampedStart = Math.max(0, relStart);
                  const clampedEnd = Math.min(clipDuration, relEnd);
                  const leftPct = (clampedStart / clipDuration) * 100;
                  const widthPct = Math.max(1.5, ((clampedEnd - clampedStart) / clipDuration) * 100);
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
            )}

            {/* Unified Vertical Playhead */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none z-20"
              style={{ left: `${playheadPct}%` }}
            >
              <div className="w-2 h-2 -ml-[3px] bg-amber-400 rotate-45 -mt-0.5" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
