import { AlertTriangle, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InspectorPanel } from './components/InspectorPanel';
import { MediaInputPanel } from './components/MediaInputPanel';
import { PreviewStage } from './components/PreviewStage';
import { TimelineDock } from './components/TimelineDock';
import { TopBar } from './components/TopBar';
import { tFor } from './i18n';
import {
  AudioTrackState,
  BeatPresetId,
  BeatSyncMode,
  ClipOverlayGenerator,
  ExportAspectMode,
  ExportProgressState,
  GeneratorEffectId,
  InspectorTab,
  Language,
  MediaBinItem,
  OverlayBlendMode,
  OverlayLayer,
  SlideTransitionType,
  StudioConfig,
  SubtitleCue,
  TimelineGeneratorOverlay,
  TrimPresetId,
  VisualMediaState,
} from './types/studio';
import {
  alignBeatGridToTime,
  analyzeAudioAtTime,
  AutoClipGenerateConfig,
  buildMonoAudioData,
  clampManualClipMove,
  closeAllManualGapsAndFitBeats,
  closeManualTimelineGap,
  computeAutoBeatAlignedClips,
  computeBeatCutsFromGrid,
  computeBeatCutTimestamps,
  computeClipTimelineSegments,
  computeFadeEnvelope,
  computeWaveformPeaks,
  createSmoothState,
  detectTrackBpmAndBeats,
  dropBinItemIntoManualGap,
  findManualInsertionSlot,
  generateAutoClipPlan,
  generateDemoAudioBuffer,
  getNormalizedManualClipIntervals,
  getTimelineSpanSec,
  insertManualClipAtAnchor,
  moveManualClipGroup,
  resolveActiveSlideshowSlice,
  resolveBeatCutPoints,
  resolveCalibratedBeatGrid,
  resolveSafeVideoSourceRange,
  resizeManualClipDuration,
  snapFxOverlayToBeats,
  snapTimeToBeat,
} from './utils/audioAnalyzer';
import { renderStudioFrame } from './utils/canvasRenderer';
import { parseID3Tags } from './utils/id3Parser';
import { classifyMediaError } from './utils/mediaErrors';
import {
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_STUDIO_CONFIG,
  GENERATOR_EFFECTS,
} from './utils/presets';
import { proceduralShaderEngine } from './utils/proceduralShaders';
import {
  clearProjectIDB,
  loadBlobFromIDB,
  loadProjectFromIDB,
  pruneOrphanedBlobs,
  saveBlobToIDB,
  saveProjectToIDB,
  SerializedProject,
  serializeStudioState,
} from './utils/projectStorage';
import { formatSrtTime, parseSubtitles } from './utils/subtitleParser';
import {
  buildSocialMetadataText,
  exportStudioVideo,
  probeExportCapabilities,
  resolveExportDimensions,
} from './utils/videoExporter';

const ExportModal = lazy(() =>
  import('./components/ExportModal').then((m) => ({ default: m.ExportModal }))
);

const IDLE_EXPORT_STATE: ExportProgressState = {
  phase: 'idle',
  currentFrame: 0,
  totalFrames: 0,
  elapsedMs: 0,
  encoderLabel: '',
  outputFormat: 'mp4',
};

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // 512 MB guard
const MAX_HISTORY_STEPS = 30;
const clipMonoCache = new WeakMap<AudioBuffer, Float32Array>();

function getCachedClipMono(buffer: AudioBuffer): Float32Array {
  let cached = clipMonoCache.get(buffer);
  if (!cached) {
    cached = buildMonoAudioData(buffer);
    clipMonoCache.set(buffer, cached);
  }
  return cached;
}

interface HistorySnapshot {
  config: StudioConfig;
  mediaBin: MediaBinItem[];
  mediaItems: VisualMediaState[];
  selectedClipId: string | null;
  selectedClipIds: string[];
  selectedFxId: string | null;
}

function createItemId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function detachClipVideoElement(video?: HTMLVideoElement): void {
  if (!video) return;
  try {
    video.pause();
    video.muted = true;
    if (video.hasAttribute('src') || video.src) {
      video.removeAttribute('src');
      video.load();
    }
  } catch {
    // ignore cleanup error on detached media element
  }
}

function cloneSnapshot(
  config: StudioConfig,
  mediaBin: MediaBinItem[],
  mediaItems: VisualMediaState[],
  selectedClipId: string | null,
  selectedClipIds: string[],
  selectedFxId: string | null
): HistorySnapshot {
  return {
    config: {
      ...config,
      subtitles: config.subtitles.map((s) => ({ ...s })),
      overlays: config.overlays.map((o) => ({ ...o })),
      manualBeatMarkers: [...config.manualBeatMarkers],
      fxOverlays: (config.fxOverlays || []).map((fx) => ({
        ...fx,
        params: fx.params ? { ...fx.params } : undefined,
      })),
    },
    mediaBin: mediaBin.map((b) => ({ ...b })),
    mediaItems: mediaItems.map((m) => ({
      ...m,
      transform: { ...(m.transform || DEFAULT_CLIP_TRANSFORM) },
      generatorParams: m.generatorParams ? { ...m.generatorParams } : undefined,
      overlayEffect: m.overlayEffect
        ? {
            ...m.overlayEffect,
            params: m.overlayEffect.params ? { ...m.overlayEffect.params } : undefined,
          }
        : undefined,
    })),
    selectedClipId,
    selectedClipIds: [...selectedClipIds],
    selectedFxId,
  };
}

function readStoredPanelBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // ignore
  }
  return fallback;
}

function readStoredPanelWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const num = Number(window.localStorage.getItem(key));
    if (Number.isFinite(num) && num >= min && num <= max) return num;
  } catch {
    // ignore
  }
  return fallback;
}

function insertClipAfterSelection(
  prev: VisualMediaState[],
  newClip: VisualMediaState,
  selectedClipId: string | null
): VisualMediaState[] {
  if (!selectedClipId) return [...prev, newClip];
  const idx = prev.findIndex((m) => m.id === selectedClipId);
  if (idx < 0 || idx === prev.length - 1) return [...prev, newClip];
  const copy = [...prev];
  copy.splice(idx + 1, 0, newClip);
  return copy;
}

function snapshotSegmentDurations(
  items: VisualMediaState[],
  clipDuration: number,
  cfg: StudioConfig,
  beatCuts: number[],
  preserveStartSec = false
): VisualMediaState[] {
  if (items.length === 0) return items;
  if (cfg.slideshowMode === 'manual') {
    const intervals = getNormalizedManualClipIntervals(items);
    const startMap = new Map(intervals.map((iv) => [iv.id, iv.startSec]));
    return items.map((item) => ({
      ...item,
      startSec: Number((startMap.get(item.id) ?? 0).toFixed(2)),
    }));
  }
  if (cfg.slideshowMode === 'custom_durations' && !preserveStartSec) return items;
  const segs = computeClipTimelineSegments(items, clipDuration, cfg, beatCuts);
  return items.map((item, idx) => {
    const seg = segs.find((s) => s.clipIndex === idx && !s.isLoopRepeat);
    if (!seg) return item;
    return {
      ...item,
      startSec: Number(seg.startSec.toFixed(2)),
      durationSec: Math.max(0.5, Number((seg.endSec - seg.startSec).toFixed(2))),
      transitionOut: cfg.transitionType,
    };
  });
}

