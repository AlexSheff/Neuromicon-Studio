import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Copy,
  Flag,
  Magnet,
  Minus,
  Orbit,
  Plus,
  Scissors,
  SlidersHorizontal,
  Trash2,
  ZoomIn,
} from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { tFor } from '../i18n';
import {
  AudioTrackState,
  GeneratorEffectId,
  Language,
  SlideTransitionType,
  StudioConfig,
  VisualMediaState,
} from '../types/studio';
import { computeClipTimelineSegments, snapTimeToBeat } from '../utils/audioAnalyzer';
import { GENERATOR_EFFECTS } from '../utils/presets';

interface TimelineDockProps {
  lang: Language;
  audio: AudioTrackState | null;
  mediaItems: VisualMediaState[];
  selectedClipId: string | null;
  beatCutTimestamps: number[];
  config: StudioConfig;
  currentTime: number;
  onSeekAbsolute: (sec: number) => void;
  onSelectClip: (id: string) => void;
  onInspectClip: (id: string) => void;
  onUpdateClip: (id: string, patch: Partial<VisualMediaState>) => void;
  onVisualFiles: (files: File[]) => void;
  onDuplicateClip: (id: string) => void;
  onReorderClip: (fromIdx: number, toIdx: number) => void;
  onReverseClips: () => void;
  onCycleClipTransition: (id: string) => void;
  onAddGeneratorScene: (
    effect: Exclude<GeneratorEffectId, 'none'>,
    snapshotGlobalParams?: boolean
  ) => void;
  onSplitClipAtPlayhead: () => void;
  onRippleDeleteSelected: () => void;
  onToggleSnapToBeats: () => void;
  onAddBeatMarker: () => void;
  onClearBeatMarkers: () => void;
  onSetTrimStart: (sec: number) => void;
  onSetTrimEnd: (sec: number) => void;
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
  beatCutTimestamps,
  config,
  currentTime,
  onSeekAbsolute,
  onSelectClip,
  onInspectClip,
  onUpdateClip,
  onVisualFiles,
  onDuplicateClip,
  onReorderClip,
  onReverseClips,
  onCycleClipTransition,
  onAddGeneratorScene,
  onSplitClipAtPlayhead,
  onRippleDeleteSelected,
  onToggleSnapToBeats,
  onAddBeatMarker,
  onClearBeatMarkers,
  onSetTrimStart,
  onSetTrimEnd,
}: TimelineDockProps) {
  const t = tFor(lang);
  const [genMenuOpen, setGenMenuOpen] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const masterTimelineRef = useRef<HTMLDivElement>(null);
  const seqInnerRef = useRef<HTMLDivElement>(null);
  const trimDragModeRef = useRef<'in' | 'out' | null>(null);
  const clipResizeRef = useRef<{
    clipId: string;
    startX: number;
    startDur: number;
  } | null>(null);

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

  const absBeatPoints = useMemo(() => {
    const autoAbs = beatCutTimestamps.map((b) => trimBase + b);
    return Array.from(new Set([...autoAbs, ...config.manualBeatMarkers])).sort((a, b) => a - b);
  }, [beatCutTimestamps, config.manualBeatMarkers, trimBase]);

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
    if (clipResizeRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubSequenceAtClientX(e.clientX);
  };

  const handleSeqScrubPointerMove = (e: React.PointerEvent) => {
    if ((e.buttons & 1) === 0 || clipResizeRef.current) return;
    scrubSequenceAtClientX(e.clientX);
  };

  const setClipDuration = (clipId: string, rawDur: number) => {
    const clamped = Math.max(0.5, Math.min(30, Number(rawDur.toFixed(1))));
    onUpdateClip(clipId, { durationSec: clamped });
  };

  const jumpToClipStart = (clipId: string) => {
    const seg = clipSegments.find((s) => mediaItems[s.clipIndex]?.id === clipId);
    if (seg) {
      onSeekAbsolute(trimBase + seg.startSec);
    }
  };

  const playheadPct = Math.max(0, Math.min(100, (localTime / clipDuration) * 100));

  return (
    <section
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

      {/* Row 1: Timeline Tools + Clip Selector & Duration Bar + Markers + Zoom */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-[#1E2330]">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Add Media */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[11px] font-medium text-gray-200 cursor-pointer transition-colors"
          >
            <Plus className="w-3 h-3 text-amber-400" aria-hidden="true" />
            <span>{t.timelineAddMediaBtn}</span>
          </button>

          {/* Add Any Generator Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setGenMenuOpen((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-500/50 bg-amber-500/12 hover:bg-amber-500/20 text-[11px] font-semibold text-amber-300 cursor-pointer transition-colors"
            >
              <Orbit className="w-3 h-3" aria-hidden="true" />
              <span>+ {t.timelineAddGenBtn}</span>
            </button>

            {genMenuOpen && (
              <div className="absolute bottom-full left-0 mb-1.5 z-40 w-64 rounded-lg border border-[#323849] bg-[#141822] shadow-2xl p-2 space-y-1 max-h-72 overflow-y-auto">
                {config.generatorEffect !== 'none' && (
                  <button
                    type="button"
                    onClick={() => {
                      onAddGeneratorScene(
                        config.generatorEffect as Exclude<GeneratorEffectId, 'none'>,
                        true
                      );
                      setGenMenuOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-[11px] font-semibold text-amber-300 cursor-pointer"
                  >
                    + {t.timelineAddCurrentGen}
                  </button>
                )}
                <div className="grid grid-cols-1 gap-0.5 pt-0.5">
                  {GENERATOR_EFFECTS.filter((g) => g.id !== 'none').map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        onAddGeneratorScene(g.id as Exclude<GeneratorEffectId, 'none'>);
                        setGenMenuOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[#1E2330] text-[11px] text-gray-200 cursor-pointer flex items-center justify-between gap-2"
                    >
                      <span className="truncate font-medium">
                        {lang === 'ru' ? g.nameRu : g.nameEn}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-[#262B38] mx-0.5 hidden sm:block" aria-hidden="true" />

          {/* Selected Clip Selector & Direct Duration Control on Timeline */}
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
              className="bg-transparent text-[11px] font-medium text-gray-100 focus:outline-none max-w-[140px] sm:max-w-[170px] truncate cursor-pointer disabled:opacity-40"
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
                <span className="text-[10px] text-gray-400 hidden sm:inline">
                  {t.timelineDurationLabel}:
                </span>
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

                <div className="hidden xl:flex items-center gap-0.5 ml-1">
                  {[2, 4, 6, 10].map((presetSec) => (
                    <button
                      key={presetSec}
                      type="button"
                      onClick={() => setClipDuration(selectedClip.id, presetSec)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums cursor-pointer transition-colors ${
                        Math.abs(selectedClip.durationSec - presetSec) < 0.05
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                          : 'bg-[#0B0D11] text-gray-400 hover:text-gray-200 border border-[#262B38]'
                      }`}
                    >
                      {presetSec}s
                    </button>
                  ))}
                </div>

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

          <div className="h-4 w-px bg-[#262B38] mx-0.5 hidden sm:block" aria-hidden="true" />

          {/* NLE Edit Tools */}
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

          <button
            type="button"
            onClick={() => {
              const targetId = selectedClipId || mediaItems[0]?.id;
              if (targetId) onDuplicateClip(targetId);
            }}
            disabled={mediaItems.length === 0}
            title={`${t.duplicateClipLabel} (Ctrl+D)`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 disabled:opacity-35 text-[11px] font-medium text-gray-200 cursor-pointer transition-colors"
          >
            <Copy className="w-3 h-3 text-gray-300" aria-hidden="true" />
            <span className="hidden md:inline">{t.duplicateSelectedBtn}</span>
          </button>

          <button
            type="button"
            onClick={onRippleDeleteSelected}
            disabled={!selectedClipId && mediaItems.length === 0}
            title={`${t.rippleDeleteBtn} (Del)`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-rose-500/60 disabled:opacity-35 text-[11px] font-medium text-gray-200 cursor-pointer transition-colors"
          >
            <Trash2 className="w-3 h-3 text-rose-400" aria-hidden="true" />
            <span className="hidden md:inline">{t.rippleDeleteBtn}</span>
          </button>

          {mediaItems.length > 1 && (
            <button
              type="button"
              onClick={onReverseClips}
              title={t.reverseClipsBtn}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-gray-500 text-[11px] font-medium text-gray-300 cursor-pointer transition-colors"
            >
              <ArrowLeftRight className="w-3 h-3 text-gray-400" aria-hidden="true" />
              <span className="hidden lg:inline">{t.reverseClipsBtn}</span>
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
          <span className="text-[10px] font-medium text-gray-500 w-10 shrink-0 truncate">
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

      {/* Row 3: Synchronized Zoomable NLE Sequence (Ruler + Clips + Audio Slice + Subtitles) */}
      <div className="flex gap-2">
        <div className="w-10 shrink-0 flex flex-col gap-1 select-none">
          <div className="h-4 flex items-center text-[9px] font-mono text-gray-500">0:00</div>
          <div className="h-11 flex items-center text-[10px] font-medium text-gray-400 truncate">
            {t.timelineClipsTrackLabel}
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

        <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden rounded-md border border-[#262B38] bg-[#0B0D11]">
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
                  const isSelected = selectedClip?.id === clip.id;
                  const isPlayheadInside =
                    localTime >= seg.startSec && localTime < seg.endSec + 0.001;
                  const isDragOver =
                    dragOverIndex === seg.clipIndex && dragIndex !== seg.clipIndex;
                  const hasNext = idx < clipSegments.length - 1;
                  const segLeftPct = (seg.endSec / clipDuration) * 100;

                  return (
                    <React.Fragment key={`${clip.id}-${idx}`}>
                      <div
                        draggable
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
                        className={`relative h-full border-r border-[#262B38] px-1.5 flex items-center gap-1.5 overflow-hidden text-left cursor-pointer transition-colors group ${
                          isDragOver
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
                        <span className="ml-auto mr-1 px-1 py-0.5 rounded bg-[#0B0D11]/80 border border-[#262B38] text-[9px] font-mono tabular-nums text-amber-300 shrink-0 pointer-events-none">
                          {segDur.toFixed(1)}s
                        </span>

                        {/* Right-Edge Duration Resize Handle */}
                        <div
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            clipResizeRef.current = {
                              clipId: clip.id,
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
                            const nextDur = Math.max(
                              0.5,
                              Math.min(
                                30,
                                Number((clipResizeRef.current.startDur + deltaSec).toFixed(1))
                              )
                            );
                            onUpdateClip(clip.id, { durationSec: nextDur });
                          }}
                          onPointerUp={(e) => {
                            e.stopPropagation();
                            clipResizeRef.current = null;
                          }}
                          onClick={(e) => e.stopPropagation()}
                          title={t.clipDurationLabel}
                          className="absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize bg-transparent hover:bg-amber-400/80 transition-colors"
                        />
                      </div>

                      {/* Boundary Transition Pill */}
                      {hasNext && mediaItems.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onCycleClipTransition(clip.id);
                          }}
                          style={{ left: `${segLeftPct}%` }}
                          title={`${t.clipTransitionLabel}: ${clip.transitionOut}`}
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 px-1 py-0.5 rounded bg-[#0E1016] border border-[#323849] hover:border-amber-400 text-[8px] font-mono text-amber-300 cursor-pointer shadow"
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
            </div>

            {/* Track 2: Zoomed Active Audio Waveform Slice + Beat Grid */}
            <div
              onPointerDown={handleSeqScrubPointerDown}
              onPointerMove={handleSeqScrubPointerMove}
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

              {beatCutTimestamps
                .filter((b) => b > 0.05 && b < clipDuration)
                .map((b, idx) => (
                  <div
                    key={`auto-${idx}-${b}`}
                    className="absolute top-0 h-2 w-px bg-amber-400/65 pointer-events-none"
                    style={{ left: `${(b / clipDuration) * 100}%` }}
                  />
                ))}

              {config.manualBeatMarkers
                .filter((m) => m >= trimBase && m <= trimBase + clipDuration)
                .map((markerSec, idx) => (
                  <div
                    key={`man-${markerSec}-${idx}`}
                    className="absolute top-0 bottom-0 w-px bg-cyan-400/90 pointer-events-none"
                    style={{
                      left: `${((markerSec - trimBase) / clipDuration) * 100}%`,
                    }}
                  >
                    <div className="w-1.5 h-1.5 -ml-[2px] bg-cyan-300 rotate-45" />
                  </div>
                ))}
            </div>

            {/* Track 3: Subtitles Lane */}
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
