import {
  AudioWaveform,
  Camera,
  Flag,
  Frame,
  Globe,
  Magnet,
  Orbit,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { tFor } from '../i18n';
import {
  AudioTrackState,
  BeatPresetId,
  Language,
  StudioConfig,
  VisualMediaState,
} from '../types/studio';
import { computeClipTimelineSegments, snapTimeToBeat } from '../utils/audioAnalyzer';
import { resolveExportDimensions } from '../utils/videoExporter';

interface PreviewStageProps {
  lang: Language;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  audio: AudioTrackState | null;
  mediaItems: VisualMediaState[];
  selectedClipId: string | null;
  beatCutTimestamps: number[];
  config: StudioConfig;
  isPlaying: boolean;
  isLooping: boolean;
  currentTime: number;
  onToggleLanguage: () => void;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onResetToTrimStart: () => void;
  onSnapshotPng: () => void;
  onSeekAbsolute: (sec: number) => void;
  onSelectClip: (id: string) => void;
  onReorderClip: (fromIdx: number, toIdx: number) => void;
  onSplitClipAtPlayhead: () => void;
  onRippleDeleteSelected: () => void;
  onToggleSnapToBeats: () => void;
  onAddBeatMarker: () => void;
  onClearBeatMarkers: () => void;
  onSelectBeatPreset: (preset: BeatPresetId) => void;
  onToggleSafeZones: () => void;
  onLoadDemoBeat: () => void;
}

const BEAT_PRESET_IDS: BeatPresetId[] = [
  'spectrum_bars',
  'radial_pulse',
  'horizon_wave',
  'beat_zoom',
  'particle_drift',
  'editorial_frame',
];

function formatTimecode(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
}

export function PreviewStage({
  lang,
  canvasRef,
  audio,
  mediaItems,
  selectedClipId,
  beatCutTimestamps,
  config,
  isPlaying,
  isLooping,
  currentTime,
  onToggleLanguage,
  onTogglePlay,
  onToggleLoop,
  onResetToTrimStart,
  onSnapshotPng,
  onSeekAbsolute,
  onSelectClip,
  onReorderClip,
  onSplitClipAtPlayhead,
  onRippleDeleteSelected,
  onToggleSnapToBeats,
  onAddBeatMarker,
  onClearBeatMarkers,
  onSelectBeatPreset,
  onToggleSafeZones,
  onLoadDemoBeat,
}: PreviewStageProps) {
  const t = tFor(lang);
  const [presetDrawerOpen, setPresetDrawerOpen] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const dims = resolveExportDimensions(
    config.aspectMode,
    mediaItems,
    config.customWidth,
    config.customHeight
  );
  const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);
  const localTime = Math.max(0, Math.min(clipDuration, currentTime - config.trimStart));

  const clipSegments = computeClipTimelineSegments(
    mediaItems,
    clipDuration,
    config,
    beatCutTimestamps
  );

  const absBeatPoints = useMemo(() => {
    const autoAbs = beatCutTimestamps.map((b) => config.trimStart + b);
    return Array.from(new Set([...autoAbs, ...config.manualBeatMarkers])).sort((a, b) => a - b);
  }, [beatCutTimestamps, config.manualBeatMarkers, config.trimStart]);

  const scrubAtClientX = (clientX: number) => {
    if (!audio || !timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    let targetSec = ratio * audio.duration;
    if (config.snapToBeats && absBeatPoints.length > 0) {
      targetSec = snapTimeToBeat(targetSec, absBeatPoints, 0.25);
    }
    onSeekAbsolute(targetSec);
  };

  const handleTimelinePointerDown = (e: React.PointerEvent) => {
    if (!audio) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubAtClientX(e.clientX);
  };

  const handleTimelinePointerMove = (e: React.PointerEvent) => {
    if (!audio || (e.buttons & 1) === 0) return;
    scrubAtClientX(e.clientX);
  };

  const activePresetMeta = t.presets[config.beatPreset];
  const hasAnythingLoaded = Boolean(audio) || mediaItems.length > 0 || config.generatorEffect !== 'none';

  return (
    <main className="flex-1 min-w-0 flex flex-col bg-[#0B0D11] relative">
      {/* Compact Stage Sub-Toolbar */}
      <div className="px-4 py-2.5 border-b border-[#262B38] bg-[#0E1016] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
          <button
            type="button"
            onClick={() => setPresetDrawerOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-xs font-semibold text-amber-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <AudioWaveform className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.beatPresetButton}:</span>
            <span className="text-gray-100">{activePresetMeta.name}</span>
          </button>

          <button
            type="button"
            onClick={onToggleSafeZones}
            className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              config.showSafeZones
                ? 'border-amber-500/60 bg-amber-500/12 text-amber-300'
                : 'border-[#262B38] bg-[#141821] hover:border-gray-500 text-gray-300'
            }`}
          >
            <Frame className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.safeZonesButton}</span>
          </button>

          <button
            type="button"
            onClick={onSnapshotPng}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-xs font-medium text-gray-300 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Camera className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.snapshotPngBtn}</span>
          </button>

          <div className="hidden xl:flex items-center gap-2 text-xs text-gray-400 font-mono tabular-nums truncate">
            <span>
              {dims.width}×{dims.height}
            </span>
            <span aria-hidden="true">·</span>
            <span>{dims.aspectLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{config.fps} fps</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleLanguage}
          aria-label="Switch language"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-gray-500 text-xs font-medium text-gray-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Globe className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
          <span>{lang === 'ru' ? 'RU / EN' : 'EN / RU'}</span>
        </button>
      </div>

      {/* Beat Preset Quick Selector Popover */}
      {presetDrawerOpen && (
        <div className="absolute top-14 left-4 right-4 z-30 max-w-2xl rounded-lg border border-[#323849] bg-[#141822] shadow-2xl p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-100">{t.beatPresetDrawerTitle}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{t.beatPresetDrawerSubtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => setPresetDrawerOpen(false)}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-[#1E2330] cursor-pointer"
              aria-label={t.closeLabel}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {BEAT_PRESET_IDS.map((id) => {
              const info = t.presets[id];
              const isSelected = config.beatPreset === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onSelectBeatPreset(id);
                    setPresetDrawerOpen(false);
                  }}
                  className={`text-left p-3 rounded-md border transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-amber-500 bg-amber-500/12'
                      : 'border-[#262B38] bg-[#10131A] hover:border-gray-500'
                  }`}
                >
                  <div className="text-xs font-semibold text-gray-100">{info.name}</div>
                  <div className="text-[11px] text-gray-400 mt-1 leading-snug">{info.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Dominant Viewport Canvas Stage */}
      <div className="flex-1 min-h-[260px] p-4 md:p-5 flex items-center justify-center relative overflow-hidden">
        <div
          className="relative flex items-center justify-center rounded-lg border border-[#262B38] bg-[#07080B] overflow-hidden shadow-xl"
          style={{
            aspectRatio: `${dims.width} / ${dims.height}`,
            maxHeight: 'calc(100vh - 375px)',
            maxWidth: '100%',
            width: dims.width >= dims.height ? 'min(100%, 820px)' : 'auto',
            height: dims.height > dims.width ? 'min(100%, 500px)' : 'auto',
          }}
        >
          <canvas
            ref={canvasRef}
            width={960}
            height={Math.round((960 * dims.height) / dims.width)}
            className="w-full h-full block"
          />

          {!hasAnythingLoaded && (
            <div className="absolute inset-0 bg-[#090B10]/85 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center">
              <SlidersHorizontal className="w-7 h-7 text-amber-400 mb-3" aria-hidden="true" />
              <h3 className="text-base font-semibold text-gray-100 max-w-md">{t.emptyStageTitle}</h3>
              <p className="text-xs text-gray-400 max-w-sm mt-1.5 leading-relaxed">
                {t.emptyStageHint}
              </p>
              <button
                type="button"
                onClick={onLoadDemoBeat}
                className="mt-4 px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-xs font-semibold text-zinc-950 transition-colors cursor-pointer"
              >
                {t.loadDemoBeat}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Dual-Track Video Editor Timeline (Toolbar + Clip Track + Audio Waveform Track) */}
      <div className="border-t border-[#262B38] bg-[#0E1016] px-4 py-2.5 space-y-2">
        {/* Stage 2 NLE Timeline Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-[#1E2330]">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onSplitClipAtPlayhead}
              disabled={!audio || mediaItems.length === 0}
              title={`${t.splitClipBtn} (S)`}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 disabled:opacity-35 text-[11px] font-medium text-gray-200 cursor-pointer transition-colors"
            >
              <Scissors className="w-3 h-3 text-amber-400" aria-hidden="true" />
              <span>{t.splitClipBtn}</span>
            </button>

            <button
              type="button"
              onClick={onRippleDeleteSelected}
              disabled={!selectedClipId && mediaItems.length === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-rose-500/60 disabled:opacity-35 text-[11px] font-medium text-gray-200 cursor-pointer transition-colors"
            >
              <Trash2 className="w-3 h-3 text-rose-400" aria-hidden="true" />
              <span>{t.rippleDeleteBtn}</span>
            </button>

            <button
              type="button"
              onClick={onToggleSnapToBeats}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] font-medium cursor-pointer transition-colors ${
                config.snapToBeats
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                  : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
              }`}
            >
              <Magnet className="w-3 h-3" aria-hidden="true" />
              <span>{t.snapBeatsLabel}</span>
            </button>

            <button
              type="button"
              onClick={onAddBeatMarker}
              disabled={!audio}
              title={`${t.tapTempoBtn} (M)`}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-cyan-400/60 disabled:opacity-35 text-[11px] font-medium text-cyan-300 cursor-pointer transition-colors"
            >
              <Flag className="w-3 h-3" aria-hidden="true" />
              <span>
                {t.tapTempoBtn}
                {config.manualBeatMarkers.length > 0 ? ` (${config.manualBeatMarkers.length})` : ''}
              </span>
            </button>

            {config.manualBeatMarkers.length > 0 && (
              <button
                type="button"
                onClick={onClearBeatMarkers}
                className="px-2 py-1 rounded border border-[#262B38] bg-[#141821] hover:border-rose-500/50 text-[11px] text-gray-400 hover:text-rose-300 cursor-pointer transition-colors"
              >
                {t.clearMarkersBtn}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ZoomIn className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
            <span className="text-[11px] text-gray-400">{t.timelineZoomLabel}</span>
            <input
              type="range"
              min={1}
              max={6}
              step={0.5}
              value={timelineZoom}
              onChange={(e) => setTimelineZoom(Number(e.target.value))}
              className="w-20 studio-slider"
              aria-label={t.timelineZoomLabel}
            />
            <span className="text-[11px] font-mono tabular-nums text-gray-300 w-7 text-right">
              {timelineZoom}×
            </span>
          </div>
        </div>

        {/* Track 1: Clip Sequence Track (Zoomable + Drag-and-Drop Reorderable) */}
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-medium text-gray-400 w-12 shrink-0 truncate">
            {t.timelineClipsTrackLabel}
          </span>
          <div className="flex-1 h-11 rounded-md border border-[#262B38] bg-[#0B0D11] overflow-x-auto overflow-y-hidden">
            <div
              className="h-full relative flex items-center"
              style={{ width: `${timelineZoom * 100}%`, minWidth: '100%' }}
            >
              {clipSegments.length > 0 ? (
                clipSegments.map((seg, idx) => {
                  const clip = mediaItems[seg.clipIndex];
                  if (!clip) return null;
                  const widthPct = ((seg.endSec - seg.startSec) / clipDuration) * 100;
                  const isSelected = selectedClipId === clip.id;
                  const isPlayheadInside =
                    localTime >= seg.startSec && localTime < seg.endSec + 0.001;
                  const isDragOver = dragOverIndex === seg.clipIndex && dragIndex !== seg.clipIndex;
                  return (
                    <button
                      key={`${clip.id}-${idx}`}
                      type="button"
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
                      onClick={() => {
                        onSelectClip(clip.id);
                        if (audio) onSeekAbsolute(config.trimStart + seg.startSec);
                      }}
                      style={{ width: `${Math.max(1.5, widthPct)}%` }}
                      title={`${clip.fileName} (${(seg.endSec - seg.startSec).toFixed(1)}s)`}
                      className={`h-full border-r border-[#262B38] px-1.5 flex items-center gap-1.5 overflow-hidden text-left cursor-pointer transition-colors ${
                        isDragOver
                          ? 'ring-2 ring-inset ring-amber-400 bg-amber-500/25'
                          : isSelected
                            ? 'bg-amber-500/20 text-amber-200'
                            : isPlayheadInside
                              ? 'bg-[#1D2434] text-gray-100'
                              : 'bg-[#141821] hover:bg-[#191E2A] text-gray-300'
                      }`}
                    >
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
                      <span className="text-[10px] font-mono tabular-nums text-gray-400 ml-auto shrink-0 pointer-events-none">
                        {(seg.endSec - seg.startSec).toFixed(1)}s
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="w-full text-center text-[11px] text-gray-500 px-2 truncate">
                  {t.timelineEmptyHint}
                </div>
              )}

              {/* Clip Track Playhead */}
              {audio && clipSegments.length > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-amber-400 pointer-events-none z-10"
                  style={{
                    left: `${Math.max(0, Math.min(100, (localTime / clipDuration) * 100))}%`,
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Track 2: Scrubbable Audio Waveform + Beat Markers */}
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-medium text-gray-400 w-12 shrink-0 truncate">
            {t.timelineAudioTrackLabel}
          </span>
          <div
            ref={timelineRef}
            onPointerDown={handleTimelinePointerDown}
            onPointerMove={handleTimelinePointerMove}
            className={`flex-1 relative h-11 rounded-md border border-[#262B38] bg-[#0B0D11] overflow-hidden select-none ${
              audio ? 'cursor-ew-resize' : 'opacity-50'
            }`}
          >
            {audio && audio.duration > 0 && (
              <div
                className="absolute top-0 bottom-0 bg-amber-500/10 border-x border-amber-500/60 pointer-events-none"
                style={{
                  left: `${(config.trimStart / audio.duration) * 100}%`,
                  width: `${((config.trimEnd - config.trimStart) / audio.duration) * 100}%`,
                }}
              >
                {config.fadeOutSec > 0.1 && (
                  <div
                    className="absolute top-0 bottom-0 right-0 bg-gradient-to-r from-transparent to-black/75 pointer-events-none"
                    style={{
                      width: `${Math.min(100, (config.fadeOutSec / clipDuration) * 100)}%`,
                    }}
                  />
                )}
              </div>
            )}

            <div className="absolute inset-0 flex items-center gap-px px-1 pointer-events-none">
              {audio
                ? Array.from(audio.waveformPeaks).map((peak, idx) => {
                    const ratio = idx / audio.waveformPeaks.length;
                    const barSec = ratio * audio.duration;
                    const isInsideTrim = barSec >= config.trimStart && barSec <= config.trimEnd;
                    const isPlayed = barSec <= currentTime;
                    return (
                      <div
                        key={idx}
                        className="flex-1 rounded-xs transition-colors"
                        style={{
                          height: `${Math.max(8, peak * 84)}%`,
                          backgroundColor: isPlayed
                            ? '#F59E0B'
                            : isInsideTrim
                              ? '#6B7280'
                              : '#262B38',
                        }}
                      />
                    );
                  })
                : Array.from({ length: 80 }).map((_, idx) => (
                    <div key={idx} className="flex-1 h-1 bg-[#1D2230] rounded-xs" />
                  ))}
            </div>

            {/* Manual Beat Markers */}
            {audio &&
              audio.duration > 0 &&
              config.manualBeatMarkers.map((markerSec, idx) => (
                <div
                  key={`${markerSec}-${idx}`}
                  className="absolute top-0 bottom-0 w-px bg-cyan-400/90 pointer-events-none"
                  style={{
                    left: `${Math.max(0, Math.min(100, (markerSec / audio.duration) * 100))}%`,
                  }}
                >
                  <div className="w-1.5 h-1.5 -ml-[2px] bg-cyan-300 rotate-45" />
                </div>
              ))}

            {audio && audio.duration > 0 && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none"
                style={{
                  left: `${Math.max(0, Math.min(100, (currentTime / audio.duration) * 100))}%`,
                }}
              />
            )}
          </div>
        </div>

        {/* Transport Controls Row */}
        <div className="flex items-center justify-between gap-4 pt-0.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onTogglePlay}
              disabled={!audio}
              aria-label={isPlaying ? t.pauseLabel : t.playLabel}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#1B202C] hover:bg-[#252B3B] disabled:opacity-40 text-xs font-semibold text-gray-100 transition-colors cursor-pointer"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  <span>{t.pauseLabel}</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  <span>{t.playLabel}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onResetToTrimStart}
              disabled={!audio}
              title={t.stopLabel}
              aria-label={t.stopLabel}
              className="p-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-gray-500 disabled:opacity-40 text-gray-300 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={onToggleLoop}
              disabled={!audio}
              title={t.loopPlaybackLabel}
              aria-label={t.loopPlaybackLabel}
              aria-pressed={isLooping}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-[11px] font-medium disabled:opacity-40 transition-colors cursor-pointer ${
                isLooping
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                  : 'border-[#262B38] bg-[#141821] hover:border-gray-500 text-gray-300'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t.loopPlaybackLabel}</span>
            </button>
          </div>

          <div className="text-xs font-mono tabular-nums text-gray-300">
            <span>{formatTimecode(localTime)}</span>
            <span className="text-gray-500 mx-1.5">/</span>
            <span className="text-gray-400">{formatTimecode(clipDuration)}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
