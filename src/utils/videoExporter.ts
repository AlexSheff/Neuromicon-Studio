import {
  ArrayBufferTarget as Mp4ArrayBufferTarget,
  FileSystemWritableFileStreamTarget as Mp4FileStreamTarget,
  Muxer as Mp4Muxer,
} from 'mp4-muxer';
import {
  ArrayBufferTarget as WebmArrayBufferTarget,
  FileSystemWritableFileStreamTarget as WebmFileStreamTarget,
  Muxer as WebmMuxer,
} from 'webm-muxer';
import {
  AudioTrackState,
  ExportAspectMode,
  ExportProgressState,
  StudioConfig,
  VisualMediaState,
} from '../types/studio';
import {
  analyzeAudioAtTime,
  buildMonoAudioData,
  computeBeatCutTimestamps,
  computeClipTimelineSegments,
  computeFadeEnvelope,
  createSmoothState,
  getTimelineSpanSec,
  resolveActiveSlideshowSlice,
  resolveBeatCutPoints,
} from './audioAnalyzer';
import { renderStudioFrame } from './canvasRenderer';

export interface ExportDimensions {
  width: number;
  height: number;
  aspectLabel: '16:9' | '9:16' | '4:5' | '1:1' | '4K 16:9' | '4K 9:16' | 'Custom';
}

function alignEven(val: number, fallback: number): number {
  const clamped = Math.max(320, Math.min(4096, Math.round(val || fallback)));
  return clamped % 2 === 0 ? clamped : clamped - 1;
}

export function resolveExportDimensions(
  mode: ExportAspectMode,
  mediaItems: VisualMediaState[],
  customWidth = 1920,
  customHeight = 1080
): ExportDimensions {
  let effective = mode;
  const primaryMedia = mediaItems[0] || null;
  if (mode === 'auto') {
    if (primaryMedia && primaryMedia.height > primaryMedia.width) {
      effective = '9:16';
    } else {
      effective = '16:9';
    }
  }
  switch (effective) {
    case '9:16':
      return { width: 1080, height: 1920, aspectLabel: '9:16' };
    case '4:5':
      return { width: 1080, height: 1350, aspectLabel: '4:5' };
    case '1:1':
      return { width: 1080, height: 1080, aspectLabel: '1:1' };
    case '4k_16:9':
      return { width: 3840, height: 2160, aspectLabel: '4K 16:9' };
    case '4k_9:16':
      return { width: 2160, height: 3840, aspectLabel: '4K 9:16' };
    case 'custom':
      return {
        width: alignEven(customWidth, 1920),
        height: alignEven(customHeight, 1080),
        aspectLabel: 'Custom',
      };
    case '16:9':
    default:
      return { width: 1920, height: 1080, aspectLabel: '16:9' };
  }
}

export function sanitizeOutputFileName(
  title: string,
  artist: string,
  aspectLabel: string,
  ext: 'mp4' | 'webm'
): string {
  const base = [artist.trim(), title.trim()].filter(Boolean).join(' - ') || 'neuromicon-export';
  const clean = base
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
  const suffix =
    aspectLabel === '9:16'
      ? ' (Reels-Vertical)'
      : aspectLabel === '16:9'
        ? ''
        : ` (${aspectLabel.replace(/\s+/g, '-')})`;
  return `${clean}${suffix}.${ext}`;
}

export function buildSocialMetadataText(
  config: StudioConfig,
  audio: AudioTrackState | null,
  dims: ExportDimensions,
  clipDurationOverride?: number
): string {
  const clipDuration = clipDurationOverride ?? Math.max(0.5, config.trimEnd - config.trimStart);
  const mins = Math.floor(clipDuration / 60);
  const secs = Math.floor(clipDuration % 60);
  const durationStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  return [
    `${config.artistText ? `${config.artistText} — ` : ''}${config.titleText || audio?.fileName || 'Neuromicon Project'}`,
    config.albumText ? `Release: ${config.albumText}` : '',
    `Format: ${dims.width}x${dims.height} (${dims.aspectLabel}) @ ${config.fps}fps`,
    `Duration: ${durationStr} (Fade In: ${config.fadeInSec.toFixed(1)}s, Fade Out: ${config.fadeOutSec.toFixed(1)}s)`,
    '',
    '#music #audiovisualizer #reels #tiktok #shorts',
  ]
    .filter((line) => line !== undefined)
    .join('\n')
    .trim();
}

