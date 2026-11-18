import { ArrayBufferTarget as Mp4ArrayBufferTarget, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmArrayBufferTarget, Muxer as WebmMuxer } from 'webm-muxer';
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
  audio: AudioTrackState,
  dims: ExportDimensions
): string {
  const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);
  const mins = Math.floor(clipDuration / 60);
  const secs = Math.floor(clipDuration % 60);
  const durationStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  return [
    `${config.artistText ? `${config.artistText} — ` : ''}${config.titleText || audio.fileName}`,
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

    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
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
        setTimeout(finish, 120);
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
  sourceBuffer: AudioBuffer,
  config: StudioConfig,
  mediaItems: VisualMediaState[],
  beatCutTimestamps: number[],
  targetSampleRate: number
): Promise<AudioBuffer> {
  const clipDuration = Math.max(0.25, config.trimEnd - config.trimStart);
  const frameCount = Math.ceil(clipDuration * targetSampleRate);
  const channels = Math.min(2, sourceBuffer.numberOfChannels);
  const offline = new OfflineAudioContext(channels, frameCount, targetSampleRate);

  const src = offline.createBufferSource();
  src.buffer = sourceBuffer;
  const mainGain = offline.createGain();
  src.connect(mainGain);
  mainGain.connect(offline.destination);
  src.start(0, config.trimStart, clipDuration);

  // Mix unmuted video clip audio tracks & schedule ducking envelope on main track
  const segments = computeClipTimelineSegments(mediaItems, clipDuration, config, beatCutTimestamps);
  const duckAmt = Math.max(0, Math.min(0.9, config.audioDucking || 0));
  const duckGain = 1 - duckAmt;

  mainGain.gain.setValueAtTime(1, 0);
  for (const seg of segments) {
    const clip = mediaItems[seg.clipIndex];
    if (!clip || clip.kind !== 'video' || clip.clipAudioMuted || clip.clipAudioVolume <= 0.01) {
      continue;
    }
    if (!clip.decodedAudioBuffer) continue;

    const segDur = Math.max(0.05, seg.endSec - seg.startSec);
    const clipSrc = offline.createBufferSource();
    clipSrc.buffer = clip.decodedAudioBuffer;
    clipSrc.playbackRate.value = clip.playbackRate || 1;
    const clipGainNode = offline.createGain();
    clipGainNode.gain.value = clip.clipAudioVolume;
    clipSrc.connect(clipGainNode);
    clipGainNode.connect(offline.destination);

    const bufDur = clip.decodedAudioBuffer.duration || 1;
    const offsetInClip = clip.sourceStartSec % bufDur;
    clipSrc.start(seg.startSec, offsetInClip, segDur * (clip.playbackRate || 1));

    if (duckAmt > 0.02) {
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
  audio: AudioTrackState;
  mediaItems: VisualMediaState[];
  config: StudioConfig;
  abortSignal: AbortSignal;
  onProgress: (state: ExportProgressState) => void;
  batchContext?: { index: number; total: number; label: string };
}): Promise<ExportProgressState> {
  const { audio, mediaItems, config, abortSignal, onProgress, batchContext } = params;
  const startWallMs = performance.now();
  const dims = resolveExportDimensions(
    config.aspectMode,
    mediaItems,
    config.customWidth,
    config.customHeight
  );
  const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);
  const totalFrames = Math.max(1, Math.ceil(clipDuration * config.fps));
  const videoBitrate = config.bitrateMbps * 1_000_000;

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
    await document.fonts.load(`${config.fontWeight} 48px "${config.fontFamily}"`);
  } catch {
    // Continue even if font check rejects
  }

  const monoData = buildMonoAudioData(audio.buffer);
  const autoCuts =
    config.slideshowMode === 'beat_cut'
      ? computeBeatCutTimestamps(
          monoData,
          audio.sampleRate,
          config.trimStart,
          config.trimEnd,
          config.minBeatCutSec,
          config.beatSensitivity
        )
      : [0];
  const beatCutTimestamps = resolveBeatCutPoints(
    autoCuts,
    config.manualBeatMarkers,
    config.trimStart,
    clipDuration
  );
  const channels = Math.min(2, audio.numberOfChannels);

  const profile = await probeBestWebCodecsProfile(
    dims.width,
    dims.height,
    config.fps,
    videoBitrate,
    audio.sampleRate,
    channels
  );

  if (profile) {
    return await exportWithWebCodecs({
      profile,
      audio,
      monoData,
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
    });
  }

  return await exportWithMediaRecorder({
    audio,
    monoData,
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
  });
}

