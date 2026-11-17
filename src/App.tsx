import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExportModal } from './components/ExportModal';
import { InspectorPanel } from './components/InspectorPanel';
import { MediaInputPanel } from './components/MediaInputPanel';
import { PreviewStage } from './components/PreviewStage';
import { TopBar } from './components/TopBar';
import {
  AudioTrackState,
  BeatPresetId,
  ExportProgressState,
  GeneratorEffectId,
  InspectorTab,
  Language,
  StudioConfig,
  TrimPresetId,
  VisualMediaState,
} from './types/studio';
import {
  analyzeAudioAtTime,
  buildMonoAudioData,
  computeBeatCutTimestamps,
  computeFadeEnvelope,
  computeWaveformPeaks,
  createSmoothState,
  generateDemoAudioBuffer,
  resolveActiveSlideshowSlice,
} from './utils/audioAnalyzer';
import { renderStudioFrame } from './utils/canvasRenderer';
import { parseID3Tags } from './utils/id3Parser';
import { DEFAULT_STUDIO_CONFIG, GENERATOR_EFFECTS } from './utils/presets';
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

function createItemId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [lang, setLang] = useState<Language>('en');
  const [activeTab, setActiveTab] = useState<InspectorTab>('effects');
  const [config, setConfig] = useState<StudioConfig>(DEFAULT_STUDIO_CONFIG);

  const [audio, setAudio] = useState<AudioTrackState | null>(null);
  const [mediaItems, setMediaItems] = useState<VisualMediaState[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [exportState, setExportState] = useState<ExportProgressState>(IDLE_EXPORT_STATE);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const monoDataRef = useRef<Float32Array>(new Float32Array(0));
  const smoothStateRef = useRef(createSmoothState());
  const playStartWallRef = useRef(0);
  const playStartAudioRef = useRef(0);
  const currentTimeRef = useRef(0);
  const exportAbortRef = useRef<AbortController | null>(null);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Precompute deterministic beat-cut timestamps whenever audio or beat-cut settings change
  const beatCutTimestamps = useMemo(() => {
    if (!audio || config.slideshowMode !== 'beat_cut' || mediaItems.length <= 1) {
      return [0];
    }
    return computeBeatCutTimestamps(
      monoDataRef.current,
      audio.sampleRate,
      config.trimStart,
      config.trimEnd,
      config.minBeatCutSec,
      config.beatSensitivity
    );
  }, [
    audio,
    config.beatSensitivity,
    config.minBeatCutSec,
    config.slideshowMode,
    config.trimEnd,
    config.trimStart,
    mediaItems.length,
  ]);

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  const stopPlayback = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore if already stopped
      }
      sourceNodeRef.current = null;
    }
    for (const item of mediaItems) {
      if (item.kind === 'video' && item.videoElement) {
        item.videoElement.pause();
      }
    }
    setIsPlaying(false);
  }, [mediaItems]);

  const syncVideosAtLocalTime = useCallback(
    (localTime: number, shouldPlay: boolean) => {
      if (mediaItems.length === 0) return;
      const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);
      const slice = resolveActiveSlideshowSlice(
        mediaItems,
        localTime,
        clipDuration,
        config,
        beatCutTimestamps
      );
      const activeIds = new Set<string>();
      const activeItem = mediaItems[slice.activeIndex];
      if (activeItem) activeIds.add(activeItem.id);
      if (slice.prevIndex !== null && mediaItems[slice.prevIndex]) {
        activeIds.add(mediaItems[slice.prevIndex].id);
      }

      mediaItems.forEach((item) => {
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
            if (v.paused) {
              v.currentTime = targetSec;
              v.play().catch(() => {});
            } else if (Math.abs(v.currentTime - targetSec) > 0.35) {
              v.currentTime = targetSec;
            }
          } else {
            v.pause();
            if (Math.abs(v.currentTime - targetSec) > 0.03) {
              v.currentTime = targetSec;
            }
          }
        } else if (!v.paused) {
          v.pause();
        }
      });
    },
    [beatCutTimestamps, config, mediaItems]
  );

  const startPlaybackAt = useCallback(
    (startAbsSec: number) => {
      if (!audio) return;
      stopPlayback();

      const ctx = getAudioContext();
      const clampedStart = Math.max(
        config.trimStart,
        Math.min(config.trimEnd - 0.1, startAbsSec)
      );
      const remainingDur = Math.max(0.1, config.trimEnd - clampedStart);
      const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);

      const src = ctx.createBufferSource();
      src.buffer = audio.buffer;

      const gainNode = ctx.createGain();
      const curveSteps = 64;
      const curve = new Float32Array(curveSteps);
      for (let i = 0; i < curveSteps; i++) {
        const localT =
          clampedStart - config.trimStart + (i / (curveSteps - 1)) * remainingDur;
        curve[i] =
          computeFadeEnvelope(localT, clipDuration, config.fadeInSec, config.fadeOutSec) *
          config.audioGain;
      }
      gainNode.gain.setValueCurveAtTime(curve, ctx.currentTime, remainingDur);

      src.connect(gainNode);
      gainNode.connect(ctx.destination);

      src.onended = () => {
        if (sourceNodeRef.current === src) {
          sourceNodeRef.current = null;
          setIsPlaying(false);
          currentTimeRef.current = config.trimStart;
          setCurrentTime(config.trimStart);
        }
      };

      sourceNodeRef.current = src;
      playStartWallRef.current = performance.now();
      playStartAudioRef.current = clampedStart;
      currentTimeRef.current = clampedStart;
      setCurrentTime(clampedStart);
      setIsPlaying(true);

      src.start(ctx.currentTime, clampedStart, remainingDur);
      syncVideosAtLocalTime(clampedStart - config.trimStart, true);
    },
    [
      audio,
      config.audioGain,
      config.fadeInSec,
      config.fadeOutSec,
      config.trimEnd,
      config.trimStart,
      getAudioContext,
      stopPlayback,
      syncVideosAtLocalTime,
    ]
  );

  const appendVisualFromUrl = useCallback(
    (url: string, fileName: string, kind: 'image' | 'video') => {
      const id = createItemId();
      if (kind === 'image') {
        const img = new Image();
        img.onload = () => {
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
            },
          ]);
          setSelectedClipId(id);
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
            },
          ]);
          setSelectedClipId(id);
        };
        video.src = url;
      }
    },
    []
  );

  const applyAudioBuffer = useCallback(
    (
      buffer: AudioBuffer,
      fileName: string,
      fileSize: number,
      meta: AudioTrackState['metadata'],
      isSyntheticDemo: boolean
    ) => {
      stopPlayback();
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

      if (meta.embeddedCoverUrl && mediaItems.length === 0) {
        appendVisualFromUrl(meta.embeddedCoverUrl, `${fileName} (Cover)`, 'image');
      }
    },
    [appendVisualFromUrl, mediaItems.length, stopPlayback]
  );

  const handleAudioFile = useCallback(
    async (file: File) => {
      setIsLoadingAudio(true);
      try {
        const arrayBuf = await file.arrayBuffer();
        const id3 = parseID3Tags(arrayBuf, file.name);
        const ctx = getAudioContext();
        const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
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
      } finally {
        setIsLoadingAudio(false);
      }
    },
    [applyAudioBuffer, getAudioContext]
  );

  const handleLoadDemoBeat = useCallback(async () => {
    setIsLoadingAudio(true);
    try {
      const demoBuf = await generateDemoAudioBuffer();
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
    } finally {
      setIsLoadingAudio(false);
    }
  }, [applyAudioBuffer]);

  const handleVisualFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name);
        const isImage =
          file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(file.name);
        if (!isVideo && !isImage) continue;
        const url = URL.createObjectURL(file);
        appendVisualFromUrl(url, file.name, isVideo ? 'video' : 'image');
      }
    },
    [appendVisualFromUrl]
  );

  const handleAddGeneratorScene = useCallback(
    (effect: Exclude<GeneratorEffectId, 'none'>) => {
      const id = createItemId();
      const meta = GENERATOR_EFFECTS.find((g) => g.id === effect);
      const fileName = meta ? (lang === 'ru' ? meta.nameRu : meta.nameEn) : effect;
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
        },
      ]);
      setSelectedClipId(id);
    },
    [lang]
  );

  const handleUpdateClip = useCallback((id: string, patch: Partial<VisualMediaState>) => {
    setMediaItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const handleDuplicateClip = useCallback((id: string) => {
    const newId = createItemId();
    setMediaItems((prev) => {
      const idx = prev.findIndex((item) => item.id === id);
      if (idx === -1) return prev;
      const orig = prev[idx];
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
        videoElement: orig.kind === 'video' ? clonedVideo : undefined,
      };
      const next = [...prev];
      next.splice(idx + 1, 0, copyItem);
      return next;
    });
    setSelectedClipId(newId);
  }, []);

  const handleFitClipsToAudio = useCallback(() => {
    if (!audio || mediaItems.length === 0) return;
    const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);
    const perClip = Number(Math.max(0.5, clipDuration / mediaItems.length).toFixed(2));
    setMediaItems((prev) => prev.map((item) => ({ ...item, durationSec: perClip })));
    setConfig((prev) => ({ ...prev, slideshowMode: 'custom_durations' }));
  }, [audio, config.trimEnd, config.trimStart, mediaItems.length]);

  const handleMoveVisual = useCallback((index: number, direction: -1 | 1) => {
    setMediaItems((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved);
      return copy;
    });
  }, []);

  const handleRemoveVisual = useCallback((id: string) => {
    setMediaItems((prev) => {
      const target = prev.find((item) => item.id === id);
      const remaining = prev.filter((item) => item.id !== id);
      if (target) {
        if (target.kind === 'video' && target.videoElement) target.videoElement.pause();
        const urlStillInUse = remaining.some((item) => item.url === target.url);
        if (target.url.startsWith('blob:') && !urlStillInUse) {
          URL.revokeObjectURL(target.url);
        }
      }
      setSelectedClipId((curr) => (curr === id ? remaining[0]?.id ?? null : curr));
      return remaining;
    });
  }, []);

  const handleClearVisuals = useCallback(() => {
    setMediaItems((prev) => {
      const seenUrls = new Set<string>();
      for (const item of prev) {
        if (item.kind === 'video' && item.videoElement) item.videoElement.pause();
        if (item.url.startsWith('blob:') && !seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          URL.revokeObjectURL(item.url);
        }
      }
      return [];
    });
    setSelectedClipId(null);
  }, []);

  const handleUseEmbeddedCover = useCallback(() => {
    if (!audio?.metadata.embeddedCoverUrl) return;
    appendVisualFromUrl(audio.metadata.embeddedCoverUrl, `${audio.fileName} (Cover)`, 'image');
  }, [appendVisualFromUrl, audio]);

  const handleUpdateConfig = useCallback((patch: Partial<StudioConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSelectTrimPreset = useCallback(
    (preset: TrimPresetId) => {
      const dur = audio ? audio.duration : 60;
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
    [audio]
  );

  const handlePreviewFadeOut = useCallback(() => {
    if (!audio) return;
    const previewOffset = Math.max(
      config.trimStart,
      config.trimEnd - Math.max(3, config.fadeOutSec + 2.2)
    );
    startPlaybackAt(previewOffset);
  }, [audio, config.fadeOutSec, config.trimEnd, config.trimStart, startPlaybackAt]);

  const handleSeekAbsolute = useCallback(
    (sec: number) => {
      if (!audio) return;
      const clamped = Math.max(0, Math.min(audio.duration, sec));
      currentTimeRef.current = clamped;
      setCurrentTime(clamped);
      if (isPlaying) {
        startPlaybackAt(clamped);
      } else {
        syncVideosAtLocalTime(Math.max(0, clamped - config.trimStart), false);
      }
    },
    [audio, config.trimStart, isPlaying, startPlaybackAt, syncVideosAtLocalTime]
  );

  const handleTogglePlay = useCallback(() => {
    if (!audio) return;
    if (isPlaying) {
      stopPlayback();
    } else {
      const startAt =
        currentTimeRef.current >= config.trimStart &&
        currentTimeRef.current < config.trimEnd - 0.15
          ? currentTimeRef.current
          : config.trimStart;
      startPlaybackAt(startAt);
    }
  }, [audio, config.trimEnd, config.trimStart, isPlaying, startPlaybackAt, stopPlayback]);

  const handleResetToTrimStart = useCallback(() => {
    stopPlayback();
    currentTimeRef.current = config.trimStart;
    setCurrentTime(config.trimStart);
    syncVideosAtLocalTime(0, false);
  }, [config.trimStart, stopPlayback, syncVideosAtLocalTime]);

  const drawOnce = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dims = resolveExportDimensions(config.aspectMode, mediaItems);
    const previewBase = 960;
    const targetW =
      dims.width >= dims.height ? previewBase : Math.round((previewBase * dims.width) / dims.height);
    const targetH =
      dims.width >= dims.height ? Math.round((previewBase * dims.height) / dims.width) : previewBase;
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);
    const absTime = currentTimeRef.current;
    const localTime = Math.max(0, Math.min(clipDuration, absTime - config.trimStart));

    const metrics = analyzeAudioAtTime(
      monoDataRef.current,
      audio?.sampleRate || 44100,
      absTime,
      config.beatSensitivity,
      isPlaying ? smoothStateRef.current : undefined,
      config.visualizerSmoothing
    );

    renderStudioFrame({
      ctx,
      width: canvas.width,
      height: canvas.height,
      localTime,
      clipDuration,
      metrics,
      config,
      mediaItems,
      beatCutTimestamps,
      reducedMotion: reducedMotionRef.current,
      isExport: false,
    });
  }, [audio?.sampleRate, beatCutTimestamps, config, isPlaying, mediaItems]);

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
    const loop = (now: number) => {
      const elapsedSec = (now - playStartWallRef.current) / 1000;
      const absSec = playStartAudioRef.current + elapsedSec;
      currentTimeRef.current = Math.min(config.trimEnd, absSec);

      const localTime = Math.max(0, currentTimeRef.current - config.trimStart);
      syncVideosAtLocalTime(localTime, true);

      if (now - lastUiSync > 50) {
        setCurrentTime(currentTimeRef.current);
        lastUiSync = now;
      }

      drawOnce();
      if (absSec < config.trimEnd) {
        rafId = requestAnimationFrame(loop);
      }
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [config.trimEnd, config.trimStart, drawOnce, isPlaying, syncVideosAtLocalTime]);

  useEffect(() => {
    if (!isPlaying) {
      drawOnce();
    }
  }, [currentTime, drawOnce, isPlaying]);

  const handleStartExport = useCallback(async () => {
    if (!audio) return;
    stopPlayback();

    if (exportState.outputUrl) {
      URL.revokeObjectURL(exportState.outputUrl);
    }

    const abortController = new AbortController();
    exportAbortRef.current = abortController;

    try {
      const finalState = await exportStudioVideo({
        audio,
        mediaItems,
        config,
        abortSignal: abortController.signal,
        onProgress: (prog) => setExportState(prog),
      });
      setExportState(finalState);
    } catch (err) {
      setExportState({
        phase: 'error',
        currentFrame: 0,
        totalFrames: 0,
        elapsedMs: 0,
        encoderLabel: 'WebCodecs',
        outputFormat: 'mp4',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }, [audio, config, exportState.outputUrl, mediaItems, stopPlayback]);

  const handleDownloadMetadataTxt = useCallback(() => {
    if (!audio) return;
    const dims = resolveExportDimensions(config.aspectMode, mediaItems);
    const content = buildSocialMetadataText(config, audio, dims);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(config.titleText || 'track').replace(/[<>:"/\\|?*]/g, '')}_description.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [audio, config, mediaItems]);

  const handleSelectSection = useCallback((section: 'media' | InspectorTab) => {
    if (section === 'media') {
      document.getElementById('media-panel')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      setActiveTab(section);
      document.getElementById('inspector-panel')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#0B0D11] text-gray-100">
      <TopBar
        lang={lang}
        activeTab={activeTab}
        hasAudio={Boolean(audio)}
        onSelectSection={handleSelectSection}
        onStartExport={handleStartExport}
      />

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
          onRemoveVisual={handleRemoveVisual}
          onClearVisuals={handleClearVisuals}
          onFitClipsToAudio={handleFitClipsToAudio}
          onUseEmbeddedCover={handleUseEmbeddedCover}
          onUpdateConfig={handleUpdateConfig}
          onSelectTrimPreset={handleSelectTrimPreset}
          onPreviewFadeOut={handlePreviewFadeOut}
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
          currentTime={currentTime}
          onToggleLanguage={() => setLang((l) => (l === 'ru' ? 'en' : 'ru'))}
          onTogglePlay={handleTogglePlay}
          onResetToTrimStart={handleResetToTrimStart}
          onSeekAbsolute={handleSeekAbsolute}
          onSelectClip={setSelectedClipId}
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
          onChangeTab={setActiveTab}
          onUpdateConfig={handleUpdateConfig}
          onStartExport={handleStartExport}
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