interface ProbedWebCodecsProfile {
  container: 'mp4' | 'webm';
  videoCodec: string;
  muxerVideoCodec: 'avc' | 'V_VP9' | 'V_VP8';
  audioCodec: string;
  muxerAudioCodec: 'aac' | 'A_OPUS';
  audioSampleRate: number;
  label: string;
}

async function probeBestWebCodecsProfile(
  width: number,
  height: number,
  fps: number,
  videoBitrate: number,
  sampleRate: number,
  numberOfChannels: number
): Promise<ProbedWebCodecsProfile | null> {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
    return null;
  }

  const aacSampleRates = Array.from(new Set([sampleRate, 48000, 44100]));
  // Level 5.1/5.2 first for 4K support, then Level 4.0/3.1
  const avcCandidates =
    width * height > 2_200_000
      ? ['avc1.640033', 'avc1.4d0033', 'avc1.640028', 'avc1.4d002a']
      : ['avc1.640028', 'avc1.4d002a', 'avc1.420028', 'avc1.42E01F'];

  for (const avc of avcCandidates) {
    try {
      const vSupport = await VideoEncoder.isConfigSupported({
        codec: avc,
        width,
        height,
        bitrate: videoBitrate,
        framerate: fps,
      });
      if (!vSupport.supported) continue;

      for (const sr of aacSampleRates) {
        const aSupport = await AudioEncoder.isConfigSupported({
          codec: 'mp4a.40.2',
          sampleRate: sr,
          numberOfChannels,
          bitrate: 192_000,
        });
        if (aSupport.supported) {
          return {
            container: 'mp4',
            videoCodec: avc,
            muxerVideoCodec: 'avc',
            audioCodec: 'mp4a.40.2',
            muxerAudioCodec: 'aac',
            audioSampleRate: sr,
            label: `MP4 (${avc.slice(0, 4).toUpperCase()} + AAC ${Math.round(sr / 1000)}kHz)`,
          };
        }
      }
    } catch {
      // Try next candidate
    }
  }

  const webmCandidates: { codec: string; muxer: 'V_VP9' | 'V_VP8'; name: string }[] = [
    { codec: 'vp09.00.10.08', muxer: 'V_VP9', name: 'VP9' },
    { codec: 'vp8', muxer: 'V_VP8', name: 'VP8' },
  ];
  for (const cand of webmCandidates) {
    try {
      const vSupport = await VideoEncoder.isConfigSupported({
        codec: cand.codec,
        width,
        height,
        bitrate: videoBitrate,
        framerate: fps,
      });
      const aSupport = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels,
        bitrate: 160_000,
      });
      if (vSupport.supported && aSupport.supported) {
        return {
          container: 'webm',
          videoCodec: cand.codec,
          muxerVideoCodec: cand.muxer,
          audioCodec: 'opus',
          muxerAudioCodec: 'A_OPUS',
          audioSampleRate: 48000,
          label: `WebM (${cand.name} + Opus, AAC fallback)`,
        };
      }
    } catch {
      // Try next candidate
    }
  }

  return null;
}

export interface ExportCapabilityReport {
  engine: 'webcodecs' | 'mediarecorder';
  container: 'mp4' | 'webm';
  label: string;
  isFallback: boolean;
  supportsStreaming: boolean;
}

export async function probeExportCapabilities(
  width: number,
  height: number,
  fps: number,
  bitrateMbps: number,
  sampleRate = 48000,
  channels = 2
): Promise<ExportCapabilityReport> {
  const supportsStreaming =
    typeof window !== 'undefined' &&
    'showSaveFilePicker' in window &&
    typeof VideoEncoder !== 'undefined';

  const profile = await probeBestWebCodecsProfile(
    width,
    height,
    fps,
    bitrateMbps * 1_000_000,
    sampleRate,
    channels
  );
  if (profile) {
    return {
      engine: 'webcodecs',
      container: profile.container,
      label: profile.label,
      isFallback: profile.container === 'webm',
      supportsStreaming,
    };
  }
  const mimeCandidates = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const selectedMime =
    mimeCandidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ||
    'video/webm';
  const ext: 'mp4' | 'webm' = selectedMime.includes('mp4') ? 'mp4' : 'webm';
  return {
    engine: 'mediarecorder',
    container: ext,
    label: `MediaRecorder (${ext.toUpperCase()})`,
    isFallback: true,
    supportsStreaming: false,
  };
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

async function seekVideoToTime(video: HTMLVideoElement, targetSec: number): Promise<void> {
  const dur = video.duration || 1;
  const maxSafe = Math.max(0, dur - 0.04);
  const wrapped = Math.min(maxSafe, Math.max(0, targetSec % dur));
  if (!video.seeking && Math.abs(video.currentTime - wrapped) < 0.004) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const vid = video as VideoWithFrameCallback;
    let rvfcId: number | null = null;
    let rvfcFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      if (rvfcFallbackTimer !== null) {
        clearTimeout(rvfcFallbackTimer);
        rvfcFallbackTimer = null;
      }
      if (rvfcId !== null && vid.cancelVideoFrameCallback) {
        try {
          vid.cancelVideoFrameCallback(rvfcId);
        } catch {
          // ignore
        }
      }
      resolve();
    };

    const onSeeked = () => {
      if (typeof vid.requestVideoFrameCallback === 'function') {
        rvfcId = vid.requestVideoFrameCallback(() => finish());
        rvfcFallbackTimer = setTimeout(finish, 120);
      } else {
        finish();
      }
    };

    const timer = setTimeout(finish, 1500);
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = wrapped;
  });
}

