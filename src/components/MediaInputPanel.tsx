import {
  Activity,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  Film,
  GripVertical,
  Image as ImageIcon,
  Layers,
  Music,
  Orbit,
  Plus,
  RotateCcw,
  Scissors,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Subtitles,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { tFor } from '../i18n';
import { NumericDraftInput } from './common/NumericDraftInput';
import {
  AudioTrackState,
  BeatGridMode,
  BeatSyncMode,
  GeneratorEffectId,
  Language,
  MediaBinItem,
  MediaFramingMode,
  OverlayLayer,
  SlideTransitionType,
  SlideshowMode,
  StudioConfig,
  SubtitleCue,
  TrimPresetId,
  VisualMediaState,
} from '../types/studio';
import {
  AUTO_CLIP_PRESETS,
  AutoClipGenerateConfig,
  AutoClipMediaPriority,
  AutoClipMode,
  AutoClipMotionLevel,
  AutoClipPresetId,
  AutoClipRhythm,
  AutoClipTargetMode,
  AutoClipTransitionStyle,
  computeTapTempoBpm,
  DEFAULT_AUTO_CLIP_CONFIG,
  getDefaultBoundsForAutoClipRhythm,
  getNormalizedManualClipIntervals,
  getTimelineSpanSec,
  MusicalSectionType,
  TrackBeatGrid,
  TrackStructureAnalysis,
} from '../utils/audioAnalyzer';
import { GENERATOR_EFFECTS } from '../utils/presets';
import { MediaPreviewModal } from './MediaPreviewModal';

type MediaPanelTab = 'media' | 'layers' | 'timing';

interface MediaInputPanelProps {
  lang: Language;
  audio: AudioTrackState | null;
  mediaBin: MediaBinItem[];
  mediaItems: VisualMediaState[];
  selectedClipId: string | null;
  config: StudioConfig;
  isLoadingAudio: boolean;
  onAudioFile: (file: File) => void;
  onRemoveAudio: () => void;
  onLoadDemoBeat: () => void;
  onVisualFiles: (files: File[]) => void;
  onAddBinItemToTimeline: (
    binItemId: string,
    options?: { atTimeSec?: number; mode?: 'playhead' | 'end' | 'exact' }
  ) => void;
  onAddAllBinToTimeline: () => void;
  onUpdateBinItem: (
    binItemId: string,
    patch: Partial<MediaBinItem>,
    syncPlacedClips?: boolean
  ) => void;
  onCreateRandomBeatAutoClip: (cfg: AutoClipGenerateConfig) => void;
  onMoveBinItem: (binItemId: string, direction: -1 | 1) => void;
  onReorderBinItem: (sourceId: string, targetId: string, position: 'before' | 'after') => void;
  onRemoveBinItem: (binItemId: string) => void;
  onClearBin: () => void;
  onAddGeneratorScene: (
    effect: Exclude<GeneratorEffectId, 'none'>,
    snapshotGlobalParams?: boolean
  ) => void;
  onSelectClip: (id: string) => void;
  onInspectClip: (id: string) => void;
  onDuplicateClip?: (id: string) => void;
  onReverseClips: () => void;
  onRemoveVisual: (id: string) => void;
  onClearVisuals: () => void;
  onFitClipsToAudio: () => void;
  onFitTrimToClips: () => void;
  onAutoBeatSyncClips: (mode?: BeatSyncMode, applyMotionAndTrans?: boolean) => void;
  trackBpm: number;
  trackBeatGrid: TrackBeatGrid;
  songStructure: TrackStructureAnalysis | null;
  rawTrackBpm: number;
  currentTime: number;
  onSetBeat1AtPlayhead: () => void;
  onReextractAudioBeats: () => void;
  onResetBeatCalibration: () => void;
  onToggleMetronome: () => void;
  onUseEmbeddedCover: () => void;
  onUpdateConfig: (patch: Partial<StudioConfig>) => void;
  onSelectTrimPreset: (preset: TrimPresetId) => void;
  onPreviewFadeOut: () => void;
  onImportSubtitlesText: (raw: string) => void;
  onExportSrt: () => void;
  onAddCueAtPlayhead: () => void;
  onUpdateSubtitleCue: (id: string, patch: Partial<SubtitleCue>) => void;
  onRemoveSubtitleCue: (id: string) => void;
  onAddTextOverlay: () => void;
  onAddImageOverlay: (file: File) => void;
  onUpdateOverlay: (id: string, patch: Partial<OverlayLayer>) => void;
  onRemoveOverlay: (id: string) => void;
  onResetAutosave: () => void;
  onSeekAbsolute?: (sec: number) => void;
  widthPx?: number;
}

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MediaInputPanel({
  lang,
  audio,
  mediaBin,
  mediaItems,
  selectedClipId,
  config,
  isLoadingAudio,
  onAudioFile,
  onRemoveAudio,
  onLoadDemoBeat,
  onVisualFiles,
  onAddBinItemToTimeline,
  onAddAllBinToTimeline,
  onUpdateBinItem,
  onCreateRandomBeatAutoClip,
  onMoveBinItem,
  onReorderBinItem,
  onRemoveBinItem,
  onClearBin,
  onAddGeneratorScene,
  onSelectClip,
  onInspectClip,
  onReverseClips,
  onRemoveVisual,
  onClearVisuals,
  onFitClipsToAudio,
  onFitTrimToClips,
  onAutoBeatSyncClips,
  trackBpm,
  trackBeatGrid,
  songStructure,
  rawTrackBpm,
  currentTime,
  onSetBeat1AtPlayhead,
  onReextractAudioBeats,
  onResetBeatCalibration,
  onToggleMetronome,
  onUseEmbeddedCover,
  onUpdateConfig,
  onSelectTrimPreset,
  onPreviewFadeOut,
  onImportSubtitlesText,
  onExportSrt,
  onAddCueAtPlayhead,
  onUpdateSubtitleCue,
  onRemoveSubtitleCue,
  onAddTextOverlay,
  onAddImageOverlay,
  onUpdateOverlay,
  onRemoveOverlay,
  onResetAutosave,
  onSeekAbsolute,
  widthPx,
}: MediaInputPanelProps) {
  const t = tFor(lang);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const visualInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);
  const overlayImgInputRef = useRef<HTMLInputElement>(null);
  const panelDragDepthRef = useRef(0);

  const [panelTab, setPanelTab] = useState<MediaPanelTab>('media');
  const [audioDragOver, setAudioDragOver] = useState(false);
  const [visualDragOver, setVisualDragOver] = useState(false);
  const [panelFileDragOver, setPanelFileDragOver] = useState(false);
  const [expandedBinId, setExpandedBinId] = useState<string | null>(null);
  const [previewBinId, setPreviewBinId] = useState<string | null>(null);
  const [draggingBinId, setDraggingBinId] = useState<string | null>(null);
  const [binDropTarget, setBinDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
  const [autoClipCfg, setAutoClipCfg] = useState<AutoClipGenerateConfig>(DEFAULT_AUTO_CLIP_CONFIG);
  const [autoSettingsOpen, setAutoSettingsOpen] = useState(false);
  const [variationTake, setVariationTake] = useState(1);
  const [beatCalibOpen, setBeatCalibOpen] = useState(true);
  const tapHistoryRef = useRef<number[]>([]);
  const tapResetTimerRef = useRef<number | null>(null);
  const [tapCount, setTapCount] = useState(0);
  const [genToAdd, setGenToAdd] = useState<Exclude<GeneratorEffectId, 'none'>>('galaxy_spiral');
  const [syncWithMotion, setSyncWithMotion] = useState(true);
  const [srtDraft, setSrtDraft] = useState('');

  useEffect(() => {
    return () => {
      if (tapResetTimerRef.current !== null) {
        window.clearTimeout(tapResetTimerRef.current);
      }
    };
  }, []);

  const handleTapTempo = () => {
    const now = performance.now();
    const prev = tapHistoryRef.current;
    const trimmed =
      prev.length > 0 && now - prev[prev.length - 1] > 2500 ? [now] : [...prev.slice(-8), now];
    tapHistoryRef.current = trimmed;
    setTapCount(trimmed.length);
    if (tapResetTimerRef.current !== null) {
      window.clearTimeout(tapResetTimerRef.current);
    }
    tapResetTimerRef.current = window.setTimeout(() => {
      tapHistoryRef.current = [];
      setTapCount(0);
    }, 2600);
    const measured = computeTapTempoBpm(trimmed);
    if (measured !== null) {
      onUpdateConfig({ beatGridMode: 'custom_bpm', manualBpm: measured });
    }
  };

  const activeBeatGridMode: BeatGridMode = config.beatGridMode ?? 'auto';
  const activeDisplayBpm =
    activeBeatGridMode === 'custom_bpm' && (config.manualBpm ?? 0) >= 40
      ? Number((config.manualBpm as number).toFixed(1))
      : Number((trackBeatGrid.exactBpm || trackBpm || rawTrackBpm || 0).toFixed(1));
  const beatOffsetMs = Math.round((config.beatOffsetSec ?? 0) * 1000);
  const downbeatIdx = ((config.beatDownbeatShift ?? 0) % 4 + 4) % 4;

  const isTimelineFullMusic = useMemo(() => {
    if (!audio || mediaItems.length === 0) return false;
    const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);
    if (config.slideshowMode === 'manual') {
      const ivs = getNormalizedManualClipIntervals(mediaItems);
      const endSec = ivs.length > 0 ? ivs[ivs.length - 1].endSec : 0;
      return endSec >= clipDuration - 0.45;
    }
    return getTimelineSpanSec(mediaItems, config) >= clipDuration - 0.45;
  }, [audio, config, mediaItems]);

  useEffect(() => {
    if (mediaItems.length === 0 && autoClipCfg.targetMode === 'append') {
      setAutoClipCfg((prev) => ({ ...prev, targetMode: 'replace' }));
    }
  }, [autoClipCfg.targetMode, mediaItems.length]);

  const applyAutoClipPreset = (presetId: AutoClipPresetId) => {
    const found = AUTO_CLIP_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setAutoClipCfg((prev) => ({
      ...prev,
      ...found.config,
      targetMode: isTimelineFullMusic && prev.targetMode === 'append' ? 'replace' : prev.targetMode,
      presetId,
    }));
  };

  const handleTriggerAutoClipGenerate = () => {
    const nextSeed = ((variationTake * 2654435761) ^ Date.now()) >>> 0;
    setVariationTake((prev) => prev + 1);
    onCreateRandomBeatAutoClip({
      ...autoClipCfg,
      variationSeed: nextSeed,
    });
  };

  const presetLabel = (id: AutoClipPresetId): string => {
    switch (id) {
      case 'music_story':
        return t.autoPresetMusicStory;
      case 'cinema_flow':
        return t.autoPresetCinemaFlow;
      case 'dynamic_drop':
        return t.autoPresetDynamicDrop;
      case 'cinema_trailer':
        return t.autoPresetCinemaTrailer;
      case 'crescendo_arc':
        return t.autoPresetCrescendo;
      case 'hiphop_groove':
        return t.autoPresetGroove;
      case 'acoustic_breath':
        return t.autoPresetAcoustic;
      case 'shorts_viral':
        return t.autoPresetViral;
      case 'story_order':
        return t.autoPresetStoryOrder;
      case 'remix_shuffle':
        return t.autoPresetRemixShuffle;
      case 'slow_dream':
        return t.autoPresetSlowDream;
      case 'beat_flash':
        return t.autoPresetBeatFlash;
    }
  };

  const sectionLabel = (secType: MusicalSectionType): string => {
    switch (secType) {
      case 'intro':
        return t.sectionIntro;
      case 'beatless':
        return t.sectionBeatless;
      case 'buildup':
        return t.sectionBuildup;
      case 'drop':
        return t.sectionDrop;
      case 'outro':
        return t.sectionOutro;
      case 'verse':
      default:
        return t.sectionVerse;
    }
  };

  const sectionColorClass = (secType: MusicalSectionType): string => {
    switch (secType) {
      case 'intro':
        return 'bg-sky-500/75';
      case 'beatless':
        return 'bg-indigo-500/80';
      case 'buildup':
        return 'bg-amber-400/85';
      case 'drop':
        return 'bg-rose-500/85';
      case 'outro':
        return 'bg-slate-400/75';
      case 'verse':
      default:
        return 'bg-emerald-500/75';
    }
  };

  const selectedClip = mediaItems.find((c) => c.id === selectedClipId) || mediaItems[0] || null;
  const previewAsset = previewBinId
    ? mediaBin.find((b) => b.id === previewBinId) || null
    : null;

  const timelineClipsByUrl = useMemo(() => {
    const map = new Map<string, VisualMediaState[]>();
    for (const clip of mediaItems) {
      if (!clip.url) continue;
      const list = map.get(clip.url) || [];
      list.push(clip);
      map.set(clip.url, list);
    }
    return map;
  }, [mediaItems]);

  const handleAudioDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    panelDragDepthRef.current = 0;
    setPanelFileDragOver(false);
    setAudioDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onAudioFile(file);
  };

  const handleVisualDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    panelDragDepthRef.current = 0;
    setPanelFileDragOver(false);
    setVisualDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) onVisualFiles(files);
  };

  const handlePanelDragEnter = (e: React.DragEvent) => {
    if (
      !e.dataTransfer.types.includes('Files') ||
      e.dataTransfer.types.includes('application/x-neuromicon-bin-id')
    ) {
      return;
    }
    panelDragDepthRef.current += 1;
    setPanelFileDragOver(true);
  };

  const handlePanelDragOver = (e: React.DragEvent) => {
    if (
      !e.dataTransfer.types.includes('Files') ||
      e.dataTransfer.types.includes('application/x-neuromicon-bin-id')
    ) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handlePanelDragLeave = (e: React.DragEvent) => {
    if (
      !e.dataTransfer.types.includes('Files') ||
      e.dataTransfer.types.includes('application/x-neuromicon-bin-id')
    ) {
      return;
    }
    panelDragDepthRef.current = Math.max(0, panelDragDepthRef.current - 1);
    if (panelDragDepthRef.current === 0 || !e.currentTarget.contains(e.relatedTarget as Node | null)) {
      panelDragDepthRef.current = 0;
      setPanelFileDragOver(false);
    }
  };

  const handlePanelDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-neuromicon-bin-id')) return;
    const files = Array.from(e.dataTransfer.files || []);
    panelDragDepthRef.current = 0;
    setPanelFileDragOver(false);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const audioOnly = files.every(
      (f) =>
        f.type.startsWith('audio/') ||
        /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(f.name)
    );
    if (audioOnly) {
      onAudioFile(files[0]);
    } else {
      onVisualFiles(files);
      setPanelTab('media');
    }
  };

  const trimPresets: { id: TrimPresetId; label: string }[] = [
    { id: 'full', label: t.trimFull },
    { id: 'reels_60', label: t.trimReels },
    { id: 'tiktok_60', label: t.trimTikTok },
    { id: 'shorts_57', label: t.trimShorts },
    { id: 'custom', label: t.trimCustom },
  ];

  const maxDur = audio ? audio.duration : 60;

  return (
    <aside
      id="media-panel"
      style={widthPx ? { ['--panel-w' as string]: `${widthPx}px` } : undefined}
      onDragEnter={handlePanelDragEnter}
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
      className="relative w-full lg:w-[var(--panel-w,310px)] shrink-0 border-b lg:border-b-0 lg:border-r border-[#262B38] bg-[#10131A] flex flex-col lg:overflow-hidden"
    >
      {panelFileDragOver && (
        <div className="absolute inset-1.5 z-30 rounded-lg border-2 border-dashed border-amber-400 bg-[#10131A]/90 backdrop-blur-sm flex flex-col items-center justify-center p-5 text-center pointer-events-none">
          <Upload className="w-7 h-7 text-amber-400 mb-2 animate-bounce" aria-hidden="true" />
          <p className="text-xs font-semibold text-amber-200 leading-snug">
            {t.binDropZoneOverlay}
          </p>
        </div>
      )}
      {/* Left Panel 3-Tab Header */}
      <div className="p-2 border-b border-[#262B38] bg-[#0E1016] grid grid-cols-3 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setPanelTab('media')}
          className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
            panelTab === 'media'
              ? 'bg-[#1D2230] text-amber-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.mediaTabSources}</span>
        </button>
        <button
          type="button"
          onClick={() => setPanelTab('layers')}
          className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
            panelTab === 'layers'
              ? 'bg-[#1D2230] text-amber-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Subtitles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.mediaTabLayers}</span>
        </button>
        <button
          type="button"
          onClick={() => setPanelTab('timing')}
          className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
            panelTab === 'timing'
              ? 'bg-[#1D2230] text-amber-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Scissors className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.mediaTabTiming}</span>
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#262B38]">
        {panelTab === 'media' && (
          <>
            {/* Audio Track */}
            <section className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-gray-100 flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  <span>{t.audioSectionTitle}</span>
                </h2>
                {audio && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => audioInputRef.current?.click()}
                      className="text-[11px] font-medium text-amber-400 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {t.replaceAudio}
                    </button>
                    <button
                      type="button"
                      onClick={onRemoveAudio}
                      title={t.removeAudio}
                      aria-label={t.removeAudio}
                      className="p-1 rounded text-gray-400 hover:text-rose-400 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>

              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*,video/mp4,video/webm,video/quicktime,.mp3,.wav,.flac,.ogg,.m4a,.mp4,.mov,.webm,.aac"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onAudioFile(f);
                  e.target.value = '';
                }}
              />

              {!audio ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => audioInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') audioInputRef.current?.click();
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setAudioDragOver(true);
                  }}
                  onDragLeave={() => setAudioDragOver(false)}
                  onDrop={handleAudioDrop}
                  className={`rounded-lg border border-dashed p-3.5 text-center cursor-pointer transition-colors ${
                    audioDragOver
                      ? 'border-amber-400 bg-amber-500/10'
                      : 'border-[#323849] bg-[#141821] hover:border-gray-500'
                  }`}
                >
                  <Upload className="w-4 h-4 mx-auto mb-1.5 text-gray-400" aria-hidden="true" />
                  <p className="text-xs font-medium text-gray-200">
                    {isLoadingAudio ? '...' : t.audioDropTitle}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{t.audioDropHint}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-lg border border-[#262B38] bg-[#141821] p-2.5 space-y-1">
                    <p className="text-xs font-semibold text-gray-100 truncate" title={audio.fileName}>
                      {audio.fileName}
                    </p>
                    <p className="text-[10px] text-gray-400 font-mono tabular-nums">
                      {formatSec(audio.duration)} · {(audio.sampleRate / 1000).toFixed(1)} kHz ·{' '}
                      {audio.numberOfChannels}ch
                      {audio.isSyntheticDemo ? ` · ${t.audioSyntheticNote}` : ''}
                    </p>
                  </div>

                  {/* Audio Beat Extraction & Calibration Box */}
                  <div className="rounded-lg border border-cyan-500/30 bg-[#121722] p-2 space-y-2">
                    <div className="flex items-center justify-between gap-1.5">
                      <button
                        type="button"
                        onClick={() => setBeatCalibOpen((v) => !v)}
                        title={t.beatCalibToggleTitle}
                        className="flex items-center gap-1.5 min-w-0 text-left cursor-pointer"
                      >
                        <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" aria-hidden="true" />
                        <span className="text-[11px] font-semibold text-cyan-200 truncate">
                          {t.beatCalibTitle}
                        </span>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="px-1.5 py-0.5 rounded bg-[#0B0D11] border border-[#262B38] text-[10px] font-mono tabular-nums text-amber-300">
                          {activeDisplayBpm > 0 ? `${activeDisplayBpm} ${t.detectedBpmLabel}` : '—'} ·{' '}
                          {trackBeatGrid.beats.length}
                        </span>
                        <button
                          type="button"
                          onClick={onToggleMetronome}
                          title={t.beatCalibMetronomeHint}
                          aria-pressed={Boolean(config.beatMetronomeEnabled)}
                          className={`px-1.5 py-0.5 rounded border text-[10px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                            config.beatMetronomeEnabled
                              ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                              : 'border-[#262B38] bg-[#0E1016] text-gray-400 hover:text-gray-200'
                          }`}
                        >
                          <Volume2 className="w-3 h-3" aria-hidden="true" />
                          <span>{t.beatCalibMetronomeBtn}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setBeatCalibOpen((v) => !v)}
                          title={t.beatCalibToggleTitle}
                          aria-expanded={beatCalibOpen}
                          className={`p-1 rounded border text-[10px] cursor-pointer ${
                            beatCalibOpen
                              ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-200'
                              : 'border-[#262B38] bg-[#0E1016] text-gray-400 hover:text-gray-200'
                          }`}
                        >
                          <SlidersHorizontal className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {beatCalibOpen && (
                      <div className="space-y-2 pt-1 border-t border-[#1F2636]">
                        {/* Beat Grid Mode */}
                        <div className="grid grid-cols-3 gap-1">
                          {(
                            [
                              { id: 'auto', label: t.beatCalibModeAuto },
                              { id: 'strict_bpm', label: t.beatCalibModeStrict },
                              { id: 'custom_bpm', label: t.beatCalibModeCustom },
                            ] as { id: BeatGridMode; label: string }[]
                          ).map((gm) => (
                            <button
                              key={gm.id}
                              type="button"
                              onClick={() => {
                                if (gm.id === 'custom_bpm' && (config.manualBpm ?? 0) < 40) {
                                  onUpdateConfig({
                                    beatGridMode: 'custom_bpm',
                                    manualBpm: Math.max(45, Math.min(220, activeDisplayBpm || 120)),
                                  });
                                } else {
                                  onUpdateConfig({ beatGridMode: gm.id });
                                }
                              }}
                              className={`py-1 px-1 rounded border text-[9.5px] font-medium cursor-pointer truncate ${
                                activeBeatGridMode === gm.id
                                  ? 'border-cyan-400/90 bg-cyan-500/20 text-cyan-200'
                                  : 'border-[#262B38] bg-[#0E1016] text-gray-400 hover:border-gray-500 hover:text-gray-200'
                              }`}
                            >
                              {gm.label}
                            </button>
                          ))}
                        </div>

                        {/* Manual BPM / x0.5 / x2 / Tap Tempo */}
                        <div className="flex items-center gap-1">
                          <div className="flex-1 min-w-0">
                            <NumericDraftInput
                              value={activeDisplayBpm > 0 ? activeDisplayBpm : 120}
                              min={45}
                              max={220}
                              step={0.5}
                              decimals={1}
                              ariaLabel={t.beatCalibManualBpmLabel}
                              onCommit={(val) =>
                                onUpdateConfig({
                                  beatGridMode: 'custom_bpm',
                                  manualBpm: Number(val.toFixed(1)),
                                })
                              }
                              className="w-full rounded bg-[#0E1016] border border-[#262B38] px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-amber-300"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const base = activeDisplayBpm > 0 ? activeDisplayBpm : 120;
                              const next = Math.max(45, Number((base / 2).toFixed(1)));
                              onUpdateConfig({ beatGridMode: 'custom_bpm', manualBpm: next });
                            }}
                            className="px-1.5 py-1 rounded border border-[#262B38] bg-[#0E1016] hover:border-cyan-500/60 text-[10px] font-mono text-gray-300 hover:text-cyan-200 cursor-pointer"
                          >
                            ÷2
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const base = activeDisplayBpm > 0 ? activeDisplayBpm : 120;
                              const next = Math.min(220, Number((base * 2).toFixed(1)));
                              onUpdateConfig({ beatGridMode: 'custom_bpm', manualBpm: next });
                            }}
                            className="px-1.5 py-1 rounded border border-[#262B38] bg-[#0E1016] hover:border-cyan-500/60 text-[10px] font-mono text-gray-300 hover:text-cyan-200 cursor-pointer"
                          >
                            ×2
                          </button>
                          <button
                            type="button"
                            onClick={handleTapTempo}
                            title={t.beatCalibTapHint}
                            className={`px-2 py-1 rounded border text-[10px] font-semibold cursor-pointer whitespace-nowrap ${
                              tapCount > 0
                                ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                                : 'border-cyan-500/45 bg-cyan-500/12 hover:bg-cyan-500/20 text-cyan-200'
                            }`}
                          >
                            {tapCount > 0 ? `${t.beatCalibTapBtn} (${tapCount})` : t.beatCalibTapBtn}
                          </button>
                        </div>

                        {/* Grid Phase Nudge & Beat 1 Alignment */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-gray-400">{t.beatCalibOffsetLabel}</span>
                            <button
                              type="button"
                              onClick={() => onUpdateConfig({ beatOffsetSec: 0 })}
                              className="font-mono tabular-nums text-cyan-300 hover:text-amber-300 cursor-pointer"
                            >
                              {beatOffsetMs >= 0 ? `+${beatOffsetMs}ms` : `${beatOffsetMs}ms`}
                            </button>
                          </div>
                          <div className="grid grid-cols-4 gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateConfig({
                                  beatOffsetSec: Number(
                                    Math.max(-2, (config.beatOffsetSec ?? 0) - 0.02).toFixed(3)
                                  ),
                                })
                              }
                              className="py-1 px-1 rounded border border-[#262B38] bg-[#0E1016] hover:border-cyan-500/60 text-[10px] font-mono text-gray-300 cursor-pointer"
                            >
                              -20ms
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateConfig({
                                  beatOffsetSec: Number(
                                    Math.min(2, (config.beatOffsetSec ?? 0) + 0.02).toFixed(3)
                                  ),
                                })
                              }
                              className="py-1 px-1 rounded border border-[#262B38] bg-[#0E1016] hover:border-cyan-500/60 text-[10px] font-mono text-gray-300 cursor-pointer"
                            >
                              +20ms
                            </button>
                            <button
                              type="button"
                              onClick={onSetBeat1AtPlayhead}
                              title={`${t.beatCalibSetBeat1Hint} (${Math.max(0, currentTime - config.trimStart).toFixed(2)}s)`}
                              className="py-1 px-1 rounded border border-amber-500/55 bg-amber-500/12 hover:bg-amber-500/25 text-[9.5px] font-semibold text-amber-200 cursor-pointer truncate"
                            >
                              {t.beatCalibSetBeat1Btn}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateConfig({
                                  beatDownbeatShift: (((config.beatDownbeatShift ?? 0) + 1) % 4) as
                                    | 0
                                    | 1
                                    | 2
                                    | 3,
                                })
                              }
                              title={t.beatCalibDownbeatHint}
                              className="py-1 px-1 rounded border border-[#262B38] bg-[#0E1016] hover:border-cyan-500/60 text-[9.5px] font-mono text-cyan-200 cursor-pointer truncate"
                            >
                              {t.beatCalibDownbeatBtn} {downbeatIdx + 1}/4
                            </button>
                          </div>
                        </div>

                        {/* Sensitivity & Extract / Reset */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-gray-400">{t.beatCalibSensitivityLabel}</span>
                            <span className="font-mono tabular-nums text-gray-200">
                              {config.beatSensitivity.toFixed(2)}×
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.6}
                            max={2.2}
                            step={0.05}
                            value={config.beatSensitivity}
                            onChange={(e) =>
                              onUpdateConfig({ beatSensitivity: Number(e.target.value) })
                            }
                            className="w-full studio-slider"
                          />
                        </div>

                        <div className="flex items-center gap-1 pt-0.5">
                          <button
                            type="button"
                            onClick={onReextractAudioBeats}
                            title={t.beatCalibExtractHint}
                            className="flex-1 py-1 px-2 rounded border border-cyan-500/45 bg-cyan-500/12 hover:bg-cyan-500/20 text-[10px] font-medium text-cyan-200 cursor-pointer flex items-center justify-center gap-1"
                          >
                            <Activity className="w-3 h-3" aria-hidden="true" />
                            <span>{t.beatCalibExtractBtn}</span>
                          </button>
                          <button
                            type="button"
                            onClick={onResetBeatCalibration}
                            className="py-1 px-2 rounded border border-[#262B38] bg-[#0E1016] hover:border-gray-500 text-[10px] text-gray-300 cursor-pointer flex items-center gap-1"
                          >
                            <RotateCcw className="w-2.5 h-2.5" aria-hidden="true" />
                            <span>{t.beatCalibResetBtn}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={onLoadDemoBeat}
                disabled={isLoadingAudio}
                className="w-full py-1.5 px-3 rounded-md border border-[#262B38] bg-[#161A24] hover:bg-[#1D2230] text-xs font-medium text-gray-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span>{t.loadDemoBeat}</span>
              </button>
            </section>

            {/* Media Library / Bin (Uploads never auto-shift timeline) */}
            <section className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold text-gray-100 flex items-center gap-1.5 min-w-0">
                  <ImageIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {t.mediaBinTitle}
                    {mediaBin.length > 0 ? ` (${mediaBin.length})` : ''}
                  </span>
                </h2>
                <div className="flex items-center gap-2 shrink-0">
                  {mediaBin.length > 1 && (
                    <button
                      type="button"
                      onClick={onAddAllBinToTimeline}
                      className="text-[11px] font-medium text-amber-400 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {t.binAddAllBtn}
                    </button>
                  )}
                  {mediaBin.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearBin}
                      className="text-[11px] text-gray-400 hover:text-rose-400 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {t.binClearBtn}
                    </button>
                  )}
                </div>
              </div>

              <input
                ref={visualInputRef}
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

              <div
                role="button"
                tabIndex={0}
                onClick={() => visualInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') visualInputRef.current?.click();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setVisualDragOver(true);
                }}
                onDragLeave={() => setVisualDragOver(false)}
                onDrop={handleVisualDrop}
                className={`rounded-lg border border-dashed text-center cursor-pointer transition-colors ${
                  mediaBin.length > 0 ? 'p-2' : 'p-3'
                } ${
                  visualDragOver
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-[#323849] bg-[#141821] hover:border-gray-500'
                }`}
              >
                {mediaBin.length === 0 ? (
                  <>
                    <Upload className="w-4 h-4 mx-auto mb-1.5 text-gray-400" aria-hidden="true" />
                    <p className="text-xs font-medium text-gray-200">{t.visualDropTitle}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{t.binEmptyHint}</p>
                  </>
                ) : (
                  <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-gray-300">
                    <Plus className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                    <span>
                      {t.addMoreVisuals} ({mediaBin.length} {t.mediaCountSuffix})
                    </span>
                  </div>
                )}
              </div>

              {audio?.metadata.embeddedCoverUrl && (
                <button
                  type="button"
                  onClick={onUseEmbeddedCover}
                  className="w-full py-1.5 px-2.5 rounded-md border border-[#262B38] bg-[#161A24] hover:bg-[#1D2230] text-[11px] font-medium text-amber-300 transition-colors cursor-pointer"
                >
                  {t.addCoverToBinBtn}
                </button>
              )}

              {mediaBin.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-gray-400 leading-tight">{t.binDragHint}</p>
                  <div className="space-y-1.5">
                    {mediaBin.map((asset, binIdx) => {
                      const placedClips = timelineClipsByUrl.get(asset.url) || [];
                      const isUsed = placedClips.length > 0;
                      const isSelectedAsset = Boolean(selectedClip && selectedClip.url === asset.url);
                      const isExpanded = expandedBinId === asset.id;
                      const isDropBefore = binDropTarget?.id === asset.id && binDropTarget.position === 'before';
                      const isDropAfter = binDropTarget?.id === asset.id && binDropTarget.position === 'after';
                      const maxV = Math.max(0.5, asset.videoDuration || asset.defaultDurationSec || 10);
                      return (
                        <div
                          key={asset.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('application/x-neuromicon-bin-id', asset.id);
                            e.dataTransfer.effectAllowed = 'copyMove';
                            setDraggingBinId(asset.id);
                          }}
                          onDragEnd={() => {
                            setDraggingBinId(null);
                            setBinDropTarget(null);
                          }}
                          onDragOver={(e) => {
                            if (!draggingBinId || draggingBinId === asset.id) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const pos = e.clientY < rect.top + rect.height * 0.5 ? 'before' : 'after';
                            if (binDropTarget?.id !== asset.id || binDropTarget?.position !== pos) {
                              setBinDropTarget({ id: asset.id, position: pos });
                            }
                          }}
                          onDrop={(e) => {
                            if (!draggingBinId || draggingBinId === asset.id) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const pos =
                              binDropTarget?.id === asset.id ? binDropTarget.position : 'after';
                            onReorderBinItem(draggingBinId, asset.id, pos);
                            setDraggingBinId(null);
                            setBinDropTarget(null);
                          }}
                          className={`rounded-md border transition-colors ${
                            draggingBinId === asset.id
                              ? 'opacity-50 border-amber-400'
                              : isSelectedAsset
                                ? 'border-amber-400/80 bg-amber-500/10'
                                : isUsed
                                  ? 'border-emerald-500/45 bg-emerald-950/15 hover:border-emerald-400/75'
                                  : 'border-[#262B38] bg-[#141821] hover:border-amber-500/55'
                          } ${
                            isDropBefore
                              ? 'border-t-2 border-t-amber-400'
                              : isDropAfter
                                ? 'border-b-2 border-b-amber-400'
                                : ''
                          }`}
                        >
                          <div className="p-1.5 flex items-center gap-1.5 cursor-grab active:cursor-grabbing group">
                            <GripVertical
                              className="w-3 h-3 text-gray-500 group-hover:text-amber-300 shrink-0"
                              aria-hidden="true"
                            />
                            {mediaBin.length > 1 && (
                              <div
                                className="flex flex-col -my-0.5 shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  disabled={binIdx === 0}
                                  onClick={() => onMoveBinItem(asset.id, -1)}
                                  aria-label={t.binMoveUpAria}
                                  title={t.binMoveUpAria}
                                  className="text-gray-500 hover:text-amber-300 disabled:opacity-25 disabled:pointer-events-none cursor-pointer leading-none p-0.2"
                                >
                                  <ChevronUp className="w-2.5 h-2.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={binIdx === mediaBin.length - 1}
                                  onClick={() => onMoveBinItem(asset.id, 1)}
                                  aria-label={t.binMoveDownAria}
                                  title={t.binMoveDownAria}
                                  className="text-gray-500 hover:text-amber-300 disabled:opacity-25 disabled:pointer-events-none cursor-pointer leading-none p-0.2"
                                >
                                  <ChevronDown className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewBinId(asset.id);
                              }}
                              title={t.binPreviewBtn}
                              className="w-9 h-9 rounded bg-black/50 overflow-hidden shrink-0 border border-[#262B38] hover:border-amber-400 flex items-center justify-center relative cursor-pointer"
                            >
                              {asset.kind === 'image' ? (
                                <img
                                  src={asset.url}
                                  alt={asset.fileName}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover pointer-events-none"
                                />
                              ) : (
                                <video
                                  src={asset.url}
                                  muted
                                  preload="metadata"
                                  className="w-full h-full object-cover pointer-events-none"
                                />
                              )}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1 min-w-0">
                                <p
                                  className="text-[11px] font-medium text-gray-100 truncate"
                                  title={asset.fileName}
                                >
                                  {asset.fileName}
                                </p>
                              </div>
                              <div className="text-[9.5px] text-gray-400 font-mono tabular-nums flex flex-wrap items-center gap-1 mt-0.5">
                                {asset.kind === 'video' && (
                                  <Film className="w-2.5 h-2.5 text-amber-400 shrink-0" aria-hidden="true" />
                                )}
                                <span className="text-amber-300">{asset.defaultDurationSec.toFixed(1)}s</span>
                                {asset.kind === 'video' &&
                                  ((asset.defaultSourceStartSec ?? 0) > 0.05 ||
                                    (asset.defaultSourceEndSec ?? maxV) < maxV - 0.05) && (
                                    <span className="text-cyan-300">
                                      [{(asset.defaultSourceStartSec ?? 0).toFixed(1)}–{(asset.defaultSourceEndSec ?? maxV).toFixed(1)}s]
                                    </span>
                                  )}
                                {isUsed && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSelectClip(placedClips[0].id);
                                      onInspectClip(placedClips[0].id);
                                    }}
                                    className="px-1 py-0.2 rounded bg-emerald-500/20 border border-emerald-500/45 text-[9px] font-sans font-semibold text-emerald-300 hover:bg-emerald-500/30 cursor-pointer"
                                  >
                                    {t.binUsedBadge}
                                    {placedClips.length > 1 ? ` ×${placedClips.length}` : ''}
                                  </button>
                                )}
                              </div>
                            </div>
                            <div
                              className="flex items-center gap-0.5 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => setPreviewBinId(asset.id)}
                                title={t.binPreviewBtn}
                                aria-label={t.binPreviewBtn}
                                className="p-1 rounded text-gray-400 hover:text-cyan-300 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedBinId((prev) => (prev === asset.id ? null : asset.id))
                                }
                                title={t.binFileSettingsBtn}
                                aria-label={t.binFileSettingsBtn}
                                className={`p-1 rounded cursor-pointer ${
                                  isExpanded
                                    ? 'text-amber-300 bg-amber-500/15'
                                    : 'text-gray-400 hover:text-amber-300'
                                }`}
                              >
                                <SlidersHorizontal className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onAddBinItemToTimeline(asset.id, { mode: 'playhead' })}
                                title={t.binPlaceAtPlayhead}
                                className="px-1.5 py-0.5 rounded border border-[#262B38] bg-[#0E1016] hover:border-amber-500/70 text-[10px] font-medium text-amber-300 cursor-pointer whitespace-nowrap"
                              >
                                +
                              </button>
                              <button
                                type="button"
                                onClick={() => onRemoveBinItem(asset.id)}
                                aria-label={t.binRemoveAssetAria}
                                title={t.binRemoveAssetAria}
                                className="p-0.5 text-gray-500 hover:text-rose-400 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {/* Expandable Inline File Settings */}
                          {isExpanded && (
                            <div
                              className="px-2 pb-2 pt-1.5 border-t border-[#262B38]/80 bg-[#0E1016]/70 space-y-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {asset.kind === 'video' ? (
                                <>
                                  <div className="grid grid-cols-3 gap-1.5">
                                    <label className="space-y-0.5 block">
                                      <span className="text-[9.5px] text-gray-400 block">
                                        {t.binRangeStartLabel}
                                      </span>
                                      <NumericDraftInput
                                        value={asset.defaultSourceStartSec ?? 0}
                                        min={0}
                                        max={Math.max(0, (asset.defaultSourceEndSec ?? maxV) - 0.4)}
                                        step={0.5}
                                        decimals={1}
                                        ariaLabel={t.binRangeStartLabel}
                                        onCommit={(val) => {
                                          const curEnd = asset.defaultSourceEndSec ?? maxV;
                                          onUpdateBinItem(
                                            asset.id,
                                            {
                                              defaultSourceStartSec: val,
                                              defaultDurationSec: Math.min(
                                                asset.defaultDurationSec,
                                                Number(Math.max(0.4, curEnd - val).toFixed(1))
                                              ),
                                            },
                                            false
                                          );
                                        }}
                                        className="w-full rounded bg-[#141821] border border-[#262B38] px-1.5 py-0.5 text-[11px] font-mono text-gray-100"
                                      />
                                    </label>

                                    <label className="space-y-0.5 block">
                                      <span className="text-[9.5px] text-gray-400 block">
                                        {t.binRangeEndLabel}
                                      </span>
                                      <NumericDraftInput
                                        value={asset.defaultSourceEndSec ?? maxV}
                                        min={Math.min(maxV, (asset.defaultSourceStartSec ?? 0) + 0.4)}
                                        max={Number(maxV.toFixed(1))}
                                        step={0.5}
                                        decimals={1}
                                        ariaLabel={t.binRangeEndLabel}
                                        onCommit={(val) => {
                                          const curStart = asset.defaultSourceStartSec ?? 0;
                                          onUpdateBinItem(
                                            asset.id,
                                            {
                                              defaultSourceEndSec: val,
                                              defaultDurationSec: Math.min(
                                                asset.defaultDurationSec,
                                                Number(Math.max(0.4, val - curStart).toFixed(1))
                                              ),
                                            },
                                            false
                                          );
                                        }}
                                        className="w-full rounded bg-[#141821] border border-[#262B38] px-1.5 py-0.5 text-[11px] font-mono text-gray-100"
                                      />
                                    </label>

                                    <label className="space-y-0.5 block">
                                      <span className="text-[9.5px] text-gray-400 block">
                                        {t.clipDurationLabel}
                                      </span>
                                      <NumericDraftInput
                                        value={asset.defaultDurationSec}
                                        min={0.4}
                                        max={Math.max(0.4, (asset.defaultSourceEndSec ?? maxV) - (asset.defaultSourceStartSec ?? 0))}
                                        step={0.5}
                                        decimals={1}
                                        ariaLabel={t.clipDurationLabel}
                                        onCommit={(val) =>
                                          onUpdateBinItem(
                                            asset.id,
                                            { defaultDurationSec: Number(val.toFixed(1)) },
                                            false
                                          )
                                        }
                                        className="w-full rounded bg-[#141821] border border-[#262B38] px-1.5 py-0.5 text-[11px] font-mono text-amber-300"
                                      />
                                    </label>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-1">
                                    {maxV >= 12.5 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const s = 5;
                                          const e = Number((maxV - 5).toFixed(1));
                                          onUpdateBinItem(
                                            asset.id,
                                            {
                                              defaultSourceStartSec: s,
                                              defaultSourceEndSec: e,
                                              defaultDurationSec: Math.min(
                                                asset.defaultDurationSec,
                                                Number(Math.max(0.5, e - s).toFixed(1))
                                              ),
                                            },
                                            false
                                          );
                                        }}
                                        className="px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-[9.5px] font-mono text-cyan-200 cursor-pointer"
                                      >
                                        {t.binEdgeTrim5sBtn}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onUpdateBinItem(
                                          asset.id,
                                          {
                                            defaultSourceStartSec: 0,
                                            defaultSourceEndSec: Number(maxV.toFixed(1)),
                                            defaultDurationSec: Number(Math.max(0.5, Math.min(600, maxV)).toFixed(1)),
                                          },
                                          false
                                        )
                                      }
                                      className="px-1.5 py-0.5 rounded border border-[#262B38] bg-[#141821] hover:border-gray-500 text-[9.5px] text-gray-300 cursor-pointer"
                                    >
                                      {t.binFullRangeBtn}
                                    </button>
                                    {[2, 4, 6, 8, 12].map((sec) => (
                                      <button
                                        key={sec}
                                        type="button"
                                        onClick={() => {
                                          const span = Math.max(
                                            0.5,
                                            (asset.defaultSourceEndSec ?? maxV) - (asset.defaultSourceStartSec ?? 0)
                                          );
                                          onUpdateBinItem(
                                            asset.id,
                                            { defaultDurationSec: Number(Math.min(sec, span).toFixed(1)) },
                                            false
                                          );
                                        }}
                                        className={`px-1.5 py-0.5 rounded border text-[9.5px] font-mono cursor-pointer ${
                                          Math.abs(asset.defaultDurationSec - sec) < 0.05
                                            ? 'border-amber-400/80 bg-amber-500/15 text-amber-200'
                                            : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                                        }`}
                                      >
                                        {sec}s
                                      </button>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <div className="grid grid-cols-2 gap-1.5">
                                  <label className="space-y-0.5 block">
                                    <span className="text-[9.5px] text-gray-400 block">
                                      {t.clipDurationLabel}
                                    </span>
                                    <NumericDraftInput
                                      value={asset.defaultDurationSec}
                                      min={0.4}
                                      max={600}
                                      step={0.5}
                                      decimals={1}
                                      ariaLabel={t.clipDurationLabel}
                                      onCommit={(val) =>
                                        onUpdateBinItem(asset.id, { defaultDurationSec: val }, false)
                                      }
                                      className="w-full rounded bg-[#141821] border border-[#262B38] px-1.5 py-0.5 text-[11px] font-mono text-amber-300"
                                    />
                                  </label>

                                  <label className="space-y-0.5 block">
                                    <span className="text-[9.5px] text-gray-400 block">
                                      {t.clipTransitionLabel}
                                    </span>
                                    <select
                                      value={asset.defaultTransitionOut ?? 'crossfade'}
                                      onChange={(e) =>
                                        onUpdateBinItem(
                                          asset.id,
                                          {
                                            defaultTransitionOut: e.target.value as SlideTransitionType,
                                          },
                                          false
                                        )
                                      }
                                      className="w-full rounded bg-[#141821] border border-[#262B38] px-1 py-0.5 text-[10.5px] text-gray-100"
                                    >
                                      <option value="crossfade">{t.transitionCrossfade}</option>
                                      <option value="zoom_cross">{t.transitionZoomCross}</option>
                                      <option value="wipe_right">{t.transitionWipeRight}</option>
                                      <option value="dip_black">{t.transitionDipBlack}</option>
                                      <option value="slide">{t.transitionSlide}</option>
                                      <option value="cut">{t.transitionCut}</option>
                                    </select>
                                  </label>
                                </div>
                              )}

                              {asset.kind === 'video' && (
                                <div className="grid grid-cols-2 gap-1.5 items-center">
                                  <label className="space-y-0.5 block">
                                    <span className="text-[9.5px] text-gray-400 block">
                                      {t.clipSpeedLabel}
                                    </span>
                                    <select
                                      value={asset.defaultPlaybackRate ?? 1.0}
                                      onChange={(e) =>
                                        onUpdateBinItem(
                                          asset.id,
                                          { defaultPlaybackRate: Number(e.target.value) },
                                          false
                                        )
                                      }
                                      className="w-full rounded bg-[#141821] border border-[#262B38] px-1.5 py-0.5 text-[11px] font-mono text-gray-100"
                                    >
                                      {[0.25, 0.35, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((spd) => (
                                        <option key={spd} value={spd}>
                                          {spd}×
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="flex items-center gap-1.5 text-[10.5px] text-gray-300 cursor-pointer pt-3">
                                    <input
                                      type="checkbox"
                                      checked={asset.defaultClipAudioMuted ?? Boolean(audio)}
                                      onChange={(e) =>
                                        onUpdateBinItem(
                                          asset.id,
                                          { defaultClipAudioMuted: e.target.checked },
                                          false
                                        )
                                      }
                                      className="accent-amber-500 w-3.5 h-3.5 rounded cursor-pointer"
                                    />
                                    <span>{t.clipMuteLabel}</span>
                                  </label>
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                <button
                                  type="button"
                                  onClick={() => onAddBinItemToTimeline(asset.id, { mode: 'end' })}
                                  className="px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-[10px] font-medium text-cyan-200 cursor-pointer"
                                >
                                  {t.binPlaceAtEnd}
                                </button>
                                {isUsed && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onUpdateBinItem(
                                        asset.id,
                                        {
                                          defaultDurationSec: asset.defaultDurationSec,
                                          defaultSourceStartSec: asset.defaultSourceStartSec,
                                          defaultSourceEndSec: asset.defaultSourceEndSec,
                                          defaultPlaybackRate: asset.defaultPlaybackRate,
                                          defaultTransitionOut: asset.defaultTransitionOut,
                                          defaultClipAudioMuted: asset.defaultClipAudioMuted,
                                        },
                                        true
                                      )
                                    }
                                    className="px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-[10px] font-medium text-emerald-200 cursor-pointer"
                                  >
                                    {t.binApplyPlacedBtn}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Beat Auto-Clip Generator with Presets, Modes & Settings */}
                  <div className="rounded-lg border border-amber-500/35 bg-[#151A25] p-2.5 space-y-2 mt-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-[11px] font-semibold text-amber-300 flex items-center gap-1.5">
                          <Shuffle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{t.binAutoClipTitle}</span>
                          {audio && activeDisplayBpm > 0 && (
                            <span className="px-1 py-0.2 rounded bg-[#0B0D11] border border-[#262B38] text-[9.5px] font-mono text-cyan-300 shrink-0">
                              {activeDisplayBpm} BPM
                            </span>
                          )}
                        </h3>
                        <p className="text-[10px] text-gray-400 leading-snug mt-0.5">
                          {autoClipCfg.mode === 'auto_rhythm'
                            ? t.autoClipModeHintAuto
                            : autoClipCfg.mode === 'sequential'
                              ? t.autoClipModeHintSeq
                              : t.autoClipModeHintRandom}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAutoSettingsOpen((v) => !v)}
                        title={t.autoClipSettingsToggle}
                        aria-expanded={autoSettingsOpen}
                        className={`p-1 rounded border text-[10px] cursor-pointer shrink-0 transition-colors ${
                          autoSettingsOpen
                            ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                            : 'border-[#262B38] bg-[#0E1016] text-gray-400 hover:text-gray-200 hover:border-gray-500'
                        }`}
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>

                    {/* Detected Musical Composition Bar (clickable to seek) */}
                    {songStructure && songStructure.segments.length > 0 && audio && (
                      <div className="space-y-1 rounded border border-[#262B38] bg-[#0B0D11]/80 px-2 py-1.5">
                        <div className="flex items-center justify-between text-[9.5px] text-gray-400">
                          <span>{t.songStructureTitle}</span>
                          <span className="text-[9px] text-gray-500">
                            {t.songStructureSeekHint} ·{' '}
                            <span className="font-mono">{songStructure.segments.length}</span>
                          </span>
                        </div>
                        <div className="flex h-2.5 w-full rounded overflow-hidden bg-[#141821] gap-[1px]">
                          {(() => {
                            const totalSpan = Math.max(
                              0.5,
                              songStructure.segments[songStructure.segments.length - 1].endSec -
                                songStructure.segments[0].startSec
                            );
                            const localNow = Math.max(0, currentTime - (config.trimStart || 0));
                            return songStructure.segments.map((seg, sIdx) => {
                              const pct = Math.max(
                                2,
                                ((seg.endSec - seg.startSec) / totalSpan) * 100
                              );
                              const isCurrentSeg =
                                localNow >= seg.startSec && localNow < seg.endSec;
                              return (
                                <button
                                  key={`${seg.type}-${sIdx}`}
                                  type="button"
                                  onClick={() =>
                                    onSeekAbsolute?.(Math.max(0, (config.trimStart || 0) + seg.startSec))
                                  }
                                  style={{ width: `${pct}%` }}
                                  title={`${sectionLabel(seg.type)} (${seg.startSec.toFixed(1)}s–${seg.endSec.toFixed(1)}s)`}
                                  className={`h-full ${sectionColorClass(seg.type)} transition-opacity cursor-pointer ${
                                    isCurrentSeg
                                      ? 'opacity-100 ring-1 ring-inset ring-white/80'
                                      : 'opacity-80 hover:opacity-100'
                                  }`}
                                />
                              );
                            });
                          })()}
                        </div>
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-gray-400">
                          {Array.from(new Set(songStructure.segments.map((s) => s.type))).map(
                            (secType) => (
                              <span key={secType} className="inline-flex items-center gap-1">
                                <span
                                  className={`w-2 h-2 rounded-xs ${sectionColorClass(secType)}`}
                                />
                                {sectionLabel(secType)}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {/* Quick Auto-Clip Presets */}
                    <div className="space-y-1">
                      <span className="text-[9.5px] uppercase tracking-wider text-gray-500 font-medium block">
                        {t.autoClipPresetsLabel}
                      </span>
                      <div className="grid grid-cols-4 gap-1">
                        {AUTO_CLIP_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => applyAutoClipPreset(preset.id)}
                            className={`py-1 px-1 rounded border text-[9.5px] font-medium cursor-pointer truncate transition-colors ${
                              autoClipCfg.presetId === preset.id
                                ? 'border-amber-400/90 bg-amber-500/20 text-amber-200'
                                : 'border-[#262B38] bg-[#0E1016] text-gray-300 hover:border-gray-500'
                            }`}
                          >
                            {presetLabel(preset.id)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 3 Auto-Creation Modes */}
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          { id: 'auto_rhythm', label: t.autoClipModeAutoRhythm },
                          { id: 'sequential', label: t.autoClipModeSequential },
                          { id: 'random', label: t.autoClipModeRandom },
                        ] as { id: AutoClipMode; label: string }[]
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() =>
                            setAutoClipCfg((prev) => ({
                              ...prev,
                              mode: m.id,
                              editorialProfile: undefined,
                              shuffleOrder: m.id !== 'sequential',
                              presetId: undefined,
                            }))
                          }
                          className={`py-1 px-1 rounded border text-[10px] font-semibold cursor-pointer truncate ${
                            autoClipCfg.mode === m.id
                              ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                              : 'border-[#262B38] bg-[#0E1016] text-gray-300 hover:border-gray-500'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>

                    {/* Optional Timeline Slice Shuffle Toggle (Sequential vs Shuffled on Timeline) */}
                    <label className="flex items-center justify-between text-[10px] text-gray-300 cursor-pointer px-0.5 pt-0.5">
                      <span>{t.autoClipShuffleOrderLabel}</span>
                      <input
                        type="checkbox"
                        checked={autoClipCfg.shuffleOrder}
                        onChange={(e) =>
                          setAutoClipCfg((prev) => ({
                            ...prev,
                            shuffleOrder: e.target.checked,
                            presetId: undefined,
                          }))
                        }
                        className="accent-amber-500 w-3.5 h-3.5 rounded cursor-pointer"
                      />
                    </label>

                    {/* Pacing Options */}
                    <div className="grid grid-cols-5 gap-1">
                      {(
                        [
                          { id: 'auto', label: t.autoClipPaceAuto },
                          { id: 'smooth', label: t.autoClipPaceSmooth },
                          { id: 'beats_2', label: t.autoClipPace2Beats },
                          { id: 'beats_4', label: t.autoClipPace4Beats },
                          { id: 'beats_1', label: t.autoClipPace1Beat },
                        ] as { id: AutoClipRhythm; label: string }[]
                      ).map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            const nextBounds = getDefaultBoundsForAutoClipRhythm(r.id);
                            setAutoClipCfg((prev) => ({
                              ...prev,
                              rhythm: r.id,
                              minClipSec: nextBounds.minClipSec,
                              maxClipSec: nextBounds.maxClipSec,
                              presetId: undefined,
                            }));
                          }}
                          className={`py-1 px-0.5 rounded border text-[9.5px] font-medium cursor-pointer truncate ${
                            autoClipCfg.rhythm === r.id
                              ? 'border-cyan-500/80 bg-cyan-500/15 text-cyan-200'
                              : 'border-[#262B38] bg-[#0E1016] text-gray-400 hover:border-gray-500'
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>

                    {/* Target Mode: Replace vs Append (prevents overwriting / squeezing existing timeline edits) */}
                    {mediaItems.length > 0 && (
                      <div className="grid grid-cols-2 gap-1">
                        {(
                          [
                            { id: 'replace', label: t.autoClipTargetReplace },
                            { id: 'append', label: t.autoClipTargetAppend },
                          ] as { id: AutoClipTargetMode; label: string }[]
                        ).map((tm) => (
                          <button
                            key={tm.id}
                            type="button"
                            onClick={() =>
                              setAutoClipCfg((prev) => ({ ...prev, targetMode: tm.id }))
                            }
                            className={`py-1 px-1.5 rounded border text-[10px] font-medium cursor-pointer truncate ${
                              autoClipCfg.targetMode === tm.id
                                ? 'border-emerald-500/80 bg-emerald-500/15 text-emerald-200'
                                : 'border-[#262B38] bg-[#0E1016] text-gray-400 hover:border-gray-500'
                            }`}
                          >
                            {tm.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Expandable Fine Settings */}
                    {autoSettingsOpen && (
                      <div className="rounded-md border border-[#262B38] bg-[#0E1016] p-2 space-y-2">
                        {/* Transition Style */}
                        <div className="space-y-1">
                          <span className="text-[10px] text-gray-400 block">
                            {t.autoClipTransLabel}
                          </span>
                          <div className="grid grid-cols-4 gap-1">
                            {(
                              [
                                { id: 'musical', label: t.autoClipTransMusical },
                                { id: 'dissolve', label: t.autoClipTransDissolve },
                                { id: 'cuts_only', label: t.autoClipTransCutsOnly },
                                { id: 'punchy', label: t.autoClipTransPunchy },
                              ] as { id: AutoClipTransitionStyle; label: string }[]
                            ).map((tr) => (
                              <button
                                key={tr.id}
                                type="button"
                                onClick={() =>
                                  setAutoClipCfg((prev) => ({
                                    ...prev,
                                    transitionStyle: tr.id,
                                    presetId: undefined,
                                  }))
                                }
                                className={`py-1 px-1 rounded border text-[9.5px] cursor-pointer truncate ${
                                  autoClipCfg.transitionStyle === tr.id
                                    ? 'border-amber-400/80 bg-amber-500/15 text-amber-200'
                                    : 'border-[#262B38] bg-[#141821] text-gray-400 hover:border-gray-500'
                                }`}
                              >
                                {tr.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Motion Level */}
                        <div className="space-y-1">
                          <span className="text-[10px] text-gray-400 block">
                            {t.autoClipMotionLabel}
                          </span>
                          <div className="grid grid-cols-3 gap-1">
                            {(
                              [
                                { id: 'off', label: t.autoClipMotionOff },
                                { id: 'gentle', label: t.autoClipMotionGentle },
                                { id: 'dynamic', label: t.autoClipMotionDynamic },
                              ] as { id: AutoClipMotionLevel; label: string }[]
                            ).map((ml) => (
                              <button
                                key={ml.id}
                                type="button"
                                onClick={() =>
                                  setAutoClipCfg((prev) => ({
                                    ...prev,
                                    motionLevel: ml.id,
                                    presetId: undefined,
                                  }))
                                }
                                className={`py-1 px-1 rounded border text-[9.5px] cursor-pointer truncate ${
                                  autoClipCfg.motionLevel === ml.id
                                    ? 'border-cyan-500/80 bg-cyan-500/15 text-cyan-200'
                                    : 'border-[#262B38] bg-[#141821] text-gray-400 hover:border-gray-500'
                                }`}
                              >
                                {ml.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Media Mix Priority */}
                        <div className="space-y-1">
                          <span className="text-[10px] text-gray-400 block">
                            {t.autoClipMediaMixLabel}
                          </span>
                          <div className="grid grid-cols-3 gap-1">
                            {(
                              [
                                { id: 'auto', label: t.autoClipMixAuto },
                                { id: 'video_first', label: t.autoClipMixVideoFirst },
                                { id: 'photo_beats', label: t.autoClipMixPhotoBeats },
                              ] as { id: AutoClipMediaPriority; label: string }[]
                            ).map((mp) => (
                              <button
                                key={mp.id}
                                type="button"
                                onClick={() =>
                                  setAutoClipCfg((prev) => ({
                                    ...prev,
                                    mediaPriority: mp.id,
                                  }))
                                }
                                className={`py-1 px-1 rounded border text-[9.5px] cursor-pointer truncate ${
                                  (autoClipCfg.mediaPriority ?? 'auto') === mp.id
                                    ? 'border-emerald-500/80 bg-emerald-500/15 text-emerald-200'
                                    : 'border-[#262B38] bg-[#141821] text-gray-400 hover:border-gray-500'
                                }`}
                              >
                                {mp.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Min & Max Clip Duration Sliders */}
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block space-y-0.5">
                            <div className="flex justify-between text-[9.5px] text-gray-400">
                              <span>{t.autoClipMinDurLabel}</span>
                              <span className="font-mono text-gray-200">
                                {autoClipCfg.minClipSec.toFixed(1)}s
                              </span>
                            </div>
                            <input
                              type="range"
                              min={0.5}
                              max={8.0}
                              step={0.5}
                              value={Math.min(8.0, autoClipCfg.minClipSec)}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setAutoClipCfg((prev) => ({
                                  ...prev,
                                  minClipSec: val,
                                  maxClipSec: Math.max(prev.maxClipSec, Number((val + 0.5).toFixed(1))),
                                  presetId: undefined,
                                }));
                              }}
                              className="w-full studio-slider"
                            />
                          </label>
                          <label className="block space-y-0.5">
                            <div className="flex justify-between text-[9.5px] text-gray-400">
                              <span>{t.autoClipMaxDurLabel}</span>
                              <span className="font-mono text-gray-200">
                                {autoClipCfg.maxClipSec.toFixed(1)}s
                              </span>
                            </div>
                            <input
                              type="range"
                              min={2.0}
                              max={24.0}
                              step={0.5}
                              value={Math.min(24.0, autoClipCfg.maxClipSec)}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setAutoClipCfg((prev) => ({
                                  ...prev,
                                  maxClipSec: val,
                                  minClipSec: Math.min(prev.minClipSec, Number((val - 0.5).toFixed(1))),
                                  presetId: undefined,
                                }));
                              }}
                              className="w-full studio-slider"
                            />
                          </label>
                        </div>

                        {/* Duration Span Limit */}
                        <div className="space-y-1">
                          <span className="text-[10px] text-gray-400 block">
                            {t.autoClipSpanLabel}
                          </span>
                          <div className="grid grid-cols-4 gap-1">
                            {(
                              [
                                { val: null, label: t.autoClipSpanFull },
                                { val: 15, label: '15s' },
                                { val: 30, label: '30s' },
                                { val: 60, label: '60s' },
                              ] as { val: number | null; label: string }[]
                            ).map((sp) => (
                              <button
                                key={String(sp.val)}
                                type="button"
                                onClick={() =>
                                  setAutoClipCfg((prev) => ({ ...prev, targetDurationSec: sp.val }))
                                }
                                className={`py-1 px-1 rounded border text-[9.5px] cursor-pointer truncate ${
                                  autoClipCfg.targetDurationSec === sp.val
                                    ? 'border-amber-400/80 bg-amber-500/15 text-amber-200'
                                    : 'border-[#262B38] bg-[#141821] text-gray-400 hover:border-gray-500'
                                }`}
                              >
                                {sp.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Beat-Centered Transitions */}
                        <label className="flex items-center justify-between text-[10px] text-gray-300 cursor-pointer pt-0.5">
                          <span>{t.autoClipCenteredTransLabel}</span>
                          <input
                            type="checkbox"
                            checked={
                              autoClipCfg.beatCenteredTransitions ??
                              config.beatCenteredTransitions ??
                              true
                            }
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setAutoClipCfg((prev) => ({
                                ...prev,
                                beatCenteredTransitions: checked,
                              }));
                              onUpdateConfig({ beatCenteredTransitions: checked });
                            }}
                            className="accent-cyan-400 w-3.5 h-3.5 rounded cursor-pointer"
                          />
                        </label>

                        {/* Exclude ±5s Edges */}
                        <label className="flex items-center justify-between text-[10px] text-gray-300 cursor-pointer pt-0.5">
                          <span>{t.autoClipEdgeTrimLabel}</span>
                          <input
                            type="checkbox"
                            checked={(autoClipCfg.excludeEdgeSec ?? 5) > 0}
                            onChange={(e) =>
                              setAutoClipCfg((prev) => ({
                                ...prev,
                                excludeEdgeSec: e.target.checked ? 5 : 0,
                              }))
                            }
                            className="accent-amber-500 w-3.5 h-3.5 rounded cursor-pointer"
                          />
                        </label>

                        {/* Avoid Back-to-Back Repeat */}
                        <label className="flex items-center justify-between text-[10px] text-gray-300 cursor-pointer pt-0.5">
                          <span>{t.autoClipAvoidRepeatLabel}</span>
                          <input
                            type="checkbox"
                            checked={autoClipCfg.avoidAdjacentRepeat}
                            onChange={(e) =>
                              setAutoClipCfg((prev) => ({
                                ...prev,
                                avoidAdjacentRepeat: e.target.checked,
                              }))
                            }
                            className="accent-amber-500 w-3.5 h-3.5 rounded cursor-pointer"
                          />
                        </label>

                        {/* Optional Exhaustion Reuse (OFF by default: strict 1x usage per slice/photo) */}
                        <label className="flex items-center justify-between text-[10px] text-gray-300 cursor-pointer pt-0.5">
                          <span>{t.autoClipAllowReuseLabel}</span>
                          <input
                            type="checkbox"
                            checked={Boolean(autoClipCfg.allowReuseWhenExhausted)}
                            onChange={(e) =>
                              setAutoClipCfg((prev) => ({
                                ...prev,
                                allowReuseWhenExhausted: e.target.checked,
                              }))
                            }
                            className="accent-amber-500 w-3.5 h-3.5 rounded cursor-pointer"
                          />
                        </label>
                      </div>
                    )}

                    {isTimelineFullMusic && autoClipCfg.targetMode === 'append' && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-amber-200 leading-snug">
                          {t.autoClipFullSwitchHint}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setAutoClipCfg((prev) => ({ ...prev, targetMode: 'replace' }))
                          }
                          className="px-2 py-0.5 rounded border border-emerald-500/60 bg-emerald-500/15 hover:bg-emerald-500/25 text-[9.5px] font-semibold text-emerald-200 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {t.autoClipSwitchReplaceBtn}
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleTriggerAutoClipGenerate}
                      className="w-full py-1.5 px-3 rounded-md border border-amber-500/70 bg-amber-500/18 hover:bg-amber-500/28 text-xs font-semibold text-amber-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                      <span>
                        {mediaItems.length > 0 && autoClipCfg.targetMode === 'append'
                          ? t.autoClipAppendBtn
                          : variationTake > 1
                            ? t.autoClipVariantBtn
                            : t.binAutoClipBtn}
                      </span>
                      {variationTake > 1 && (
                        <span className="px-1.5 py-0.2 rounded bg-[#0B0D11]/80 border border-amber-400/45 text-[9.5px] font-mono text-amber-300">
                          {t.autoClipVariantBadge} #{variationTake}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Generative 3D/Shader Scenes Quick-Add */}
            <section className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold text-gray-100 flex items-center gap-1.5 min-w-0">
                  <Orbit className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t.binScenesTitle}</span>
                </h2>
                {mediaItems.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearVisuals}
                    className="text-[11px] text-gray-400 hover:text-rose-400 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {t.clearVisuals}
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <select
                    value={genToAdd}
                    onChange={(e) =>
                      setGenToAdd(e.target.value as Exclude<GeneratorEffectId, 'none'>)
                    }
                    aria-label={t.clipGeneratorSceneLabel}
                    className="flex-1 min-w-0 rounded-md bg-[#141821] border border-[#262B38] px-2 py-1.5 text-xs text-gray-100 focus:border-amber-500 focus:outline-none"
                  >
                    {GENERATOR_EFFECTS.filter((g) => g.id !== 'none').map((g) => (
                      <option key={g.id} value={g.id}>
                        {lang === 'ru' ? g.nameRu : g.nameEn}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onAddGeneratorScene(genToAdd)}
                    className="py-1.5 px-2.5 rounded-md border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-xs font-medium text-amber-300 transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Orbit className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{t.addSelectedGenBtn}</span>
                  </button>
                </div>

                {config.generatorEffect !== 'none' && (
                  <button
                    type="button"
                    onClick={() =>
                      onAddGeneratorScene(
                        config.generatorEffect as Exclude<GeneratorEffectId, 'none'>,
                        true
                      )
                    }
                    className="w-full py-1.5 px-2.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-amber-500/50 text-[11px] font-medium text-gray-300 hover:text-amber-300 transition-colors cursor-pointer truncate"
                  >
                    {t.addActiveFxSceneBtn}
                  </button>
                )}
              </div>
            </section>
          </>
        )}

        {panelTab === 'layers' && (
          <>
            {/* Subtitles (SRT / VTT) */}
            <section className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-gray-100 flex items-center gap-1.5">
                  <Subtitles className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  <span>
                    {t.subtitlesTitle}
                    {config.subtitles.length > 0 ? ` (${config.subtitles.length})` : ''}
                  </span>
                </h2>
              </div>

              <input
                ref={srtInputRef}
                type="file"
                accept=".srt,.vtt,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    file.text().then((txt) => {
                      onImportSubtitlesText(txt);
                    });
                  }
                  e.target.value = '';
                }}
              />

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => srtInputRef.current?.click()}
                  className="py-1.5 px-2 rounded border border-[#262B38] bg-[#141821] hover:border-gray-500 text-[11px] font-medium text-gray-200 cursor-pointer truncate"
                >
                  {t.importSrtBtn}
                </button>
                <button
                  type="button"
                  onClick={onAddCueAtPlayhead}
                  className="py-1.5 px-2 rounded border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-[11px] font-medium text-amber-300 cursor-pointer truncate"
                >
                  {t.addCueAtPlayheadBtn}
                </button>
              </div>

              <textarea
                rows={2}
                value={srtDraft}
                onChange={(e) => setSrtDraft(e.target.value)}
                onBlur={() => {
                  if (srtDraft.trim()) {
                    onImportSubtitlesText(srtDraft);
                    setSrtDraft('');
                  }
                }}
                placeholder={t.pasteSrtPlaceholder}
                className="w-full rounded bg-[#141821] border border-[#262B38] px-2.5 py-1.5 text-[11px] font-mono text-gray-200 focus:border-amber-500 focus:outline-none"
              />

              <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer">
                <span>{t.showSubtitlesLabel}</span>
                <input
                  type="checkbox"
                  checked={config.showSubtitles}
                  onChange={(e) => onUpdateConfig({ showSubtitles: e.target.checked })}
                  className="accent-amber-500 w-4 h-4 rounded cursor-pointer"
                />
              </label>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-400">{t.subtitleSizeLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {Math.round(config.subtitleSizeScale * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={1.6}
                  step={0.05}
                  value={config.subtitleSizeScale}
                  onChange={(e) => onUpdateConfig({ subtitleSizeScale: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              {config.subtitles.length > 0 && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                  {config.subtitles.map((cue) => (
                    <div
                      key={cue.id}
                      className="rounded border border-[#262B38] bg-[#141821] p-1.5 space-y-1"
                    >
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={cue.text}
                          onChange={(e) => onUpdateSubtitleCue(cue.id, { text: e.target.value })}
                          className="flex-1 min-w-0 bg-transparent text-[11px] text-gray-100 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => onRemoveSubtitleCue(cue.id)}
                          aria-label="Remove subtitle"
                          className="p-0.5 text-gray-500 hover:text-rose-400 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums text-amber-400/90">
                        <NumericDraftInput
                          value={cue.startSec}
                          min={0}
                          max={3600}
                          step={0.1}
                          decimals={2}
                          onCommit={(nextStart) => {
                            const nextEnd = Math.max(nextStart + 0.2, cue.endSec);
                            onUpdateSubtitleCue(cue.id, {
                              startSec: Number(nextStart.toFixed(2)),
                              endSec: Number(nextEnd.toFixed(2)),
                            });
                          }}
                          className="w-14 rounded bg-[#0E1016] border border-[#262B38] px-1 py-0.5 text-amber-300"
                        />
                        <span className="text-gray-500">→</span>
                        <NumericDraftInput
                          value={cue.endSec}
                          min={Number((cue.startSec + 0.2).toFixed(2))}
                          max={3600}
                          step={0.1}
                          decimals={2}
                          onCommit={(nextEnd) => {
                            const clampedEnd = Math.max(cue.startSec + 0.2, nextEnd);
                            onUpdateSubtitleCue(cue.id, {
                              endSec: Number(clampedEnd.toFixed(2)),
                            });
                          }}
                          className="w-14 rounded bg-[#0E1016] border border-[#262B38] px-1 py-0.5 text-amber-300"
                        />
                        <span className="text-gray-500">s</span>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={onExportSrt}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400 hover:text-amber-300 cursor-pointer"
                    >
                      <Download className="w-3 h-3" aria-hidden="true" />
                      <span>{t.exportSrtBtn}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateConfig({ subtitles: [] })}
                      className="text-[11px] text-rose-400 hover:text-rose-300 cursor-pointer"
                    >
                      {t.clearSubsBtn}
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Overlay Layers */}
            <section className="p-3.5 space-y-2.5">
              <h2 className="text-xs font-semibold text-gray-100 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span>
                  {t.overlaysTitle}
                  {config.overlays.length > 0 ? ` (${config.overlays.length})` : ''}
                </span>
              </h2>

              <input
                ref={overlayImgInputRef}
                type="file"
                accept="image/png,image/webp,image/svg+xml,image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onAddImageOverlay(file);
                  e.target.value = '';
                }}
              />

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={onAddTextOverlay}
                  className="py-1.5 px-2 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[11px] font-medium text-gray-200 cursor-pointer truncate"
                >
                  {t.addTextOverlayBtn}
                </button>
                <button
                  type="button"
                  onClick={() => overlayImgInputRef.current?.click()}
                  className="py-1.5 px-2 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[11px] font-medium text-gray-200 cursor-pointer truncate"
                >
                  {t.addImageOverlayBtn}
                </button>
              </div>

              {config.overlays.map((ov) => (
                <div
                  key={ov.id}
                  className="rounded border border-[#262B38] bg-[#141821] p-2 space-y-2"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    {ov.kind === 'text' ? (
                      <input
                        type="text"
                        value={ov.text || ''}
                        onChange={(e) => onUpdateOverlay(ov.id, { text: e.target.value })}
                        className="flex-1 min-w-0 rounded bg-[#0E1016] border border-[#262B38] px-2 py-1 text-xs text-gray-100"
                      />
                    ) : (
                      <span className="text-xs text-gray-200 truncate flex-1">{ov.label}</span>
                    )}
                    <button
                      type="button"
                      title={t.overlayDuplicateBtn}
                      aria-label={t.overlayDuplicateBtn}
                      onClick={() => {
                        const copy: OverlayLayer = {
                          ...ov,
                          id: `ov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                          imageBlobKey:
                            ov.kind === 'image'
                              ? ov.imageBlobKey || `overlay-${ov.id}`
                              : ov.imageBlobKey,
                          xPct: Math.min(0.92, ov.xPct + 0.04),
                          yPct: Math.min(0.92, ov.yPct + 0.04),
                        };
                        onUpdateConfig({ overlays: [...config.overlays, copy] });
                      }}
                      className="p-1 text-gray-400 hover:text-amber-300 cursor-pointer shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveOverlay(ov.id)}
                      aria-label="Remove layer"
                      className="p-1 text-gray-400 hover:text-rose-400 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <label className="space-y-0.5 block">
                      <span className="text-[10px] text-gray-400">X {Math.round(ov.xPct * 100)}%</span>
                      <input
                        type="range"
                        min={0.05}
                        max={0.95}
                        step={0.02}
                        value={ov.xPct}
                        onChange={(e) => onUpdateOverlay(ov.id, { xPct: Number(e.target.value) })}
                        className="w-full studio-slider"
                      />
                    </label>
                    <label className="space-y-0.5 block">
                      <span className="text-[10px] text-gray-400">Y {Math.round(ov.yPct * 100)}%</span>
                      <input
                        type="range"
                        min={0.05}
                        max={0.95}
                        step={0.02}
                        value={ov.yPct}
                        onChange={(e) => onUpdateOverlay(ov.id, { yPct: Number(e.target.value) })}
                        className="w-full studio-slider"
                      />
                    </label>
                    <label className="space-y-0.5 block">
                      <span className="text-[10px] text-gray-400">{ov.scale.toFixed(1)}×</span>
                      <input
                        type="range"
                        min={0.4}
                        max={2.4}
                        step={0.1}
                        value={ov.scale}
                        onChange={(e) => onUpdateOverlay(ov.id, { scale: Number(e.target.value) })}
                        className="w-full studio-slider"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-0.5 block">
                      <span className="text-[10px] text-gray-400">
                        α {Math.round(ov.opacity * 100)}%
                      </span>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={ov.opacity}
                        onChange={(e) => onUpdateOverlay(ov.id, { opacity: Number(e.target.value) })}
                        className="w-full studio-slider"
                      />
                    </label>
                    <label className="space-y-0.5 block">
                      <span className="text-[10px] text-gray-400">
                        {t.overlayFadeSecLabel} {(ov.fadeSec ?? 0).toFixed(2)}s
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={ov.fadeSec ?? 0}
                        onChange={(e) => onUpdateOverlay(ov.id, { fadeSec: Number(e.target.value) })}
                        className="w-full studio-slider"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#262B38]/60">
                    <label className="space-y-0.5 block">
                      <span className="text-[10px] text-gray-400">{t.overlayStartSecLabel}</span>
                      <NumericDraftInput
                        value={ov.startSec}
                        min={0}
                        max={600}
                        step={0.2}
                        decimals={1}
                        allowEmpty
                        placeholder="0"
                        onCommitEmpty={() => onUpdateOverlay(ov.id, { startSec: undefined })}
                        onCommit={(val) => onUpdateOverlay(ov.id, { startSec: Math.max(0, val) })}
                        className="w-full rounded bg-[#0E1016] border border-[#262B38] px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-gray-200"
                      />
                    </label>
                    <label className="space-y-0.5 block">
                      <span className="text-[10px] text-gray-400">
                        {t.overlayDurSecLabel}
                      </span>
                      <NumericDraftInput
                        value={ov.durationSec}
                        min={0}
                        max={600}
                        step={0.2}
                        decimals={1}
                        allowEmpty
                        placeholder={t.overlayWholeVideoHint}
                        onCommitEmpty={() => onUpdateOverlay(ov.id, { durationSec: undefined })}
                        onCommit={(val) => {
                          if (val <= 0) {
                            onUpdateOverlay(ov.id, { durationSec: undefined });
                          } else {
                            onUpdateOverlay(ov.id, {
                              startSec: ov.startSec ?? 0,
                              durationSec: Math.max(0.4, val),
                            });
                          }
                        }}
                        className="w-full rounded bg-[#0E1016] border border-[#262B38] px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-gray-200"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </section>
          </>
        )}

        {panelTab === 'timing' && (
          <>
            {/* Framing & Motion */}
            <section className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 font-medium">{t.framingLabel}</span>
                <div className="inline-flex rounded-md bg-[#141821] p-0.5 border border-[#262B38]">
                  {(['cover', 'fit_blur'] as MediaFramingMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onUpdateConfig({ framingMode: mode })}
                      className={`px-2 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                        config.framingMode === mode
                          ? 'bg-[#262B38] text-gray-100'
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {mode === 'cover' ? t.framingCover : t.framingFitBlur}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer py-0.5">
                <span>{t.kenBurnsLabel}</span>
                <input
                  type="checkbox"
                  checked={config.kenBurnsMotion}
                  onChange={(e) => onUpdateConfig({ kenBurnsMotion: e.target.checked })}
                  className="accent-amber-500 w-4 h-4 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer py-0.5">
                <span>{t.stabilizeMotionLabel}</span>
                <input
                  type="checkbox"
                  checked={Boolean(config.stabilizeMotion)}
                  onChange={(e) => onUpdateConfig({ stabilizeMotion: e.target.checked })}
                  className="accent-cyan-500 w-4 h-4 rounded cursor-pointer"
                />
              </label>
            </section>

            {/* Timeline Sequencing */}
            <section className="p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  <span>{t.sequenceSectionTitle}</span>
                </h3>
                {mediaItems.length > 0 && (
                  <span className="text-[11px] font-mono tabular-nums text-gray-400">
                    {t.seqDurationBadge}:{' '}
                    {(audio
                      ? Math.min(
                          Math.max(0.5, config.trimEnd - config.trimStart),
                          getTimelineSpanSec(mediaItems, config)
                        )
                      : getTimelineSpanSec(mediaItems, config)
                    ).toFixed(1)}
                    s
                  </span>
                )}
              </div>

              {mediaItems.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {audio && (
                    <>
                      <button
                        type="button"
                        onClick={() => onAutoBeatSyncClips('fit_track', syncWithMotion)}
                        title={t.autoBeatSyncHint}
                        className="w-full py-1.5 px-2.5 rounded border border-amber-500/60 bg-amber-500/15 hover:bg-amber-500/25 text-[11px] font-semibold text-amber-300 cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t.autoBeatSyncBtn}</span>
                        {trackBpm > 0 && (
                          <span className="font-mono text-[10px] px-1 py-0.2 rounded bg-[#0B0D11]/80 text-amber-200">
                            {trackBpm} {t.detectedBpmLabel}
                          </span>
                        )}
                      </button>
                      <div className="w-full grid grid-cols-3 gap-1">
                        {(
                          [
                            { id: 'beats_2', label: t.beatSync2Beats },
                            { id: 'beats_4', label: t.beatSync4Beats },
                            { id: 'beats_8', label: t.beatSync8Beats },
                          ] as { id: BeatSyncMode; label: string }[]
                        ).map((bm) => (
                          <button
                            key={bm.id}
                            type="button"
                            onClick={() => onAutoBeatSyncClips(bm.id, syncWithMotion)}
                            className="py-1 px-1.5 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[10px] font-medium text-gray-300 hover:text-amber-300 cursor-pointer truncate"
                          >
                            {bm.label}
                          </button>
                        ))}
                      </div>
                      <label className="w-full flex items-center justify-between text-[11px] text-gray-300 cursor-pointer py-0.5">
                        <span>{t.beatSyncAutoMotion}</span>
                        <input
                          type="checkbox"
                          checked={syncWithMotion}
                          onChange={(e) => setSyncWithMotion(e.target.checked)}
                          className="accent-amber-500 w-3.5 h-3.5 rounded cursor-pointer"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={onFitClipsToAudio}
                        className="flex-1 py-1 px-2 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[11px] font-medium text-amber-400 cursor-pointer whitespace-nowrap"
                      >
                        {t.fitClipsToAudioBtn}
                      </button>
                      <button
                        type="button"
                        onClick={onFitTrimToClips}
                        className="flex-1 py-1 px-2 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[11px] font-medium text-gray-300 hover:text-amber-300 cursor-pointer whitespace-nowrap"
                      >
                        {t.fitTrimToClipsBtn}
                      </button>
                    </>
                  )}
                  {mediaItems.length > 1 && (
                    <button
                      type="button"
                      onClick={onReverseClips}
                      className="inline-flex items-center gap-1 py-1 px-2.5 rounded border border-[#262B38] bg-[#141821] hover:border-gray-500 text-[11px] font-medium text-gray-300 cursor-pointer whitespace-nowrap"
                    >
                      <ArrowLeftRight className="w-3 h-3" aria-hidden="true" />
                      <span>{t.reverseClipsBtn}</span>
                    </button>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => onUpdateConfig({ slideshowMode: 'manual' })}
                  className={`col-span-2 py-1.5 px-2 rounded border text-[11px] font-semibold cursor-pointer truncate ${
                    config.slideshowMode === 'manual'
                      ? 'border-amber-500/80 bg-amber-500/15 text-amber-300'
                      : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                  }`}
                >
                  {t.slideshowManual}
                </button>
                {(
                  [
                    { id: 'custom_durations', label: t.slideshowCustom },
                    { id: 'even', label: t.slideshowEven },
                    { id: 'fixed', label: t.slideshowFixed },
                    { id: 'beat_cut', label: t.slideshowBeatCut },
                  ] as { id: SlideshowMode; label: string }[]
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onUpdateConfig({ slideshowMode: m.id })}
                    className={`py-1.5 px-2 rounded border text-[11px] font-medium cursor-pointer truncate ${
                      config.slideshowMode === m.id
                        ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                        : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {config.slideshowMode === 'manual' && (
                <p className="text-[10.5px] text-amber-200/80 leading-snug bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1.5">
                  {t.manualModeHint}
                </p>
              )}

              {config.slideshowMode === 'fixed' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-400">{t.slideIntervalLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {config.slideDurationSec.toFixed(1)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1.5}
                    max={15}
                    step={0.5}
                    value={config.slideDurationSec}
                    onChange={(e) => onUpdateConfig({ slideDurationSec: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>
              )}

              {config.slideshowMode === 'beat_cut' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-400">{t.minBeatHoldLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {config.minBeatCutSec.toFixed(1)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.8}
                    max={6}
                    step={0.2}
                    value={config.minBeatCutSec}
                    onChange={(e) => onUpdateConfig({ minBeatCutSec: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>
              )}

              {config.slideshowMode !== 'custom_durations' && config.slideshowMode !== 'manual' && (
                <>
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-gray-400 block">{t.transitionTypeLabel}</span>
                    <div className="grid grid-cols-2 gap-1">
                      {(
                        [
                          { id: 'crossfade', label: t.transitionCrossfade },
                          { id: 'zoom_cross', label: t.transitionZoomCross },
                          { id: 'wipe_right', label: t.transitionWipeRight },
                          { id: 'dip_black', label: t.transitionDipBlack },
                          { id: 'slide', label: t.transitionSlide },
                          { id: 'cut', label: t.transitionCut },
                        ] as { id: SlideTransitionType; label: string }[]
                      ).map((tr) => (
                        <button
                          key={tr.id}
                          type="button"
                          onClick={() => onUpdateConfig({ transitionType: tr.id })}
                          className={`py-1.5 px-2 rounded border text-[11px] font-medium cursor-pointer truncate ${
                            config.transitionType === tr.id
                              ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                              : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                          }`}
                        >
                          {tr.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {config.transitionType !== 'cut' && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-400">{t.transitionDurationLabel}</span>
                        <span className="font-mono tabular-nums text-gray-200">
                          {config.transitionDurationSec.toFixed(2)}s
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.15}
                        max={2.0}
                        step={0.05}
                        value={config.transitionDurationSec}
                        onChange={(e) =>
                          onUpdateConfig({ transitionDurationSec: Number(e.target.value) })
                        }
                        className="w-full studio-slider"
                      />
                    </div>
                  )}
                </>
              )}
            </section>

            {/* Auto-Trim & Fade Out */}
            <section className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-gray-100 flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  <span>{t.trimSectionTitle}</span>
                </h2>
                {audio && (
                  <span className="text-[11px] font-mono tabular-nums text-gray-400">
                    {formatSec(Math.max(0, config.trimEnd - config.trimStart))}
                  </span>
                )}
              </div>

              {audio && (
                <>
                  <div className="grid grid-cols-3 gap-1">
                    {trimPresets.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onSelectTrimPreset(p.id)}
                        className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer whitespace-nowrap truncate ${
                          config.trimPreset === p.id
                            ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                            : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <label className="block space-y-1">
                      <span className="text-[11px] text-gray-400 block">{t.trimStartLabel}</span>
                      <NumericDraftInput
                        value={config.trimStart}
                        min={0}
                        max={Math.max(0, config.trimEnd - 1)}
                        step={0.5}
                        decimals={1}
                        onCommit={(val) =>
                          onUpdateConfig({
                            trimStart: Math.max(0, Math.min(config.trimEnd - 1, val)),
                            trimPreset: 'custom',
                          })
                        }
                        className="w-full rounded-md bg-[#141821] border border-[#262B38] px-2 py-1 text-xs font-mono tabular-nums text-gray-100 focus:border-amber-500 focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-gray-400 block">{t.trimEndLabel}</span>
                      <NumericDraftInput
                        value={config.trimEnd}
                        min={Math.min(maxDur, config.trimStart + 1)}
                        max={maxDur}
                        step={0.5}
                        decimals={1}
                        onCommit={(val) =>
                          onUpdateConfig({
                            trimEnd: Math.max(config.trimStart + 1, Math.min(maxDur, val)),
                            trimPreset: 'custom',
                          })
                        }
                        className="w-full rounded-md bg-[#141821] border border-[#262B38] px-2 py-1 text-xs font-mono tabular-nums text-gray-100 focus:border-amber-500 focus:outline-none"
                      />
                    </label>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-400">{t.fadeInLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {config.fadeInSec.toFixed(1)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={0.1}
                    value={config.fadeInSec}
                    onChange={(e) => onUpdateConfig({ fadeInSec: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-400">{t.fadeOutLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {config.fadeOutSec.toFixed(1)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={6}
                    step={0.1}
                    value={config.fadeOutSec}
                    onChange={(e) => onUpdateConfig({ fadeOutSec: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>
              </div>

              {audio && (
                <button
                  type="button"
                  onClick={onPreviewFadeOut}
                  className="w-full py-1.5 px-3 rounded-md border border-[#262B38] bg-[#161A24] hover:bg-[#1D2230] text-xs font-medium text-gray-200 transition-colors cursor-pointer"
                >
                  {t.testFadeOutBtn}
                </button>
              )}
            </section>

            {/* Autosave Maintenance */}
            <section className="p-3.5">
              <button
                type="button"
                onClick={onResetAutosave}
                className="w-full py-1.5 px-3 rounded-md border border-[#262B38] bg-[#141821] hover:border-rose-500/50 text-[11px] font-medium text-gray-400 hover:text-rose-300 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" aria-hidden="true" />
                <span>{t.resetProjectBtn}</span>
              </button>
            </section>
          </>
        )}
      </div>

      {previewAsset && (
        <MediaPreviewModal
          key={previewAsset.id}
          lang={lang}
          asset={previewAsset}
          placedCount={(timelineClipsByUrl.get(previewAsset.url) || []).length}
          hasMasterAudio={Boolean(audio)}
          onClose={() => setPreviewBinId(null)}
          onSaveDefaults={onUpdateBinItem}
          onPlaceOnTimeline={(binId, mode) => onAddBinItemToTimeline(binId, { mode })}
        />
      )}
    </aside>
  );
}