async function exportWithWebCodecs(params: {
  profile: ProbedWebCodecsProfile;
  audio: AudioTrackState;
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
}): Promise<ExportProgressState> {
  const {
    profile,
    audio,
    monoData,
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
  } = params;

  const targetSampleRate = profile.audioSampleRate;
  const trimmedAudio = await renderTrimmedAudioWithFades(
    audio.buffer,
    config,
    mediaItems,
    beatCutTimestamps,
    targetSampleRate
  );

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

  let mp4Muxer: Mp4Muxer<Mp4ArrayBufferTarget> | null = null;
  let webmMuxer: WebmMuxer<WebmArrayBufferTarget> | null = null;
  let mp4Target: Mp4ArrayBufferTarget | null = null;
  let webmTarget: WebmArrayBufferTarget | null = null;

  if (profile.container === 'mp4') {
    mp4Target = new Mp4ArrayBufferTarget();
    mp4Muxer = new Mp4Muxer({
      target: mp4Target,
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
  } else {
    webmTarget = new WebmArrayBufferTarget();
    webmMuxer = new WebmMuxer({
      target: webmTarget,
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
        const activeItem = mediaItems[slice.activeIndex];
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
        monoData,
        audio.sampleRate,
        sourceAudioTime,
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

    let buffer: ArrayBuffer;
    let mime: string;
    if (mp4Muxer && mp4Target) {
      mp4Muxer.finalize();
      buffer = mp4Target.buffer;
      mime = 'video/mp4';
    } else if (webmMuxer && webmTarget) {
      webmMuxer.finalize();
      buffer = webmTarget.buffer;
      mime = 'video/webm';
    } else {
      throw new Error('Muxer target missing');
    }

    const blob = new Blob([buffer], { type: mime });
    const outputUrl = URL.createObjectURL(blob);
    const outputFileName = sanitizeOutputFileName(
      config.titleText,
      config.artistText,
      dims.aspectLabel,
      profile.container
    );

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
  } finally {
    closeEncoders();
  }
}

async function exportWithMediaRecorder(params: {
  audio: AudioTrackState;
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
    monoData,
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

  const audioCtx = new AudioContext({ sampleRate: 48000 });
  const dest = audioCtx.createMediaStreamDestination();
  const src = audioCtx.createBufferSource();
  src.buffer = audio.buffer;

  const gainNode = audioCtx.createGain();
  const now = audioCtx.currentTime;
  const baseGain = config.audioGain;
  if (config.fadeInSec > 0.02) {
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(
      baseGain,
      now + Math.min(clipDuration * 0.5, config.fadeInSec)
    );
  } else {
    gainNode.gain.setValueAtTime(baseGain, now);
  }
  if (config.fadeOutSec > 0.02) {
    const fadeStart = Math.max(0, clipDuration - config.fadeOutSec);
    gainNode.gain.setValueAtTime(baseGain, now + fadeStart);
    gainNode.gain.linearRampToValueAtTime(0, now + clipDuration);
  }

  src.connect(gainNode);
  gainNode.connect(dest);

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

  const resultPromise = new Promise<ExportProgressState>((resolve) => {
    recorder.onstop = () => {
      try {
        src.stop();
        audioCtx.close();
      } catch {
        // ignore
      }
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
  src.start(now, config.trimStart, clipDuration);

  const startTime = performance.now();
  let lastTickTime = startTime;
  let rafId = 0;

  const tick = () => {
    if (abortSignal.aborted) {
      recorder.stop();
      return;
    }
    const wallNow = performance.now();
    const dtSec = Math.max(0.001, (wallNow - lastTickTime) / 1000);
    lastTickTime = wallNow;
    const localTime = (wallNow - startTime) / 1000;
    if (localTime >= clipDuration) {
      recorder.stop();
      return;
    }
    const currentFrame = Math.min(totalFrames, Math.floor(localTime * config.fps));
    const sourceAudioTime = config.trimStart + localTime;
    const metrics = analyzeAudioAtTime(
      monoData,
      audio.sampleRate,
      sourceAudioTime,
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
  abortSignal.addEventListener(
    'abort',
    () => {
      cancelAnimationFrame(rafId);
      if (recorder.state !== 'inactive') recorder.stop();
    },
    { once: true }
  );

  return resultPromise;
}