async function renderTrimmedAudioWithFades(
  sourceBuffer: AudioBuffer | null,
  config: StudioConfig,
  mediaItems: VisualMediaState[],
  beatCutTimestamps: number[],
  targetSampleRate: number
): Promise<AudioBuffer> {
  const clipDuration = Math.max(0.25, config.trimEnd - config.trimStart);
  const frameCount = Math.ceil(clipDuration * targetSampleRate);
  const channels = sourceBuffer ? Math.min(2, sourceBuffer.numberOfChannels) : 2;
  const offline = new OfflineAudioContext(channels, frameCount, targetSampleRate);

  let mainGain: GainNode | null = null;
  if (sourceBuffer) {
    const src = offline.createBufferSource();
    src.buffer = sourceBuffer;
    mainGain = offline.createGain();
    mainGain.gain.setValueAtTime(1, 0);
    src.connect(mainGain);
    mainGain.connect(offline.destination);
    src.start(0, config.trimStart, clipDuration);
  }

  // Mix unmuted video clip audio tracks & schedule ducking envelope on main track
  const segments = computeClipTimelineSegments(mediaItems, clipDuration, config, beatCutTimestamps);
  const duckAmt = Math.max(0, Math.min(0.9, config.audioDucking || 0));
  const duckGain = 1 - duckAmt;

  for (const seg of segments) {
    const clip = mediaItems[seg.clipIndex];
    if (!clip || clip.kind !== 'video' || clip.clipAudioMuted || clip.clipAudioVolume <= 0.01) {
      continue;
    }
    if (!clip.decodedAudioBuffer) continue;

    const clipSrc = offline.createBufferSource();
    clipSrc.buffer = clip.decodedAudioBuffer;
    clipSrc.loop = true;
    clipSrc.playbackRate.value = clip.playbackRate || 1;
    const clipGainNode = offline.createGain();
    clipGainNode.gain.value = clip.clipAudioVolume;
    clipSrc.connect(clipGainNode);
    clipGainNode.connect(offline.destination);

    const bufDur = clip.decodedAudioBuffer.duration || 1;
    const offsetInClip = ((clip.sourceStartSec % bufDur) + bufDur) % bufDur;
    clipSrc.start(seg.startSec, offsetInClip);
    clipSrc.stop(seg.endSec);

    if (mainGain && duckAmt > 0.02) {
      mainGain.gain.setTargetAtTime(duckGain, seg.startSec, 0.08);
      mainGain.gain.setTargetAtTime(1, seg.endSec, 0.12);
    }
  }

  const rendered = await offline.startRendering();

  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    const data = rendered.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const t = i / targetSampleRate;
      const env = computeFadeEnvelope(t, clipDuration, config.fadeInSec, config.fadeOutSec);
      const scaled = data[i] * env * config.audioGain;
      data[i] = Math.max(-0.99, Math.min(0.99, scaled));
    }
  }
  return rendered;
}