export default function App() {
  const [lang, setLang] = useState<Language>('en');
  const [activeTab, setActiveTab] = useState<InspectorTab>('effects');
  const [config, setConfig] = useState<StudioConfig>(DEFAULT_STUDIO_CONFIG);

  const [audio, setAudio] = useState<AudioTrackState | null>(null);
  const [mediaBin, setMediaBin] = useState<MediaBinItem[]>([]);
  const [mediaItems, setMediaItems] = useState<VisualMediaState[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [selectedFxId, setSelectedFxId] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [glslError, setGlslError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [exportState, setExportState] = useState<ExportProgressState>(IDLE_EXPORT_STATE);
  const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false });
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [undoToast, setUndoToast] = useState<string | null>(null);
  const [autoTimelineZoomSignal, setAutoTimelineZoomSignal] = useState<{
    nonce: number;
    targetZoom: number;
    focusStartSec?: number;
  } | null>(null);

  const [leftOpen, setLeftOpen] = useState(() =>
    readStoredPanelBool('neuromicon_left_panel_open_v1', true)
  );
  const [rightOpen, setRightOpen] = useState(() =>
    readStoredPanelBool('neuromicon_right_panel_open_v1', true)
  );
  const [leftWidth, setLeftWidth] = useState(() =>
    readStoredPanelWidth('neuromicon_left_panel_w_v1', 310, 260, 420)
  );
  const [rightWidth, setRightWidth] = useState(() =>
    readStoredPanelWidth('neuromicon_right_panel_w_v1', 340, 280, 440)
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const monoDataRef = useRef<Float32Array>(new Float32Array(0));
  const smoothStateRef = useRef(createSmoothState());
  const playStartCtxTimeRef = useRef(0);
  const playStartPerfMsRef = useRef(0);
  const playStartAudioRef = useRef(0);
  const playSessionRef = useRef(0);
  const lastMetronomeBeatRef = useRef(-1);
  const currentTimeRef = useRef(0);
  const isLoopingRef = useRef(false);
  const startPlaybackAtRef = useRef<(sec: number) => void>(() => {});
  const exportAbortRef = useRef<AbortController | null>(null);
  const reducedMotionRef = useRef(false);
  const pendingVideoSeekRef = useRef<WeakMap<HTMLVideoElement, number>>(new WeakMap());
  const pendingSeekHookedRef = useRef<WeakSet<HTMLVideoElement>>(new WeakSet());
  const seekRedrawHookedRef = useRef<WeakSet<HTMLVideoElement>>(new WeakSet());
  const drawOnceRef = useRef<() => void>(() => {});
  const isPlayingRef = useRef(false);

  const configRef = useRef<StudioConfig>(config);
  const mediaBinRef = useRef<MediaBinItem[]>(mediaBin);
  const mediaItemsRef = useRef<VisualMediaState[]>(mediaItems);
  const selectedClipIdRef = useRef<string | null>(selectedClipId);
  const selectedClipIdsRef = useRef<string[]>(selectedClipIds);
  const selectedFxIdRef = useRef<string | null>(selectedFxId);
  const audioRef = useRef<AudioTrackState | null>(audio);
  const langRef = useRef<Language>(lang);
  const errorTimerRef = useRef<number | null>(null);
  const undoToastTimerRef = useRef<number | null>(null);
  const panelDragRef = useRef<{
    side: 'left' | 'right';
    startX: number;
    startW: number;
  } | null>(null);

  // Persistence & History Refs
  const hydratedRef = useRef(false);
  const blobKeyMapRef = useRef<Map<string, string>>(new Map());
  const audioBlobKeyRef = useRef<string | undefined>(undefined);
  const pastRef = useRef<HistorySnapshot[]>([]);
  const futureRef = useRef<HistorySnapshot[]>([]);
  const pendingBaseSnapshotRef = useRef<HistorySnapshot | null>(null);
  const historyDebounceRef = useRef<number | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);

  configRef.current = config;
  mediaBinRef.current = mediaBin;
  mediaItemsRef.current = mediaItems;
  selectedClipIdRef.current = selectedClipId;
  selectedClipIdsRef.current = selectedClipIds;
  selectedFxIdRef.current = selectedFxId;
  audioRef.current = audio;
  langRef.current = lang;
  isLoopingRef.current = isLooping;

  const t = tFor(lang);

  const showError = useCallback((msg: string) => {
    setNoticeError(msg);
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
    }
    errorTimerRef.current = window.setTimeout(() => {
      setNoticeError(null);
      errorTimerRef.current = null;
    }, 6500);
  }, []);

  const showUndoToast = useCallback((msg: string) => {
    setUndoToast(msg);
    if (undoToastTimerRef.current !== null) {
      window.clearTimeout(undoToastTimerRef.current);
    }
    undoToastTimerRef.current = window.setTimeout(() => {
      setUndoToast(null);
      undoToastTimerRef.current = null;
    }, 5000);
  }, []);

  const syncHistoryFlags = useCallback(() => {
    setHistoryFlags({
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
    });
  }, []);

  const pushImmediateHistory = useCallback(() => {
    if (historyDebounceRef.current !== null) {
      window.clearTimeout(historyDebounceRef.current);
      historyDebounceRef.current = null;
    }
    if (pendingBaseSnapshotRef.current) {
      pastRef.current.push(pendingBaseSnapshotRef.current);
      pendingBaseSnapshotRef.current = null;
    }
    pastRef.current.push(
      cloneSnapshot(
        configRef.current,
        mediaBinRef.current,
        mediaItemsRef.current,
        selectedClipIdRef.current,
        selectedClipIdsRef.current,
        selectedFxIdRef.current
      )
    );
    if (pastRef.current.length > MAX_HISTORY_STEPS) {
      pastRef.current.shift();
    }
    futureRef.current = [];
    syncHistoryFlags();
  }, [syncHistoryFlags]);

  const queueDebouncedHistory = useCallback(() => {
    if (!pendingBaseSnapshotRef.current) {
      pendingBaseSnapshotRef.current = cloneSnapshot(
        configRef.current,
        mediaBinRef.current,
        mediaItemsRef.current,
        selectedClipIdRef.current,
        selectedClipIdsRef.current,
        selectedFxIdRef.current
      );
    }
    if (historyDebounceRef.current !== null) {
      window.clearTimeout(historyDebounceRef.current);
    }
    historyDebounceRef.current = window.setTimeout(() => {
      if (pendingBaseSnapshotRef.current) {
        pastRef.current.push(pendingBaseSnapshotRef.current);
        pendingBaseSnapshotRef.current = null;
        if (pastRef.current.length > MAX_HISTORY_STEPS) {
          pastRef.current.shift();
        }
        futureRef.current = [];
        syncHistoryFlags();
      }
      historyDebounceRef.current = null;
    }, 450);
  }, [syncHistoryFlags]);

  const handleUndo = useCallback(() => {
    if (historyDebounceRef.current !== null) {
      window.clearTimeout(historyDebounceRef.current);
      historyDebounceRef.current = null;
    }
    if (pendingBaseSnapshotRef.current) {
      pastRef.current.push(pendingBaseSnapshotRef.current);
      pendingBaseSnapshotRef.current = null;
    }
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(
      cloneSnapshot(
        configRef.current,
        mediaBinRef.current,
        mediaItemsRef.current,
        selectedClipIdRef.current,
        selectedClipIdsRef.current,
        selectedFxIdRef.current
      )
    );
    setConfig(prev.config);
    setMediaBin(prev.mediaBin);
    setMediaItems(prev.mediaItems);
    setSelectedClipId(prev.selectedClipId);
    setSelectedClipIds(prev.selectedClipIds);
    setSelectedFxId(prev.selectedFxId);
    syncHistoryFlags();
  }, [syncHistoryFlags]);

  const handleRedo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(
      cloneSnapshot(
        configRef.current,
        mediaBinRef.current,
        mediaItemsRef.current,
        selectedClipIdRef.current,
        selectedClipIdsRef.current,
        selectedFxIdRef.current
      )
    );
    setConfig(next.config);
    setMediaBin(next.mediaBin);
    setMediaItems(next.mediaItems);
    setSelectedClipId(next.selectedClipId);
    setSelectedClipIds(next.selectedClipIds);
    setSelectedFxId(next.selectedFxId);
    syncHistoryFlags();
  }, [syncHistoryFlags]);

  useEffect(() => {
    try {
      window.localStorage.setItem('neuromicon_left_panel_open_v1', leftOpen ? '1' : '0');
    } catch {
      // ignore
    }
  }, [leftOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem('neuromicon_right_panel_open_v1', rightOpen ? '1' : '0');
    } catch {
      // ignore
    }
  }, [rightOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem('neuromicon_left_panel_w_v1', String(Math.round(leftWidth)));
    } catch {
      // ignore
    }
  }, [leftWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem('neuromicon_right_panel_w_v1', String(Math.round(rightWidth)));
    } catch {
      // ignore
    }
  }, [rightWidth]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!panelDragRef.current) return;
      const { side, startX, startW } = panelDragRef.current;
      if (side === 'left') {
        setLeftWidth(Math.max(260, Math.min(420, startW + (e.clientX - startX))));
      } else {
        setRightWidth(Math.max(280, Math.min(440, startW - (e.clientX - startX))));
      }
    };
    const onPointerUp = () => {
      panelDragRef.current = null;
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

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Clean up object URLs, timers, AudioContext, and WebGL resources on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
      if (undoToastTimerRef.current !== null) window.clearTimeout(undoToastTimerRef.current);
      if (historyDebounceRef.current !== null) window.clearTimeout(historyDebounceRef.current);
      if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
      exportAbortRef.current?.abort();
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
          sourceNodeRef.current.disconnect();
        } catch {
          // ignore
        }
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
      const seen = new Set<string>();
      for (const b of mediaBinRef.current) {
        if (b.url.startsWith('blob:') && !seen.has(b.url)) {
          seen.add(b.url);
          URL.revokeObjectURL(b.url);
        }
      }
      for (const item of mediaItemsRef.current) {
        if (item.kind === 'video' && item.videoElement) item.videoElement.pause();
        if (item.url.startsWith('blob:') && !seen.has(item.url)) {
          seen.add(item.url);
          URL.revokeObjectURL(item.url);
        }
      }
      for (const ov of configRef.current.overlays) {
        if (ov.imageUrl?.startsWith('blob:') && !seen.has(ov.imageUrl)) {
          seen.add(ov.imageUrl);
          URL.revokeObjectURL(ov.imageUrl);
        }
      }
      const coverUrl = audioRef.current?.metadata.embeddedCoverUrl;
      if (coverUrl && coverUrl.startsWith('blob:') && !seen.has(coverUrl)) {
        URL.revokeObjectURL(coverUrl);
      }
      proceduralShaderEngine.dispose();
    };
  }, []);

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new AudioContext({ sampleRate: 48000 });
      } catch {
        audioCtxRef.current = new AudioContext();
      }
    }
    return audioCtxRef.current;
  }, []);


  const getEffectiveTimelineBounds = useCallback(
    (cfg: StudioConfig, items: VisualMediaState[], aud: AudioTrackState | null) => {
      if (aud) {
        const start = cfg.trimStart;
        const end = cfg.trimEnd;
        return {
          trimBase: start,
          trimEnd: end,
          clipDuration: Math.max(0.5, end - start),
          maxSeek: aud.duration,
        };
      }
      const clipDuration = getTimelineSpanSec(items, cfg);
      const workspaceSpan = Math.max(
        24,
        Math.ceil((clipDuration + Math.max(12, clipDuration * 0.35)) / 4) * 4
      );
      return {
        trimBase: 0,
        trimEnd: clipDuration,
        clipDuration,
        maxSeek: workspaceSpan,
      };
    },
    []
  );

  const rawTrackBeatGrid = useMemo(() => {
    if (!audio || monoDataRef.current.length === 0) {
      return { bpm: 0, beatSec: 0.5, beats: [] as number[] };
    }
    return detectTrackBpmAndBeats(
      monoDataRef.current,
      audio.sampleRate,
      config.trimStart,
      config.trimEnd,
      config.beatSensitivity
    );
  }, [audio, config.beatSensitivity, config.trimEnd, config.trimStart]);

  const trackBeatGrid = useMemo(() => {
    const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);
    return resolveCalibratedBeatGrid(rawTrackBeatGrid, clipDuration, {
      mode: config.beatGridMode,
      manualBpm: config.manualBpm,
      offsetSec: config.beatOffsetSec,
      downbeatShift: config.beatDownbeatShift,
    });
  }, [
    config.beatDownbeatShift,
    config.beatGridMode,
    config.beatOffsetSec,
    config.manualBpm,
    config.trimEnd,
    config.trimStart,
    rawTrackBeatGrid,
  ]);

  const trackBeatGridRef = useRef(trackBeatGrid);
  trackBeatGridRef.current = trackBeatGrid;

  useEffect(() => {
    lastMetronomeBeatRef.current = -1;
  }, [trackBeatGrid]);

  // Precompute deterministic beat-cut timestamps (merging manual beat markers when present)
  const beatCutTimestamps = useMemo(() => {
    const bounds = getEffectiveTimelineBounds(config, mediaItems, audio);
    const clipDuration = bounds.clipDuration;
    const hasCalibratedGrid =
      (config.beatGridMode ?? 'auto') !== 'auto' ||
      Math.abs(config.beatOffsetSec ?? 0) > 0.005 ||
      (config.beatDownbeatShift ?? 0) !== 0;
    let autoCuts: number[] = [0];
    if (audio && config.slideshowMode === 'beat_cut' && mediaItems.length > 1) {
      autoCuts = hasCalibratedGrid
        ? computeBeatCutsFromGrid(trackBeatGrid, clipDuration, config.minBeatCutSec)
        : computeBeatCutTimestamps(
            monoDataRef.current,
            audio.sampleRate,
            config.trimStart,
            config.trimEnd,
            config.minBeatCutSec,
            config.beatSensitivity
          );
    }
    return resolveBeatCutPoints(
      autoCuts,
      config.manualBeatMarkers,
      bounds.trimBase,
      clipDuration
    );
  }, [
    audio,
    config,
    getEffectiveTimelineBounds,
    mediaItems,
    trackBeatGrid,
  ]);

  const stopPlayback = useCallback(() => {
    playSessionRef.current++;
    lastMetronomeBeatRef.current = -1;
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore if already stopped
      }
      sourceNodeRef.current = null;
    }
    for (const item of mediaItemsRef.current) {
      if (item.kind === 'video' && item.videoElement) {
        item.videoElement.pause();
        item.videoElement.muted = true;
      }
    }
    smoothStateRef.current = createSmoothState();
    setIsPlaying(false);
  }, []);

  const syncVideosAtLocalTime = useCallback(
    (localTime: number, shouldPlay: boolean) => {
      const items = mediaItemsRef.current;
      if (items.length === 0) return;
      const bounds = getEffectiveTimelineBounds(config, items, audioRef.current);
      const segments = computeClipTimelineSegments(
        items,
        bounds.clipDuration,
        config,
        beatCutTimestamps
      );
      const slice = resolveActiveSlideshowSlice(
        items,
        localTime,
        bounds.clipDuration,
        config,
        beatCutTimestamps
      );
      const activeIds = new Set<string>();
      const activeItem = slice.activeIndex !== null ? items[slice.activeIndex] : undefined;
      if (activeItem) activeIds.add(activeItem.id);
      if (slice.prevIndex !== null && items[slice.prevIndex]) {
        activeIds.add(items[slice.prevIndex].id);
      }

      // Rolling lookahead window: promote active/transitioning + upcoming clips (within 3.2s)
      // to preload='auto' and prewarm next 2 upcoming clips so beat cuts fire cleanly with zero seek lag,
      // while keeping total live WebMediaPlayer instances bounded on long auto-generated timelines.
      const preloadWindowIds = new Set<string>(activeIds);
      const keepAttachedIds = new Set<string>(activeIds);
      const prewarmTargets = new Map<string, number>();
      let upcomingVideoCount = 0;

      for (const s of segments) {
        const dt = s.startSec - localTime;
        if (dt <= 0) {
          if (Math.abs(s.endSec - localTime) <= 6) {
            const recent = items[s.clipIndex];
            if (recent?.kind === 'video') keepAttachedIds.add(recent.id);
          }
          continue;
        }
        const upcoming = items[s.clipIndex];
        if (!upcoming || upcoming.kind !== 'video') continue;
        if (dt <= 3.6 || upcomingVideoCount < 5) {
          preloadWindowIds.add(upcoming.id);
          keepAttachedIds.add(upcoming.id);
          if (!activeIds.has(upcoming.id) && prewarmTargets.size < 4 && dt <= 3.2) {
            const vDur = upcoming.videoDuration || 1;
            const maxSafe = Math.max(0, vDur - 0.04);
            prewarmTargets.set(
              upcoming.id,
              Math.min(maxSafe, Math.max(0, upcoming.sourceStartSec % vDur))
            );
          }
          upcomingVideoCount++;
        } else if (dt <= 10 && keepAttachedIds.size < 16) {
          keepAttachedIds.add(upcoming.id);
        }
        if (keepAttachedIds.size >= 16 && dt > 10) break;
      }

      const totalVideoCount = items.reduce((acc, it) => acc + (it.kind === 'video' ? 1 : 0), 0);
      const enforceDecoderBudget = totalVideoCount > 18;

      items.forEach((item) => {
        if (item.kind !== 'video' || !item.videoElement) return;
        const v = item.videoElement;
        const shouldAttach = !enforceDecoderBudget || keepAttachedIds.has(item.id);

        if (!shouldAttach) {
          detachClipVideoElement(v);
          return;
        }

        if (!v.getAttribute('src') && !v.src && item.url) {
          v.src = item.url;
        }

        const vDur = item.videoDuration || 1;
        const maxSafe = Math.max(0, vDur - 0.04);
        const rate = item.playbackRate || 1;
        const isActive = item.id === activeItem?.id;
        const clipOffset = isActive ? slice.slideLocalTime : slice.prevSlideLocalTime;
        const targetSec = Math.min(maxSafe, Math.max(0, (item.sourceStartSec + clipOffset * rate) % vDur));

        if (preloadWindowIds.has(item.id)) {
          if (v.preload !== 'auto') v.preload = 'auto';
        } else {
          if (v.preload !== 'metadata') v.preload = 'metadata';
        }

        if (Math.abs(v.playbackRate - rate) > 0.01) {
          v.playbackRate = rate;
        }

        if (!seekRedrawHookedRef.current.has(v)) {
          seekRedrawHookedRef.current.add(v);
          const triggerPausedRedraw = () => {
            const pending = pendingVideoSeekRef.current.get(v);
            if (pending !== undefined) {
              pendingVideoSeekRef.current.delete(v);
              const safeDur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : vDur;
              const clamped = Math.min(Math.max(0, safeDur - 0.04), Math.max(0, pending));
              if (Math.abs(v.currentTime - clamped) > 0.04) {
                try {
                  v.currentTime = clamped;
                  return;
                } catch {
                  // fall through to redraw
                }
              }
            }
            if (!isPlayingRef.current) {
              drawOnceRef.current();
            }
          };
          v.addEventListener('seeked', triggerPausedRedraw);
          v.addEventListener('loadeddata', triggerPausedRedraw);
        }

        const applySafeSeek = (sec: number) => {
          if (v.readyState >= 1) {
            if (!v.seeking) {
              pendingVideoSeekRef.current.delete(v);
              v.currentTime = sec;
            } else {
              pendingVideoSeekRef.current.set(v, sec);
            }
          } else {
            pendingVideoSeekRef.current.set(v, sec);
            if (!pendingSeekHookedRef.current.has(v)) {
              pendingSeekHookedRef.current.add(v);
              v.addEventListener(
                'loadedmetadata',
                () => {
                  const pending = pendingVideoSeekRef.current.get(v);
                  if (pending !== undefined) {
                    pendingVideoSeekRef.current.delete(v);
                    const safeDur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : vDur;
                    const clamped = Math.min(Math.max(0, safeDur - 0.04), Math.max(0, pending));
                    try {
                      v.currentTime = clamped;
                    } catch {
                      // ignore seek error on unready source
                    }
                  }
                },
                { once: true }
              );
            }
          }
        };

        const prewarmSec = prewarmTargets.get(item.id);
        if (activeIds.has(item.id)) {
          if (shouldPlay) {
            v.muted = !isActive || item.clipAudioMuted || item.clipAudioVolume <= 0.01;
            v.volume = Math.max(0, Math.min(1, item.clipAudioVolume));
            if (v.paused) {
              if (v.readyState < 1) {
                applySafeSeek(targetSec);
              } else if (Math.abs(v.currentTime - targetSec) > 0.06 && !v.seeking) {
                v.currentTime = targetSec;
              }
              v.play().catch(() => {});
            } else {
              const rawDiff = Math.abs(v.currentTime - targetSec);
              const modDiff = Math.min(rawDiff, Math.max(0, vDur - rawDiff));
              // Only seek on large drift so playback never stutters or flashes seeking frames right after cuts
              if (modDiff > 0.75 && !v.seeking) {
                applySafeSeek(targetSec);
              }
            }
          } else {
            v.muted = true;
            if (!v.paused) v.pause();
            if (v.readyState < 1 || (!v.seeking && Math.abs(v.currentTime - targetSec) > 0.04)) {
              applySafeSeek(targetSec);
            }
          }
        } else if (prewarmSec !== undefined) {
          v.muted = true;
          if (!v.paused) v.pause();
          if (v.readyState < 1 || (!v.seeking && Math.abs(v.currentTime - prewarmSec) > 0.08)) {
            applySafeSeek(prewarmSec);
          }
        } else {
          v.muted = true;
          if (!v.paused) v.pause();
        }
      });
    },
    [beatCutTimestamps, config, getEffectiveTimelineBounds]
  );

  const startPlaybackAt = useCallback(
    async (startAbsSec: number) => {
      const currentAudio = audioRef.current;
      stopPlayback();

      if (!currentAudio) {
        const bounds = getEffectiveTimelineBounds(
          configRef.current,
          mediaItemsRef.current,
          null
        );
        const clampedStart = Math.max(0, Math.min(bounds.clipDuration - 0.1, startAbsSec));
        playStartPerfMsRef.current = performance.now();
        playStartAudioRef.current = clampedStart;
        currentTimeRef.current = clampedStart;
        setCurrentTime(clampedStart);
        setIsPlaying(true);
        syncVideosAtLocalTime(clampedStart, true);
        return;
      }

      const session = playSessionRef.current;
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          // continue best-effort
        }
      }
      if (session !== playSessionRef.current) return;

      const cfg = configRef.current;
      const clampedStart = Math.max(
        cfg.trimStart,
        Math.min(cfg.trimEnd - 0.1, startAbsSec)
      );
      const remainingDur = Math.max(0.1, cfg.trimEnd - clampedStart);
      const clipDuration = Math.max(0.5, cfg.trimEnd - cfg.trimStart);

      const segments = computeClipTimelineSegments(
        mediaItemsRef.current,
        clipDuration,
        cfg,
        beatCutTimestamps
      );
      const duckGain = Math.max(0.08, 1 - (cfg.audioDucking ?? 0.45));

      const src = ctx.createBufferSource();
      src.buffer = currentAudio.buffer;

      const gainNode = ctx.createGain();
      const curveSteps = 96;
      const curve = new Float32Array(curveSteps);
      for (let i = 0; i < curveSteps; i++) {
        const localT =
          clampedStart - cfg.trimStart + (i / (curveSteps - 1)) * remainingDur;
        let duckMult = 1;
        if (cfg.audioDucking > 0.02 && segments.length > 0) {
          const seg = segments.find((s) => localT >= s.startSec && localT <= s.endSec);
          const clip = seg ? mediaItemsRef.current[seg.clipIndex] : undefined;
          if (clip && clip.kind === 'video' && !clip.clipAudioMuted && clip.clipAudioVolume > 0.02) {
            duckMult = duckGain;
          }
        }
        curve[i] =
          computeFadeEnvelope(localT, clipDuration, cfg.fadeInSec, cfg.fadeOutSec) *
          cfg.audioGain *
          duckMult;
      }

      const startCtxTime = ctx.currentTime;
      gainNode.gain.setValueCurveAtTime(curve, startCtxTime, remainingDur);

      src.connect(gainNode);
      gainNode.connect(ctx.destination);

      src.onended = () => {
        if (sourceNodeRef.current === src) {
          sourceNodeRef.current = null;
          if (isLoopingRef.current && audioRef.current) {
            startPlaybackAtRef.current(configRef.current.trimStart);
          } else {
            setIsPlaying(false);
            currentTimeRef.current = configRef.current.trimStart;
            setCurrentTime(configRef.current.trimStart);
          }
        }
      };

      sourceNodeRef.current = src;
      playStartCtxTimeRef.current = startCtxTime;
      playStartPerfMsRef.current = performance.now();
      playStartAudioRef.current = clampedStart;
      lastMetronomeBeatRef.current = clampedStart - cfg.trimStart - 0.02;
      currentTimeRef.current = clampedStart;
      setCurrentTime(clampedStart);
      setIsPlaying(true);

      src.start(startCtxTime, clampedStart, remainingDur);
      syncVideosAtLocalTime(clampedStart - cfg.trimStart, true);
    },
    [
      beatCutTimestamps,
      getAudioContext,
      getEffectiveTimelineBounds,
      stopPlayback,
      syncVideosAtLocalTime,
    ]
  );

  startPlaybackAtRef.current = startPlaybackAt;

  const buildClipFromBinItem = useCallback(
    (
      binItem: MediaBinItem,
      placement: {
        startSec?: number;
        durationSec?: number;
        sourceStartSec?: number;
        playbackRate?: number;
        clipAudioMuted?: boolean;
      }
    ): VisualMediaState => {
      const id = createItemId();
      const defaultTrans = binItem.defaultTransitionOut ?? 'crossfade';
      if (binItem.kind === 'image') {
        const img = binItem.imageElement || (() => {
          const el = new Image();
          el.src = binItem.url;
          return el;
        })();
        return {
          id,
          kind: 'image',
          fileName: binItem.fileName,
          url: binItem.url,
          width: binItem.width,
          height: binItem.height,
          imageElement: img,
          startSec: placement.startSec,
          durationSec:
            placement.durationSec ??
            Number(Math.max(0.4, Math.min(600, binItem.defaultDurationSec || 4.0)).toFixed(2)),
          sourceStartSec: 0,
          playbackRate: 1.0,
          transitionOut: defaultTrans,
          transitionDurationSec: 0.65,
          transform: { ...DEFAULT_CLIP_TRANSFORM },
          clipAudioVolume: 0,
          clipAudioMuted: true,
        };
      }
      const video = document.createElement('video');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'none';
      // Attach src immediately only for manual single placements or early clips;
      // syncVideosAtLocalTime hydrates rolling window decoders on demand so bulk generations stay light.
      if (placement.startSec === undefined || placement.startSec <= 6) {
        video.preload = 'metadata';
        video.src = binItem.url;
      }
      const vDur = binItem.videoDuration || 10;
      const safeRange = resolveSafeVideoSourceRange(binItem, 0);
      const defaultDur = binItem.defaultDurationSec || safeRange.usableSpanSec || vDur;
      const cappedDur =
        binItem.defaultSourceEndSec !== undefined
          ? Math.min(defaultDur, safeRange.usableSpanSec)
          : defaultDur;
      const resolvedMuted =
        placement.clipAudioMuted ?? binItem.defaultClipAudioMuted ?? Boolean(audioRef.current);
      return {
        id,
        kind: 'video',
        fileName: binItem.fileName,
        url: binItem.url,
        width: binItem.width || 1080,
        height: binItem.height || 1920,
        videoElement: video,
        videoDuration: vDur,
        decodedAudioBuffer: binItem.decodedAudioBuffer,
        startSec: placement.startSec,
        durationSec:
          placement.durationSec ??
          Number(Math.max(0.5, Math.min(600, cappedDur)).toFixed(1)),
        sourceStartSec: placement.sourceStartSec ?? safeRange.sourceStartSec,
        playbackRate: placement.playbackRate ?? binItem.defaultPlaybackRate ?? 1.0,
        transitionOut: defaultTrans,
        transitionDurationSec: 0.65,
        transform: { ...DEFAULT_CLIP_TRANSFORM },
        clipAudioVolume: resolvedMuted ? 0 : 0.8,
        clipAudioMuted: resolvedMuted,
      };
    },
    []
  );

  const placeBinItemOnTimeline = useCallback(
    (
      binItem: MediaBinItem,
      options?: { atTimeSec?: number; mode?: 'playhead' | 'end' | 'exact' }
    ) => {
      const cfg = configRef.current;
      const items = mediaItemsRef.current;
      const safeRange = resolveSafeVideoSourceRange(binItem, 0);
      const rawDefaultDur =
        binItem.kind === 'video'
          ? binItem.defaultDurationSec || safeRange.usableSpanSec || binItem.videoDuration || 10
          : binItem.defaultDurationSec || 4.0;
      const boundedVideoDur =
        binItem.kind === 'video' && binItem.defaultSourceEndSec !== undefined
          ? Math.min(rawDefaultDur, safeRange.usableSpanSec)
          : rawDefaultDur;
      const defaultDur = Number(
        Math.max(binItem.kind === 'video' ? 0.5 : 0.4, Math.min(600, boundedVideoDur)).toFixed(1)
      );

      if (cfg.slideshowMode === 'manual') {
        const bounds = getEffectiveTimelineBounds(cfg, items, audioRef.current);
        const hasAud = Boolean(audioRef.current);
        const maxTimeline = hasAud ? bounds.clipDuration : 3600;
        const playheadLocalSec = Math.max(
          0,
          Number((currentTimeRef.current - bounds.trimBase).toFixed(2))
        );
        const intervals = getNormalizedManualClipIntervals(items);

        if (options?.mode === 'end') {
          const endCursor =
            intervals.length > 0 ? intervals[intervals.length - 1].endSec : 0;
          if (hasAud && endCursor >= maxTimeline - 0.45) {
            showUndoToast(tFor(langRef.current).errTimelineFullMusic);
            return null;
          }
          const clippedDur = hasAud
            ? Number(Math.max(0.4, Math.min(defaultDur, maxTimeline - endCursor)).toFixed(2))
            : defaultDur;
          const newClip = buildClipFromBinItem(binItem, {
            startSec: Number(endCursor.toFixed(2)),
            durationSec: clippedDur,
          });
          pushImmediateHistory();
          setMediaItems((prev) => [...prev, newClip]);
          setSelectedClipId(newClip.id);
          setSelectedClipIds([newClip.id]);
          setSelectedFxId(null);
          return newClip.id;
        }

        if (options?.atTimeSec !== undefined && options?.mode !== 'playhead') {
          const dropSec = Math.max(0, Math.min(Math.max(0, maxTimeline - 0.25), options.atTimeSec));
          const gapCheck = dropBinItemIntoManualGap(items, dropSec, defaultDur, maxTimeline);
          // Prioritize bounded empty gaps first so dropping anywhere inside/near a gap fills & trims cleanly
          if (!gapCheck.filledGap) {
            const overlapsExisting = intervals.some(
              (iv) => dropSec > iv.startSec + 0.04 && dropSec < iv.endSec - 0.04
            );
            if (overlapsExisting) {
              const newClip = buildClipFromBinItem(binItem, {
                startSec: dropSec,
                durationSec: defaultDur,
              });
              pushImmediateHistory();
              setMediaItems((prev) =>
                insertManualClipAtAnchor(prev, newClip, dropSec, maxTimeline)
              );
              setSelectedClipId(newClip.id);
              setSelectedClipIds([newClip.id]);
              setSelectedFxId(null);
              return newClip.id;
            }
          }

          const beatPoints = trackBeatGridRef.current.beats;
          let placement = gapCheck;
          if (!gapCheck.filledGap && cfg.snapToBeats && beatPoints.length > 1) {
            const snappedStart = snapTimeToBeat(dropSec, [0, ...beatPoints], 0.25);
            placement = dropBinItemIntoManualGap(items, snappedStart, defaultDur, maxTimeline);
          }

          const minAllowed = placement.filledGap ? 0.25 : 0.4;
          if (hasAud && (placement.durationSec < minAllowed || placement.startSec >= maxTimeline - minAllowed)) {
            showUndoToast(tFor(langRef.current).errTimelineFullMusic);
            return null;
          }
          const newClip = buildClipFromBinItem(binItem, {
            startSec: placement.startSec,
            durationSec: placement.durationSec,
          });
          pushImmediateHistory();
          setMediaItems((prev) =>
            [...prev, newClip].sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0))
          );
          setSelectedClipId(newClip.id);
          setSelectedClipIds([newClip.id]);
          setSelectedFxId(null);
          return newClip.id;
        }

        const anchorStart = hasAud
          ? Math.max(0, Math.min(Math.max(0, maxTimeline - 0.45), playheadLocalSec))
          : playheadLocalSec;
        const newClip = buildClipFromBinItem(binItem, {
          startSec: anchorStart,
          durationSec: defaultDur,
        });
        pushImmediateHistory();
        setMediaItems((prev) =>
          insertManualClipAtAnchor(prev, newClip, anchorStart, maxTimeline)
        );
        setSelectedClipId(newClip.id);
        setSelectedClipIds([newClip.id]);
        setSelectedFxId(null);
        return newClip.id;
      }

      let resolvedNonManualDur = defaultDur;
      if (options?.atTimeSec !== undefined && options?.mode !== 'playhead' && audioRef.current) {
        const bounds = getEffectiveTimelineBounds(cfg, items, audioRef.current);
        const usedTotal = items.reduce((acc, m) => acc + Math.max(0.4, m.durationSec || 4), 0);
        if (usedTotal < bounds.clipDuration - 0.35) {
          resolvedNonManualDur = Number(
            Math.max(0.25, Math.min(defaultDur, bounds.clipDuration - usedTotal)).toFixed(2)
          );
        }
      }
      const newClip = buildClipFromBinItem(binItem, { durationSec: resolvedNonManualDur });
      pushImmediateHistory();
      setMediaItems((prev) =>
        options?.mode === 'end'
          ? [...prev, newClip]
          : insertClipAfterSelection(prev, newClip, selectedClipIdRef.current)
      );
      setSelectedClipId(newClip.id);
      setSelectedClipIds([newClip.id]);
      setSelectedFxId(null);
      return newClip.id;
    },
    [
      buildClipFromBinItem,
      getEffectiveTimelineBounds,
      pushImmediateHistory,
      showUndoToast,
    ]
  );

  const ingestVisualAssetFromUrl = useCallback(
    (
      url: string,
      fileName: string,
      kind: 'image' | 'video',
      blobKey?: string,
      isSharedUrl = false,
      sourceBlob?: Blob,
      autoPlace?: { atTimeSec?: number; mode?: 'playhead' | 'end' | 'exact' }
    ) => {
      if (blobKey) {
        blobKeyMapRef.current.set(url, blobKey);
      }
      const binId = `bin-${createItemId()}`;
      if (kind === 'image') {
        const img = new Image();
        img.onload = () => {
          const newBinItem: MediaBinItem = {
            id: binId,
            kind: 'image',
            fileName,
            url,
            width: img.naturalWidth,
            height: img.naturalHeight,
            imageElement: img,
            defaultDurationSec: 4.0,
          };
          pushImmediateHistory();
          const nextBinImg = [...mediaBinRef.current, newBinItem];
          mediaBinRef.current = nextBinImg;
          setMediaBin(nextBinImg);
          if (autoPlace) {
            setTimeout(() => {
              placeBinItemOnTimeline(newBinItem, autoPlace);
            }, 0);
          }
        };
        img.onerror = () => {
          if (!isSharedUrl && url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
          }
          const classified = classifyMediaError({
            fileName,
            kind: 'image',
            fileSize: sourceBlob?.size,
            lang,
          });
          console.error('[media] Image decode failed:', classified.code, fileName);
          showError(classified.formatted);
        };
        img.src = url;
      } else {
        const video = document.createElement('video');
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          const vDur = video.duration || 10;
          const trimEdges = vDur >= 12.5;
          const initStart = trimEdges ? 5 : 0;
          const initEnd = trimEdges ? Number((vDur - 5).toFixed(1)) : Number(vDur.toFixed(1));
          const usableDur = Math.max(0.5, initEnd - initStart);
          const newBinItem: MediaBinItem = {
            id: binId,
            kind: 'video',
            fileName,
            url,
            width: video.videoWidth || 1080,
            height: video.videoHeight || 1920,
            videoDuration: vDur,
            defaultSourceStartSec: initStart,
            defaultSourceEndSec: initEnd,
            defaultDurationSec: Number(Math.max(0.5, Math.min(600, usableDur)).toFixed(1)),
          };
          pushImmediateHistory();
          const nextBinVid = [...mediaBinRef.current, newBinItem];
          mediaBinRef.current = nextBinVid;
          setMediaBin(nextBinVid);
          if (autoPlace) {
            setTimeout(() => {
              placeBinItemOnTimeline(newBinItem, autoPlace);
            }, 0);
          }
          if (sourceBlob) {
            sourceBlob
              .arrayBuffer()
              .then((arr) => getAudioContext().decodeAudioData(arr))
              .then((decoded) => {
                setMediaBin((prev) =>
                  prev.map((b) =>
                    b.id === binId ? { ...b, decodedAudioBuffer: decoded } : b
                  )
                );
                setMediaItems((prev) =>
                  prev.map((m) =>
                    m.url === url && !m.decodedAudioBuffer
                      ? { ...m, decodedAudioBuffer: decoded }
                      : m
                  )
                );
              })
              .catch(() => {
                // Silent video or unsupported audio track; skip cleanly
              });
          }
        };
        video.onerror = () => {
          if (!isSharedUrl && url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
          }
          const classified = classifyMediaError({
            fileName,
            kind: 'video',
            mediaErrorCode: video.error?.code,
            fileSize: sourceBlob?.size,
            lang,
          });
          console.error('[media] Video load failed:', classified.code, fileName, video.error);
          showError(classified.formatted);
        };
        video.src = url;
      }
    },
    [getAudioContext, lang, placeBinItemOnTimeline, pushImmediateHistory, showError]
  );

  const applyAudioBuffer = useCallback(
    (
      buffer: AudioBuffer,
      fileName: string,
      fileSize: number,
      meta: AudioTrackState['metadata'],
      isSyntheticDemo: boolean,
      preserveRestoredConfig = false
    ) => {
      stopPlayback();

      const prevCover = audioRef.current?.metadata.embeddedCoverUrl;
      if (
        prevCover &&
        prevCover.startsWith('blob:') &&
        prevCover !== meta.embeddedCoverUrl &&
        !mediaItemsRef.current.some((m) => m.url === prevCover) &&
        !mediaBinRef.current.some((b) => b.url === prevCover)
      ) {
        URL.revokeObjectURL(prevCover);
      }

      const mono = buildMonoAudioData(buffer);
      monoDataRef.current = mono;
      const peaks = computeWaveformPeaks(mono, 1200);

      const newAudio: AudioTrackState = {
        fileName,
        fileSize,
        buffer,
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        numberOfChannels: buffer.numberOfChannels,
        waveformPeaks: peaks,
        isSyntheticDemo,
        metadata: meta,
      };

      setAudio(newAudio);
      currentTimeRef.current = 0;
      setCurrentTime(0);

      if (!preserveRestoredConfig) {
        const nextTrimEnd =
          configRef.current.trimPreset === 'reels_60' ||
          configRef.current.trimPreset === 'tiktok_60'
            ? Math.min(buffer.duration, 60)
            : configRef.current.trimPreset === 'shorts_57'
              ? Math.min(buffer.duration, 57)
              : buffer.duration;
        const maxSpan = Math.max(0.5, Number(nextTrimEnd.toFixed(2)));

        setConfig((prev) => ({
          ...prev,
          titleText: meta.title || prev.titleText,
          artistText: meta.artist || (isSyntheticDemo ? 'Neuromicon' : ''),
          albumText: meta.album || (meta.year ? `Release · ${meta.year}` : ''),
          trimStart: 0,
          trimEnd: Number(nextTrimEnd.toFixed(2)),
          beatGridMode: 'auto',
          manualBpm: 0,
          beatOffsetSec: 0,
          beatDownbeatShift: 0,
        }));

        // Mute already-placed video clip audio tracks & clamp manual clips within music length
        if (mediaItemsRef.current.length > 0) {
          setMediaItems((prev) =>
            prev
              .filter((m) => configRef.current.slideshowMode !== 'manual' || (m.startSec ?? 0) < maxSpan - 0.35)
              .map((m) => {
                const start = m.startSec ?? 0;
                const clampedDur =
                  configRef.current.slideshowMode === 'manual'
                    ? Number(Math.max(0.4, Math.min(m.durationSec, maxSpan - start)).toFixed(2))
                    : m.durationSec;
                return {
                  ...m,
                  durationSec: clampedDur,
                  clipAudioMuted: m.kind === 'video' ? true : m.clipAudioMuted,
                  clipAudioVolume: m.kind === 'video' ? 0 : m.clipAudioVolume,
                };
              })
          );
        }

        // Add embedded audio cover to Media Library (never auto-inserting onto the timeline)
        if (
          meta.embeddedCoverUrl &&
          !mediaBinRef.current.some((b) => b.url === meta.embeddedCoverUrl)
        ) {
          ingestVisualAssetFromUrl(
            meta.embeddedCoverUrl,
            `${fileName} (Cover)`,
            'image',
            undefined,
            true
          );
        }
      }
    },
    [ingestVisualAssetFromUrl, stopPlayback]
  );

  const applyAudioBufferRef = useRef(applyAudioBuffer);
  applyAudioBufferRef.current = applyAudioBuffer;

  const handleRemoveAudio = useCallback(() => {
    stopPlayback();
    const prevCover = audioRef.current?.metadata.embeddedCoverUrl;
    if (
      prevCover &&
      prevCover.startsWith('blob:') &&
      !mediaItemsRef.current.some((m) => m.url === prevCover) &&
      !mediaBinRef.current.some((b) => b.url === prevCover)
    ) {
      URL.revokeObjectURL(prevCover);
    }
    pushImmediateHistory();
    audioBlobKeyRef.current = undefined;
    monoDataRef.current = new Float32Array(0);
    setAudio(null);
    setConfig((prev) => ({
      ...prev,
      trimStart: 0,
      trimEnd: 60,
      trimPreset: 'full',
    }));
    currentTimeRef.current = 0;
    setCurrentTime(0);
  }, [pushImmediateHistory, stopPlayback]);

  // Restore autosaved project from IndexedDB strictly once on initial mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadProjectFromIDB();
        if (!saved || cancelled) {
          return;
        }

        const isLegacySchema = !saved.version || saved.version < 5;
        const mergedConfig: StudioConfig = {
          ...DEFAULT_STUDIO_CONFIG,
          ...saved.config,
          slideshowMode: isLegacySchema
            ? 'manual'
            : saved.config.slideshowMode || DEFAULT_STUDIO_CONFIG.slideshowMode,
          overlays: [],
          fxOverlays: (saved.config.fxOverlays || []).map((fx) => ({
            ...fx,
            params: fx.params ? { ...fx.params } : undefined,
          })),
        };

        // Rehydrate overlay layers (load PNG/logo blobs if stored)
        const restoredOverlays: OverlayLayer[] = [];
        for (const ov of saved.config.overlays || []) {
          if (ov.kind === 'image') {
            const blobKey = ov.imageBlobKey || `overlay-${ov.id}`;
            const blob = await loadBlobFromIDB(blobKey);
            if (blob) {
              const url = URL.createObjectURL(blob);
              blobKeyMapRef.current.set(url, blobKey);
              const img = new Image();
              img.src = url;
              restoredOverlays.push({
                ...ov,
                imageUrl: url,
                imageBlobKey: blobKey,
                imageElement: img,
              });
            }
          } else {
            restoredOverlays.push({ ...ov });
          }
        }
        mergedConfig.overlays = restoredOverlays;

        if (cancelled) return;
        setConfig(mergedConfig);
        if (mergedConfig.customGlslCode) {
          const res = proceduralShaderEngine.updateCustomShader(mergedConfig.customGlslCode);
          setGlslError(res.error);
        }

        // Rehydrate audio track
        if (saved.audioMeta) {
          if (saved.audioMeta.isSyntheticDemo) {
            const demoBuf = await generateDemoAudioBuffer();
            if (!cancelled) {
              audioBlobKeyRef.current = undefined;
              applyAudioBufferRef.current(
                demoBuf,
                saved.audioMeta.fileName,
                saved.audioMeta.fileSize,
                {
                  title: mergedConfig.titleText,
                  artist: mergedConfig.artistText,
                  album: mergedConfig.albumText,
                  year: '2026',
                },
                true,
                true
              );
            }
          } else if (saved.audioMeta.blobKey) {
            const audioBlob = await loadBlobFromIDB(saved.audioMeta.blobKey);
            if (audioBlob && !cancelled) {
              audioBlobKeyRef.current = saved.audioMeta.blobKey;
              const arr = await audioBlob.arrayBuffer();
              const id3 = parseID3Tags(arr, saved.audioMeta.fileName);
              const ctx = getAudioContext();
              const decoded = await ctx.decodeAudioData(arr.slice(0));
              if (!cancelled) {
                applyAudioBufferRef.current(
                  decoded,
                  saved.audioMeta.fileName,
                  saved.audioMeta.fileSize,
                  {
                    title: id3.title || mergedConfig.titleText,
                    artist: id3.artist || mergedConfig.artistText,
                    album: id3.album || mergedConfig.albumText,
                    year: id3.year || '',
                    embeddedCoverUrl: id3.coverBlobUrl,
                  },
                  false,
                  true
                );
              }
            }
          }
        }

        // Cache blobKey -> objectURL and decoded video metadata/audio so sliced auto-clips restore instantaneously
        const restoredUrlByKey = new Map<string, string>();
        const restoredVideoMetaByKey = new Map<
          string,
          { duration: number; width: number; height: number; decodedAudio?: AudioBuffer }
        >();
        const restoredBin: MediaBinItem[] = [];
        for (const sb of saved.mediaBin || []) {
          if (!sb.blobKey) continue;
          const blob = await loadBlobFromIDB(sb.blobKey);
          if (!blob) continue;
          let url = restoredUrlByKey.get(sb.blobKey);
          if (!url) {
            url = URL.createObjectURL(blob);
            restoredUrlByKey.set(sb.blobKey, url);
            blobKeyMapRef.current.set(url, sb.blobKey);
          }
          if (sb.kind === 'image') {
            const img = await new Promise<HTMLImageElement | null>((resolve) => {
              const el = new Image();
              el.onload = () => resolve(el);
              el.onerror = () => resolve(null);
              el.src = url!;
            });
            if (img) {
              restoredBin.push({
                id: sb.id || `bin-${createItemId()}`,
                kind: 'image',
                fileName: sb.fileName,
                url,
                width: img.naturalWidth || sb.width,
                height: img.naturalHeight || sb.height,
                imageElement: img,
                defaultDurationSec: sb.defaultDurationSec || 4.0,
                defaultTransitionOut: sb.defaultTransitionOut,
              });
            }
          } else {
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.preload = 'metadata';
            const ok = await new Promise<boolean>((resolve) => {
              video.onloadedmetadata = () => resolve(true);
              video.onerror = () => resolve(false);
              video.src = url!;
            });
            if (ok) {
              let decodedBuf: AudioBuffer | undefined;
              try {
                const arr = await blob.arrayBuffer();
                decodedBuf = await getAudioContext().decodeAudioData(arr);
              } catch {
                // silent video
              }
              const vDur = video.duration || sb.videoDuration || 10;
              const vW = video.videoWidth || sb.width;
              const vH = video.videoHeight || sb.height;
              restoredVideoMetaByKey.set(sb.blobKey, {
                duration: vDur,
                width: vW,
                height: vH,
                decodedAudio: decodedBuf,
              });
              restoredBin.push({
                id: sb.id || `bin-${createItemId()}`,
                kind: 'video',
                fileName: sb.fileName,
                url,
                width: vW,
                height: vH,
                videoDuration: vDur,
                decodedAudioBuffer: decodedBuf,
                defaultDurationSec:
                  sb.defaultDurationSec || Number(Math.max(0.5, Math.min(600, vDur)).toFixed(1)),
                defaultSourceStartSec: sb.defaultSourceStartSec,
                defaultSourceEndSec: sb.defaultSourceEndSec,
                defaultPlaybackRate: sb.defaultPlaybackRate,
                defaultTransitionOut: sb.defaultTransitionOut,
                defaultClipAudioMuted: sb.defaultClipAudioMuted,
              });
            }
          }
        }

        // Rehydrate media clips cleanly in saved order without re-decoding shared video blobs
        const restoredImageByKey = new Map<string, HTMLImageElement>();
        for (const b of restoredBin) {
          const k = b.url ? blobKeyMapRef.current.get(b.url) : undefined;
          if (k && b.kind === 'image' && b.imageElement) {
            restoredImageByKey.set(k, b.imageElement);
          }
        }
        const restoredClips: VisualMediaState[] = [];
        for (const sc of saved.clips || []) {
          const restoredOverlay = sc.overlayEffect
            ? {
                ...sc.overlayEffect,
                params: sc.overlayEffect.params ? { ...sc.overlayEffect.params } : undefined,
              }
            : undefined;
          if (sc.kind === 'generator') {
            restoredClips.push({
              id: sc.id,
              kind: 'generator',
              fileName: sc.fileName,
              url: '',
              width: sc.width,
              height: sc.height,
              startSec: sc.startSec,
              durationSec: sc.durationSec,
              sourceStartSec: sc.sourceStartSec,
              playbackRate: sc.playbackRate,
              transitionOut: sc.transitionOut,
              transitionDurationSec: sc.transitionDurationSec,
              generatorId: sc.generatorId || 'galaxy_spiral',
              generatorParams: sc.generatorParams ? { ...sc.generatorParams } : undefined,
              overlayEffect: restoredOverlay,
              transform: sc.transform || { ...DEFAULT_CLIP_TRANSFORM },
              clipAudioVolume: sc.clipAudioVolume ?? 0,
              clipAudioMuted: sc.clipAudioMuted ?? true,
            });
          } else if (sc.blobKey) {
            let url = restoredUrlByKey.get(sc.blobKey);
            if (!url) {
              const blob = await loadBlobFromIDB(sc.blobKey);
              if (!blob) continue;
              url = URL.createObjectURL(blob);
              restoredUrlByKey.set(sc.blobKey, url);
              blobKeyMapRef.current.set(url, sc.blobKey);
            }

            if (sc.kind === 'image') {
              let img = restoredImageByKey.get(sc.blobKey) ?? null;
              if (!img) {
                img = await new Promise<HTMLImageElement | null>((resolve) => {
                  const el = new Image();
                  el.onload = () => resolve(el);
                  el.onerror = () => resolve(null);
                  el.src = url!;
                });
                if (img) restoredImageByKey.set(sc.blobKey, img);
              }
              if (img) {
                restoredClips.push({
                  id: sc.id,
                  kind: 'image',
                  fileName: sc.fileName,
                  url,
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                  imageElement: img,
                  startSec: sc.startSec,
                  durationSec: sc.durationSec,
                  sourceStartSec: sc.sourceStartSec,
                  playbackRate: sc.playbackRate,
                  transitionOut: sc.transitionOut,
                  transitionDurationSec: sc.transitionDurationSec,
                  overlayEffect: restoredOverlay,
                  transform: sc.transform || { ...DEFAULT_CLIP_TRANSFORM },
                  clipAudioVolume: sc.clipAudioVolume ?? 0,
                  clipAudioMuted: sc.clipAudioMuted ?? true,
                });
                if (
                  !saved.mediaBin &&
                  !restoredBin.some((b) => b.url && blobKeyMapRef.current.get(b.url) === sc.blobKey)
                ) {
                  restoredBin.push({
                    id: `bin-${createItemId()}`,
                    kind: 'image',
                    fileName: sc.fileName,
                    url,
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                    imageElement: img,
                    defaultDurationSec: sc.durationSec || 4.0,
                  });
                }
              }
            } else {
              const video = document.createElement('video');
              video.muted = true;
              video.loop = true;
              video.playsInline = true;
              video.preload = 'metadata';

              let cachedMeta = restoredVideoMetaByKey.get(sc.blobKey);
              let ok = Boolean(cachedMeta);
              if (!cachedMeta) {
                ok = await new Promise<boolean>((resolve) => {
                  video.onloadedmetadata = () => resolve(true);
                  video.onerror = () => resolve(false);
                  video.src = url!;
                });
                if (ok) {
                  let decodedBuf: AudioBuffer | undefined;
                  try {
                    const blob = await loadBlobFromIDB(sc.blobKey);
                    if (blob) {
                      const arr = await blob.arrayBuffer();
                      decodedBuf = await getAudioContext().decodeAudioData(arr);
                    }
                  } catch {
                    // silent video
                  }
                  cachedMeta = {
                    duration: video.duration || sc.videoDuration || 10,
                    width: video.videoWidth || sc.width,
                    height: video.videoHeight || sc.height,
                    decodedAudio: decodedBuf,
                  };
                  restoredVideoMetaByKey.set(sc.blobKey, cachedMeta);
                }
              } else {
                video.src = url!;
              }

              if (ok && cachedMeta) {
                const vDur = cachedMeta.duration;
                restoredClips.push({
                  id: sc.id,
                  kind: 'video',
                  fileName: sc.fileName,
                  url,
                  width: cachedMeta.width,
                  height: cachedMeta.height,
                  videoElement: video,
                  videoDuration: vDur,
                  decodedAudioBuffer: cachedMeta.decodedAudio,
                  startSec: sc.startSec,
                  durationSec: sc.durationSec,
                  sourceStartSec: sc.sourceStartSec,
                  playbackRate: sc.playbackRate,
                  transitionOut: sc.transitionOut,
                  transitionDurationSec: sc.transitionDurationSec,
                  overlayEffect: restoredOverlay,
                  transform: sc.transform || { ...DEFAULT_CLIP_TRANSFORM },
                  clipAudioVolume: sc.clipAudioVolume ?? 0.8,
                  clipAudioMuted: sc.clipAudioMuted ?? true,
                });
                if (
                  !saved.mediaBin &&
                  !restoredBin.some((b) => b.url && blobKeyMapRef.current.get(b.url) === sc.blobKey)
                ) {
                  restoredBin.push({
                    id: `bin-${createItemId()}`,
                    kind: 'video',
                    fileName: sc.fileName,
                    url,
                    width: cachedMeta.width,
                    height: cachedMeta.height,
                    videoDuration: vDur,
                    decodedAudioBuffer: cachedMeta.decodedAudio,
                    defaultDurationSec: Number(Math.max(0.5, Math.min(600, vDur)).toFixed(1)),
                  });
                }
              }
            }
          }
        }
        if (!cancelled) {
          if (restoredBin.length > 0) {
            setMediaBin(restoredBin);
          }
          if (restoredClips.length > 0) {
            let finalClips = restoredClips;
            if (mergedConfig.slideshowMode === 'manual') {
              const intervals = getNormalizedManualClipIntervals(restoredClips);
              const startMap = new Map(intervals.map((iv) => [iv.id, iv.startSec]));
              finalClips = restoredClips.map((c) => ({
                ...c,
                startSec: Number((startMap.get(c.id) ?? 0).toFixed(2)),
              }));
            }
            setMediaItems(finalClips);
            setSelectedClipId(finalClips[0].id);
          }
        }
      } catch {
        // Ignore IDB hydration errors cleanly
      } finally {
        if (!cancelled) {
          hydratedRef.current = true;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getAudioContext]);

  // Debounced IndexedDB autosave + orphan blob pruning
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    setSaveStatus('saving');
    autosaveTimerRef.current = window.setTimeout(async () => {
      try {
        const serialized = serializeStudioState(
          config,
          mediaItems,
          blobKeyMapRef.current,
          audio?.fileName,
          audio?.fileSize,
          audio?.isSyntheticDemo,
          audioBlobKeyRef.current,
          mediaBin
        );
        const res = await saveProjectToIDB(serialized);
        if (!res.ok) {
          setSaveStatus('error');
          showError(res.error || tFor(langRef.current).saveStatusError);
        } else {
          const activeKeys = new Set<string>();
          if (audioBlobKeyRef.current) activeKeys.add(audioBlobKeyRef.current);
          for (const b of mediaBin) {
            const key = b.url ? blobKeyMapRef.current.get(b.url) : undefined;
            if (key) activeKeys.add(key);
          }
          for (const item of mediaItems) {
            const key = item.url ? blobKeyMapRef.current.get(item.url) : undefined;
            if (key) activeKeys.add(key);
          }
          for (const ov of config.overlays) {
            if (ov.kind === 'image') {
              const key =
                (ov.imageUrl ? blobKeyMapRef.current.get(ov.imageUrl) : undefined) ||
                ov.imageBlobKey ||
                `overlay-${ov.id}`;
              activeKeys.add(key);
            }
          }
          await pruneOrphanedBlobs(activeKeys);
          setSaveStatus('saved');
        }
      } catch (err) {
        setSaveStatus('error');
        showError(err instanceof Error ? err.message : tFor(langRef.current).saveStatusError);
      } finally {
        autosaveTimerRef.current = null;
      }
    }, 900);

    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [audio, config, mediaBin, mediaItems, showError]);

  const handleAudioFile = useCallback(
    async (file: File) => {
      if (!file || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
        const classified = classifyMediaError({
          fileName: file?.name || '',
          kind: 'audio',
          fileSize: file?.size ?? 0,
          maxBytes: MAX_UPLOAD_BYTES,
          lang,
        });
        showError(classified.formatted);
        return;
      }
      setIsLoadingAudio(true);
      try {
        const arrayBuf = await file.arrayBuffer();
        const id3 = parseID3Tags(arrayBuf, file.name);
        const ctx = getAudioContext();
        const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));

        const audioKey = `audio-${createItemId()}`;
        audioBlobKeyRef.current = audioKey;
        saveBlobToIDB(audioKey, file).then((res) => {
          if (!res.ok) {
            setSaveStatus('error');
            showError(res.error || tFor(langRef.current).saveStatusError);
          }
        });

        applyAudioBuffer(
          decoded,
          file.name,
          file.size,
          {
            title: id3.title || file.name.replace(/\.[^.]+$/, ''),
            artist: id3.artist || '',
            album: id3.album || '',
            year: id3.year || '',
            embeddedCoverUrl: id3.coverBlobUrl,
          },
          false
        );
      } catch (err) {
        const classified = classifyMediaError({
          fileName: file.name,
          kind: 'audio',
          mimeType: file.type,
          fileSize: file.size,
          error: err,
          lang,
        });
        console.error('[media] Failed to decode audio file:', classified.code, err);
        showError(classified.formatted);
      } finally {
        setIsLoadingAudio(false);
      }
    },
    [applyAudioBuffer, getAudioContext, lang, showError]
  );

  const handleUseClipAudioAsMaster = useCallback(
    (clipId: string) => {
      const clip = mediaItemsRef.current.find((m) => m.id === clipId);
      if (!clip?.decodedAudioBuffer) return;
      pushImmediateHistory();
      audioBlobKeyRef.current = undefined;
      // Mute clip element audio so it doesn't double-play alongside the extracted master track
      setMediaItems((prev) =>
        prev.map((m) => (m.id === clipId ? { ...m, clipAudioMuted: true } : m))
      );
      applyAudioBuffer(
        clip.decodedAudioBuffer,
        clip.fileName,
        0,
        {
          title: clip.fileName.replace(/\.[^.]+$/, ''),
          artist: '',
          album: '',
          year: '',
        },
        false
      );
      showUndoToast(tFor(langRef.current).clipAudioExtractedToast);
    },
    [applyAudioBuffer, pushImmediateHistory, showUndoToast]
  );

  const handleLoadDemoBeat = useCallback(async () => {
    setIsLoadingAudio(true);
    try {
      const demoBuf = await generateDemoAudioBuffer();
      audioBlobKeyRef.current = undefined;
      applyAudioBuffer(
        demoBuf,
        'Midnight Resonance (122 BPM Synth).wav',
        demoBuf.length * 4,
        {
          title: 'Midnight Resonance',
          artist: 'Neuromicon',
          album: 'Studio Master · 2026',
          year: '2026',
        },
        true
      );
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingAudio(false);
    }
  }, [applyAudioBuffer, showError]);

  const handleVisualFiles = useCallback(
    (files: File[], autoPlaceAtSec?: number) => {
      let placedFirst = false;
      for (const file of files) {
        if (!file || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
          const classified = classifyMediaError({
            fileName: file?.name || '',
            kind: 'visual',
            mimeType: file?.type,
            fileSize: file?.size ?? 0,
            maxBytes: MAX_UPLOAD_BYTES,
            lang,
          });
          showError(classified.formatted);
          continue;
        }
        const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
        const isImage =
          file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(file.name);
        if (!isVideo && !isImage) {
          const classified = classifyMediaError({
            fileName: file.name,
            kind: 'visual',
            mimeType: file.type,
            fileSize: file.size,
            lang,
          });
          showError(classified.formatted);
          continue;
        }
        const url = URL.createObjectURL(file);
        const blobKey = `clip-${createItemId()}`;
        blobKeyMapRef.current.set(url, blobKey);
        saveBlobToIDB(blobKey, file).then((res) => {
          if (!res.ok) {
            setSaveStatus('error');
            showError(res.error || tFor(langRef.current).saveStatusError);
          }
        });
        const autoPlace =
          autoPlaceAtSec !== undefined
            ? !placedFirst
              ? ({ atTimeSec: autoPlaceAtSec, mode: 'exact' } as const)
              : ({ mode: 'end' } as const)
            : undefined;
        placedFirst = true;
        ingestVisualAssetFromUrl(
          url,
          file.name,
          isVideo ? 'video' : 'image',
          blobKey,
          false,
          file,
          autoPlace
        );
      }
    },
    [ingestVisualAssetFromUrl, lang, showError]
  );

  const handleDropFilesToTimeline = useCallback(
    (files: File[], atTimeSec: number) => {
      handleVisualFiles(files, atTimeSec);
    },
    [handleVisualFiles]
  );

  const handleAddBinItemToTimeline = useCallback(
    (binItemId: string, options?: { atTimeSec?: number; mode?: 'playhead' | 'end' | 'exact' }) => {
      const binItem = mediaBinRef.current.find((b) => b.id === binItemId);
      if (!binItem) return;
      placeBinItemOnTimeline(binItem, options);
    },
    [placeBinItemOnTimeline]
  );

  const handleDropBinItemToTimeline = useCallback(
    (binItemId: string, atTimeSec: number) => {
      handleAddBinItemToTimeline(binItemId, { atTimeSec, mode: 'exact' });
    },
    [handleAddBinItemToTimeline]
  );

  const handleAddAllBinToTimeline = useCallback(() => {
    const binList = mediaBinRef.current;
    if (binList.length === 0) return;
    pushImmediateHistory();
    const cfg = configRef.current;
    const existing = [...mediaItemsRef.current];
    const hasAud = Boolean(audioRef.current);
    const bounds = getEffectiveTimelineBounds(cfg, existing, audioRef.current);
    const maxTimeline = hasAud ? bounds.clipDuration : 3600;
    const created: VisualMediaState[] = [];

    let simulated = [...existing];
    for (const b of binList) {
      const dur =
        b.kind === 'video'
          ? Number(
              Math.max(0.5, Math.min(600, b.defaultDurationSec || b.videoDuration || 10)).toFixed(1)
            )
          : Number(Math.max(0.4, Math.min(600, b.defaultDurationSec || 4.0)).toFixed(1));
      if (cfg.slideshowMode === 'manual') {
        const intervals = getNormalizedManualClipIntervals(simulated);
        const endCursor = intervals.length > 0 ? intervals[intervals.length - 1].endSec : 0;
        if (hasAud && endCursor >= maxTimeline - 0.45) break;
        const slot = findManualInsertionSlot(simulated, endCursor, dur, maxTimeline);
        if (hasAud && (slot.durationSec < 0.4 || slot.startSec >= maxTimeline - 0.4)) break;
        const clip = buildClipFromBinItem(b, {
          startSec: slot.startSec,
          durationSec: Math.min(dur, slot.durationSec),
        });
        created.push(clip);
        simulated.push(clip);
      } else {
        const clip = buildClipFromBinItem(b, { durationSec: dur });
        created.push(clip);
        simulated.push(clip);
      }
    }

    if (created.length > 0) {
      setMediaItems((prev) => [...prev, ...created]);
      setSelectedClipId(created[0].id);
      setSelectedClipIds([created[0].id]);
      setSelectedFxId(null);
    } else if (hasAud) {
      showUndoToast(tFor(langRef.current).errTimelineFullMusic);
    }
  }, [buildClipFromBinItem, getEffectiveTimelineBounds, pushImmediateHistory, showUndoToast]);

  const handleUpdateBinItem = useCallback(
    (binItemId: string, patch: Partial<MediaBinItem>, syncPlacedClips = false) => {
      const target = mediaBinRef.current.find((b) => b.id === binItemId);
      if (!target) return;
      pushImmediateHistory();
      const updatedAsset: MediaBinItem = { ...target, ...patch };
      const nextBin = mediaBinRef.current.map((b) =>
        b.id === binItemId ? updatedAsset : b
      );
      mediaBinRef.current = nextBin;
      setMediaBin(nextBin);
      if (syncPlacedClips) {
        const cfg = configRef.current;
        const bounds = getEffectiveTimelineBounds(cfg, mediaItemsRef.current, audioRef.current);
        const maxTimeline = audioRef.current ? bounds.clipDuration : 3600;
        const safeRange = resolveSafeVideoSourceRange(updatedAsset, 0);
        const requestedDur =
          patch.defaultDurationSec !== undefined
            ? target.kind === 'video' && updatedAsset.defaultSourceEndSec !== undefined
              ? Math.min(patch.defaultDurationSec, safeRange.usableSpanSec)
              : patch.defaultDurationSec
            : undefined;
        setMediaItems((prev) => {
          let next = prev.map((clip) => {
            if (clip.url !== target.url) return clip;
            const cappedClipDur =
              target.kind === 'video' && updatedAsset.defaultSourceEndSec !== undefined
                ? Math.min(
                    requestedDur ?? clip.durationSec,
                    safeRange.usableSpanSec
                  )
                : requestedDur ?? clip.durationSec;
            return {
              ...clip,
              sourceStartSec:
                target.kind === 'video' && patch.defaultSourceStartSec !== undefined
                  ? patch.defaultSourceStartSec
                  : clip.sourceStartSec,
              playbackRate:
                target.kind === 'video' && patch.defaultPlaybackRate !== undefined
                  ? patch.defaultPlaybackRate
                  : clip.playbackRate,
              transitionOut: patch.defaultTransitionOut ?? clip.transitionOut,
              clipAudioMuted:
                target.kind === 'video' && patch.defaultClipAudioMuted !== undefined
                  ? patch.defaultClipAudioMuted
                  : clip.clipAudioMuted,
              durationSec:
                cfg.slideshowMode !== 'manual'
                  ? Number(Math.max(0.4, cappedClipDur).toFixed(1))
                  : clip.durationSec,
            };
          });
          if (
            cfg.slideshowMode === 'manual' &&
            (requestedDur !== undefined ||
              (target.kind === 'video' &&
                (patch.defaultSourceStartSec !== undefined ||
                  patch.defaultSourceEndSec !== undefined)))
          ) {
            const matchingClips = next.filter((c) => c.url === target.url);
            for (const c of matchingClips) {
              const targetClipDur =
                requestedDur !== undefined
                  ? requestedDur
                  : target.kind === 'video' && updatedAsset.defaultSourceEndSec !== undefined
                    ? Math.min(c.durationSec, safeRange.usableSpanSec)
                    : c.durationSec;
              if (Math.abs(targetClipDur - c.durationSec) >= 0.05) {
                next = resizeManualClipDuration(
                  next,
                  c.id,
                  targetClipDur,
                  maxTimeline,
                  cfg.timelineStretchMode ?? 'push'
                );
              }
            }
          }
          return next;
        });
      }
    },
    [getEffectiveTimelineBounds, pushImmediateHistory]
  );

  const handleCreateRandomBeatAutoClip = useCallback(
    (autoCfg: AutoClipGenerateConfig) => {
      const binList = mediaBinRef.current;
      if (binList.length === 0) return;
      stopPlayback();

      const cfg = configRef.current;
      const aud = audioRef.current;
      const prevItems = mediaItemsRef.current;
      const bounds = getEffectiveTimelineBounds(cfg, prevItems, aud);

      const isAppend = autoCfg.targetMode === 'append' && prevItems.length > 0;
      let startOffsetSec = 0;
      let normalizedPrev =
        isAppend && cfg.slideshowMode !== 'manual'
          ? snapshotSegmentDurations(prevItems, bounds.clipDuration, cfg, beatCutTimestamps)
          : isAppend
            ? (() => {
                const ivs = getNormalizedManualClipIntervals(prevItems);
                const startById = new Map(ivs.map((iv) => [iv.id, iv.startSec]));
                return prevItems.map((c) => ({
                  ...c,
                  startSec: Number((startById.get(c.id) ?? 0).toFixed(2)),
                }));
              })()
            : prevItems;

      if (isAppend && aud) {
        normalizedPrev = normalizedPrev
          .filter((c) => (c.startSec ?? 0) < bounds.clipDuration - 0.4)
          .map((c) => {
            const st = c.startSec ?? 0;
            const dur = Math.min(c.durationSec || 4, Math.max(0.4, bounds.clipDuration - st));
            return { ...c, durationSec: Number(dur.toFixed(2)) };
          });
      }

      const excludeUsedUrls = new Set<string>();
      const excludeVideoRangesByUrl = new Map<string, Array<[number, number]>>();

      if (isAppend) {
        const prevIntervals = getNormalizedManualClipIntervals(normalizedPrev);
        startOffsetSec =
          prevIntervals.length > 0 ? prevIntervals[prevIntervals.length - 1].endSec : 0;
        if (aud && startOffsetSec >= bounds.clipDuration - 0.45) {
          showError(tFor(langRef.current).errTimelineFullMusic);
          return;
        }
        for (const c of normalizedPrev) {
          if (!c.url) continue;
          if (c.kind === 'image') {
            excludeUsedUrls.add(c.url);
          } else if (c.kind === 'video') {
            const list = excludeVideoRangesByUrl.get(c.url) || [];
            const srcStart = Math.max(0, c.sourceStartSec || 0);
            const srcEnd = srcStart + Math.max(0.4, c.durationSec) * Math.max(0.25, c.playbackRate || 1);
            list.push([Number(srcStart.toFixed(2)), Number(srcEnd.toFixed(2))]);
            excludeVideoRangesByUrl.set(c.url, list);
          }
        }
      }

      const maxLimit = aud ? bounds.clipDuration : 3600;
      const placements = generateAutoClipPlan(
        binList,
        trackBeatGrid,
        cfg.manualBeatMarkers,
        bounds.trimBase,
        maxLimit,
        {
          mode: autoCfg.mode,
          rhythm: autoCfg.rhythm,
          transitionStyle: autoCfg.transitionStyle,
          motionLevel: autoCfg.motionLevel,
          minClipSec: autoCfg.minClipSec,
          maxClipSec: autoCfg.maxClipSec,
          targetDurationSec: autoCfg.targetDurationSec,
          startOffsetSec,
          avoidAdjacentRepeat: autoCfg.avoidAdjacentRepeat,
          shuffleOrder: autoCfg.shuffleOrder,
          excludeEdgeSec: autoCfg.excludeEdgeSec ?? 5,
          excludeUsedUrls: isAppend ? excludeUsedUrls : undefined,
          excludeVideoRangesByUrl: isAppend ? excludeVideoRangesByUrl : undefined,
          fillToTargetEnd: Boolean(aud),
          hasAudio: Boolean(aud),
          monoData: monoDataRef.current,
          sampleRate: aud?.sampleRate,
        }
      );
      if (placements.length === 0) {
        showError(tFor(langRef.current).errAutoClipEmpty);
        return;
      }

      pushImmediateHistory();
      if (!isAppend) {
        for (const prevClip of prevItems) {
          if (prevClip.kind === 'video') {
            detachClipVideoElement(prevClip.videoElement);
          }
        }
      }

      const binById = new Map(binList.map((b) => [b.id, b]));
      const builtClips: VisualMediaState[] = [];
      for (const p of placements) {
        const asset = binById.get(p.binItemId);
        if (!asset) continue;
        if (aud && p.startSec >= maxLimit - 0.1) continue;
        const clampedDur = aud
          ? Number(Math.max(0.4, Math.min(p.durationSec, maxLimit - p.startSec)).toFixed(2))
          : p.durationSec;
        const clip = buildClipFromBinItem(asset, {
          startSec: p.startSec,
          durationSec: clampedDur,
          sourceStartSec: p.sourceStartSec,
          playbackRate: p.playbackRate,
          // Always silence auto-generated video slices when master music is active so no leftover audio tracks collide
          clipAudioMuted: aud ? true : undefined,
        });
        builtClips.push({
          ...clip,
          clipAudioMuted: aud ? true : clip.clipAudioMuted,
          clipAudioVolume: aud ? 0 : clip.clipAudioVolume,
          transitionOut: p.transitionOut,
          transitionDurationSec: p.transitionDurationSec,
          transform: {
            ...clip.transform,
            scale: p.scaleStart,
            endScale: p.scaleEnd,
            easing: 'ease_in_out',
          },
        });
      }

      if (builtClips.length === 0) {
        showError(tFor(langRef.current).errAutoClipEmpty);
        return;
      }
      const nextItems = isAppend ? [...normalizedPrev, ...builtClips] : builtClips;
      setMediaItems(nextItems);
      setSelectedClipId(builtClips[0].id);
      setSelectedClipIds([builtClips[0].id]);
      setSelectedFxId(null);
      if (cfg.slideshowMode !== 'manual') {
        setConfig((prev) => ({ ...prev, slideshowMode: 'manual' }));
      }
      const focusLocal = isAppend ? startOffsetSec : 0;
      const focusAbs = (aud ? bounds.trimBase : 0) + focusLocal;
      currentTimeRef.current = focusAbs;
      setCurrentTime(focusAbs);

      // Pre-warm only the first slice of the new auto-clip block
      if (builtClips[0].kind === 'video' && builtClips[0].videoElement) {
        if (!builtClips[0].videoElement.getAttribute('src') && builtClips[0].url) {
          builtClips[0].videoElement.src = builtClips[0].url;
        }
        builtClips[0].videoElement.preload = 'auto';
      }

      // Keep timeline fitted cleanly to the viewport at 1× zoom so clips never extend past screen edge
      setAutoTimelineZoomSignal({
        nonce: Date.now(),
        targetZoom: 1,
        focusStartSec: focusLocal,
      });
    },
    [
      beatCutTimestamps,
      buildClipFromBinItem,
      getEffectiveTimelineBounds,
      pushImmediateHistory,
      showError,
      stopPlayback,
      trackBeatGrid,
    ]
  );

  const handleRemoveBinItem = useCallback(
    (binItemId: string) => {
      const target = mediaBinRef.current.find((b) => b.id === binItemId);
      if (!target) return;
      pushImmediateHistory();
      setMediaBin((prev) => prev.filter((b) => b.id !== binItemId));
      const usedElsewhere =
        mediaItemsRef.current.some((m) => m.url === target.url) ||
        audioRef.current?.metadata.embeddedCoverUrl === target.url;
      if (!usedElsewhere && target.url.startsWith('blob:')) {
        URL.revokeObjectURL(target.url);
      }
    },
    [pushImmediateHistory]
  );

  const handleClearBin = useCallback(() => {
    if (mediaBinRef.current.length === 0) return;
    pushImmediateHistory();
    const prevBin = mediaBinRef.current;
    setMediaBin([]);
    for (const target of prevBin) {
      const usedElsewhere =
        mediaItemsRef.current.some((m) => m.url === target.url) ||
        audioRef.current?.metadata.embeddedCoverUrl === target.url;
      if (!usedElsewhere && target.url.startsWith('blob:')) {
        URL.revokeObjectURL(target.url);
      }
    }
  }, [pushImmediateHistory]);

  const handleAddGeneratorScene = useCallback(
    (effect: Exclude<GeneratorEffectId, 'none'>, snapshotGlobalParams = false) => {
      pushImmediateHistory();
      const id = createItemId();
      const meta = GENERATOR_EFFECTS.find((g) => g.id === effect);
      const fileName = meta ? (lang === 'ru' ? meta.nameRu : meta.nameEn) : effect;
      const cfg = configRef.current;
      const generatorParams = snapshotGlobalParams
        ? {
            speed: cfg.generatorSpeed,
            scale: cfg.generatorScale,
            beatReact: cfg.generatorBeatReact,
            complexity: cfg.generatorComplexity,
            warp: cfg.generatorWarp,
            symmetry: cfg.generatorSymmetry,
            rotationSpeed: cfg.generatorRotationSpeed,
            hueShift: cfg.generatorHueShift,
            glow: cfg.generatorGlow,
          }
        : undefined;

      const bounds = getEffectiveTimelineBounds(cfg, mediaItemsRef.current, audioRef.current);
      const maxTimeline = audioRef.current ? bounds.clipDuration : 3600;
      const playheadLocalSec = Math.max(
        0,
        Number((currentTimeRef.current - bounds.trimBase).toFixed(2))
      );

      const newScene: VisualMediaState = {
        id,
        kind: 'generator',
        fileName,
        url: '',
        width: 1920,
        height: 1080,
        startSec: cfg.slideshowMode === 'manual' ? playheadLocalSec : undefined,
        durationSec: 5.0,
        sourceStartSec: 0,
        playbackRate: 1.0,
        transitionOut: 'crossfade',
        transitionDurationSec: 0.65,
        generatorId: effect,
        generatorParams,
        transform: { ...DEFAULT_CLIP_TRANSFORM },
        clipAudioVolume: 0,
        clipAudioMuted: true,
      };

      setMediaItems((prev) =>
        cfg.slideshowMode === 'manual'
          ? insertManualClipAtAnchor(prev, newScene, playheadLocalSec, maxTimeline)
          : insertClipAfterSelection(prev, newScene, selectedClipIdRef.current)
      );
      setSelectedClipId(id);
      setSelectedFxId(null);
    },
    [getEffectiveTimelineBounds, lang, pushImmediateHistory]
  );

  const handleUpdateClip = useCallback(
    (id: string, patch: Partial<VisualMediaState>) => {
      queueDebouncedHistory();
      const cfg = configRef.current;
      const needsModeSwitch =
        (patch.durationSec !== undefined ||
          ((patch.transitionOut !== undefined || patch.transitionDurationSec !== undefined) &&
            mediaItemsRef.current.length > 1)) &&
        cfg.slideshowMode !== 'custom_durations' &&
        cfg.slideshowMode !== 'manual';

      const bounds = needsModeSwitch
        ? getEffectiveTimelineBounds(cfg, mediaItemsRef.current, audioRef.current)
        : null;

      setMediaItems((prev) => {
        const base =
          needsModeSwitch && bounds
            ? snapshotSegmentDurations(prev, bounds.clipDuration, cfg, beatCutTimestamps)
            : prev;

        if (cfg.slideshowMode === 'manual' && patch.durationSec !== undefined) {
          const { durationSec, ...restPatch } = patch;
          const withExtra =
            Object.keys(restPatch).length > 0
              ? base.map((item) => (item.id === id ? { ...item, ...restPatch } : item))
              : base;
          const maxTimeline = audioRef.current
            ? getEffectiveTimelineBounds(cfg, withExtra, audioRef.current).clipDuration
            : 3600;
          return resizeManualClipDuration(
            withExtra,
            id,
            durationSec,
            maxTimeline,
            cfg.timelineStretchMode ?? 'push'
          );
        }
        return base.map((item) => (item.id === id ? { ...item, ...patch } : item));
      });
      if (needsModeSwitch) {
        setConfig((prev) => ({ ...prev, slideshowMode: 'custom_durations' }));
      }
      if (!isPlayingRef.current && patch.sourceStartSec !== undefined) {
        const curBounds = getEffectiveTimelineBounds(cfg, mediaItemsRef.current, audioRef.current);
        const segs = computeClipTimelineSegments(
          mediaItemsRef.current,
          curBounds.clipDuration,
          cfg,
          beatCutTimestamps
        );
        const clipIdx = mediaItemsRef.current.findIndex((m) => m.id === id);
        const seg = segs.find((s) => s.clipIndex === clipIdx);
        const curLocal = Math.max(0, currentTimeRef.current - curBounds.trimBase);
        if (seg && (curLocal < seg.startSec || curLocal >= seg.endSec)) {
          const nextAbs = curBounds.trimBase + seg.startSec + Math.min(0.02, (seg.endSec - seg.startSec) * 0.1);
          currentTimeRef.current = nextAbs;
          setCurrentTime(nextAbs);
        }
      }
    },
    [beatCutTimestamps, getEffectiveTimelineBounds, queueDebouncedHistory]
  );

  const handleMoveClipPosition = useCallback(
    (clipId: string, rawStartSec: number, disableSnap = false) => {
      const cfg = configRef.current;
      const items = mediaItemsRef.current;
      if (cfg.slideshowMode !== 'manual') return;
      queueDebouncedHistory();
      const bounds = getEffectiveTimelineBounds(cfg, items, audioRef.current);
      const maxTimeline = audioRef.current ? bounds.clipDuration : 3600;
      const beats = trackBeatGrid.beats.length > 0 ? [0, ...trackBeatGrid.beats] : [];
      const clampedStart = clampManualClipMove(
        items,
        clipId,
        rawStartSec,
        maxTimeline,
        beats,
        disableSnap ? false : cfg.snapToBeats,
        !disableSnap
      );
      setMediaItems((prev) =>
        prev
          .map((m) => (m.id === clipId ? { ...m, startSec: clampedStart } : m))
          .sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0))
      );
    },
    [getEffectiveTimelineBounds, queueDebouncedHistory, trackBeatGrid.beats]
  );

  const handleMoveClipGroup = useCallback(
    (clipIds: string[], rawTargetStartSec: number) => {
      const cfg = configRef.current;
      const items = mediaItemsRef.current;
      if (cfg.slideshowMode !== 'manual' || clipIds.length === 0) return;
      queueDebouncedHistory();
      const bounds = getEffectiveTimelineBounds(cfg, items, audioRef.current);
      const maxTimeline = audioRef.current ? bounds.clipDuration : 3600;
      const beats = trackBeatGrid.beats.length > 0 ? [0, ...trackBeatGrid.beats] : [];
      setMediaItems((prev) =>
        moveManualClipGroup(prev, clipIds, rawTargetStartSec, maxTimeline, beats, cfg.snapToBeats)
      );
    },
    [getEffectiveTimelineBounds, queueDebouncedHistory, trackBeatGrid.beats]
  );

  const handleCloseTimelineGap = useCallback(
    (gapStartSec: number, gapEndSec: number) => {
      const cfg = configRef.current;
      const items = mediaItemsRef.current;
      if (items.length === 0) return;
      pushImmediateHistory();
      const bounds = getEffectiveTimelineBounds(cfg, items, audioRef.current);
      const maxTimeline = audioRef.current ? bounds.clipDuration : 3600;
      const beats = trackBeatGrid.beats.length > 0 ? [0, ...trackBeatGrid.beats] : [];
      setMediaItems((prev) =>
        closeManualTimelineGap(
          prev,
          gapStartSec,
          gapEndSec,
          beats,
          Boolean(cfg.snapToBeats),
          audioRef.current ? maxTimeline : undefined
        )
      );
      if (cfg.slideshowMode !== 'manual') {
        setConfig((prev) => ({ ...prev, slideshowMode: 'manual' }));
      }
    },
    [getEffectiveTimelineBounds, pushImmediateHistory, trackBeatGrid.beats]
  );

  const handleCloseAllGaps = useCallback(
    (fitBeatsAndMusic = true) => {
      const cfg = configRef.current;
      const items = mediaItemsRef.current;
      if (items.length === 0) return;
      pushImmediateHistory();
      const bounds = getEffectiveTimelineBounds(cfg, items, audioRef.current);
      const maxTimeline = audioRef.current ? bounds.clipDuration : 3600;
      const beats = trackBeatGrid.beats.length > 0 ? [0, ...trackBeatGrid.beats] : [];
      setMediaItems((prev) =>
        closeAllManualGapsAndFitBeats(
          prev,
          beats,
          maxTimeline,
          fitBeatsAndMusic && Boolean(audioRef.current)
        )
      );
      if (cfg.slideshowMode !== 'manual') {
        setConfig((prev) => ({ ...prev, slideshowMode: 'manual' }));
      }
    },
    [getEffectiveTimelineBounds, pushImmediateHistory, trackBeatGrid.beats]
  );

  const handleTrimClipLeftEdge = useCallback(
    (
      clipId: string,
      nextStartSec: number,
      nextDurSec: number,
      nextSourceStartSec?: number
    ) => {
      const cfg = configRef.current;
      if (cfg.slideshowMode !== 'manual') return;
      queueDebouncedHistory();
      const hasAud = Boolean(audioRef.current);
      const maxTimeline = hasAud
        ? getEffectiveTimelineBounds(cfg, mediaItemsRef.current, audioRef.current).clipDuration
        : 3600;
      const stretchMode = cfg.timelineStretchMode ?? 'push';
      setMediaItems((prev) => {
        const clampedStart = Math.max(
          0,
          Math.min(hasAud ? Math.max(0, maxTimeline - 0.4) : 3600, Number(nextStartSec.toFixed(2)))
        );
        const clampedDur = Math.max(
          0.4,
          Math.min(
            hasAud ? Math.max(0.4, maxTimeline - clampedStart) : 600,
            Number(nextDurSec.toFixed(2))
          )
        );
        const targetEnd = Number((clampedStart + clampedDur).toFixed(2));
        return prev
          .map((m) => {
            if (m.id === clipId) {
              return {
                ...m,
                startSec: clampedStart,
                durationSec: clampedDur,
                sourceStartSec:
                  nextSourceStartSec !== undefined
                    ? Math.max(0, Number(nextSourceStartSec.toFixed(2)))
                    : m.sourceStartSec,
              };
            }
            if (stretchMode === 'overlap') {
              const mStart = Math.max(0, m.startSec ?? 0);
              const mEnd = mStart + Math.max(0.4, m.durationSec || 4);
              if (mStart >= clampedStart - 0.005 && mEnd <= targetEnd + 0.01) {
                return null;
              }
              if (mStart < clampedStart && mEnd > clampedStart + 0.01) {
                const remDur = Number((clampedStart - mStart).toFixed(2));
                if (remDur < 0.4) return null;
                return { ...m, durationSec: remDur };
              }
            }
            return m;
          })
          .filter((m): m is VisualMediaState => m !== null);
      });
    },
    [getEffectiveTimelineBounds, queueDebouncedHistory]
  );

  const handleSelectClip = useCallback(
    (id: string, modifiers?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
      setSelectedFxId(null);
      if (modifiers?.metaKey || modifiers?.ctrlKey) {
        const prev = selectedClipIdsRef.current.length > 0
          ? selectedClipIdsRef.current
          : selectedClipIdRef.current
            ? [selectedClipIdRef.current]
            : [];
        const exists = prev.includes(id);
        const next = exists ? prev.filter((x) => x !== id) : [...prev, id];
        if (next.length === 0) {
          setSelectedClipIds([id]);
          setSelectedClipId(id);
        } else {
          setSelectedClipIds(next);
          setSelectedClipId(exists ? next[next.length - 1] : id);
        }
        return;
      }
      if (modifiers?.shiftKey && selectedClipIdRef.current) {
        const ordered =
          configRef.current.slideshowMode === 'manual'
            ? [...mediaItemsRef.current].sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0))
            : mediaItemsRef.current;
        const idxA = ordered.findIndex((c) => c.id === selectedClipIdRef.current);
        const idxB = ordered.findIndex((c) => c.id === id);
        if (idxA >= 0 && idxB >= 0) {
          const lo = Math.min(idxA, idxB);
          const hi = Math.max(idxA, idxB);
          setSelectedClipIds(ordered.slice(lo, hi + 1).map((c) => c.id));
          setSelectedClipId(id);
          return;
        }
      }
      setSelectedClipId(id);
      setSelectedClipIds([id]);
    },
    []
  );

  const handleSelectFx = useCallback((id: string | null) => {
    setSelectedFxId(id);
  }, []);

  const handleInspectClip = useCallback((id: string) => {
    setSelectedClipId(id);
    setSelectedClipIds([id]);
    setSelectedFxId(null);
    setActiveTab('clip');
  }, []);

  const handleInspectFx = useCallback((id: string) => {
    setSelectedFxId(id);
    setActiveTab('generator');
  }, []);

  const handleDuplicateClip = useCallback(
    (id: string) => {
      const prev = mediaItemsRef.current;
      const idx = prev.findIndex((item) => item.id === id);
      if (idx === -1) return;
      pushImmediateHistory();
      const orig = prev[idx];
      const newId = createItemId();

      let clonedVideo: HTMLVideoElement | undefined;
      if (orig.kind === 'video' && orig.url) {
        clonedVideo = document.createElement('video');
        clonedVideo.muted = true;
        clonedVideo.loop = true;
        clonedVideo.playsInline = true;
        clonedVideo.preload = 'metadata';
        clonedVideo.src = orig.url;
      }

      let dupStart = orig.startSec;
      let dupDur = orig.durationSec;
      if (configRef.current.slideshowMode === 'manual') {
        const bounds = getEffectiveTimelineBounds(
          configRef.current,
          prev,
          audioRef.current
        );
        const origInterval = getNormalizedManualClipIntervals(prev).find((iv) => iv.id === orig.id);
        const desiredStart = origInterval ? origInterval.endSec : 0;
        const slot = findManualInsertionSlot(
          prev,
          desiredStart,
          orig.durationSec,
          audioRef.current ? bounds.clipDuration : 3600
        );
        dupStart = slot.startSec;
        dupDur = slot.durationSec;
      }

      const copyItem: VisualMediaState = {
        ...orig,
        id: newId,
        startSec: dupStart,
        durationSec: dupDur,
        transform: { ...(orig.transform || DEFAULT_CLIP_TRANSFORM) },
        generatorParams: orig.generatorParams ? { ...orig.generatorParams } : undefined,
        overlayEffect: orig.overlayEffect
          ? {
              ...orig.overlayEffect,
              params: orig.overlayEffect.params ? { ...orig.overlayEffect.params } : undefined,
            }
          : undefined,
        videoElement: orig.kind === 'video' ? clonedVideo : undefined,
      };

      const next = [...prev];
      if (configRef.current.slideshowMode === 'manual') {
        next.push(copyItem);
        next.sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
      } else {
        next.splice(idx + 1, 0, copyItem);
      }
      setMediaItems(next);
      setSelectedClipId(newId);
      setSelectedFxId(null);
    },
    [getEffectiveTimelineBounds, pushImmediateHistory]
  );

  const handleAddFxOverlay = useCallback(
    (
      effect: Exclude<GeneratorEffectId, 'none'>,
      target: 'clip' | 'playhead' = 'clip',
      snapshotGlobalParams = false,
      explicitSpan?: { startSec: number; durationSec: number }
    ) => {
      const cfg = configRef.current;
      const items = mediaItemsRef.current;
      const bounds = getEffectiveTimelineBounds(cfg, items, audioRef.current);
      const segments = computeClipTimelineSegments(
        items,
        bounds.clipDuration,
        cfg,
        beatCutTimestamps
      );

      let startSec = 0;
      let durationSec = Math.min(4.0, bounds.clipDuration);

      if (explicitSpan) {
        startSec = Math.max(0, Math.min(bounds.clipDuration - 0.4, explicitSpan.startSec));
        durationSec = Math.max(0.4, Math.min(bounds.clipDuration - startSec, explicitSpan.durationSec));
      } else if (target === 'clip' && items.length > 0) {
        const targetClipIdx = items.findIndex(
          (m) => m.id === (selectedClipIdRef.current || items[0].id)
        );
        const seg = segments.find((s) => s.clipIndex === targetClipIdx);
        if (seg) {
          startSec = seg.startSec;
          durationSec = Math.max(0.4, seg.endSec - seg.startSec);
        }
      } else {
        const relPlayhead = Math.max(
          0,
          Math.min(bounds.clipDuration - 0.5, currentTimeRef.current - bounds.trimBase)
        );
        startSec = relPlayhead;
        if (cfg.snapToBeats && trackBeatGrid.beats.length > 1) {
          startSec = snapTimeToBeat(startSec, [0, ...trackBeatGrid.beats], 0.35);
        }
        durationSec = Math.max(0.5, Math.min(4.0, bounds.clipDuration - startSec));
      }

      const meta = GENERATOR_EFFECTS.find((g) => g.id === effect);
      const name = meta ? (lang === 'ru' ? meta.nameRu : meta.nameEn) : effect;
      const id = `fx-${createItemId()}`;
      const newFx: TimelineGeneratorOverlay = {
        id,
        generatorId: effect,
        name,
        startSec: Number(startSec.toFixed(2)),
        durationSec: Number(durationSec.toFixed(2)),
        blend: 'screen',
        opacity: 0.72,
        fadeSec: 0.35,
        params: snapshotGlobalParams
          ? {
              speed: cfg.generatorSpeed,
              scale: cfg.generatorScale,
              beatReact: cfg.generatorBeatReact,
              complexity: cfg.generatorComplexity,
              warp: cfg.generatorWarp,
              symmetry: cfg.generatorSymmetry,
              rotationSpeed: cfg.generatorRotationSpeed,
              hueShift: cfg.generatorHueShift,
              glow: cfg.generatorGlow,
            }
          : undefined,
      };

      pushImmediateHistory();
      setConfig((prev) => ({
        ...prev,
        fxOverlays: [...(prev.fxOverlays || []), newFx],
      }));
      setSelectedFxId(id);
    },
    [beatCutTimestamps, getEffectiveTimelineBounds, lang, pushImmediateHistory, trackBeatGrid.beats]
  );

  const handleUpdateFxOverlay = useCallback(
    (id: string, patch: Partial<TimelineGeneratorOverlay>) => {
      queueDebouncedHistory();
      setConfig((prev) => ({
        ...prev,
        fxOverlays: (prev.fxOverlays || []).map((fx) =>
          fx.id === id ? { ...fx, ...patch } : fx
        ),
      }));
    },
    [queueDebouncedHistory]
  );

  const handleDuplicateFxOverlay = useCallback(
    (id: string) => {
      const list = configRef.current.fxOverlays || [];
      const idx = list.findIndex((fx) => fx.id === id);
      if (idx === -1) return;
      const orig = list[idx];
      const bounds = getEffectiveTimelineBounds(
        configRef.current,
        mediaItemsRef.current,
        audioRef.current
      );
      const newId = `fx-${createItemId()}`;
      const nextStart = Math.min(
        Math.max(0, bounds.clipDuration - orig.durationSec),
        orig.startSec + Math.min(orig.durationSec, 1.5)
      );
      const copy: TimelineGeneratorOverlay = {
        ...orig,
        id: newId,
        startSec: Number(nextStart.toFixed(2)),
        params: orig.params ? { ...orig.params } : undefined,
      };
      pushImmediateHistory();
      const nextList = [...list];
      nextList.splice(idx + 1, 0, copy);
      setConfig((prev) => ({ ...prev, fxOverlays: nextList }));
      setSelectedFxId(newId);
    },
    [getEffectiveTimelineBounds, pushImmediateHistory]
  );

  const handleRemoveFxOverlay = useCallback(
    (id: string) => {
      const list = configRef.current.fxOverlays || [];
      if (!list.some((fx) => fx.id === id)) return;
      pushImmediateHistory();
      setConfig((prev) => ({
        ...prev,
        fxOverlays: (prev.fxOverlays || []).filter((fx) => fx.id !== id),
      }));
      if (selectedFxIdRef.current === id) {
        setSelectedFxId(null);
      }
      showUndoToast(tFor(langRef.current).toastFxDeleted);
    },
    [pushImmediateHistory, showUndoToast]
  );

  const handleFitFxToSelectedClip = useCallback(
    (fxId: string) => {
      const items = mediaItemsRef.current;
      if (items.length === 0) return;
      const bounds = getEffectiveTimelineBounds(configRef.current, items, audioRef.current);
      const segments = computeClipTimelineSegments(
        items,
        bounds.clipDuration,
        configRef.current,
        beatCutTimestamps
      );
      const targetIdx = items.findIndex(
        (m) => m.id === (selectedClipIdRef.current || items[0].id)
      );
      const seg = segments.find((s) => s.clipIndex === targetIdx);
      if (!seg) return;
      pushImmediateHistory();
      setConfig((prev) => ({
        ...prev,
        fxOverlays: (prev.fxOverlays || []).map((fx) =>
          fx.id === fxId
            ? {
                ...fx,
                startSec: Number(seg.startSec.toFixed(2)),
                durationSec: Number(Math.max(0.4, seg.endSec - seg.startSec).toFixed(2)),
              }
            : fx
        ),
      }));
    },
    [beatCutTimestamps, getEffectiveTimelineBounds, pushImmediateHistory]
  );

  const handleSnapFxOverlaysToBeats = useCallback(() => {
    const list = configRef.current.fxOverlays || [];
    if (list.length === 0) return;
    const bounds = getEffectiveTimelineBounds(
      configRef.current,
      mediaItemsRef.current,
      audioRef.current
    );
    pushImmediateHistory();
    setConfig((prev) => ({
      ...prev,
      fxOverlays: (prev.fxOverlays || []).map((fx) => {
        const snapped = snapFxOverlayToBeats(
          fx.startSec,
          fx.durationSec,
          trackBeatGrid,
          bounds.clipDuration
        );
        return { ...fx, startSec: snapped.startSec, durationSec: snapped.durationSec };
      }),
    }));
  }, [getEffectiveTimelineBounds, pushImmediateHistory, trackBeatGrid]);

  const handleApplyClipOverlay = useCallback(
    (
      clipId: string,
      effect: GeneratorEffectId,
      blend: OverlayBlendMode = 'screen',
      opacity = 0.68,
      snapshotGlobalParams = false
    ) => {
      pushImmediateHistory();
      if (effect === 'none') {
        setMediaItems((prev) =>
          prev.map((m) => (m.id === clipId ? { ...m, overlayEffect: undefined } : m))
        );
        return;
      }
      const cfg = configRef.current;
      const overlay: ClipOverlayGenerator = {
        effect,
        blend,
        opacity,
        params: snapshotGlobalParams
          ? {
              speed: cfg.generatorSpeed,
              scale: cfg.generatorScale,
              beatReact: cfg.generatorBeatReact,
              complexity: cfg.generatorComplexity,
              warp: cfg.generatorWarp,
              symmetry: cfg.generatorSymmetry,
              rotationSpeed: cfg.generatorRotationSpeed,
              hueShift: cfg.generatorHueShift,
              glow: cfg.generatorGlow,
            }
          : undefined,
      };
      setMediaItems((prev) =>
        prev.map((m) => (m.id === clipId ? { ...m, overlayEffect: overlay } : m))
      );
    },
    [pushImmediateHistory]
  );

  const handleMoveClipOverlayToFxTrack = useCallback(
    (clipId: string) => {
      const items = mediaItemsRef.current;
      const clipIdx = items.findIndex((m) => m.id === clipId);
      if (clipIdx === -1) return;
      const clip = items[clipIdx];
      if (!clip.overlayEffect) return;

      const bounds = getEffectiveTimelineBounds(configRef.current, items, audioRef.current);
      const segments = computeClipTimelineSegments(
        items,
        bounds.clipDuration,
        configRef.current,
        beatCutTimestamps
      );
      const seg = segments.find((s) => s.clipIndex === clipIdx);
      const span = seg
        ? { startSec: seg.startSec, durationSec: Math.max(0.4, seg.endSec - seg.startSec) }
        : { startSec: 0, durationSec: Math.max(0.5, clip.durationSec) };

      const ov = clip.overlayEffect;
      const meta = GENERATOR_EFFECTS.find((g) => g.id === ov.effect);
      const name = meta ? (lang === 'ru' ? meta.nameRu : meta.nameEn) : ov.effect;
      const fxId = `fx-${createItemId()}`;
      const newFx: TimelineGeneratorOverlay = {
        id: fxId,
        generatorId: ov.effect,
        name,
        startSec: Number(span.startSec.toFixed(2)),
        durationSec: Number(span.durationSec.toFixed(2)),
        blend: ov.blend,
        opacity: ov.opacity,
        fadeSec: 0.35,
        params: ov.params ? { ...ov.params } : undefined,
      };

      pushImmediateHistory();
      setMediaItems((prev) =>
        prev.map((m) => (m.id === clipId ? { ...m, overlayEffect: undefined } : m))
      );
      setConfig((prev) => ({
        ...prev,
        fxOverlays: [...(prev.fxOverlays || []), newFx],
      }));
      setSelectedFxId(fxId);
      setActiveTab('generator');
    },
    [beatCutTimestamps, getEffectiveTimelineBounds, lang, pushImmediateHistory]
  );

  const handleFitClipsToAudio = useCallback(() => {
    if (!audioRef.current || mediaItemsRef.current.length === 0) return;
    pushImmediateHistory();
    const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);
    const perClip = Number(Math.max(0.5, clipDuration / mediaItemsRef.current.length).toFixed(2));
    setMediaItems((prev) =>
      prev.map((item, idx) => ({
        ...item,
        startSec: Number((idx * perClip).toFixed(2)),
        durationSec: perClip,
      }))
    );
    if (configRef.current.slideshowMode !== 'manual') {
      setConfig((prev) => ({ ...prev, slideshowMode: 'custom_durations' }));
    }
  }, [config.trimEnd, config.trimStart, pushImmediateHistory]);

  const handleAutoBeatSyncClips = useCallback(
    (mode: BeatSyncMode = 'fit_track', applyMotionAndTrans = false) => {
      const items = mediaItemsRef.current;
      const aud = audioRef.current;
      if (!aud || items.length === 0) return;
      pushImmediateHistory();
      const bounds = getEffectiveTimelineBounds(configRef.current, items, aud);
      const plan = computeAutoBeatAlignedClips(
        items.length,
        bounds.clipDuration,
        trackBeatGrid,
        configRef.current.manualBeatMarkers,
        bounds.trimBase,
        mode,
        monoDataRef.current,
        aud.sampleRate
      );
      let cursor = 0;
      setMediaItems((prev) => {
        const updated: VisualMediaState[] = [];
        for (let i = 0; i < prev.length; i++) {
          const clip = prev[i];
          const p = plan[i];
          if (!p) continue;
          const remaining = bounds.clipDuration - cursor;
          if (remaining < 0.4) break;
          const clippedDur = Number(Math.min(p.durationSec, remaining).toFixed(2));
          const baseTransform = clip.transform || DEFAULT_CLIP_TRANSFORM;
          const clipStart = Number(cursor.toFixed(2));
          cursor += clippedDur;
          const nextTransitionOut = applyMotionAndTrans
            ? p.suggestedTransition
            : clip.transitionOut;
          const nextTransitionDur = applyMotionAndTrans
            ? p.transitionDurationSec
            : nextTransitionOut === 'cut'
              ? 0
              : Number(
                  Math.max(
                    0.14,
                    Math.min(clip.transitionDurationSec || 0.45, Math.max(0.14, clippedDur * 0.85))
                  ).toFixed(2)
                );
          updated.push({
            ...clip,
            startSec: clipStart,
            durationSec: clippedDur,
            transitionDurationSec: nextTransitionDur,
            transitionOut: nextTransitionOut,
            clipAudioMuted: true,
            clipAudioVolume: 0,
            transform: applyMotionAndTrans
              ? {
                  ...baseTransform,
                  scale: p.suggestedScaleStart,
                  endScale: p.suggestedScaleEnd,
                  easing: 'ease_in_out',
                }
              : clip.transform,
          });
        }
        return updated;
      });
      if (configRef.current.slideshowMode !== 'manual') {
        setConfig((prev) => ({ ...prev, slideshowMode: 'custom_durations' }));
      }
      setAutoTimelineZoomSignal({
        nonce: Date.now(),
        targetZoom: 1,
        focusStartSec: 0,
      });
    },
    [getEffectiveTimelineBounds, pushImmediateHistory, trackBeatGrid]
  );

  const handleMuteAllClipAudio = useCallback(
    (muted = true) => {
      if (mediaItemsRef.current.length === 0 && mediaBinRef.current.length === 0) return;
      pushImmediateHistory();
      setMediaItems((prev) =>
        prev.map((m) =>
          m.kind === 'video'
            ? {
                ...m,
                clipAudioMuted: muted,
                clipAudioVolume: muted ? 0 : m.clipAudioVolume > 0.05 ? m.clipAudioVolume : 0.8,
              }
            : m
        )
      );
      setMediaBin((prev) =>
        prev.map((b) =>
          b.kind === 'video' ? { ...b, defaultClipAudioMuted: muted } : b
        )
      );
      showUndoToast(
        muted ? tFor(langRef.current).allClipsMutedToast : tFor(langRef.current).allClipsUnmutedToast
      );
    },
    [pushImmediateHistory, showUndoToast]
  );

  const handleFitTrimToClips = useCallback(() => {
    const aud = audioRef.current;
    const items = mediaItemsRef.current;
    if (!aud || items.length === 0) return;
    pushImmediateHistory();
    const totalClips = getTimelineSpanSec(items, configRef.current);
    setConfig((prev) => {
      const nextEnd = Math.min(aud.duration, prev.trimStart + Math.max(0.5, totalClips));
      return {
        ...prev,
        trimPreset: 'custom',
        trimEnd: Number(nextEnd.toFixed(2)),
        slideshowMode: prev.slideshowMode === 'manual' ? 'manual' : 'custom_durations',
      };
    });
  }, [pushImmediateHistory]);

  const handleReverseClips = useCallback(() => {
    if (mediaItemsRef.current.length < 2) return;
    pushImmediateHistory();
    setMediaItems((prev) => {
      if (configRef.current.slideshowMode !== 'manual') {
        return [...prev].reverse();
      }
      const hasAud = Boolean(audioRef.current);
      const maxTimeline = hasAud
        ? getEffectiveTimelineBounds(configRef.current, prev, audioRef.current).clipDuration
        : 3600;
      const intervals = getNormalizedManualClipIntervals(prev);
      const totalDur = intervals.reduce((s, iv) => s + iv.durationSec, 0);
      let cursor =
        intervals.length > 0
          ? hasAud && intervals[0].startSec + totalDur > maxTimeline
            ? 0
            : intervals[0].startSec
          : 0;
      const byId = new Map(prev.map((m) => [m.id, m]));
      const ordered = [...intervals].reverse().map((iv) => byId.get(iv.id)!).filter(Boolean);
      const out: VisualMediaState[] = [];
      for (const m of ordered) {
        if (hasAud && cursor >= maxTimeline - 0.4) break;
        const dur = Math.max(0.4, m.durationSec || 4);
        const start = Number(cursor.toFixed(2));
        const clampedDur = hasAud
          ? Number(Math.max(0.4, Math.min(dur, maxTimeline - start)).toFixed(2))
          : dur;
        cursor += clampedDur;
        out.push({ ...m, startSec: start, durationSec: clampedDur });
      }
      return out;
    });
  }, [getEffectiveTimelineBounds, pushImmediateHistory]);

  const handleSetClipTransition = useCallback(
    (id: string, transitionOut: SlideTransitionType, applyAll = false) => {
      pushImmediateHistory();
      if (applyAll) {
        setConfig((prev) => ({ ...prev, transitionType: transitionOut }));
        setMediaItems((prev) => prev.map((m) => ({ ...m, transitionOut })));
      } else {
        const cfg = configRef.current;
        const needsModeSwitch =
          mediaItemsRef.current.length > 1 &&
          cfg.slideshowMode !== 'custom_durations' &&
          cfg.slideshowMode !== 'manual';
        const bounds = needsModeSwitch
          ? getEffectiveTimelineBounds(cfg, mediaItemsRef.current, audioRef.current)
          : null;
        setMediaItems((prev) => {
          const base =
            needsModeSwitch && bounds
              ? snapshotSegmentDurations(prev, bounds.clipDuration, cfg, beatCutTimestamps)
              : prev;
          return base.map((m) => (m.id === id ? { ...m, transitionOut } : m));
        });
        if (needsModeSwitch) {
          setConfig((prev) => ({ ...prev, slideshowMode: 'custom_durations' }));
        }
      }
    },
    [beatCutTimestamps, getEffectiveTimelineBounds, pushImmediateHistory]
  );

  const handleMaterializeLoopSegment = useCallback(
    (upToStepIndex: number) => {
      const items = mediaItemsRef.current;
      const cfg = configRef.current;
      if (items.length === 0) return;
      const bounds = getEffectiveTimelineBounds(cfg, items, audioRef.current);
      const segments = computeClipTimelineSegments(
        items,
        bounds.clipDuration,
        cfg,
        beatCutTimestamps
      );
      if (upToStepIndex < items.length || upToStepIndex >= segments.length) return;

      pushImmediateHistory();
      const baseList = snapshotSegmentDurations(items, bounds.clipDuration, cfg, beatCutTimestamps);
      const additions: VisualMediaState[] = [];
      for (let i = items.length; i <= upToStepIndex; i++) {
        const seg = segments[i];
        const orig = items[seg.clipIndex];
        if (!orig) continue;
        const newId = createItemId();
        let clonedVideo: HTMLVideoElement | undefined;
        if (orig.kind === 'video' && orig.url) {
          clonedVideo = document.createElement('video');
          clonedVideo.muted = true;
          clonedVideo.loop = true;
          clonedVideo.playsInline = true;
          clonedVideo.preload = 'metadata';
          clonedVideo.src = orig.url;
        }
        additions.push({
          ...orig,
          id: newId,
          durationSec: Math.max(0.5, Number((seg.endSec - seg.startSec).toFixed(2))),
          transform: { ...(orig.transform || DEFAULT_CLIP_TRANSFORM) },
          generatorParams: orig.generatorParams ? { ...orig.generatorParams } : undefined,
          overlayEffect: orig.overlayEffect
            ? {
                ...orig.overlayEffect,
                params: orig.overlayEffect.params ? { ...orig.overlayEffect.params } : undefined,
              }
            : undefined,
          videoElement: orig.kind === 'video' ? clonedVideo : undefined,
        });
      }
      const next = [...baseList, ...additions];
      setMediaItems(next);
      if (additions.length > 0) {
        setSelectedClipId(additions[additions.length - 1].id);
      }
      if (cfg.slideshowMode !== 'custom_durations') {
        setConfig((prev) => ({ ...prev, slideshowMode: 'custom_durations' }));
      }
    },
    [beatCutTimestamps, getEffectiveTimelineBounds, pushImmediateHistory]
  );

  const handleCycleClipTransition = useCallback(
    (id: string) => {
      const order: SlideTransitionType[] = [
        'crossfade',
        'zoom_cross',
        'wipe_right',
        'dip_black',
        'slide',
        'cut',
      ];
      pushImmediateHistory();
      if (
        configRef.current.slideshowMode !== 'custom_durations' &&
        configRef.current.slideshowMode !== 'manual'
      ) {
        setConfig((prev) => {
          const idx = order.indexOf(prev.transitionType);
          return { ...prev, transitionType: order[(idx + 1) % order.length] };
        });
        return;
      }
      setMediaItems((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          const idx = order.indexOf(m.transitionOut);
          return { ...m, transitionOut: order[(idx + 1) % order.length] };
        })
      );
    },
    [pushImmediateHistory]
  );

  const handleReorderClip = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx) return;
      pushImmediateHistory();
      setMediaItems((prev) => {
        if (fromIdx < 0 || toIdx < 0 || fromIdx >= prev.length || toIdx >= prev.length) {
          return prev;
        }
        if (configRef.current.slideshowMode !== 'manual') {
          const copy = [...prev];
          const [moved] = copy.splice(fromIdx, 1);
          copy.splice(toIdx, 0, moved);
          return copy;
        }
        const hasAud = Boolean(audioRef.current);
        const maxTimeline = hasAud
          ? getEffectiveTimelineBounds(configRef.current, prev, audioRef.current).clipDuration
          : 3600;
        const movedItem = prev[fromIdx];
        const targetItem = prev[toIdx];
        const intervals = getNormalizedManualClipIntervals(prev);
        const totalDur = intervals.reduce((s, iv) => s + iv.durationSec, 0);
        let cursor =
          intervals.length > 0
            ? hasAud && intervals[0].startSec + totalDur > maxTimeline
              ? 0
              : intervals[0].startSec
            : 0;
        const byId = new Map(prev.map((m) => [m.id, m]));
        const ordered = intervals.map((iv) => byId.get(iv.id)!).filter(Boolean);
        const oFrom = ordered.findIndex((m) => m.id === movedItem.id);
        const oTo = ordered.findIndex((m) => m.id === targetItem.id);
        if (oFrom >= 0 && oTo >= 0) {
          const [moved] = ordered.splice(oFrom, 1);
          ordered.splice(oTo, 0, moved);
        }
        const out: VisualMediaState[] = [];
        for (const m of ordered) {
          if (hasAud && cursor >= maxTimeline - 0.4) break;
          const dur = Math.max(0.4, m.durationSec || 4);
          const start = Number(cursor.toFixed(2));
          const clampedDur = hasAud
            ? Number(Math.max(0.4, Math.min(dur, maxTimeline - start)).toFixed(2))
            : dur;
          cursor += clampedDur;
          out.push({ ...m, startSec: start, durationSec: clampedDur });
        }
        return out;
      });
    },
    [getEffectiveTimelineBounds, pushImmediateHistory]
  );

  const handleMoveVisual = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= mediaItemsRef.current.length) return;
      handleReorderClip(index, target);
    },
    [handleReorderClip]
  );

  const handleSplitClipAtPlayhead = useCallback(() => {
    const items = mediaItemsRef.current;
    if (items.length === 0) return;
    const cfg = configRef.current;
    const bounds = getEffectiveTimelineBounds(cfg, items, audioRef.current);
    const clipDuration = bounds.clipDuration;
    const localTime = Math.max(0, Math.min(clipDuration, currentTimeRef.current - bounds.trimBase));
    const segments = computeClipTimelineSegments(
      items,
      clipDuration,
      cfg,
      beatCutTimestamps
    );
    if (segments.length === 0) return;

    let segIndex = segments.findIndex((s) => localTime >= s.startSec && localTime < s.endSec);
    if (segIndex === -1) segIndex = segments.length - 1;
    const seg = segments[segIndex];
    const targetClip = items[seg.clipIndex];
    if (!targetClip) return;

    const segDur = seg.endSec - seg.startSec;
    const offsetInSeg = localTime - seg.startSec;
    if (segDur < 1.0 || offsetInSeg < 0.35 || segDur - offsetInSeg < 0.35) return;

    pushImmediateHistory();
    const firstDur = Number(offsetInSeg.toFixed(2));
    const secondDur = Number((segDur - offsetInSeg).toFixed(2));

    const cloneClipVideo = (clip: VisualMediaState) => {
      if (clip.kind !== 'video' || !clip.url) return undefined;
      const vid = document.createElement('video');
      vid.muted = true;
      vid.loop = true;
      vid.playsInline = true;
      vid.preload = 'metadata';
      vid.src = clip.url;
      return vid;
    };

    const baseItems = snapshotSegmentDurations(items, clipDuration, cfg, beatCutTimestamps);
    let workingItems = [...baseItems];
    let targetReplaceIndex = seg.clipIndex;

    if (segIndex >= items.length) {
      // Playhead is inside a loop repeat: materialize repeated segments up to segIndex first
      for (let i = items.length; i <= segIndex; i++) {
        const repSeg = segments[i];
        const orig = items[repSeg.clipIndex];
        if (!orig) continue;
        workingItems.push({
          ...orig,
          id: createItemId(),
          durationSec: Math.max(0.5, Number((repSeg.endSec - repSeg.startSec).toFixed(2))),
          videoElement: cloneClipVideo(orig),
          transform: { ...(orig.transform || DEFAULT_CLIP_TRANSFORM) },
          generatorParams: orig.generatorParams ? { ...orig.generatorParams } : undefined,
          overlayEffect: orig.overlayEffect
            ? {
                ...orig.overlayEffect,
                params: orig.overlayEffect.params ? { ...orig.overlayEffect.params } : undefined,
              }
            : undefined,
        });
      }
      targetReplaceIndex = workingItems.length - 1;
    }

    const sourceForSplit = workingItems[targetReplaceIndex];
    if (!sourceForSplit) return;

    const newId = createItemId();
    const secondVideo = cloneClipVideo(sourceForSplit);

    const firstClip: VisualMediaState = {
      ...sourceForSplit,
      startSec: Number(seg.startSec.toFixed(2)),
      durationSec: firstDur,
      generatorParams: sourceForSplit.generatorParams ? { ...sourceForSplit.generatorParams } : undefined,
      overlayEffect: sourceForSplit.overlayEffect
        ? {
            ...sourceForSplit.overlayEffect,
            params: sourceForSplit.overlayEffect.params ? { ...sourceForSplit.overlayEffect.params } : undefined,
          }
        : undefined,
    };
    const secondClip: VisualMediaState = {
      ...sourceForSplit,
      id: newId,
      startSec: Number((seg.startSec + firstDur).toFixed(2)),
      durationSec: secondDur,
      sourceStartSec:
        sourceForSplit.kind === 'video'
          ? Number(
              (sourceForSplit.sourceStartSec + firstDur * (sourceForSplit.playbackRate || 1)).toFixed(2)
            )
          : sourceForSplit.sourceStartSec,
      videoElement: secondVideo,
      transform: { ...(sourceForSplit.transform || DEFAULT_CLIP_TRANSFORM) },
      generatorParams: sourceForSplit.generatorParams ? { ...sourceForSplit.generatorParams } : undefined,
      overlayEffect: sourceForSplit.overlayEffect
        ? {
            ...sourceForSplit.overlayEffect,
            params: sourceForSplit.overlayEffect.params ? { ...sourceForSplit.overlayEffect.params } : undefined,
          }
        : undefined,
    };

    workingItems.splice(targetReplaceIndex, 1, firstClip, secondClip);
    setMediaItems(workingItems);
    setSelectedClipId(newId);
    setSelectedFxId(null);
    if (cfg.slideshowMode !== 'custom_durations' && cfg.slideshowMode !== 'manual') {
      setConfig((prev) => ({ ...prev, slideshowMode: 'custom_durations' }));
    }
  }, [beatCutTimestamps, getEffectiveTimelineBounds, pushImmediateHistory]);

  const removeClipsByIds = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const prev = mediaItemsRef.current;
      const idSet = new Set(ids);
      const targets = prev.filter((item) => idSet.has(item.id));
      if (targets.length === 0) return;
      pushImmediateHistory();
      for (const target of targets) {
        if (target.kind === 'video') {
          detachClipVideoElement(target.videoElement);
        }
      }
      const cfg = configRef.current;
      let remaining = prev.filter((item) => !idSet.has(item.id));
      if (cfg.slideshowMode === 'manual' && cfg.autoRippleOnDelete && remaining.length > 0) {
        const bounds = getEffectiveTimelineBounds(cfg, prev, audioRef.current);
        const maxTimeline = audioRef.current ? bounds.clipDuration : 3600;
        const beats = trackBeatGrid.beats.length > 0 ? [0, ...trackBeatGrid.beats] : [];
        remaining = closeAllManualGapsAndFitBeats(
          remaining,
          beats,
          maxTimeline,
          Boolean(audioRef.current)
        );
      }
      setMediaItems(remaining);
      const nextIds = selectedClipIdsRef.current.filter((cid) => !idSet.has(cid));
      const fallback = remaining[0]?.id ?? null;
      setSelectedClipIds(nextIds.length > 0 ? nextIds : fallback ? [fallback] : []);
      if (!selectedClipIdRef.current || idSet.has(selectedClipIdRef.current)) {
        setSelectedClipId(nextIds[0] ?? fallback);
      }
      showUndoToast(tFor(langRef.current).toastClipDeleted);
    },
    [getEffectiveTimelineBounds, pushImmediateHistory, showUndoToast, trackBeatGrid.beats]
  );

  const handleRemoveVisual = useCallback(
    (id: string) => {
      removeClipsByIds([id]);
    },
    [removeClipsByIds]
  );

  const handleRippleDeleteSelected = useCallback(() => {
    if (selectedFxIdRef.current) {
      handleRemoveFxOverlay(selectedFxIdRef.current);
      return;
    }
    const items = mediaItemsRef.current;
    if (items.length === 0) return;
    const validSet = new Set(items.map((m) => m.id));
    const multi = selectedClipIdsRef.current.filter((cid) => validSet.has(cid));
    if (multi.length > 0) {
      removeClipsByIds(multi);
    } else {
      const targetId = selectedClipIdRef.current || items[0].id;
      removeClipsByIds([targetId]);
    }
  }, [handleRemoveFxOverlay, removeClipsByIds]);

  const handleClearVisuals = useCallback(() => {
    if (mediaItemsRef.current.length === 0) return;
    pushImmediateHistory();
    for (const item of mediaItemsRef.current) {
      if (item.kind === 'video') {
        detachClipVideoElement(item.videoElement);
      }
    }
    setMediaItems([]);
    setSelectedClipId(null);
    setSelectedClipIds([]);
  }, [pushImmediateHistory]);

  const handleUseEmbeddedCover = useCallback(() => {
    const currentAudio = audioRef.current;
    const coverUrl = currentAudio?.metadata.embeddedCoverUrl;
    if (!coverUrl) return;
    const existing = mediaBinRef.current.find((b) => b.url === coverUrl);
    if (existing) {
      placeBinItemOnTimeline(existing, { mode: 'playhead' });
    } else {
      ingestVisualAssetFromUrl(
        coverUrl,
        `${currentAudio.fileName} (Cover)`,
        'image',
        undefined,
        true
      );
    }
  }, [ingestVisualAssetFromUrl, placeBinItemOnTimeline]);

  const handleUpdateConfig = useCallback(
    (patch: Partial<StudioConfig>) => {
      queueDebouncedHistory();
      if (
        patch.slideshowMode === 'manual' &&
        configRef.current.slideshowMode !== 'manual' &&
        mediaItemsRef.current.length > 0
      ) {
        const bounds = getEffectiveTimelineBounds(
          configRef.current,
          mediaItemsRef.current,
          audioRef.current
        );
        setMediaItems((prev) =>
          snapshotSegmentDurations(
            prev,
            bounds.clipDuration,
            configRef.current,
            beatCutTimestamps,
            true
          )
        );
      }
      setConfig((prev) => ({ ...prev, ...patch }));
    },
    [beatCutTimestamps, getEffectiveTimelineBounds, queueDebouncedHistory]
  );

  const handleCompileCustomGlsl = useCallback(() => {
    const res = proceduralShaderEngine.updateCustomShader(configRef.current.customGlslCode);
    setGlslError(res.error);
  }, []);

  const handleApplyMoodPreset = useCallback(
    (patch: Partial<StudioConfig>) => {
      pushImmediateHistory();
      setConfig((prev) => ({ ...prev, ...patch }));
    },
    [pushImmediateHistory]
  );

  const handleResetGenerator = useCallback(() => {
    pushImmediateHistory();
    setConfig((prev) => ({
      ...prev,
      generatorBlend: DEFAULT_STUDIO_CONFIG.generatorBlend,
      generatorOpacity: DEFAULT_STUDIO_CONFIG.generatorOpacity,
      generatorSpeed: DEFAULT_STUDIO_CONFIG.generatorSpeed,
      generatorScale: DEFAULT_STUDIO_CONFIG.generatorScale,
      generatorBeatReact: DEFAULT_STUDIO_CONFIG.generatorBeatReact,
      generatorComplexity: DEFAULT_STUDIO_CONFIG.generatorComplexity,
      generatorWarp: DEFAULT_STUDIO_CONFIG.generatorWarp,
      generatorSymmetry: DEFAULT_STUDIO_CONFIG.generatorSymmetry,
      generatorRotationSpeed: DEFAULT_STUDIO_CONFIG.generatorRotationSpeed,
      generatorHueShift: DEFAULT_STUDIO_CONFIG.generatorHueShift,
      generatorGlow: DEFAULT_STUDIO_CONFIG.generatorGlow,
    }));
  }, [pushImmediateHistory]);

  const handleAddBeatMarker = useCallback(() => {
    pushImmediateHistory();
    const markerSec = Number(currentTimeRef.current.toFixed(2));
    setConfig((prev) => {
      const existsClose = prev.manualBeatMarkers.some((m) => Math.abs(m - markerSec) < 0.08);
      if (existsClose) return prev;
      return {
        ...prev,
        manualBeatMarkers: [...prev.manualBeatMarkers, markerSec].sort((a, b) => a - b),
      };
    });
  }, [pushImmediateHistory]);

  const handleToggleBeatMarkerAt = useCallback(
    (absSec: number) => {
      pushImmediateHistory();
      const targetSec = Number(Math.max(0, absSec).toFixed(2));
      setConfig((prev) => {
        const nearIdx = prev.manualBeatMarkers.findIndex((m) => Math.abs(m - targetSec) < 0.22);
        if (nearIdx !== -1) {
          const next = [...prev.manualBeatMarkers];
          next.splice(nearIdx, 1);
          return { ...prev, manualBeatMarkers: next };
        }
        return {
          ...prev,
          manualBeatMarkers: [...prev.manualBeatMarkers, targetSec].sort((a, b) => a - b),
        };
      });
    },
    [pushImmediateHistory]
  );

  const handleClearBeatMarkers = useCallback(() => {
    if (configRef.current.manualBeatMarkers.length === 0) return;
    pushImmediateHistory();
    setConfig((prev) => ({ ...prev, manualBeatMarkers: [] }));
  }, [pushImmediateHistory]);

  const handleSetBeat1AtPlayhead = useCallback(() => {
    if (!audioRef.current) return;
    const cfg = configRef.current;
    const clipDuration = Math.max(0.5, cfg.trimEnd - cfg.trimStart);
    const localPlayhead = Math.max(
      0.02,
      Math.min(clipDuration - 0.02, currentTimeRef.current - cfg.trimStart)
    );
    const activeMode = cfg.beatGridMode ?? 'auto';
    const nextMode = activeMode === 'auto' ? 'strict_bpm' : activeMode;
    const aligned = alignBeatGridToTime(
      rawTrackBeatGrid,
      clipDuration,
      localPlayhead,
      nextMode,
      cfg.manualBpm
    );
    pushImmediateHistory();
    setConfig((prev) => ({
      ...prev,
      beatGridMode: nextMode,
      beatOffsetSec: aligned.offsetSec,
      beatDownbeatShift: aligned.downbeatShift,
    }));
    showUndoToast(tFor(langRef.current).beatCalibAlignedToast);
  }, [pushImmediateHistory, rawTrackBeatGrid, showUndoToast]);

  const handleReextractAudioBeats = useCallback(() => {
    if (!audioRef.current) return;
    pushImmediateHistory();
    setConfig((prev) => ({
      ...prev,
      beatGridMode: 'auto',
      manualBpm: 0,
      beatOffsetSec: 0,
      beatDownbeatShift: 0,
    }));
    showUndoToast(tFor(langRef.current).beatCalibExtractedToast);
  }, [pushImmediateHistory, showUndoToast]);

  const handleResetBeatCalibration = useCallback(() => {
    pushImmediateHistory();
    setConfig((prev) => ({
      ...prev,
      beatGridMode: 'auto',
      manualBpm: 0,
      beatOffsetSec: 0,
      beatDownbeatShift: 0,
      beatSensitivity: DEFAULT_STUDIO_CONFIG.beatSensitivity,
    }));
  }, [pushImmediateHistory]);

  const handleToggleMetronome = useCallback(() => {
    lastMetronomeBeatRef.current = -1;
    setConfig((prev) => ({
      ...prev,
      beatMetronomeEnabled: !prev.beatMetronomeEnabled,
    }));
  }, []);

  const handleImportSubtitlesText = useCallback(
    (raw: string) => {
      const parsed = parseSubtitles(raw);
      if (parsed.length === 0) {
        showError(tFor(langRef.current).errEmptySubtitles);
        return;
      }
      pushImmediateHistory();
      setConfig((prev) => ({ ...prev, subtitles: parsed, showSubtitles: true }));
    },
    [pushImmediateHistory, showError]
  );

  const handleAddCueAtPlayhead = useCallback(() => {
    pushImmediateHistory();
    const startSec = Number(currentTimeRef.current.toFixed(2));
    const endSec = Number((startSec + 2.5).toFixed(2));
    const cue: SubtitleCue = {
      id: `sub-${createItemId()}`,
      startSec,
      endSec,
      text: lang === 'ru' ? 'Новый субтитр' : 'New subtitle line',
    };
    setConfig((prev) => ({
      ...prev,
      showSubtitles: true,
      subtitles: [...prev.subtitles, cue].sort((a, b) => a.startSec - b.startSec),
    }));
  }, [lang, pushImmediateHistory]);

  const handleUpdateSubtitleCue = useCallback(
    (id: string, patch: Partial<SubtitleCue>) => {
      queueDebouncedHistory();
      setConfig((prev) => ({
        ...prev,
        subtitles: prev.subtitles.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }));
    },
    [queueDebouncedHistory]
  );

  const handleRemoveSubtitleCue = useCallback(
    (id: string) => {
      pushImmediateHistory();
      setConfig((prev) => ({
        ...prev,
        subtitles: prev.subtitles.filter((c) => c.id !== id),
      }));
    },
    [pushImmediateHistory]
  );

  const handleAddTextOverlay = useCallback(() => {
    pushImmediateHistory();
    const layer: OverlayLayer = {
      id: `ov-${createItemId()}`,
      kind: 'text',
      label: 'Badge',
      text: 'NEW RELEASE',
      xPct: 0.5,
      yPct: 0.14,
      scale: 1.0,
      opacity: 0.92,
      color: configRef.current.customTextColor || '#F9FAFB',
    };
    setConfig((prev) => ({ ...prev, overlays: [...prev.overlays, layer] }));
  }, [pushImmediateHistory]);

  const handleAddImageOverlay = useCallback(
    (file: File) => {
      if (!file || file.size === 0 || file.size > MAX_UPLOAD_BYTES) return;
      const ovId = `ov-${createItemId()}`;
      const url = URL.createObjectURL(file);
      saveBlobToIDB(`overlay-${ovId}`, file).then((res) => {
        if (!res.ok) {
          setSaveStatus('error');
          showError(res.error || tFor(langRef.current).saveStatusError);
        }
      });
      blobKeyMapRef.current.set(url, `overlay-${ovId}`);

      const img = new Image();
      img.onload = () => {
        pushImmediateHistory();
        const layer: OverlayLayer = {
          id: ovId,
          kind: 'image',
          label: file.name,
          imageUrl: url,
          imageBlobKey: `overlay-${ovId}`,
          imageElement: img,
          xPct: 0.86,
          yPct: 0.12,
          scale: 0.9,
          opacity: 0.9,
        };
        setConfig((prev) => ({ ...prev, overlays: [...prev.overlays, layer] }));
      };
      img.onerror = () => {
        blobKeyMapRef.current.delete(url);
        URL.revokeObjectURL(url);
        showError(`${tFor(lang).errInvalidVisual}: ${file.name}`);
      };
      img.src = url;
    },
    [lang, pushImmediateHistory, showError]
  );

  const handleUpdateOverlay = useCallback(
    (id: string, patch: Partial<OverlayLayer>) => {
      queueDebouncedHistory();
      setConfig((prev) => ({
        ...prev,
        overlays: prev.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)),
      }));
    },
    [queueDebouncedHistory]
  );

  const handleRemoveOverlay = useCallback(
    (id: string) => {
      pushImmediateHistory();
      setConfig((prev) => ({
        ...prev,
        overlays: prev.overlays.filter((o) => o.id !== id),
      }));
    },
    [pushImmediateHistory]
  );

  const handleExportProjectJson = useCallback(() => {
    const serialized = serializeStudioState(
      configRef.current,
      mediaItemsRef.current,
      blobKeyMapRef.current,
      audioRef.current?.fileName,
      audioRef.current?.fileSize,
      audioRef.current?.isSyntheticDemo,
      audioBlobKeyRef.current,
      mediaBinRef.current
    );
    const blob = new Blob([JSON.stringify(serialized, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(configRef.current.titleText || 'neuromicon-project')
      .replace(/[<>:"/\\|?*]/g, '')
      .trim() || 'neuromicon-project'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const handleImportProjectJson = useCallback(
    async (file: File) => {
      try {
        const txt = await file.text();
        const parsed = JSON.parse(txt) as SerializedProject;
        if (!parsed || typeof parsed !== 'object' || !parsed.config) {
          throw new Error('Invalid project JSON');
        }
        stopPlayback();
        pushImmediateHistory();
        let missingBinaryMedia = false;

        const restoredOverlays: OverlayLayer[] = [];
        for (const ov of parsed.config.overlays || []) {
          if (ov.kind === 'image') {
            const blobKey = ov.imageBlobKey || `overlay-${ov.id}`;
            const blob = await loadBlobFromIDB(blobKey);
            if (blob) {
              const url = URL.createObjectURL(blob);
              blobKeyMapRef.current.set(url, blobKey);
              const img = await new Promise<HTMLImageElement | null>((resolve) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => resolve(null);
                el.src = url;
              });
              if (img) {
                restoredOverlays.push({
                  ...ov,
                  imageUrl: url,
                  imageBlobKey: blobKey,
                  imageElement: img,
                });
              } else {
                blobKeyMapRef.current.delete(url);
                URL.revokeObjectURL(url);
                missingBinaryMedia = true;
              }
            } else {
              missingBinaryMedia = true;
            }
          } else {
            restoredOverlays.push({ ...ov });
          }
        }

        const isLegacySchema = !parsed.version || parsed.version < 5;
        const mergedConfig: StudioConfig = {
          ...DEFAULT_STUDIO_CONFIG,
          ...parsed.config,
          slideshowMode: isLegacySchema
            ? 'manual'
            : parsed.config.slideshowMode || DEFAULT_STUDIO_CONFIG.slideshowMode,
          overlays: restoredOverlays,
          fxOverlays: (parsed.config.fxOverlays || []).map((fx) => ({
            ...fx,
            params: fx.params ? { ...fx.params } : undefined,
          })),
        };
        setConfig(mergedConfig);
        setSelectedFxId(null);
        if (mergedConfig.customGlslCode) {
          const res = proceduralShaderEngine.updateCustomShader(mergedConfig.customGlslCode);
          setGlslError(res.error);
        }

        // Rehydrate audio track if demo or matching local IDB blob exists; otherwise clear stale audio
        const clearPreviousAudio = () => {
          const prevCover = audioRef.current?.metadata.embeddedCoverUrl;
          if (
            prevCover &&
            prevCover.startsWith('blob:') &&
            !mediaItemsRef.current.some((m) => m.url === prevCover) &&
            !mediaBinRef.current.some((b) => b.url === prevCover)
          ) {
            URL.revokeObjectURL(prevCover);
          }
          audioBlobKeyRef.current = undefined;
          monoDataRef.current = new Float32Array(0);
          setAudio(null);
          currentTimeRef.current = 0;
          setCurrentTime(0);
        };

        if (parsed.audioMeta) {
          if (parsed.audioMeta.isSyntheticDemo) {
            const demoBuf = await generateDemoAudioBuffer();
            audioBlobKeyRef.current = undefined;
            applyAudioBuffer(
              demoBuf,
              parsed.audioMeta.fileName,
              parsed.audioMeta.fileSize,
              {
                title: mergedConfig.titleText,
                artist: mergedConfig.artistText,
                album: mergedConfig.albumText,
                year: '2026',
              },
              true,
              true
            );
          } else if (parsed.audioMeta.blobKey) {
            const audioBlob = await loadBlobFromIDB(parsed.audioMeta.blobKey);
            if (audioBlob) {
              try {
                audioBlobKeyRef.current = parsed.audioMeta.blobKey;
                const arr = await audioBlob.arrayBuffer();
                const id3 = parseID3Tags(arr, parsed.audioMeta.fileName);
                const ctx = getAudioContext();
                const decoded = await ctx.decodeAudioData(arr.slice(0));
                applyAudioBuffer(
                  decoded,
                  parsed.audioMeta.fileName,
                  parsed.audioMeta.fileSize,
                  {
                    title: id3.title || mergedConfig.titleText,
                    artist: id3.artist || mergedConfig.artistText,
                    album: id3.album || mergedConfig.albumText,
                    year: id3.year || '',
                    embeddedCoverUrl: id3.coverBlobUrl,
                  },
                  false,
                  true
                );
              } catch {
                clearPreviousAudio();
                missingBinaryMedia = true;
              }
            } else {
              clearPreviousAudio();
              missingBinaryMedia = true;
            }
          } else {
            clearPreviousAudio();
            missingBinaryMedia = true;
          }
        } else {
          clearPreviousAudio();
        }

        // Restore Media Library + generator/image/video clips whose IDB blobs exist locally
        const urlByKey = new Map<string, string>();
        const nextBin: MediaBinItem[] = [];
        for (const sb of parsed.mediaBin || []) {
          if (!sb.blobKey) continue;
          const blob = await loadBlobFromIDB(sb.blobKey);
          if (!blob) {
            missingBinaryMedia = true;
            continue;
          }
          let url = urlByKey.get(sb.blobKey);
          if (!url) {
            url = URL.createObjectURL(blob);
            urlByKey.set(sb.blobKey, url);
            blobKeyMapRef.current.set(url, sb.blobKey);
          }
          if (sb.kind === 'image') {
            const img = await new Promise<HTMLImageElement | null>((resolve) => {
              const el = new Image();
              el.onload = () => resolve(el);
              el.onerror = () => resolve(null);
              el.src = url!;
            });
            if (img) {
              nextBin.push({
                id: sb.id || `bin-${createItemId()}`,
                kind: 'image',
                fileName: sb.fileName,
                url,
                width: img.naturalWidth || sb.width || 1920,
                height: img.naturalHeight || sb.height || 1080,
                imageElement: img,
                defaultDurationSec: sb.defaultDurationSec || 4.0,
              });
            } else {
              missingBinaryMedia = true;
            }
          } else {
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.preload = 'metadata';
            const ok = await new Promise<boolean>((resolve) => {
              video.onloadedmetadata = () => resolve(true);
              video.onerror = () => resolve(false);
              video.src = url!;
            });
            if (ok) {
              let decodedBuf: AudioBuffer | undefined;
              try {
                const arr = await blob.arrayBuffer();
                decodedBuf = await getAudioContext().decodeAudioData(arr);
              } catch {
                // silent video
              }
              const vDur = video.duration || sb.videoDuration || 10;
              nextBin.push({
                id: sb.id || `bin-${createItemId()}`,
                kind: 'video',
                fileName: sb.fileName,
                url,
                width: video.videoWidth || sb.width || 1080,
                height: video.videoHeight || sb.height || 1920,
                videoDuration: vDur,
                decodedAudioBuffer: decodedBuf,
                defaultDurationSec:
                  sb.defaultDurationSec || Number(Math.max(0.5, Math.min(600, vDur)).toFixed(1)),
                defaultSourceStartSec: sb.defaultSourceStartSec,
                defaultSourceEndSec: sb.defaultSourceEndSec,
                defaultPlaybackRate: sb.defaultPlaybackRate,
                defaultTransitionOut: sb.defaultTransitionOut,
                defaultClipAudioMuted: sb.defaultClipAudioMuted,
              });
            } else {
              missingBinaryMedia = true;
            }
          }
        }

        const nextClips: VisualMediaState[] = [];
        for (const sc of parsed.clips || []) {
          const restoredOverlay = sc.overlayEffect
            ? {
                ...sc.overlayEffect,
                params: sc.overlayEffect.params ? { ...sc.overlayEffect.params } : undefined,
              }
            : undefined;
          if (sc.kind === 'generator') {
            nextClips.push({
              id: sc.id || createItemId(),
              kind: 'generator',
              fileName: sc.fileName,
              url: '',
              width: sc.width || 1920,
              height: sc.height || 1080,
              startSec: sc.startSec,
              durationSec: sc.durationSec || 5,
              sourceStartSec: sc.sourceStartSec || 0,
              playbackRate: sc.playbackRate || 1,
              transitionOut: sc.transitionOut || 'crossfade',
              transitionDurationSec: sc.transitionDurationSec || 0.65,
              generatorId: sc.generatorId || 'galaxy_spiral',
              generatorParams: sc.generatorParams ? { ...sc.generatorParams } : undefined,
              overlayEffect: restoredOverlay,
              transform: sc.transform || { ...DEFAULT_CLIP_TRANSFORM },
              clipAudioVolume: sc.clipAudioVolume ?? 0,
              clipAudioMuted: sc.clipAudioMuted ?? true,
            });
          } else if (sc.blobKey) {
            const blob = await loadBlobFromIDB(sc.blobKey);
            if (!blob) {
              missingBinaryMedia = true;
              continue;
            }
            let url = urlByKey.get(sc.blobKey);
            if (!url) {
              url = URL.createObjectURL(blob);
              urlByKey.set(sc.blobKey, url);
              blobKeyMapRef.current.set(url, sc.blobKey);
            }
            if (sc.kind === 'image') {
              const img = await new Promise<HTMLImageElement | null>((resolve) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => resolve(null);
                el.src = url!;
              });
              if (img) {
                nextClips.push({
                  id: sc.id || createItemId(),
                  kind: 'image',
                  fileName: sc.fileName,
                  url,
                  width: img.naturalWidth || sc.width || 1920,
                  height: img.naturalHeight || sc.height || 1080,
                  imageElement: img,
                  startSec: sc.startSec,
                  durationSec: sc.durationSec || 4,
                  sourceStartSec: 0,
                  playbackRate: 1,
                  transitionOut: sc.transitionOut || 'crossfade',
                  transitionDurationSec: sc.transitionDurationSec || 0.65,
                  overlayEffect: restoredOverlay,
                  transform: sc.transform || { ...DEFAULT_CLIP_TRANSFORM },
                  clipAudioVolume: 0,
                  clipAudioMuted: true,
                });
                if (
                  !parsed.mediaBin &&
                  !nextBin.some((b) => b.url && blobKeyMapRef.current.get(b.url) === sc.blobKey)
                ) {
                  nextBin.push({
                    id: `bin-${createItemId()}`,
                    kind: 'image',
                    fileName: sc.fileName,
                    url,
                    width: img.naturalWidth || sc.width || 1920,
                    height: img.naturalHeight || sc.height || 1080,
                    imageElement: img,
                    defaultDurationSec: sc.durationSec || 4.0,
                  });
                }
              } else {
                missingBinaryMedia = true;
              }
            } else if (sc.kind === 'video') {
              const video = document.createElement('video');
              video.muted = true;
              video.loop = true;
              video.playsInline = true;
              video.preload = 'metadata';
              const existingBin = nextBin.find(
                (b) => b.kind === 'video' && b.url && blobKeyMapRef.current.get(b.url) === sc.blobKey
              );
              let ok = Boolean(existingBin);
              let decodedBuf: AudioBuffer | undefined = existingBin?.decodedAudioBuffer;
              let vDur = existingBin?.videoDuration || sc.videoDuration || 10;
              let vW = existingBin?.width || sc.width || 1080;
              let vH = existingBin?.height || sc.height || 1920;
              if (!existingBin) {
                ok = await new Promise<boolean>((resolve) => {
                  video.onloadedmetadata = () => resolve(true);
                  video.onerror = () => resolve(false);
                  video.src = url!;
                });
                if (ok) {
                  try {
                    const arr = await blob.arrayBuffer();
                    decodedBuf = await getAudioContext().decodeAudioData(arr);
                  } catch {
                    // silent video
                  }
                  vDur = video.duration || vDur;
                  vW = video.videoWidth || vW;
                  vH = video.videoHeight || vH;
                }
              } else {
                video.src = url!;
              }
              if (ok) {
                nextClips.push({
                  id: sc.id || createItemId(),
                  kind: 'video',
                  fileName: sc.fileName,
                  url,
                  width: vW,
                  height: vH,
                  videoElement: video,
                  videoDuration: vDur,
                  decodedAudioBuffer: decodedBuf,
                  startSec: sc.startSec,
                  durationSec: sc.durationSec || 4,
                  sourceStartSec: sc.sourceStartSec || 0,
                  playbackRate: sc.playbackRate || 1,
                  transitionOut: sc.transitionOut || 'crossfade',
                  transitionDurationSec: sc.transitionDurationSec || 0.65,
                  overlayEffect: restoredOverlay,
                  transform: sc.transform || { ...DEFAULT_CLIP_TRANSFORM },
                  clipAudioVolume: sc.clipAudioVolume ?? 0.8,
                  clipAudioMuted: sc.clipAudioMuted ?? true,
                });
                if (
                  !parsed.mediaBin &&
                  !nextBin.some((b) => b.url && blobKeyMapRef.current.get(b.url) === sc.blobKey)
                ) {
                  nextBin.push({
                    id: `bin-${createItemId()}`,
                    kind: 'video',
                    fileName: sc.fileName,
                    url,
                    width: video.videoWidth || sc.width || 1080,
                    height: video.videoHeight || sc.height || 1920,
                    videoDuration: vDur,
                    decodedAudioBuffer: decodedBuf,
                    defaultDurationSec: Number(Math.max(0.5, Math.min(600, vDur)).toFixed(1)),
                  });
                }
              } else {
                missingBinaryMedia = true;
              }
            }
          } else {
            missingBinaryMedia = true;
          }
        }
        setMediaBin(nextBin);
        if (nextClips.length > 0) {
          let finalClips = nextClips;
          if (mergedConfig.slideshowMode === 'manual') {
            const intervals = getNormalizedManualClipIntervals(nextClips);
            const startMap = new Map(intervals.map((iv) => [iv.id, iv.startSec]));
            finalClips = nextClips.map((c) => ({
              ...c,
              startSec: Number((startMap.get(c.id) ?? 0).toFixed(2)),
            }));
          }
          setMediaItems(finalClips);
          setSelectedClipId(finalClips[0].id);
          setSelectedClipIds([finalClips[0].id]);
        } else {
          setMediaItems([]);
          setSelectedClipId(null);
          setSelectedClipIds([]);
        }
        if (missingBinaryMedia) {
          showError(tFor(langRef.current).noticeJsonPartialRestore);
        }
      } catch (err) {
        showError(err instanceof Error ? err.message : tFor(langRef.current).errUnsupportedFile);
      }
    },
    [applyAudioBuffer, getAudioContext, pushImmediateHistory, showError, stopPlayback]
  );

  const handleResetAutosave = useCallback(async () => {
    stopPlayback();
    const seen = new Set<string>();
    for (const b of mediaBinRef.current) {
      if (b.url.startsWith('blob:') && !seen.has(b.url)) {
        seen.add(b.url);
        URL.revokeObjectURL(b.url);
      }
    }
    for (const item of mediaItemsRef.current) {
      if (item.kind === 'video' && item.videoElement) item.videoElement.pause();
      if (item.url.startsWith('blob:') && !seen.has(item.url)) {
        seen.add(item.url);
        URL.revokeObjectURL(item.url);
      }
    }
    for (const ov of configRef.current.overlays) {
      if (ov.imageUrl?.startsWith('blob:') && !seen.has(ov.imageUrl)) {
        seen.add(ov.imageUrl);
        URL.revokeObjectURL(ov.imageUrl);
      }
    }
    const coverUrl = audioRef.current?.metadata.embeddedCoverUrl;
    if (coverUrl && coverUrl.startsWith('blob:') && !seen.has(coverUrl)) {
      URL.revokeObjectURL(coverUrl);
    }

    await clearProjectIDB();
    blobKeyMapRef.current.clear();
    audioBlobKeyRef.current = undefined;
    pastRef.current = [];
    futureRef.current = [];
    pendingBaseSnapshotRef.current = null;
    syncHistoryFlags();
    setMediaBin([]);
    setMediaItems([]);
    setSelectedClipId(null);
    setSelectedFxId(null);
    setAudio(null);
    monoDataRef.current = new Float32Array(0);
    setConfig(DEFAULT_STUDIO_CONFIG);
    setGlslError(null);
    setUndoToast(null);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setSaveStatus('saved');
  }, [stopPlayback, syncHistoryFlags]);

  const clampManualClipsToSpan = useCallback((maxSpan: number) => {
    if (configRef.current.slideshowMode !== 'manual') return;
    setMediaItems((prev) =>
      prev
        .filter((m) => (m.startSec ?? 0) < maxSpan - 0.35)
        .map((m) => ({
          ...m,
          durationSec: Number(
            Math.max(0.4, Math.min(m.durationSec || 4, maxSpan - (m.startSec ?? 0))).toFixed(2)
          ),
        }))
    );
  }, []);

  const handleSelectTrimPreset = useCallback(
    (preset: TrimPresetId) => {
      pushImmediateHistory();
      const dur = audioRef.current ? audioRef.current.duration : 60;
      let nextSpan = dur;
      setConfig((prev) => {
        if (preset === 'full') {
          nextSpan = Number(dur.toFixed(2));
          return { ...prev, trimPreset: preset, trimStart: 0, trimEnd: nextSpan };
        }
        if (preset === 'reels_60' || preset === 'tiktok_60') {
          nextSpan = Number(Math.min(dur, 60).toFixed(2));
          return {
            ...prev,
            trimPreset: preset,
            trimStart: 0,
            trimEnd: nextSpan,
            fadeOutSec: 3.0,
          };
        }
        if (preset === 'shorts_57') {
          nextSpan = Number(Math.min(dur, 57).toFixed(2));
          return {
            ...prev,
            trimPreset: preset,
            trimStart: 0,
            trimEnd: nextSpan,
            fadeOutSec: 3.0,
          };
        }
        nextSpan = Math.max(0.5, prev.trimEnd - prev.trimStart);
        return { ...prev, trimPreset: 'custom' };
      });
      if (audioRef.current) {
        clampManualClipsToSpan(Math.max(0.5, nextSpan));
      }
    },
    [clampManualClipsToSpan, pushImmediateHistory]
  );

  const handlePreviewFadeOut = useCallback(() => {
    if (!audioRef.current) return;
    const previewOffset = Math.max(
      config.trimStart,
      config.trimEnd - Math.max(3, config.fadeOutSec + 2.2)
    );
    startPlaybackAt(previewOffset);
  }, [config.fadeOutSec, config.trimEnd, config.trimStart, startPlaybackAt]);

  const handleSetTrimStart = useCallback(
    (sec: number) => {
      if (!audioRef.current) return;
      queueDebouncedHistory();
      const prevCfg = configRef.current;
      const clamped = Number(Math.max(0, Math.min(prevCfg.trimEnd - 0.5, sec)).toFixed(2));
      setConfig((prev) => ({
        ...prev,
        trimPreset: 'custom',
        trimStart: clamped,
      }));
      clampManualClipsToSpan(Math.max(0.5, prevCfg.trimEnd - clamped));
    },
    [clampManualClipsToSpan, queueDebouncedHistory]
  );

  const handleSetTrimEnd = useCallback(
    (sec: number) => {
      const aud = audioRef.current;
      if (!aud) return;
      queueDebouncedHistory();
      const prevCfg = configRef.current;
      const clamped = Number(Math.min(aud.duration, Math.max(prevCfg.trimStart + 0.5, sec)).toFixed(2));
      setConfig((prev) => ({
        ...prev,
        trimPreset: 'custom',
        trimEnd: clamped,
      }));
      clampManualClipsToSpan(Math.max(0.5, clamped - prevCfg.trimStart));
    },
    [clampManualClipsToSpan, queueDebouncedHistory]
  );

  const handleSeekAbsolute = useCallback(
    (sec: number) => {
      const bounds = getEffectiveTimelineBounds(
        configRef.current,
        mediaItemsRef.current,
        audioRef.current
      );
      const clamped = Math.max(0, Math.min(bounds.maxSeek, sec));
      currentTimeRef.current = clamped;
      smoothStateRef.current = createSmoothState();
      setCurrentTime(clamped);
      if (isPlaying) {
        startPlaybackAt(clamped);
      } else {
        syncVideosAtLocalTime(Math.max(0, clamped - bounds.trimBase), false);
      }
    },
    [getEffectiveTimelineBounds, isPlaying, startPlaybackAt, syncVideosAtLocalTime]
  );

  const handleTogglePlay = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
    } else {
      const bounds = getEffectiveTimelineBounds(
        configRef.current,
        mediaItemsRef.current,
        audioRef.current
      );
      const startAt =
        currentTimeRef.current >= bounds.trimBase &&
        currentTimeRef.current < bounds.trimEnd - 0.15
          ? currentTimeRef.current
          : bounds.trimBase;
      startPlaybackAt(startAt);
    }
  }, [getEffectiveTimelineBounds, isPlaying, startPlaybackAt, stopPlayback]);

  const handleResetToTrimStart = useCallback(() => {
    stopPlayback();
    const bounds = getEffectiveTimelineBounds(
      configRef.current,
      mediaItemsRef.current,
      audioRef.current
    );
    currentTimeRef.current = bounds.trimBase;
    setCurrentTime(bounds.trimBase);
    syncVideosAtLocalTime(0, false);
  }, [getEffectiveTimelineBounds, stopPlayback, syncVideosAtLocalTime]);

  const handleStepFrame = useCallback(
    (deltaFrames: -1 | 1) => {
      if (isPlaying) stopPlayback();
      const fps = Math.max(1, configRef.current.fps || 30);
      handleSeekAbsolute(currentTimeRef.current + deltaFrames * (1 / fps));
    },
    [handleSeekAbsolute, isPlaying, stopPlayback]
  );

  const handleJumpCut = useCallback(
    (direction: -1 | 1) => {
      const bounds = getEffectiveTimelineBounds(
        configRef.current,
        mediaItemsRef.current,
        audioRef.current
      );
      const segments = computeClipTimelineSegments(
        mediaItemsRef.current,
        bounds.clipDuration,
        configRef.current,
        beatCutTimestamps
      );
      const points = new Set<number>([bounds.trimBase, bounds.trimEnd]);
      for (const seg of segments) {
        points.add(Number((bounds.trimBase + seg.startSec).toFixed(3)));
        points.add(Number((bounds.trimBase + seg.endSec).toFixed(3)));
      }
      const sorted = Array.from(points).sort((a, b) => a - b);
      const cur = currentTimeRef.current;
      if (direction < 0) {
        const prev = [...sorted].reverse().find((p) => p < cur - 0.05);
        handleSeekAbsolute(prev ?? bounds.trimBase);
      } else {
        const next = sorted.find((p) => p > cur + 0.05);
        handleSeekAbsolute(next ?? bounds.trimEnd);
      }
    },
    [beatCutTimestamps, getEffectiveTimelineBounds, handleSeekAbsolute]
  );

  const drawOnce = useCallback(
    (dtSec = 1 / 60) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dims = resolveExportDimensions(
        config.aspectMode,
        mediaItems,
        config.customWidth,
        config.customHeight
      );
      const previewBase = 960;
      const targetW =
        dims.width >= dims.height
          ? previewBase
          : Math.round((previewBase * dims.width) / dims.height);
      const targetH =
        dims.width >= dims.height
          ? Math.round((previewBase * dims.height) / dims.width)
          : previewBase;
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const bounds = getEffectiveTimelineBounds(config, mediaItems, audio);
      const clipDuration = bounds.clipDuration;
      const absTime = currentTimeRef.current;
      const localTime = Math.max(0, Math.min(clipDuration, absTime - bounds.trimBase));

      let analysisMono = monoDataRef.current;
      let analysisSampleRate = audio?.sampleRate || 48000;
      let analysisTime = absTime;

      if (!audio && analysisMono.length === 0 && mediaItems.length > 0) {
        const slice = resolveActiveSlideshowSlice(
          mediaItems,
          localTime,
          clipDuration,
          config,
          beatCutTimestamps
        );
        const activeClip = slice.activeIndex !== null ? mediaItems[slice.activeIndex] : undefined;
        if (
          activeClip?.decodedAudioBuffer &&
          !activeClip.clipAudioMuted &&
          activeClip.clipAudioVolume > 0.01
        ) {
          analysisMono = getCachedClipMono(activeClip.decodedAudioBuffer);
          analysisSampleRate = activeClip.decodedAudioBuffer.sampleRate;
          const vDur = activeClip.videoDuration || activeClip.decodedAudioBuffer.duration || 1;
          analysisTime =
            (activeClip.sourceStartSec + slice.slideLocalTime * (activeClip.playbackRate || 1)) %
            Math.max(0.1, vDur);
        }
      }

      const metrics = analyzeAudioAtTime(
        analysisMono,
        analysisSampleRate,
        analysisTime,
        config.beatSensitivity,
        isPlaying ? smoothStateRef.current : undefined,
        config.visualizerSmoothing,
        dtSec
      );

      renderStudioFrame({
        ctx,
        width: canvas.width,
        height: canvas.height,
        localTime,
        absTime,
        clipDuration,
        metrics,
        config,
        mediaItems,
        beatCutTimestamps,
        reducedMotion: reducedMotionRef.current,
        isExport: false,
      });
    },
    [audio, beatCutTimestamps, config, getEffectiveTimelineBounds, isPlaying, mediaItems]
  );

  drawOnceRef.current = drawOnce;
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    document.fonts
      .load(`${config.fontWeight} 48px "${config.fontFamily}"`)
      .then(() => drawOnce())
      .catch(() => drawOnce());
  }, [config.fontFamily, config.fontWeight, drawOnce]);

  useEffect(() => {
    if (!isPlaying) {
      drawOnce();
      return;
    }

    let rafId = 0;
    let lastUiSync = 0;
    let prevRafNow = performance.now();

    const loop = (now: number) => {
      const dtSec = Math.max(0.001, (now - prevRafNow) / 1000);
      prevRafNow = now;

      const bounds = getEffectiveTimelineBounds(
        configRef.current,
        mediaItemsRef.current,
        audioRef.current
      );
      const hasAudioSource = Boolean(
        audioRef.current && sourceNodeRef.current && audioCtxRef.current
      );
      let elapsedSec = 0;
      if (hasAudioSource && audioCtxRef.current) {
        const ctx = audioCtxRef.current;
        const latency = Math.max(0, ctx.outputLatency || 0);
        elapsedSec = Math.max(0, ctx.currentTime - latency - playStartCtxTimeRef.current);
      } else {
        elapsedSec = Math.max(0, (now - playStartPerfMsRef.current) / 1000);
      }

      const absSec = playStartAudioRef.current + elapsedSec;
      currentTimeRef.current = Math.min(bounds.trimEnd, absSec);

      const localTime = Math.max(0, currentTimeRef.current - bounds.trimBase);
      syncVideosAtLocalTime(localTime, true);

      // Preview-only sample-accurate metronome click on calibrated beats (never mixed into export)
      if (hasAudioSource && audioCtxRef.current && configRef.current.beatMetronomeEnabled) {
        const ctx = audioCtxRef.current;
        const grid = trackBeatGridRef.current;
        const downbeat = grid.downbeatOffset ?? 0;
        const lookAheadEnd = localTime + 0.085;
        for (let bi = 0; bi < grid.beats.length; bi++) {
          const bt = grid.beats[bi];
          if (bt < localTime - 0.015) continue;
          if (bt > lookAheadEnd) break;
          if (bt <= lastMetronomeBeatRef.current + 0.015) continue;
          lastMetronomeBeatRef.current = bt;
          const isDownbeat = (((bi - downbeat) % 4) + 4) % 4 === 0;
          const beatAbs = bounds.trimBase + bt;
          const whenCtx = Math.max(
            ctx.currentTime + 0.002,
            playStartCtxTimeRef.current + (beatAbs - playStartAudioRef.current)
          );
          try {
            const osc = ctx.createOscillator();
            const clickGain = ctx.createGain();
            osc.type = isDownbeat ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(isDownbeat ? 1280 : 840, whenCtx);
            clickGain.gain.setValueAtTime(isDownbeat ? 0.24 : 0.14, whenCtx);
            clickGain.gain.exponentialRampToValueAtTime(0.0008, whenCtx + 0.036);
            osc.connect(clickGain);
            clickGain.connect(ctx.destination);
            osc.start(whenCtx);
            osc.stop(whenCtx + 0.04);
          } catch {
            // ignore WebAudio scheduling edge errors
          }
        }
      }

      if (now - lastUiSync > 50 || absSec >= bounds.trimEnd) {
        setCurrentTime(currentTimeRef.current);
        lastUiSync = now;
      }

      drawOnce(dtSec);
      if (absSec < bounds.trimEnd) {
        rafId = requestAnimationFrame(loop);
      } else if (!hasAudioSource) {
        if (isLoopingRef.current) {
          startPlaybackAtRef.current(bounds.trimBase);
        } else {
          setIsPlaying(false);
          currentTimeRef.current = bounds.trimBase;
          setCurrentTime(bounds.trimBase);
          syncVideosAtLocalTime(0, false);
        }
      }
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drawOnce, getEffectiveTimelineBounds, isPlaying, syncVideosAtLocalTime]);

  useEffect(() => {
    if (!isPlaying) {
      const bounds = getEffectiveTimelineBounds(config, mediaItems, audio);
      const localTime = Math.max(0, Math.min(bounds.clipDuration, currentTime - bounds.trimBase));
      syncVideosAtLocalTime(localTime, false);
      drawOnce();
    }
  }, [audio, config, currentTime, drawOnce, getEffectiveTimelineBounds, isPlaying, mediaItems, syncVideosAtLocalTime]);

  // Global Keyboard Shortcuts (ignoring text inputs & interactive controls)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const isInteractiveControl = Boolean(
        target?.closest('button, a, [role="slider"], [role="button"], [role="menuitem"], [role="option"]')
      );

      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
        e.preventDefault();
        if (selectedFxIdRef.current) {
          handleDuplicateFxOverlay(selectedFxIdRef.current);
        } else if (selectedClipIdRef.current) {
          handleDuplicateClip(selectedClipIdRef.current);
        }
        return;
      }
      if (e.code === 'Space') {
        if (isInteractiveControl) return;
        e.preventDefault();
        handleTogglePlay();
        return;
      }
      if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleSplitClipAtPlayhead();
        return;
      }
      if (e.code === 'KeyI' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleSetTrimStart(currentTimeRef.current);
        return;
      }
      if (e.code === 'KeyO' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleSetTrimEnd(currentTimeRef.current);
        return;
      }
      if (e.code === 'KeyM') {
        e.preventDefault();
        handleAddBeatMarker();
        return;
      }
      if (e.code === 'Comma') {
        e.preventDefault();
        handleStepFrame(-1);
        return;
      }
      if (e.code === 'Period') {
        e.preventDefault();
        handleStepFrame(1);
        return;
      }
      if ((e.code === 'Delete' || e.code === 'Backspace') && !isInteractiveControl) {
        e.preventDefault();
        handleRippleDeleteSelected();
        return;
      }
      if (e.code === 'ArrowLeft') {
        if (target?.closest('[role="slider"]')) return;
        e.preventDefault();
        handleSeekAbsolute(currentTimeRef.current - (e.shiftKey ? 2.0 : 0.5));
        return;
      }
      if (e.code === 'ArrowRight') {
        if (target?.closest('[role="slider"]')) return;
        e.preventDefault();
        handleSeekAbsolute(currentTimeRef.current + (e.shiftKey ? 2.0 : 0.5));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleAddBeatMarker,
    handleDuplicateClip,
    handleDuplicateFxOverlay,
    handleRedo,
    handleRippleDeleteSelected,
    handleSeekAbsolute,
    handleSetTrimEnd,
    handleSetTrimStart,
    handleSplitClipAtPlayhead,
    handleStepFrame,
    handleTogglePlay,
    handleUndo,
  ]);

  const handleStartExport = useCallback(async () => {
    if (!audio && mediaItems.length === 0) return;
    stopPlayback();

    if (exportState.outputUrl) {
      URL.revokeObjectURL(exportState.outputUrl);
    }

    const abortController = new AbortController();
    exportAbortRef.current = abortController;
    let lastEncoderLabel = 'Encoder';

    try {
      const finalState = await exportStudioVideo({
        audio,
        mediaItems,
        config,
        abortSignal: abortController.signal,
        onProgress: (prog) => {
          if (prog.encoderLabel) lastEncoderLabel = prog.encoderLabel;
          setExportState(prog);
        },
      });
      setExportState(finalState);
    } catch (err) {
      setExportState({
        phase: 'error',
        currentFrame: 0,
        totalFrames: 0,
        elapsedMs: 0,
        encoderLabel: lastEncoderLabel,
        outputFormat: 'mp4',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }, [audio, config, exportState.outputUrl, mediaItems, stopPlayback]);

  const handleStartStreamExport = useCallback(async () => {
    if (!audio && mediaItems.length === 0) return;
    const picker = (
      window as unknown as {
        showSaveFilePicker?: (opts?: {
          suggestedName?: string;
          types?: Array<{ description?: string; accept: Record<string, string[]> }>;
        }) => Promise<FileSystemFileHandle>;
      }
    ).showSaveFilePicker;
    if (!picker) {
      handleStartExport();
      return;
    }

    const dims = resolveExportDimensions(
      config.aspectMode,
      mediaItems,
      config.customWidth,
      config.customHeight
    );
    const caps = await probeExportCapabilities(
      dims.width,
      dims.height,
      config.fps,
      config.bitrateMbps,
      audio?.sampleRate || 48000,
      Math.min(2, audio?.numberOfChannels || 2)
    );
    if (caps.engine === 'mediarecorder') {
      handleStartExport();
      return;
    }

    const ext = caps.container;
    const safeTitle =
      (config.titleText || 'neuromicon-video').replace(/[<>:"/\\|?*]/g, '').trim() ||
      'neuromicon-video';

    let fileHandle: FileSystemFileHandle;
    try {
      fileHandle = await picker({
        suggestedName: `${safeTitle}_${dims.width}x${dims.height}.${ext}`,
        types: [
          ext === 'mp4'
            ? { description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } }
            : { description: 'WebM Video', accept: { 'video/webm': ['.webm'] } },
        ],
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      handleStartExport();
      return;
    }

    stopPlayback();
    if (exportState.outputUrl) {
      URL.revokeObjectURL(exportState.outputUrl);
    }

    const abortController = new AbortController();
    exportAbortRef.current = abortController;
    let lastEncoderLabel = 'Stream Encoder';

    try {
      const finalState = await exportStudioVideo({
        audio,
        mediaItems,
        config,
        fileHandle,
        abortSignal: abortController.signal,
        onProgress: (prog) => {
          if (prog.encoderLabel) lastEncoderLabel = prog.encoderLabel;
          setExportState(prog);
        },
      });
      setExportState(finalState);
    } catch (err) {
      setExportState({
        phase: 'error',
        currentFrame: 0,
        totalFrames: 0,
        elapsedMs: 0,
        encoderLabel: lastEncoderLabel,
        outputFormat: ext,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }, [audio, config, exportState.outputUrl, handleStartExport, mediaItems, stopPlayback]);

  const handleStartBatchExport = useCallback(async () => {
    if (!audio && mediaItems.length === 0) return;
    stopPlayback();

    if (exportState.outputUrl) {
      URL.revokeObjectURL(exportState.outputUrl);
    }

    const abortController = new AbortController();
    exportAbortRef.current = abortController;
    const aspects: ExportAspectMode[] = ['16:9', '9:16', '1:1'];
    let lastState: ExportProgressState = IDLE_EXPORT_STATE;

    try {
      for (let i = 0; i < aspects.length; i++) {
        if (abortController.signal.aborted) break;
        const aspect = aspects[i];
        const batchConfig: StudioConfig = { ...config, aspectMode: aspect };
        const result = await exportStudioVideo({
          audio,
          mediaItems,
          config: batchConfig,
          abortSignal: abortController.signal,
          batchContext: { index: i + 1, total: aspects.length, label: aspect },
          onProgress: (prog) => setExportState(prog),
        });
        lastState = result;
        if (result.phase === 'cancelled' || result.phase === 'error') {
          setExportState(result);
          return;
        }
        if (result.phase === 'complete' && result.outputUrl) {
          const a = document.createElement('a');
          a.href = result.outputUrl;
          a.download = result.outputFileName || `neuromicon-${aspect}.${result.outputFormat}`;
          a.click();
          if (i < aspects.length - 1) {
            const urlToRevoke = result.outputUrl;
            setTimeout(() => URL.revokeObjectURL(urlToRevoke), 1500);
          }
        }
      }
      setExportState(lastState);
    } catch (err) {
      setExportState({
        phase: 'error',
        currentFrame: 0,
        totalFrames: 0,
        elapsedMs: 0,
        encoderLabel: 'Batch Encoder',
        outputFormat: 'mp4',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }, [audio, config, exportState.outputUrl, mediaItems, stopPlayback]);

  const handleDownloadMetadataTxt = useCallback(() => {
    if (!audio && mediaItems.length === 0) return;
    const dims = resolveExportDimensions(
      config.aspectMode,
      mediaItems,
      config.customWidth,
      config.customHeight
    );
    const clipDurationOverride = audio
      ? undefined
      : getEffectiveTimelineBounds(config, mediaItems, null).clipDuration;
    const content = buildSocialMetadataText(config, audio, dims, clipDurationOverride);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(config.titleText || 'track').replace(/[<>:"/\\|?*]/g, '')}_description.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [audio, config, getEffectiveTimelineBounds, mediaItems]);

  const handleSnapshotPng = useCallback(() => {
    const cfg = configRef.current;
    const dims = resolveExportDimensions(
      cfg.aspectMode,
      mediaItemsRef.current,
      cfg.customWidth,
      cfg.customHeight
    );
    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = dims.width;
    snapCanvas.height = dims.height;
    const ctx = snapCanvas.getContext('2d');
    if (!ctx) return;

    const bounds = getEffectiveTimelineBounds(cfg, mediaItemsRef.current, audioRef.current);
    const clipDuration = bounds.clipDuration;
    const absTime = currentTimeRef.current;
    const localTime = Math.max(0, Math.min(clipDuration, absTime - bounds.trimBase));

    let analysisMono = monoDataRef.current;
    let analysisSampleRate = audioRef.current?.sampleRate || 48000;
    let analysisTime = absTime;
    if (!audioRef.current && analysisMono.length === 0 && mediaItemsRef.current.length > 0) {
      const slice = resolveActiveSlideshowSlice(
        mediaItemsRef.current,
        localTime,
        clipDuration,
        cfg,
        beatCutTimestamps
      );
      const activeClip =
        slice.activeIndex !== null ? mediaItemsRef.current[slice.activeIndex] : undefined;
      if (
        activeClip?.decodedAudioBuffer &&
        !activeClip.clipAudioMuted &&
        activeClip.clipAudioVolume > 0.01
      ) {
        analysisMono = getCachedClipMono(activeClip.decodedAudioBuffer);
        analysisSampleRate = activeClip.decodedAudioBuffer.sampleRate;
        const vDur = activeClip.videoDuration || activeClip.decodedAudioBuffer.duration || 1;
        analysisTime =
          (activeClip.sourceStartSec + slice.slideLocalTime * (activeClip.playbackRate || 1)) %
          Math.max(0.1, vDur);
      }
    }

    const metrics = analyzeAudioAtTime(
      analysisMono,
      analysisSampleRate,
      analysisTime,
      cfg.beatSensitivity,
      undefined,
      cfg.visualizerSmoothing,
      1 / 30
    );

    renderStudioFrame({
      ctx,
      width: dims.width,
      height: dims.height,
      localTime,
      absTime,
      clipDuration,
      metrics,
      config: cfg,
      mediaItems: mediaItemsRef.current,
      beatCutTimestamps,
      reducedMotion: reducedMotionRef.current,
      isExport: true,
    });

    snapCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeTitle =
        (cfg.titleText || 'neuromicon-frame').replace(/[<>:"/\\|?*]/g, '').trim() ||
        'neuromicon-frame';
      a.download = `${safeTitle}_${dims.width}x${dims.height}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showUndoToast(`${tFor(langRef.current).snapshotSavedNotice} (${dims.width}×${dims.height})`);
    }, 'image/png');
  }, [beatCutTimestamps, getEffectiveTimelineBounds, showUndoToast]);

  const handleExportSrt = useCallback(() => {
    const subs = configRef.current.subtitles;
    if (subs.length === 0) return;
    const srtBody = subs
      .map(
        (cue, idx) =>
          `${idx + 1}\n${formatSrtTime(cue.startSec)} --> ${formatSrtTime(cue.endSec)}\n${cue.text}\n`
      )
      .join('\n');
    const blob = new Blob([srtBody], { type: 'application/x-subrip;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle =
      (configRef.current.titleText || 'subtitles').replace(/[<>:"/\\|?*]/g, '').trim() ||
      'subtitles';
    a.download = `${safeTitle}.srt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const handleSelectSection = useCallback((section: 'media' | InspectorTab) => {
    if (section === 'media') {
      setLeftOpen(true);
      requestAnimationFrame(() => {
        document.getElementById('media-panel')?.scrollIntoView({ behavior: 'smooth' });
      });
    } else {
      setRightOpen(true);
      setActiveTab(section);
      requestAnimationFrame(() => {
        document.getElementById('inspector-panel')?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }, []);

  const stageDims = resolveExportDimensions(
    config.aspectMode,
    mediaItems,
    config.customWidth,
    config.customHeight
  );

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#0B0D11] text-gray-100 lg:overflow-hidden relative">
      <TopBar
        lang={lang}
        activeTab={activeTab}
        canExport={Boolean(audio) || mediaItems.length > 0}
        canUndo={historyFlags.canUndo}
        canRedo={historyFlags.canRedo}
        dimsLabel={`${stageDims.width}×${stageDims.height} · ${stageDims.aspectLabel} · ${config.fps}fps`}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        saveStatus={saveStatus}
        onToggleLeftPanel={() => setLeftOpen((v) => !v)}
        onToggleRightPanel={() => setRightOpen((v) => !v)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onToggleLanguage={() => setLang((l) => (l === 'ru' ? 'en' : 'ru'))}
        onExportProjectJson={handleExportProjectJson}
        onImportProjectJson={handleImportProjectJson}
        onResetWorkspace={handleResetAutosave}
        onSelectSection={handleSelectSection}
        onStartExport={handleStartExport}
      />

      {noticeError && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-rose-500/60 bg-[#1B1216] px-3.5 py-2.5 shadow-xl flex items-start gap-2.5 text-xs text-rose-200"
        >
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="flex-1 leading-snug">{noticeError}</span>
          <button
            type="button"
            onClick={() => setNoticeError(null)}
            aria-label={t.closeLabel}
            className="text-rose-300 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {undoToast && (
        <div
          role="status"
          className="fixed bottom-4 left-4 z-50 rounded-md border border-amber-500/50 bg-[#141822] px-3 py-2 shadow-xl flex items-center gap-3 text-xs text-gray-200"
        >
          <span>{undoToast}</span>
          <button
            type="button"
            onClick={() => {
              handleUndo();
              setUndoToast(null);
            }}
            className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/35 border border-amber-500/50 text-amber-300 font-semibold cursor-pointer"
          >
            {t.undoActionBtn}
          </button>
          <button
            type="button"
            onClick={() => setUndoToast(null)}
            aria-label={t.closeLabel}
            className="text-gray-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row lg:overflow-hidden">
        {leftOpen && (
          <>
            <MediaInputPanel
              lang={lang}
              audio={audio}
              mediaBin={mediaBin}
              mediaItems={mediaItems}
              selectedClipId={selectedClipId}
              config={config}
              isLoadingAudio={isLoadingAudio}
              widthPx={leftWidth}
              onAudioFile={handleAudioFile}
              onRemoveAudio={handleRemoveAudio}
              onLoadDemoBeat={handleLoadDemoBeat}
              onVisualFiles={handleVisualFiles}
              onAddBinItemToTimeline={handleAddBinItemToTimeline}
              onAddAllBinToTimeline={handleAddAllBinToTimeline}
              onUpdateBinItem={handleUpdateBinItem}
              onCreateRandomBeatAutoClip={handleCreateRandomBeatAutoClip}
              onRemoveBinItem={handleRemoveBinItem}
              onClearBin={handleClearBin}
              onAddGeneratorScene={handleAddGeneratorScene}
              onSelectClip={handleSelectClip}
              onInspectClip={handleInspectClip}
              onDuplicateClip={handleDuplicateClip}
              onMoveVisual={handleMoveVisual}
              onReverseClips={handleReverseClips}
              onRemoveVisual={handleRemoveVisual}
              onClearVisuals={handleClearVisuals}
              onFitClipsToAudio={handleFitClipsToAudio}
              onFitTrimToClips={handleFitTrimToClips}
              onAutoBeatSyncClips={handleAutoBeatSyncClips}
              trackBpm={trackBeatGrid.bpm}
              trackBeatGrid={trackBeatGrid}
              rawTrackBpm={rawTrackBeatGrid.exactBpm || rawTrackBeatGrid.bpm}
              currentTime={currentTime}
              onSetBeat1AtPlayhead={handleSetBeat1AtPlayhead}
              onReextractAudioBeats={handleReextractAudioBeats}
              onResetBeatCalibration={handleResetBeatCalibration}
              onToggleMetronome={handleToggleMetronome}
              onUseEmbeddedCover={handleUseEmbeddedCover}
              onUpdateConfig={handleUpdateConfig}
              onSelectTrimPreset={handleSelectTrimPreset}
              onPreviewFadeOut={handlePreviewFadeOut}
              onImportSubtitlesText={handleImportSubtitlesText}
              onExportSrt={handleExportSrt}
              onAddCueAtPlayhead={handleAddCueAtPlayhead}
              onUpdateSubtitleCue={handleUpdateSubtitleCue}
              onRemoveSubtitleCue={handleRemoveSubtitleCue}
              onAddTextOverlay={handleAddTextOverlay}
              onAddImageOverlay={handleAddImageOverlay}
              onUpdateOverlay={handleUpdateOverlay}
              onRemoveOverlay={handleRemoveOverlay}
              onResetAutosave={handleResetAutosave}
            />
            <div
              onPointerDown={(e) => {
                panelDragRef.current = { side: 'left', startX: e.clientX, startW: leftWidth };
              }}
              className="hidden lg:block w-1 shrink-0 cursor-col-resize bg-[#1B202C] hover:bg-amber-500/60 transition-colors"
              aria-hidden="true"
            />
          </>
        )}

        <PreviewStage
          lang={lang}
          canvasRef={canvasRef}
          audio={audio}
          mediaItems={mediaItems}
          config={config}
          isPlaying={isPlaying}
          isLooping={isLooping}
          currentTime={currentTime}
          onTogglePlay={handleTogglePlay}
          onToggleLoop={() => setIsLooping((v) => !v)}
          onResetToTrimStart={handleResetToTrimStart}
          onSnapshotPng={handleSnapshotPng}
          onStepFrame={handleStepFrame}
          onJumpCut={handleJumpCut}
          onSelectBeatPreset={(preset: BeatPresetId) => handleUpdateConfig({ beatPreset: preset })}
          onSelectAspectMode={(mode: ExportAspectMode) => handleUpdateConfig({ aspectMode: mode })}
          onToggleSafeZones={() => handleUpdateConfig({ showSafeZones: !config.showSafeZones })}
          onLoadDemoBeat={handleLoadDemoBeat}
        />

        {rightOpen && (
          <>
            <div
              onPointerDown={(e) => {
                panelDragRef.current = { side: 'right', startX: e.clientX, startW: rightWidth };
              }}
              className="hidden lg:block w-1 shrink-0 cursor-col-resize bg-[#1B202C] hover:bg-amber-500/60 transition-colors"
              aria-hidden="true"
            />
            <InspectorPanel
              lang={lang}
              activeTab={activeTab}
              audio={audio}
              mediaItems={mediaItems}
              selectedClipId={selectedClipId}
              selectedFxId={selectedFxId}
              config={config}
              glslError={glslError}
              widthPx={rightWidth}
              onChangeTab={setActiveTab}
              onSelectClip={handleSelectClip}
              onSelectFx={handleSelectFx}
              onUpdateClip={handleUpdateClip}
              onMoveClipPosition={handleMoveClipPosition}
              onApplyClipOverlay={handleApplyClipOverlay}
              onMoveClipOverlayToFxTrack={handleMoveClipOverlayToFxTrack}
              onDuplicateClip={handleDuplicateClip}
              onRemoveVisual={handleRemoveVisual}
              onSetClipTransition={handleSetClipTransition}
              onUpdateConfig={handleUpdateConfig}
              onAddFxOverlay={handleAddFxOverlay}
              onUpdateFxOverlay={handleUpdateFxOverlay}
              onDuplicateFxOverlay={handleDuplicateFxOverlay}
              onRemoveFxOverlay={handleRemoveFxOverlay}
              onFitFxToSelectedClip={handleFitFxToSelectedClip}
              onApplyMoodPreset={handleApplyMoodPreset}
              onResetGenerator={handleResetGenerator}
              onCompileCustomGlsl={handleCompileCustomGlsl}
              onStartExport={handleStartExport}
              onStartStreamExport={handleStartStreamExport}
              onStartBatchExport={handleStartBatchExport}
              onDownloadMetadataTxt={handleDownloadMetadataTxt}
              onUseClipAudioAsMaster={handleUseClipAudioAsMaster}
              onMuteAllClipAudio={handleMuteAllClipAudio}
            />
          </>
        )}
      </div>

      <TimelineDock
        lang={lang}
        audio={audio}
        mediaItems={mediaItems}
        selectedClipId={selectedClipId}
        selectedClipIds={selectedClipIds}
        selectedFxId={selectedFxId}
        beatCutTimestamps={beatCutTimestamps}
        config={config}
        currentTime={currentTime}
        onSeekAbsolute={handleSeekAbsolute}
        onSelectClip={handleSelectClip}
        onSelectFx={handleSelectFx}
        onInspectClip={handleInspectClip}
        onInspectFx={handleInspectFx}
        onUpdateClip={handleUpdateClip}
        onMoveClipPosition={handleMoveClipPosition}
        onMoveClipGroup={handleMoveClipGroup}
        onCloseTimelineGap={handleCloseTimelineGap}
        onCloseAllGaps={handleCloseAllGaps}
        onTrimClipLeftEdge={handleTrimClipLeftEdge}
        onDropBinItemToTimeline={handleDropBinItemToTimeline}
        onDropFilesToTimeline={handleDropFilesToTimeline}
        onApplyClipOverlay={handleApplyClipOverlay}
        onVisualFiles={handleVisualFiles}
        onDuplicateClip={handleDuplicateClip}
        onReorderClip={handleReorderClip}
        onReverseClips={handleReverseClips}
        onCycleClipTransition={handleCycleClipTransition}
        onSetClipTransition={handleSetClipTransition}
        onAddGeneratorScene={handleAddGeneratorScene}
        onAddFxOverlay={handleAddFxOverlay}
        onUpdateFxOverlay={handleUpdateFxOverlay}
        onDuplicateFxOverlay={handleDuplicateFxOverlay}
        onRemoveFxOverlay={handleRemoveFxOverlay}
        onFitFxToSelectedClip={handleFitFxToSelectedClip}
        onSnapFxOverlaysToBeats={handleSnapFxOverlaysToBeats}
        onUpdateOverlay={handleUpdateOverlay}
        onMaterializeLoopSegment={handleMaterializeLoopSegment}
        onSplitClipAtPlayhead={handleSplitClipAtPlayhead}
        onRippleDeleteSelected={handleRippleDeleteSelected}
        onToggleSnapToBeats={() => handleUpdateConfig({ snapToBeats: !config.snapToBeats })}
        onToggleStretchMode={() =>
          handleUpdateConfig({
            timelineStretchMode: config.timelineStretchMode === 'overlap' ? 'push' : 'overlap',
          })
        }
        onToggleAutoRipple={() =>
          handleUpdateConfig({
            autoRippleOnDelete: !config.autoRippleOnDelete,
          })
        }
        onAddBeatMarker={handleAddBeatMarker}
        onToggleBeatMarkerAt={handleToggleBeatMarkerAt}
        onClearBeatMarkers={handleClearBeatMarkers}
        onAutoBeatSyncClips={handleAutoBeatSyncClips}
        trackBpm={trackBeatGrid.bpm}
        beatGridPoints={trackBeatGrid.beats}
        beatDownbeatOffset={trackBeatGrid.downbeatOffset ?? 0}
        beatMetronomeEnabled={Boolean(config.beatMetronomeEnabled)}
        onToggleMetronome={handleToggleMetronome}
        onSetTrimStart={handleSetTrimStart}
        onSetTrimEnd={handleSetTrimEnd}
        onChangeSlideshowMode={(mode) => handleUpdateConfig({ slideshowMode: mode })}
        onMuteAllClipAudio={handleMuteAllClipAudio}
        onToggleBottomAudioTrack={(show) => handleUpdateConfig({ showBottomAudioTrack: show })}
        autoZoomSignal={autoTimelineZoomSignal}
      />

      {exportState.phase !== 'idle' && (
        <Suspense fallback={null}>
          <ExportModal
            lang={lang}
            state={exportState}
            onCancel={() => exportAbortRef.current?.abort()}
            onClose={() => setExportState(IDLE_EXPORT_STATE)}
            onDownloadMetadataTxt={handleDownloadMetadataTxt}
          />
        </Suspense>
      )}
    </div>
  );
}
