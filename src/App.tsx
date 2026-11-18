import { AlertTriangle, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExportModal } from './components/ExportModal';
import { InspectorPanel } from './components/InspectorPanel';
import { MediaInputPanel } from './components/MediaInputPanel';
import { PreviewStage } from './components/PreviewStage';
import { TopBar } from './components/TopBar';
import { tFor } from './i18n';
import {
  AudioTrackState,
  BeatPresetId,
  ExportAspectMode,
  ExportProgressState,
  GeneratorEffectId,
  InspectorTab,
  Language,
  OverlayLayer,
  SlideTransitionType,
  StudioConfig,
  SubtitleCue,
  TrimPresetId,
  VisualMediaState,
} from './types/studio';
import {
  analyzeAudioAtTime,
  buildMonoAudioData,
  computeBeatCutTimestamps,
  computeClipTimelineSegments,
  computeFadeEnvelope,
  computeWaveformPeaks,
  createSmoothState,
  generateDemoAudioBuffer,
  resolveActiveSlideshowSlice,
  resolveBeatCutPoints,
} from './utils/audioAnalyzer';
import { renderStudioFrame } from './utils/canvasRenderer';
import { parseID3Tags } from './utils/id3Parser';
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
  saveBlobToIDB,
  saveProjectToIDB,
  SerializedProject,
  serializeStudioState,
} from './utils/projectStorage';
import { formatSrtTime, parseSubtitles } from './utils/subtitleParser';
import {
  buildSocialMetadataText,
  exportStudioVideo,
  resolveExportDimensions,
} from './utils/videoExporter';

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

interface HistorySnapshot {
  config: StudioConfig;
  mediaItems: VisualMediaState[];
  selectedClipId: string | null;
}

function createItemId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneSnapshot(
  config: StudioConfig,
  mediaItems: VisualMediaState[],
  selectedClipId: string | null
): HistorySnapshot {
  return {
    config: {
      ...config,
      subtitles: config.subtitles.map((s) => ({ ...s })),
      overlays: config.overlays.map((o) => ({ ...o })),
      manualBeatMarkers: [...config.manualBeatMarkers],
    },
    mediaItems: mediaItems.map((m) => ({
      ...m,
      transform: { ...(m.transform || DEFAULT_CLIP_TRANSFORM) },
      generatorParams: m.generatorParams ? { ...m.generatorParams } : undefined,
    })),
    selectedClipId,
  };
}