export async function exportStudioVideo(params: {
  audio: AudioTrackState | null;
  mediaItems: VisualMediaState[];
  config: StudioConfig;
  abortSignal: AbortSignal;
  onProgress: (state: ExportProgressState) => void;
  batchContext?: { index: number; total: number; label: string };
  fileHandle?: FileSystemFileHandle | null;
}): Promise<ExportProgressState> {
  const { audio, mediaItems, config, abortSignal, onProgress, batchContext, fileHandle } = params;
  const startWallMs = performance.now();
  const dims = resolveExportDimensions(
    config.aspectMode,
    mediaItems,
    config.customWidth,
    config.customHeight
  );
  const rawClipsTotal = getTimelineSpanSec(mediaItems, config);
  const effectiveConfig: StudioConfig = audio
    ? config
    : {
        ...config,
        trimStart: 0,
        trimEnd:
          mediaItems.length > 0
            ? Math.max(0.5, rawClipsTotal)
            : Math.max(0.5, config.trimEnd - config.trimStart),
      };
  const clipDuration = Math.max(0.5, effectiveConfig.trimEnd - effectiveConfig.trimStart);
  const totalFrames = Math.max(1, Math.ceil(clipDuration * effectiveConfig.fps));
  const videoBitrate = effectiveConfig.bitrateMbps * 1_000_000;

  onProgress({
    phase: 'preparing',
    currentFrame: 0,
    totalFrames,
    elapsedMs: 0,
    encoderLabel: 'Probing hardware/software codecs...',
    outputFormat: 'mp4',
    batchIndex: batchContext?.index,
    batchTotal: batchContext?.total,
    batchLabel: batchContext?.label,
  });

  try {
    await document.fonts.load(
      `${effectiveConfig.fontWeight} 48px "${effectiveConfig.fontFamily}"`
    );
  } catch {
    // Continue even if font check rejects
  }

  const audioSampleRate = audio?.sampleRate || 48000;
  const monoData = audio ? buildMonoAudioData(audio.buffer) : new Float32Array(0);
  const autoCuts =
    audio && effectiveConfig.slideshowMode === 'beat_cut'
      ? computeBeatCutTimestamps(
          monoData,
          audioSampleRate,
          effectiveConfig.trimStart,
          effectiveConfig.trimEnd,
          effectiveConfig.minBeatCutSec,
          effectiveConfig.beatSensitivity
        )
      : [0];
  const beatCutTimestamps = resolveBeatCutPoints(
    autoCuts,
    effectiveConfig.manualBeatMarkers,
    effectiveConfig.trimStart,
    clipDuration
  );
  const channels = audio ? Math.min(2, audio.numberOfChannels) : 2;

  const profile = await probeBestWebCodecsProfile(
    dims.width,
    dims.height,
    effectiveConfig.fps,
    videoBitrate,
    audioSampleRate,
    channels
  );

  if (profile) {
    return await exportWithWebCodecs({
      profile,
      audio,
      audioSampleRate,
      monoData,
      mediaItems,
      beatCutTimestamps,
      config: effectiveConfig,
      dims,
      clipDuration,
      totalFrames,
      videoBitrate,
      channels,
      startWallMs,
      abortSignal,
      onProgress,
      batchContext,
      fileHandle,
    });
  }

  return await exportWithMediaRecorder({
    audio,
    audioSampleRate,
    monoData,
    mediaItems,
    beatCutTimestamps,
    config: effectiveConfig,
    dims,
    clipDuration,
    totalFrames,
    videoBitrate,
    startWallMs,
    abortSignal,
    onProgress,
    batchContext,
  });
}

async function exportWithWebCodecs(params: {
  profile: ProbedWebCodecsProfile;
  audio: AudioTrackState | null;
  audioSampleRate: number;
  monoData: Float32Array;
  mediaItems: VisualMediaState[];
  beatCutTimestamps: number[];
  config: StudioConfig;
  dims: ExportDimensions;
  clipDuration: number;
  totalFrames: number;
  videoBitrate: number;
  channels: number;
  startWallMs: number;
  abortSignal: AbortSignal;
  onProgress: (state: ExportProgressState) => void;
  batchContext?: { index: number; total: number; label: string };
  fileHandle?: FileSystemFileHandle | null;
}): Promise<ExportProgressState> {
  const {
    profile,
    audio,
    audioSampleRate,
    monoData: masterMonoData,
    mediaItems,
    beatCutTimestamps,
    config,
    dims,
    clipDuration,
    totalFrames,
    videoBitrate,
    channels,
    startWallMs,
    abortSignal,
    onProgress,
    batchContext,
    fileHandle,
  } = params;

  const targetSampleRate = profile.audioSampleRate;
  const trimmedAudio = await renderTrimmedAudioWithFades(
    audio ? audio.buffer : null,
    config,
    mediaItems,
    beatCutTimestamps,
    targetSampleRate
  );
  // When exporting standalone MP4/video clips without a separate master track, drive audio visualizers from mixed clip audio
  const activeMonoData = audio ? masterMonoData : buildMonoAudioData(trimmedAudio);
  const analysisSampleRate = audio ? audioSampleRate : targetSampleRate;

  if (abortSignal.aborted) {
    return {
      phase: 'cancelled',
      currentFrame: 0,
      totalFrames,
      elapsedMs: performance.now() - startWallMs,
      encoderLabel: profile.label,
      outputFormat: profile.container,
      batchIndex: batchContext?.index,
      batchTotal: batchContext?.total,
      batchLabel: batchContext?.label,
    };
  }

  let mp4Muxer: Mp4Muxer<Mp4ArrayBufferTarget | Mp4FileStreamTarget> | null = null;
  let webmMuxer: WebmMuxer<WebmArrayBufferTarget | WebmFileStreamTarget> | null = null;
  let mp4ArrayTarget: Mp4ArrayBufferTarget | null = null;
  let webmArrayTarget: WebmArrayBufferTarget | null = null;
  let writableStream: FileSystemWritableFileStream | null = null;

  if (fileHandle && typeof fileHandle.createWritable === 'function') {
    try {
      writableStream = await fileHandle.createWritable();
    } catch {
      writableStream = null;
    }
  }

  if (profile.container === 'mp4') {
    if (writableStream) {
      const streamTarget = new Mp4FileStreamTarget(writableStream);
      mp4Muxer = new Mp4Muxer({
        target: streamTarget,
        video: {
          codec: 'avc',
          width: dims.width,
          height: dims.height,
          frameRate: config.fps,
        },
        audio: {
          codec: 'aac',
          numberOfChannels: channels,
          sampleRate: targetSampleRate,
        },
        fastStart: false,
      });
    } else {
      mp4ArrayTarget = new Mp4ArrayBufferTarget();
      mp4Muxer = new Mp4Muxer({
        target: mp4ArrayTarget,
        video: {
          codec: 'avc',
          width: dims.width,
          height: dims.height,
          frameRate: config.fps,
        },
        audio: {
          codec: 'aac',
          numberOfChannels: channels,
          sampleRate: targetSampleRate,
        },
        fastStart: 'in-memory',
      });
    }
  } else {
    if (writableStream) {
      const streamTarget = new WebmFileStreamTarget(writableStream);
      webmMuxer = new WebmMuxer({
        target: streamTarget,
        video: {
          codec: profile.muxerVideoCodec as 'V_VP9' | 'V_VP8',
          width: dims.width,
          height: dims.height,
          frameRate: config.fps,
        },
        audio: {
          codec: 'A_OPUS',
          numberOfChannels: channels,
          sampleRate: targetSampleRate,
        },
      });
    } else {
      webmArrayTarget = new WebmArrayBufferTarget();
      webmMuxer = new WebmMuxer({
        target: webmArrayTarget,
        video: {
          codec: profile.muxerVideoCodec as 'V_VP9' | 'V_VP8',
          width: dims.width,
          height: dims.height,
          frameRate: config.fps,
        },
        audio: {
          codec: 'A_OPUS',
          numberOfChannels: channels,
          sampleRate: targetSampleRate,
        },
      });
    }
  }

  let encoderError: Error | null = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (mp4Muxer) mp4Muxer.addVideoChunk(chunk, meta);
      if (webmMuxer) webmMuxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      encoderError = err;
    },
  });

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      if (mp4Muxer) mp4Muxer.addAudioChunk(chunk, meta);
      if (webmMuxer) webmMuxer.addAudioChunk(chunk, meta);
    },
    error: (err) => {
      encoderError = err;
    },
  });

  const closeEncoders = () => {
    try {
      if (videoEncoder.state !== 'closed') videoEncoder.close();
    } catch {
      // ignore
    }
    try {
      if (audioEncoder.state !== 'closed') audioEncoder.close();
    } catch {
      // ignore
    }
  };

  try {
    videoEncoder.configure({
      codec: profile.videoCodec,
      width: dims.width,
      height: dims.height,
      bitrate: videoBitrate,
      framerate: config.fps,
    });

    audioEncoder.configure({
      codec: profile.audioCodec,
      sampleRate: targetSampleRate,
      numberOfChannels: channels,
      bitrate: profile.container === 'mp4' ? 192_000 : 160_000,
    });

    const chunkSize = 1024;
    const totalAudioSamples = trimmedAudio.length;
    for (let offset = 0; offset < totalAudioSamples; offset += chunkSize) {
      if (abortSignal.aborted || encoderError) break;

      while (audioEncoder.encodeQueueSize > 64 && !abortSignal.aborted && !encoderError) {
        await new Promise((r) => setTimeout(r, 4));
      }
      if (abortSignal.aborted || encoderError) break;

      const count = Math.min(chunkSize, totalAudioSamples - offset);
      const planar = new Float32Array(count * channels);
      for (let ch = 0; ch < channels; ch++) {
        const chSlice = trimmedAudio.getChannelData(ch).subarray(offset, offset + count);
        planar.set(chSlice, ch * count);
      }
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: targetSampleRate,
        numberOfChannels: channels,
        numberOfFrames: count,
        timestamp: Math.round((offset / targetSampleRate) * 1_000_000),
        data: planar,
      });
      try {
        audioEncoder.encode(audioData);
      } finally {
        audioData.close();
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = dims.width;
    canvas.height = dims.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Failed to create 2D export canvas context');

    const smoothState = createSmoothState();
    const frameDtSec = 1 / config.fps;
    const frameDurationUs = Math.round(1_000_000 / config.fps);
    const encodeLoopStartMs = performance.now();

    for (const item of mediaItems) {
      if (item.kind === 'video' && item.videoElement && !item.videoElement.paused) {
        item.videoElement.pause();
      }
    }

    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (abortSignal.aborted || encoderError) break;

      const localTime = frameIdx / config.fps;
      const sourceAudioTime = config.trimStart + localTime;

      if (mediaItems.length > 0) {
        const slice = resolveActiveSlideshowSlice(
          mediaItems,
          localTime,
          clipDuration,
          config,
          beatCutTimestamps
        );
        const activeItem = slice.activeIndex !== null ? mediaItems[slice.activeIndex] : undefined;
        if (activeItem?.kind === 'video' && activeItem.videoElement) {
          const vidTime =
            activeItem.sourceStartSec + slice.slideLocalTime * (activeItem.playbackRate || 1);
          await seekVideoToTime(activeItem.videoElement, vidTime);
        }
        if (slice.prevIndex !== null) {
          const prevItem = mediaItems[slice.prevIndex];
          if (prevItem?.kind === 'video' && prevItem.videoElement) {
            const prevVidTime =
              prevItem.sourceStartSec + slice.prevSlideLocalTime * (prevItem.playbackRate || 1);
            await seekVideoToTime(prevItem.videoElement, prevVidTime);
          }
        }
      }

      const metrics = analyzeAudioAtTime(
        activeMonoData,
        analysisSampleRate,
        audio ? sourceAudioTime : localTime,
        config.beatSensitivity,
        smoothState,
        config.visualizerSmoothing,
        frameDtSec
      );

      renderStudioFrame({
        ctx,
        width: dims.width,
        height: dims.height,
        localTime,
        absTime: sourceAudioTime,
        clipDuration,
        metrics,
        config,
        mediaItems,
        beatCutTimestamps,
        reducedMotion: false,
        isExport: true,
      });

      while (videoEncoder.encodeQueueSize > 8 && !abortSignal.aborted && !encoderError) {
        await new Promise((r) => setTimeout(r, 8));
      }
      if (abortSignal.aborted || encoderError) break;

      const timestampUs = Math.round(localTime * 1_000_000);
      const videoFrame = new VideoFrame(canvas, {
        timestamp: timestampUs,
        duration: frameDurationUs,
      });
      try {
        videoEncoder.encode(videoFrame, { keyFrame: frameIdx % (config.fps * 2) === 0 });
      } finally {
        videoFrame.close();
      }

      if (frameIdx % 4 === 0 || frameIdx === totalFrames - 1) {
        const now = performance.now();
        const done = frameIdx + 1;
        const loopElapsed = now - encodeLoopStartMs;
        const etaMs = done > 3 ? (loopElapsed / done) * (totalFrames - done) : undefined;
        onProgress({
          phase: 'encoding',
          currentFrame: done,
          totalFrames,
          elapsedMs: now - startWallMs,
          etaMs,
          encoderLabel: profile.label,
          outputFormat: profile.container,
          batchIndex: batchContext?.index,
          batchTotal: batchContext?.total,
          batchLabel: batchContext?.label,
        });
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    if (abortSignal.aborted) {
      if (writableStream) {
        try {
          await writableStream.abort();
        } catch {
          // ignore
        }
        writableStream = null;
      }
      return {
        phase: 'cancelled',
        currentFrame: 0,
        totalFrames,
        elapsedMs: performance.now() - startWallMs,
        encoderLabel: profile.label,
        outputFormat: profile.container,
        batchIndex: batchContext?.index,
        batchTotal: batchContext?.total,
        batchLabel: batchContext?.label,
      };
    }

    if (encoderError) {
      throw encoderError;
    }

    onProgress({
      phase: 'muxing',
      currentFrame: totalFrames,
      totalFrames,
      elapsedMs: performance.now() - startWallMs,
      etaMs: 0,
      encoderLabel: profile.label,
      outputFormat: profile.container,
      batchIndex: batchContext?.index,
      batchTotal: batchContext?.total,
      batchLabel: batchContext?.label,
    });

    await Promise.all([videoEncoder.flush(), audioEncoder.flush()]);

    const outputFileName =
      fileHandle?.name ||
      sanitizeOutputFileName(config.titleText, config.artistText, dims.aspectLabel, profile.container);

    if (writableStream) {
      if (mp4Muxer) mp4Muxer.finalize();
      else if (webmMuxer) webmMuxer.finalize();
      await writableStream.close();
      return {
        phase: 'complete',
        currentFrame: totalFrames,
        totalFrames,
        elapsedMs: performance.now() - startWallMs,
        encoderLabel: profile.label,
        outputFormat: profile.container,
        streamedToDisk: true,
        batchIndex: batchContext?.index,
        batchTotal: batchContext?.total,
        batchLabel: batchContext?.label,
        outputFileName,
      };
    }

    let buffer: ArrayBuffer;
    let mime: string;
    if (mp4Muxer && mp4ArrayTarget) {
      mp4Muxer.finalize();
      buffer = mp4ArrayTarget.buffer;
      mime = 'video/mp4';
    } else if (webmMuxer && webmArrayTarget) {
      webmMuxer.finalize();
      buffer = webmArrayTarget.buffer;
      mime = 'video/webm';
    } else {
      throw new Error('Muxer target missing');
    }

    const blob = new Blob([buffer], { type: mime });
    const outputUrl = URL.createObjectURL(blob);

    return {
      phase: 'complete',
      currentFrame: totalFrames,
      totalFrames,
      elapsedMs: performance.now() - startWallMs,
      encoderLabel: profile.label,
      outputFormat: profile.container,
      batchIndex: batchContext?.index,
      batchTotal: batchContext?.total,
      batchLabel: batchContext?.label,
      outputUrl,
      outputFileName,
      outputSizeBytes: blob.size,
    };
  } catch (err) {
    if (writableStream) {
      try {
        await writableStream.abort();
      } catch {
        // ignore
      }
    }
    throw err;
  } finally {
    closeEncoders();
  }
}