export default function App() {
  const [lang, setLang] = useState<Language>('en');
  const [activeTab, setActiveTab] = useState<InspectorTab>('effects');
  const [config, setConfig] = useState<StudioConfig>(DEFAULT_STUDIO_CONFIG);

  const [audio, setAudio] = useState<AudioTrackState | null>(null);
  const [mediaItems, setMediaItems] = useState<VisualMediaState[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [glslError, setGlslError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [exportState, setExportState] = useState<ExportProgressState>(IDLE_EXPORT_STATE);
  const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const monoDataRef = useRef<Float32Array>(new Float32Array(0));
  const smoothStateRef = useRef(createSmoothState());
  const playStartCtxTimeRef = useRef(0);
  const playStartPerfMsRef = useRef(0);
  const playStartAudioRef = useRef(0);
  const playSessionRef = useRef(0);
  const currentTimeRef = useRef(0);
  const isLoopingRef = useRef(false);
  const startPlaybackAtRef = useRef<(sec: number) => void>(() => {});
  const exportAbortRef = useRef<AbortController | null>(null);
  const reducedMotionRef = useRef(false);

  const configRef = useRef<StudioConfig>(config);
  const mediaItemsRef = useRef<VisualMediaState[]>(mediaItems);
  const selectedClipIdRef = useRef<string | null>(selectedClipId);
  const audioRef = useRef<AudioTrackState | null>(audio);
  const errorTimerRef = useRef<number | null>(null);

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
  mediaItemsRef.current = mediaItems;
  selectedClipIdRef.current = selectedClipId;
  audioRef.current = audio;
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
      cloneSnapshot(configRef.current, mediaItemsRef.current, selectedClipIdRef.current)
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
        mediaItemsRef.current,
        selectedClipIdRef.current
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
      cloneSnapshot(configRef.current, mediaItemsRef.current, selectedClipIdRef.current)
    );
    setConfig(prev.config);
    setMediaItems(prev.mediaItems);
    setSelectedClipId(prev.selectedClipId);
    syncHistoryFlags();
  }, [syncHistoryFlags]);

  const handleRedo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(
      cloneSnapshot(configRef.current, mediaItemsRef.current, selectedClipIdRef.current)
    );
    setConfig(next.config);
    setMediaItems(next.mediaItems);
    setSelectedClipId(next.selectedClipId);
    syncHistoryFlags();
  }, [syncHistoryFlags]);

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

  const decodeVideoClipAudio = useCallback(
    async (clipId: string, sourceBlob: Blob) => {
      try {
        const arr = await sourceBlob.arrayBuffer();
        const ctx = getAudioContext();
        const decoded = await ctx.decodeAudioData(arr);
        setMediaItems((prev) =>
          prev.map((m) => (m.id === clipId ? { ...m, decodedAudioBuffer: decoded } : m))
        );
      } catch {
        // Silent video or unsupported audio track; skip cleanly
      }
    },
    [getAudioContext]
  );

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
      const rawClipsTotal = items.reduce((acc, m) => acc + Math.max(0.5, m.durationSec || 4), 0);
      const clipDuration = Math.max(4, rawClipsTotal > 0 ? rawClipsTotal : 12);
      return {
        trimBase: 0,
        trimEnd: clipDuration,
        clipDuration,
        maxSeek: clipDuration,
      };
    },
    []
  );

  // Precompute deterministic beat-cut timestamps (merging manual beat markers when present)
  const beatCutTimestamps = useMemo(() => {
    const bounds = getEffectiveTimelineBounds(config, mediaItems, audio);
    const clipDuration = bounds.clipDuration;
    const autoCuts =
      audio && config.slideshowMode === 'beat_cut' && mediaItems.length > 1
        ? computeBeatCutTimestamps(
            monoDataRef.current,
            audio.sampleRate,
            config.trimStart,
            config.trimEnd,
            config.minBeatCutSec,
            config.beatSensitivity
          )
        : [0];
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
  ]);

  const stopPlayback = useCallback(() => {
    playSessionRef.current++;
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
    setIsPlaying(false);
  }, []);

  const syncVideosAtLocalTime = useCallback(
    (localTime: number, shouldPlay: boolean) => {
      const items = mediaItemsRef.current;
      if (items.length === 0) return;
      const bounds = getEffectiveTimelineBounds(config, items, audioRef.current);
      const slice = resolveActiveSlideshowSlice(
        items,
        localTime,
        bounds.clipDuration,
        config,
        beatCutTimestamps
      );
      const activeIds = new Set<string>();
      const activeItem = items[slice.activeIndex];
      if (activeItem) activeIds.add(activeItem.id);
      if (slice.prevIndex !== null && items[slice.prevIndex]) {
        activeIds.add(items[slice.prevIndex].id);
      }

      items.forEach((item) => {
        if (item.kind !== 'video' || !item.videoElement) return;
        const v = item.videoElement;
        const vDur = item.videoDuration || 1;
        const rate = item.playbackRate || 1;
        const isActive = item.id === activeItem?.id;
        const clipOffset = isActive ? slice.slideLocalTime : slice.prevSlideLocalTime;
        const targetSec = (item.sourceStartSec + clipOffset * rate) % vDur;

        if (Math.abs(v.playbackRate - rate) > 0.01) {
          v.playbackRate = rate;
        }

        if (activeIds.has(item.id)) {
          if (shouldPlay) {
            v.muted = !isActive || item.clipAudioMuted || item.clipAudioVolume <= 0.01;
            v.volume = Math.max(0, Math.min(1, item.clipAudioVolume));
            if (v.paused) {
              v.currentTime = targetSec;
              v.play().catch(() => {});
            } else if (Math.abs(v.currentTime - targetSec) > 0.35) {
              v.currentTime = targetSec;
            }
          } else {
            v.muted = true;
            v.pause();
            if (Math.abs(v.currentTime - targetSec) > 0.03) {
              v.currentTime = targetSec;
            }
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

      const clampedStart = Math.max(
        config.trimStart,
        Math.min(config.trimEnd - 0.1, startAbsSec)
      );
      const remainingDur = Math.max(0.1, config.trimEnd - clampedStart);
      const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);

      const segments = computeClipTimelineSegments(
        mediaItemsRef.current,
        clipDuration,
        config,
        beatCutTimestamps
      );
      const duckGain = Math.max(0.08, 1 - (config.audioDucking ?? 0.45));

      const src = ctx.createBufferSource();
      src.buffer = currentAudio.buffer;

      const gainNode = ctx.createGain();
      const curveSteps = 96;
      const curve = new Float32Array(curveSteps);
      for (let i = 0; i < curveSteps; i++) {
        const localT =
          clampedStart - config.trimStart + (i / (curveSteps - 1)) * remainingDur;
        let duckMult = 1;
        if (config.audioDucking > 0.02 && segments.length > 0) {
          const seg = segments.find((s) => localT >= s.startSec && localT <= s.endSec);
          const clip = seg ? mediaItemsRef.current[seg.clipIndex] : undefined;
          if (clip && clip.kind === 'video' && !clip.clipAudioMuted && clip.clipAudioVolume > 0.02) {
            duckMult = duckGain;
          }
        }
        curve[i] =
          computeFadeEnvelope(localT, clipDuration, config.fadeInSec, config.fadeOutSec) *
          config.audioGain *
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
      currentTimeRef.current = clampedStart;
      setCurrentTime(clampedStart);
      setIsPlaying(true);

      src.start(startCtxTime, clampedStart, remainingDur);
      syncVideosAtLocalTime(clampedStart - config.trimStart, true);
    },
    [
      beatCutTimestamps,
      config,
      getAudioContext,
      getEffectiveTimelineBounds,
      stopPlayback,
      syncVideosAtLocalTime,
    ]
  );

  startPlaybackAtRef.current = startPlaybackAt;

  const appendVisualFromUrl = useCallback(
    (
      url: string,
      fileName: string,
      kind: 'image' | 'video',
      isSharedUrl = false,
      sourceBlob?: Blob
    ) => {
      const id = createItemId();
      if (kind === 'image') {
        const img = new Image();
        img.onload = () => {
          pushImmediateHistory();
          setMediaItems((prev) => [
            ...prev,
            {
              id,
              kind: 'image',
              fileName,
              url,
              width: img.naturalWidth,
              height: img.naturalHeight,
              imageElement: img,
              durationSec: 4.0,
              sourceStartSec: 0,
              playbackRate: 1.0,
              transitionOut: 'crossfade',
              transitionDurationSec: 0.65,
              transform: { ...DEFAULT_CLIP_TRANSFORM },
              clipAudioVolume: 0,
              clipAudioMuted: true,
            },
          ]);
          setSelectedClipId(id);
        };
        img.onerror = () => {
          if (!isSharedUrl && url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
          }
          showError(`${tFor(lang).errInvalidVisual}: ${fileName}`);
        };
        img.src = url;
      } else {
        const video = document.createElement('video');
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.onloadedmetadata = () => {
          const vDur = video.duration || 10;
          pushImmediateHistory();
          setMediaItems((prev) => [
            ...prev,
            {
              id,
              kind: 'video',
              fileName,
              url,
              width: video.videoWidth || 1080,
              height: video.videoHeight || 1920,
              videoElement: video,
              videoDuration: vDur,
              durationSec: Number(Math.min(8, Math.max(1, vDur)).toFixed(1)),
              sourceStartSec: 0,
              playbackRate: 1.0,
              transitionOut: 'crossfade',
              transitionDurationSec: 0.65,
              transform: { ...DEFAULT_CLIP_TRANSFORM },
              clipAudioVolume: 0.8,
              clipAudioMuted: true,
            },
          ]);
          setSelectedClipId(id);
          if (sourceBlob) {
            decodeVideoClipAudio(id, sourceBlob);
          }
        };
        video.onerror = () => {
          if (!isSharedUrl && url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
          }
          showError(`${tFor(lang).errInvalidVisual}: ${fileName}`);
        };
        video.src = url;
      }
    },
    [decodeVideoClipAudio, lang, pushImmediateHistory, showError]
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
        !mediaItemsRef.current.some((m) => m.url === prevCover)
      ) {
        URL.revokeObjectURL(prevCover);
      }

      const mono = buildMonoAudioData(buffer);
      monoDataRef.current = mono;
      const peaks = computeWaveformPeaks(mono, 220);

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
        setConfig((prev) => {
          const nextEnd =
            prev.trimPreset === 'reels_60' || prev.trimPreset === 'tiktok_60'
              ? Math.min(buffer.duration, 60)
              : prev.trimPreset === 'shorts_57'
                ? Math.min(buffer.duration, 57)
                : buffer.duration;
          return {
            ...prev,
            titleText: meta.title || prev.titleText,
            artistText: meta.artist || (isSyntheticDemo ? 'Neuromicon' : ''),
            albumText: meta.album || (meta.year ? `Release · ${meta.year}` : ''),
            trimStart: 0,
            trimEnd: Number(nextEnd.toFixed(2)),
          };
        });

        if (meta.embeddedCoverUrl && mediaItemsRef.current.length === 0) {
          appendVisualFromUrl(meta.embeddedCoverUrl, `${fileName} (Cover)`, 'image', true);
        }
      }
    },
    [appendVisualFromUrl, stopPlayback]
  );

  // Restore autosaved project from IndexedDB on initial mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadProjectFromIDB();
        if (!saved || cancelled) {
          hydratedRef.current = true;
          return;
        }

        const mergedConfig: StudioConfig = {
          ...DEFAULT_STUDIO_CONFIG,
          ...saved.config,
          overlays: [],
        };

        // Rehydrate overlay layers (load PNG/logo blobs if stored)
        const restoredOverlays: OverlayLayer[] = [];
        for (const ov of saved.config.overlays || []) {
          if (ov.kind === 'image') {
            const blob = await loadBlobFromIDB(`overlay-${ov.id}`);
            if (blob) {
              const url = URL.createObjectURL(blob);
              blobKeyMapRef.current.set(url, `overlay-${ov.id}`);
              const img = new Image();
              img.src = url;
              restoredOverlays.push({ ...ov, imageUrl: url, imageElement: img });
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
              applyAudioBuffer(
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
                applyAudioBuffer(
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

        // Rehydrate media clips cleanly in saved order
        const restoredClips: VisualMediaState[] = [];
        for (const sc of saved.clips || []) {
          if (sc.kind === 'generator') {
            restoredClips.push({
              id: sc.id,
              kind: 'generator',
              fileName: sc.fileName,
              url: '',
              width: sc.width,
              height: sc.height,
              durationSec: sc.durationSec,
              sourceStartSec: sc.sourceStartSec,
              playbackRate: sc.playbackRate,
              transitionOut: sc.transitionOut,
              transitionDurationSec: sc.transitionDurationSec,
              generatorId: sc.generatorId || 'galaxy_spiral',
              generatorParams: sc.generatorParams ? { ...sc.generatorParams } : undefined,
              transform: sc.transform || { ...DEFAULT_CLIP_TRANSFORM },
              clipAudioVolume: sc.clipAudioVolume ?? 0,
              clipAudioMuted: sc.clipAudioMuted ?? true,
            });
          } else if (sc.blobKey) {
            const blob = await loadBlobFromIDB(sc.blobKey);
            if (!blob) continue;
            const url = URL.createObjectURL(blob);
            blobKeyMapRef.current.set(url, sc.blobKey);

            if (sc.kind === 'image') {
              const img = await new Promise<HTMLImageElement | null>((resolve) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => resolve(null);
                el.src = url;
              });
              if (img) {
                restoredClips.push({
                  id: sc.id,
                  kind: 'image',
                  fileName: sc.fileName,
                  url,
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                  imageElement: img,
                  durationSec: sc.durationSec,
                  sourceStartSec: sc.sourceStartSec,
                  playbackRate: sc.playbackRate,
                  transitionOut: sc.transitionOut,
                  transitionDurationSec: sc.transitionDurationSec,
                  transform: sc.transform || { ...DEFAULT_CLIP_TRANSFORM },
                  clipAudioVolume: sc.clipAudioVolume ?? 0,
                  clipAudioMuted: sc.clipAudioMuted ?? true,
                });
              }
            } else {
              const video = document.createElement('video');
              video.muted = true;
              video.loop = true;
              video.playsInline = true;
              video.preload = 'auto';
              const ok = await new Promise<boolean>((resolve) => {
                video.onloadedmetadata = () => resolve(true);
                video.onerror = () => resolve(false);
                video.src = url;
              });
              if (ok) {
                let decodedBuf: AudioBuffer | undefined;
                try {
                  const arr = await blob.arrayBuffer();
                  decodedBuf = await getAudioContext().decodeAudioData(arr);
                } catch {
                  // silent video
                }
                restoredClips.push({
                  id: sc.id,
                  kind: 'video',
                  fileName: sc.fileName,
                  url,
                  width: video.videoWidth || sc.width,
                  height: video.videoHeight || sc.height,
                  videoElement: video,
                  videoDuration: video.duration || sc.videoDuration || 10,
                  decodedAudioBuffer: decodedBuf,
                  durationSec: sc.durationSec,
                  sourceStartSec: sc.sourceStartSec,
                  playbackRate: sc.playbackRate,
                  transitionOut: sc.transitionOut,
                  transitionDurationSec: sc.transitionDurationSec,
                  transform: sc.transform || { ...DEFAULT_CLIP_TRANSFORM },
                  clipAudioVolume: sc.clipAudioVolume ?? 0.8,
                  clipAudioMuted: sc.clipAudioMuted ?? true,
                });
              }
            }
          }
        }
        if (!cancelled && restoredClips.length > 0) {
          setMediaItems(restoredClips);
          setSelectedClipId(restoredClips[0].id);
        }
      } catch {
        // Ignore IDB hydration errors cleanly
      } finally {
        hydratedRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyAudioBuffer, getAudioContext]);

  // Debounced IndexedDB autosave whenever project state changes
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      const serialized = serializeStudioState(
        config,
        mediaItems,
        blobKeyMapRef.current,
        audio?.fileName,
        audio?.fileSize,
        audio?.isSyntheticDemo,
        audioBlobKeyRef.current
      );
      saveProjectToIDB(serialized);
      autosaveTimerRef.current = null;
    }, 900);
  }, [audio, config, mediaItems]);

  const handleAudioFile = useCallback(
    async (file: File) => {
      if (!file || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
        showError(`${tFor(lang).errUnsupportedFile}: ${file?.name || ''}`);
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
        saveBlobToIDB(audioKey, file);

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
        console.error('Failed to decode audio file:', err);
        showError(tFor(lang).errInvalidAudio);
      } finally {
        setIsLoadingAudio(false);
      }
    },
    [applyAudioBuffer, getAudioContext, lang, showError]
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
    (files: File[]) => {
      for (const file of files) {
        if (!file || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
          showError(`${tFor(lang).errUnsupportedFile}: ${file?.name || ''}`);
          continue;
        }
        const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name);
        const isImage =
          file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(file.name);
        if (!isVideo && !isImage) {
          showError(`${tFor(lang).errUnsupportedFile}: ${file.name}`);
          continue;
        }
        const url = URL.createObjectURL(file);
        const blobKey = `clip-${createItemId()}`;
        blobKeyMapRef.current.set(url, blobKey);
        saveBlobToIDB(blobKey, file);
        appendVisualFromUrl(url, file.name, isVideo ? 'video' : 'image', false, file);
      }
    },
    [appendVisualFromUrl, lang, showError]
  );

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
      setMediaItems((prev) => [
        ...prev,
        {
          id,
          kind: 'generator',
          fileName,
          url: '',
          width: 1920,
          height: 1080,
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
        },
      ]);
      setSelectedClipId(id);
    },
    [lang, pushImmediateHistory]
  );

  const handleUpdateClip = useCallback(
    (id: string, patch: Partial<VisualMediaState>) => {
      queueDebouncedHistory();
      setMediaItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    },
    [queueDebouncedHistory]
  );

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
        clonedVideo.preload = 'auto';
        clonedVideo.src = orig.url;
      }

      const copyItem: VisualMediaState = {
        ...orig,
        id: newId,
        transform: { ...(orig.transform || DEFAULT_CLIP_TRANSFORM) },
        generatorParams: orig.generatorParams ? { ...orig.generatorParams } : undefined,
        videoElement: orig.kind === 'video' ? clonedVideo : undefined,
      };

      const next = [...prev];
      next.splice(idx + 1, 0, copyItem);
      setMediaItems(next);
      setSelectedClipId(newId);
    },
    [pushImmediateHistory]
  );

  const handleFitClipsToAudio = useCallback(() => {
    if (!audioRef.current || mediaItemsRef.current.length === 0) return;
    pushImmediateHistory();
    const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);
    const perClip = Number(Math.max(0.5, clipDuration / mediaItemsRef.current.length).toFixed(2));
    setMediaItems((prev) => prev.map((item) => ({ ...item, durationSec: perClip })));
    setConfig((prev) => ({ ...prev, slideshowMode: 'custom_durations' }));
  }, [config.trimEnd, config.trimStart, pushImmediateHistory]);

  const handleFitTrimToClips = useCallback(() => {
    const aud = audioRef.current;
    const items = mediaItemsRef.current;
    if (!aud || items.length === 0) return;
    pushImmediateHistory();
    const totalClips = items.reduce((acc, m) => acc + Math.max(0.5, m.durationSec || 4), 0);
    setConfig((prev) => {
      const nextEnd = Math.min(aud.duration, prev.trimStart + Math.max(0.5, totalClips));
      return {
        ...prev,
        trimPreset: 'custom',
        trimEnd: Number(nextEnd.toFixed(2)),
        slideshowMode: 'custom_durations',
      };
    });
  }, [pushImmediateHistory]);

  const handleReverseClips = useCallback(() => {
    if (mediaItemsRef.current.length < 2) return;
    pushImmediateHistory();
    setMediaItems((prev) => [...prev].reverse());
  }, [pushImmediateHistory]);

  const handleCycleClipTransition = useCallback(
    (id: string) => {
      const order: SlideTransitionType[] = ['crossfade', 'dip_black', 'slide', 'cut'];
      pushImmediateHistory();
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

  const handleMoveVisual = useCallback(
    (index: number, direction: -1 | 1) => {
      pushImmediateHistory();
      setMediaItems((prev) => {
        const target = index + direction;
        if (target < 0 || target >= prev.length) return prev;
        const copy = [...prev];
        const [moved] = copy.splice(index, 1);
        copy.splice(target, 0, moved);
        return copy;
      });
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
        const copy = [...prev];
        const [moved] = copy.splice(fromIdx, 1);
        copy.splice(toIdx, 0, moved);
        return copy;
      });
    },
    [pushImmediateHistory]
  );

  const handleSplitClipAtPlayhead = useCallback(() => {
    const items = mediaItemsRef.current;
    if (items.length === 0) return;
    const bounds = getEffectiveTimelineBounds(configRef.current, items, audioRef.current);
    const clipDuration = bounds.clipDuration;
    const localTime = Math.max(0, Math.min(clipDuration, currentTimeRef.current - bounds.trimBase));
    const segments = computeClipTimelineSegments(
      items,
      clipDuration,
      configRef.current,
      beatCutTimestamps
    );
    if (segments.length === 0) return;

    const seg =
      segments.find((s) => localTime >= s.startSec && localTime < s.endSec) ||
      segments[segments.length - 1];
    const targetClip = items[seg.clipIndex];
    if (!targetClip) return;

    const segDur = seg.endSec - seg.startSec;
    const offsetInSeg = localTime - seg.startSec;
    if (segDur < 1.0 || offsetInSeg < 0.35 || segDur - offsetInSeg < 0.35) return;

    pushImmediateHistory();
    const firstDur = Number(offsetInSeg.toFixed(2));
    const secondDur = Number((segDur - offsetInSeg).toFixed(2));
    const newId = createItemId();

    let secondVideo: HTMLVideoElement | undefined;
    if (targetClip.kind === 'video' && targetClip.url) {
      secondVideo = document.createElement('video');
      secondVideo.muted = true;
      secondVideo.loop = true;
      secondVideo.playsInline = true;
      secondVideo.preload = 'auto';
      secondVideo.src = targetClip.url;
    }

    const firstClip: VisualMediaState = {
      ...targetClip,
      durationSec: firstDur,
      generatorParams: targetClip.generatorParams ? { ...targetClip.generatorParams } : undefined,
    };
    const secondClip: VisualMediaState = {
      ...targetClip,
      id: newId,
      durationSec: secondDur,
      sourceStartSec:
        targetClip.kind === 'video'
          ? Number((targetClip.sourceStartSec + firstDur * (targetClip.playbackRate || 1)).toFixed(2))
          : targetClip.sourceStartSec,
      videoElement: secondVideo,
      transform: { ...(targetClip.transform || DEFAULT_CLIP_TRANSFORM) },
      generatorParams: targetClip.generatorParams ? { ...targetClip.generatorParams } : undefined,
    };

    const next = [...items];
    next.splice(seg.clipIndex, 1, firstClip, secondClip);
    setMediaItems(next);
    setSelectedClipId(newId);
    if (configRef.current.slideshowMode !== 'custom_durations') {
      setConfig((prev) => ({ ...prev, slideshowMode: 'custom_durations' }));
    }
  }, [beatCutTimestamps, getEffectiveTimelineBounds, pushImmediateHistory]);

  const handleRemoveVisual = useCallback(
    (id: string) => {
      const prev = mediaItemsRef.current;
      const target = prev.find((item) => item.id === id);
      if (!target) return;
      pushImmediateHistory();
      if (target.kind === 'video' && target.videoElement) {
        target.videoElement.pause();
      }
      const remaining = prev.filter((item) => item.id !== id);
      setMediaItems(remaining);
      if (selectedClipIdRef.current === id) {
        setSelectedClipId(remaining[0]?.id ?? null);
      }
    },
    [pushImmediateHistory]
  );

  const handleRippleDeleteSelected = useCallback(() => {
    const items = mediaItemsRef.current;
    if (items.length === 0) return;
    const targetId = selectedClipIdRef.current || items[0].id;
    handleRemoveVisual(targetId);
  }, [handleRemoveVisual]);

  const handleClearVisuals = useCallback(() => {
    if (mediaItemsRef.current.length === 0) return;
    pushImmediateHistory();
    for (const item of mediaItemsRef.current) {
      if (item.kind === 'video' && item.videoElement) {
        item.videoElement.pause();
      }
    }
    setMediaItems([]);
    setSelectedClipId(null);
  }, [pushImmediateHistory]);

  const handleUseEmbeddedCover = useCallback(() => {
    const currentAudio = audioRef.current;
    if (!currentAudio?.metadata.embeddedCoverUrl) return;
    appendVisualFromUrl(
      currentAudio.metadata.embeddedCoverUrl,
      `${currentAudio.fileName} (Cover)`,
      'image',
      true
    );
  }, [appendVisualFromUrl]);

  const handleUpdateConfig = useCallback(
    (patch: Partial<StudioConfig>) => {
      queueDebouncedHistory();
      setConfig((prev) => ({ ...prev, ...patch }));
    },
    [queueDebouncedHistory]
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

  const handleClearBeatMarkers = useCallback(() => {
    if (configRef.current.manualBeatMarkers.length === 0) return;
    pushImmediateHistory();
    setConfig((prev) => ({ ...prev, manualBeatMarkers: [] }));
  }, [pushImmediateHistory]);

  const handleImportSubtitlesText = useCallback(
    (raw: string) => {
      const parsed = parseSubtitles(raw);
      if (parsed.length === 0) return;
      pushImmediateHistory();
      setConfig((prev) => ({ ...prev, subtitles: parsed, showSubtitles: true }));
    },
    [pushImmediateHistory]
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
      saveBlobToIDB(`overlay-${ovId}`, file);
      blobKeyMapRef.current.set(url, `overlay-${ovId}`);

      const img = new Image();
      img.onload = () => {
        pushImmediateHistory();
        const layer: OverlayLayer = {
          id: ovId,
          kind: 'image',
          label: file.name,
          imageUrl: url,
          imageElement: img,
          xPct: 0.86,
          yPct: 0.12,
          scale: 0.9,
          opacity: 0.9,
        };
        setConfig((prev) => ({ ...prev, overlays: [...prev.overlays, layer] }));
      };
      img.onerror = () => {
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
      audioBlobKeyRef.current
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
        pushImmediateHistory();
        const mergedConfig: StudioConfig = {
          ...DEFAULT_STUDIO_CONFIG,
          ...parsed.config,
          overlays: (parsed.config.overlays || [])
            .filter((o) => o.kind === 'text')
            .map((o) => ({ ...o })),
        };
        setConfig(mergedConfig);
        if (mergedConfig.customGlslCode) {
          const res = proceduralShaderEngine.updateCustomShader(mergedConfig.customGlslCode);
          setGlslError(res.error);
        }

        // Restore generator clips cleanly + any local IDB blobs if available
        const nextClips: VisualMediaState[] = [];
        for (const sc of parsed.clips || []) {
          if (sc.kind === 'generator') {
            nextClips.push({
              id: sc.id || createItemId(),
              kind: 'generator',
              fileName: sc.fileName,
              url: '',
              width: sc.width || 1920,
              height: sc.height || 1080,
              durationSec: sc.durationSec || 5,
              sourceStartSec: sc.sourceStartSec || 0,
              playbackRate: sc.playbackRate || 1,
              transitionOut: sc.transitionOut || 'crossfade',
              transitionDurationSec: sc.transitionDurationSec || 0.65,
              generatorId: sc.generatorId || 'galaxy_spiral',
              generatorParams: sc.generatorParams ? { ...sc.generatorParams } : undefined,
              transform: sc.transform || { ...DEFAULT_CLIP_TRANSFORM },
              clipAudioVolume: sc.clipAudioVolume ?? 0,
              clipAudioMuted: sc.clipAudioMuted ?? true,
            });
          } else if (sc.blobKey) {
            const blob = await loadBlobFromIDB(sc.blobKey);
            if (!blob) continue;
            const url = URL.createObjectURL(blob);
            blobKeyMapRef.current.set(url, sc.blobKey);
            if (sc.kind === 'image') {
              const img = new Image();
              img.src = url;
              nextClips.push({
                id: sc.id || createItemId(),
                kind: 'image',
                fileName: sc.fileName,
                url,
                width: sc.width || 1920,
                height: sc.height || 1080,
                imageElement: img,
                durationSec: sc.durationSec || 4,
                sourceStartSec: 0,
                playbackRate: 1,
                transitionOut: sc.transitionOut || 'crossfade',
                transitionDurationSec: sc.transitionDurationSec || 0.65,
                transform: sc.transform || { ...DEFAULT_CLIP_TRANSFORM },
                clipAudioVolume: 0,
                clipAudioMuted: true,
              });
            }
          }
        }
        if (nextClips.length > 0) {
          setMediaItems(nextClips);
          setSelectedClipId(nextClips[0].id);
        }
      } catch (err) {
        showError(err instanceof Error ? err.message : tFor(lang).errUnsupportedFile);
      }
    },
    [lang, pushImmediateHistory, showError]
  );

  const handleResetAutosave = useCallback(async () => {
    stopPlayback();
    pushImmediateHistory();
    await clearProjectIDB();
    blobKeyMapRef.current.clear();
    audioBlobKeyRef.current = undefined;
    setMediaItems([]);
    setSelectedClipId(null);
    setAudio(null);
    monoDataRef.current = new Float32Array(0);
    setConfig(DEFAULT_STUDIO_CONFIG);
    setGlslError(null);
    currentTimeRef.current = 0;
    setCurrentTime(0);
  }, [pushImmediateHistory, stopPlayback]);

  const handleSelectTrimPreset = useCallback(
    (preset: TrimPresetId) => {
      pushImmediateHistory();
      const dur = audioRef.current ? audioRef.current.duration : 60;
      setConfig((prev) => {
        if (preset === 'full') {
          return { ...prev, trimPreset: preset, trimStart: 0, trimEnd: Number(dur.toFixed(2)) };
        }
        if (preset === 'reels_60' || preset === 'tiktok_60') {
          return {
            ...prev,
            trimPreset: preset,
            trimStart: 0,
            trimEnd: Number(Math.min(dur, 60).toFixed(2)),
            fadeOutSec: 3.0,
          };
        }
        if (preset === 'shorts_57') {
          return {
            ...prev,
            trimPreset: preset,
            trimStart: 0,
            trimEnd: Number(Math.min(dur, 57).toFixed(2)),
            fadeOutSec: 3.0,
          };
        }
        return { ...prev, trimPreset: 'custom' };
      });
    },
    [pushImmediateHistory]
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
      setConfig((prev) => {
        const clamped = Math.max(0, Math.min(prev.trimEnd - 0.5, sec));
        return {
          ...prev,
          trimPreset: 'custom',
          trimStart: Number(clamped.toFixed(2)),
        };
      });
    },
    [queueDebouncedHistory]
  );

  const handleSetTrimEnd = useCallback(
    (sec: number) => {
      const aud = audioRef.current;
      if (!aud) return;
      queueDebouncedHistory();
      setConfig((prev) => {
        const clamped = Math.min(aud.duration, Math.max(prev.trimStart + 0.5, sec));
        return {
          ...prev,
          trimPreset: 'custom',
          trimEnd: Number(clamped.toFixed(2)),
        };
      });
    },
    [queueDebouncedHistory]
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

      const metrics = analyzeAudioAtTime(
        monoDataRef.current,
        audio?.sampleRate || 48000,
        absTime,
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
      drawOnce();
    }
  }, [currentTime, drawOnce, isPlaying]);

  // Global Keyboard Shortcuts (ignoring text inputs)
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
        if (selectedClipIdRef.current) {
          handleDuplicateClip(selectedClipIdRef.current);
        }
        return;
      }
      if (e.code === 'Space') {
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
      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        handleRippleDeleteSelected();
        return;
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleSeekAbsolute(currentTimeRef.current - (e.shiftKey ? 2.0 : 0.5));
        return;
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleSeekAbsolute(currentTimeRef.current + (e.shiftKey ? 2.0 : 0.5));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleAddBeatMarker,
    handleDuplicateClip,
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
    if (!audio) return;
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

  const handleStartBatchExport = useCallback(async () => {
    if (!audio) return;
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
    if (!audio) return;
    const dims = resolveExportDimensions(
      config.aspectMode,
      mediaItems,
      config.customWidth,
      config.customHeight
    );
    const content = buildSocialMetadataText(config, audio, dims);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(config.titleText || 'track').replace(/[<>:"/\\|?*]/g, '')}_description.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [audio, config, mediaItems]);

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

    const metrics = analyzeAudioAtTime(
      monoDataRef.current,
      audioRef.current?.sampleRate || 48000,
      absTime,
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
    }, 'image/png');
  }, [beatCutTimestamps]);

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
      document.getElementById('media-panel')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      setActiveTab(section);
      document.getElementById('inspector-panel')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#0B0D11] text-gray-100 relative">
      <TopBar
        lang={lang}
        activeTab={activeTab}
        hasAudio={Boolean(audio)}
        canUndo={historyFlags.canUndo}
        canRedo={historyFlags.canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onExportProjectJson={handleExportProjectJson}
        onImportProjectJson={handleImportProjectJson}
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

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <MediaInputPanel
          lang={lang}
          audio={audio}
          mediaItems={mediaItems}
          selectedClipId={selectedClipId}
          config={config}
          isLoadingAudio={isLoadingAudio}
          onAudioFile={handleAudioFile}
          onLoadDemoBeat={handleLoadDemoBeat}
          onVisualFiles={handleVisualFiles}
          onAddGeneratorScene={handleAddGeneratorScene}
          onSelectClip={setSelectedClipId}
          onUpdateClip={handleUpdateClip}
          onDuplicateClip={handleDuplicateClip}
          onMoveVisual={handleMoveVisual}
          onReverseClips={handleReverseClips}
          onRemoveVisual={handleRemoveVisual}
          onClearVisuals={handleClearVisuals}
          onFitClipsToAudio={handleFitClipsToAudio}
          onFitTrimToClips={handleFitTrimToClips}
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

        <PreviewStage
          lang={lang}
          canvasRef={canvasRef}
          audio={audio}
          mediaItems={mediaItems}
          selectedClipId={selectedClipId}
          beatCutTimestamps={beatCutTimestamps}
          config={config}
          isPlaying={isPlaying}
          isLooping={isLooping}
          currentTime={currentTime}
          onToggleLanguage={() => setLang((l) => (l === 'ru' ? 'en' : 'ru'))}
          onTogglePlay={handleTogglePlay}
          onToggleLoop={() => setIsLooping((v) => !v)}
          onResetToTrimStart={handleResetToTrimStart}
          onSnapshotPng={handleSnapshotPng}
          onSeekAbsolute={handleSeekAbsolute}
          onSelectClip={setSelectedClipId}
          onUpdateClip={handleUpdateClip}
          onDuplicateClip={handleDuplicateClip}
          onReorderClip={handleReorderClip}
          onReverseClips={handleReverseClips}
          onCycleClipTransition={handleCycleClipTransition}
          onAddGeneratorScene={handleAddGeneratorScene}
          onSplitClipAtPlayhead={handleSplitClipAtPlayhead}
          onRippleDeleteSelected={handleRippleDeleteSelected}
          onToggleSnapToBeats={() => handleUpdateConfig({ snapToBeats: !config.snapToBeats })}
          onAddBeatMarker={handleAddBeatMarker}
          onClearBeatMarkers={handleClearBeatMarkers}
          onSetTrimStart={handleSetTrimStart}
          onSetTrimEnd={handleSetTrimEnd}
          onStepFrame={handleStepFrame}
          onJumpCut={handleJumpCut}
          onSelectBeatPreset={(preset: BeatPresetId) => handleUpdateConfig({ beatPreset: preset })}
          onToggleSafeZones={() => handleUpdateConfig({ showSafeZones: !config.showSafeZones })}
          onLoadDemoBeat={handleLoadDemoBeat}
        />

        <InspectorPanel
          lang={lang}
          activeTab={activeTab}
          audio={audio}
          mediaItems={mediaItems}
          config={config}
          glslError={glslError}
          onChangeTab={setActiveTab}
          onUpdateConfig={handleUpdateConfig}
          onApplyMoodPreset={handleApplyMoodPreset}
          onResetGenerator={handleResetGenerator}
          onCompileCustomGlsl={handleCompileCustomGlsl}
          onStartExport={handleStartExport}
          onStartBatchExport={handleStartBatchExport}
          onDownloadMetadataTxt={handleDownloadMetadataTxt}
        />
      </div>

      <ExportModal
        lang={lang}
        state={exportState}
        onCancel={() => exportAbortRef.current?.abort()}
        onClose={() => setExportState(IDLE_EXPORT_STATE)}
        onDownloadMetadataTxt={handleDownloadMetadataTxt}
      />
    </div>
  );
}