async function exportWithMediaRecorder(params: {
  audio: AudioTrackState | null;
  audioSampleRate: number;
  monoData: Float32Array;
  mediaItems: VisualMediaState[];
  beatCutTimestamps: number[];
  config: StudioConfig;
  dims: ExportDimensions;
  clipDuration: number;
  totalFrames: number;
  videoBitrate: number;
  startWallMs: number;
  abortSignal: AbortSignal;
  onProgress: (state: ExportProgressState) => void;
  batchContext?: { index: number; total: number; label: string };
}): Promise<ExportProgressState> {
  const {
    audio,
    audioSampleRate,
    monoData: masterMonoData,
    mediaItems,
    beatCutTimestamps,
    config,
    dims,
    clipDuration,
    totalFrames,
    videoBitrate,
    startWallMs,
    abortSignal,
    onProgress,
    batchContext,
  } = params;

  const mimeCandidates = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const selectedMime =
    mimeCandidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ||
    'video/webm';
  const ext: 'mp4' | 'webm' = selectedMime.includes('mp4') ? 'mp4' : 'webm';

  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Cannot initialize export canvas');

  let audioCtx: AudioContext;
  try {
    audioCtx = new AudioContext({ sampleRate: 48000 });
  } catch {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume();
    } catch {
      // continue best-effort
    }
  }

  const mixedAudioBuffer = await renderTrimmedAudioWithFades(
    audio ? audio.buffer : null,
    config,
    mediaItems,
    beatCutTimestamps,
    audioCtx.sampleRate
  );
  const activeMonoData = audio ? masterMonoData : buildMonoAudioData(mixedAudioBuffer);
  const analysisSampleRate = audio ? audioSampleRate : audioCtx.sampleRate;

  const dest = audioCtx.createMediaStreamDestination();
  const src = audioCtx.createBufferSource();
  src.buffer = mixedAudioBuffer;
  src.connect(dest);

  const canvasStream = canvas.captureStream(config.fps);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(combinedStream, {
    mimeType: selectedMime,
    videoBitsPerSecond: videoBitrate,
  });
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const smoothState = createSmoothState();
  const label = `MediaRecorder (${ext.toUpperCase()})`;

  let rafId = 0;
  const onAbort = () => {
    cancelAnimationFrame(rafId);
    if (recorder.state !== 'inactive') recorder.stop();
  };

  const resultPromise = new Promise<ExportProgressState>((resolve) => {
    recorder.onstop = () => {
      abortSignal.removeEventListener('abort', onAbort);
      try {
        src.stop();
        src.disconnect();
        audioCtx.close();
      } catch {
        // ignore
      }
      for (const track of canvasStream.getTracks()) track.stop();
      for (const track of dest.stream.getTracks()) track.stop();
      for (const track of combinedStream.getTracks()) track.stop();

      if (abortSignal.aborted) {
        resolve({
          phase: 'cancelled',
          currentFrame: 0,
          totalFrames,
          elapsedMs: performance.now() - startWallMs,
          encoderLabel: label,
          outputFormat: ext,
          isNonDeterministicFallback: true,
          batchIndex: batchContext?.index,
          batchTotal: batchContext?.total,
          batchLabel: batchContext?.label,
        });
        return;
      }
      const blob = new Blob(chunks, { type: selectedMime });
      const outputUrl = URL.createObjectURL(blob);
      resolve({
        phase: 'complete',
        currentFrame: totalFrames,
        totalFrames,
        elapsedMs: performance.now() - startWallMs,
        encoderLabel: label,
        outputFormat: ext,
        isNonDeterministicFallback: true,
        batchIndex: batchContext?.index,
        batchTotal: batchContext?.total,
        batchLabel: batchContext?.label,
        outputUrl,
        outputFileName: sanitizeOutputFileName(
          config.titleText,
          config.artistText,
          dims.aspectLabel,
          ext
        ),
        outputSizeBytes: blob.size,
      });
    };
  });

  recorder.start(250);
  const audioNow = audioCtx.currentTime;
  src.start(audioNow, 0, mixedAudioBuffer.duration);

  const startTime = performance.now();
  let lastTickTime = startTime;

  const tick = () => {
    if (abortSignal.aborted) {
      if (recorder.state !== 'inactive') recorder.stop();
      return;
    }
    const wallNow = performance.now();
    const dtSec = Math.max(0.001, (wallNow - lastTickTime) / 1000);
    lastTickTime = wallNow;
    const localTime = (wallNow - startTime) / 1000;
    if (localTime >= clipDuration) {
      if (recorder.state !== 'inactive') recorder.stop();
      return;
    }

    if (mediaItems.length > 0) {
      const slice = resolveActiveSlideshowSlice(
        mediaItems,
        localTime,
        clipDuration,
        config,
        beatCutTimestamps
      );
      const syncVid = (item: VisualMediaState | undefined, slideT: number) => {
        if (!item || item.kind !== 'video' || !item.videoElement) return;
        const vid = item.videoElement;
        const dur = vid.duration || 1;
        const target =
          Math.max(0, (item.sourceStartSec + slideT * (item.playbackRate || 1)) % dur);
        if (!vid.seeking && Math.abs(vid.currentTime - target) > 0.08) {
          vid.currentTime = Math.min(Math.max(0, dur - 0.04), target);
        }
      };
      if (slice.activeIndex !== null) {
        syncVid(mediaItems[slice.activeIndex], slice.slideLocalTime);
      }
      if (slice.prevIndex !== null) {
        syncVid(mediaItems[slice.prevIndex], slice.prevSlideLocalTime);
      }
    }

    const currentFrame = Math.min(totalFrames, Math.floor(localTime * config.fps));
    const sourceAudioTime = config.trimStart + localTime;
    const metrics = analyzeAudioAtTime(
      activeMonoData,
      analysisSampleRate,
      audio ? sourceAudioTime : localTime,
      config.beatSensitivity,
      smoothState,
      config.visualizerSmoothing,
      dtSec
    );

    renderStudioFrame({
      ctx,
      width: dims.width,
      height: dims.height,
      localTime,
      absTime: sourceAudioTime,
      clipDuration,
      metrics,
      config,
      mediaItems,
      beatCutTimestamps,
      reducedMotion: false,
      isExport: true,
    });

    onProgress({
      phase: 'encoding',
      currentFrame,
      totalFrames,
      elapsedMs: wallNow - startWallMs,
      etaMs: Math.max(0, (clipDuration - localTime) * 1000),
      encoderLabel: label,
      outputFormat: ext,
      isNonDeterministicFallback: true,
      batchIndex: batchContext?.index,
      batchTotal: batchContext?.total,
      batchLabel: batchContext?.label,
    });

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  abortSignal.addEventListener('abort', onAbort, { once: true });

  return resultPromise;
}
