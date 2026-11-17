import {
  AudioFrameMetrics,
  SlideTransitionType,
  StudioConfig,
  VisualMediaState,
} from '../types/studio';
import { Radix2FFT } from './fft';

const FFT_SIZE = 1024;
const fftInstance = new Radix2FFT(FFT_SIZE);
const tempSlice = new Float32Array(FFT_SIZE);
const tempMagnitudes = new Float32Array(FFT_SIZE >> 1);

export interface AnalyzerSmoothState {
  spectrum: Float32Array;
  bass: number;
  mid: number;
  treble: number;
  rms: number;
  beatPulse: number;
}

export function createSmoothState(): AnalyzerSmoothState {
  return {
    spectrum: new Float32Array(48),
    bass: 0,
    mid: 0,
    treble: 0,
    rms: 0,
    beatPulse: 0,
  };
}

export function buildMonoAudioData(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(length);
  if (channels === 1) {
    mono.set(buffer.getChannelData(0));
    return mono;
  }
  const inv = 1 / channels;
  for (let ch = 0; ch < channels; ch++) {
    const chData = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += chData[i] * inv;
    }
  }
  return mono;
}

export function computeWaveformPeaks(mono: Float32Array, barCount = 220): Float32Array {
  const peaks = new Float32Array(barCount);
  if (mono.length === 0) return peaks;
  const blockSize = Math.max(1, Math.floor(mono.length / barCount));
  let maxPeak = 0.0001;

  for (let b = 0; b < barCount; b++) {
    const start = b * blockSize;
    const end = Math.min(mono.length, start + blockSize);
    let peak = 0;
    const step = Math.max(1, Math.floor((end - start) / 64));
    for (let i = start; i < end; i += step) {
      const v = Math.abs(mono[i]);
      if (v > peak) peak = v;
    }
    peaks[b] = peak;
    if (peak > maxPeak) maxPeak = peak;
  }

  for (let b = 0; b < barCount; b++) {
    peaks[b] = peaks[b] / maxPeak;
  }
  return peaks;
}

export function analyzeAudioAtTime(
  mono: Float32Array,
  sampleRate: number,
  timeSec: number,
  sensitivity: number,
  smoothState?: AnalyzerSmoothState,
  smoothing = 0.45
): AudioFrameMetrics {
  const spectrumOut = new Float32Array(48);
  const waveformOut = new Float32Array(64);

  if (mono.length === 0) {
    return {
      rms: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      beatPulse: 0,
      spectrum: spectrumOut,
      waveform: waveformOut,
    };
  }

  const centerIdx = Math.max(0, Math.min(mono.length - 1, Math.floor(timeSec * sampleRate)));
  const startIdx = Math.max(0, centerIdx - (FFT_SIZE >> 1));

  let sumSq = 0;
  for (let i = 0; i < FFT_SIZE; i++) {
    const idx = startIdx + i;
    const sample = idx < mono.length ? mono[idx] : 0;
    tempSlice[i] = sample;
    sumSq += sample * sample;
  }

  const rawRms = Math.min(1, Math.sqrt(sumSq / FFT_SIZE) * 2.2 * sensitivity);

  const waveStep = Math.floor(FFT_SIZE / 64);
  for (let i = 0; i < 64; i++) {
    waveformOut[i] = Math.max(-1, Math.min(1, tempSlice[i * waveStep] * sensitivity));
  }

  fftInstance.computeMagnitudes(tempSlice, tempMagnitudes);

  const nyquist = sampleRate / 2;
  const binHz = nyquist / (FFT_SIZE >> 1);
  const minFreq = 35;
  const maxFreq = Math.min(14000, nyquist * 0.9);
  const logMin = Math.log(minFreq);
  const logMax = Math.log(maxFreq);

  for (let b = 0; b < 48; b++) {
    const f0 = Math.exp(logMin + ((logMax - logMin) * b) / 48);
    const f1 = Math.exp(logMin + ((logMax - logMin) * (b + 1)) / 48);
    const k0 = Math.max(1, Math.floor(f0 / binHz));
    const k1 = Math.min(tempMagnitudes.length - 1, Math.max(k0, Math.ceil(f1 / binHz)));
    let peak = 0;
    for (let k = k0; k <= k1; k++) {
      if (tempMagnitudes[k] > peak) peak = tempMagnitudes[k];
    }
    const tilt = 1 + (b / 48) * 1.4;
    const scaled = Math.pow(Math.min(1, peak * 5.2 * sensitivity * tilt), 0.72);
    spectrumOut[b] = scaled;
  }

  let bassSum = 0;
  for (let i = 0; i < 10; i++) bassSum += spectrumOut[i];
  const rawBass = bassSum / 10;

  let midSum = 0;
  for (let i = 10; i < 28; i++) midSum += spectrumOut[i];
  const rawMid = midSum / 18;

  let trebleSum = 0;
  for (let i = 28; i < 48; i++) trebleSum += spectrumOut[i];
  const rawTreble = trebleSum / 20;

  const rawBeat = Math.max(0, Math.min(1, (rawBass - 0.16) * 1.45));

  if (smoothState) {
    const decayRate = Math.max(0.08, 0.45 * (1 - smoothing * 0.75));
    const attackRate = Math.max(0.25, 0.85 * (1 - smoothing * 0.45));

    for (let i = 0; i < 48; i++) {
      const target = spectrumOut[i];
      const prev = smoothState.spectrum[i];
      const rate = target > prev ? attackRate : decayRate;
      smoothState.spectrum[i] = prev + (target - prev) * rate;
      spectrumOut[i] = smoothState.spectrum[i];
    }
    smoothState.bass += (rawBass - smoothState.bass) * (rawBass > smoothState.bass ? attackRate : decayRate);
    smoothState.mid += (rawMid - smoothState.mid) * Math.max(0.15, decayRate * 1.2);
    smoothState.treble += (rawTreble - smoothState.treble) * Math.max(0.15, decayRate * 1.2);
    smoothState.rms += (rawRms - smoothState.rms) * Math.max(0.15, decayRate * 1.2);
    smoothState.beatPulse +=
      (rawBeat - smoothState.beatPulse) *
      (rawBeat > smoothState.beatPulse ? Math.min(0.85, attackRate * 1.1) : decayRate * 0.8);

    return {
      rms: smoothState.rms,
      bass: smoothState.bass,
      mid: smoothState.mid,
      treble: smoothState.treble,
      beatPulse: smoothState.beatPulse,
      spectrum: spectrumOut,
      waveform: waveformOut,
    };
  }

  return {
    rms: rawRms,
    bass: rawBass,
    mid: rawMid,
    treble: rawTreble,
    beatPulse: rawBeat,
    spectrum: spectrumOut,
    waveform: waveformOut,
  };
}

export function computeBeatCutTimestamps(
  mono: Float32Array,
  sampleRate: number,
  trimStart: number,
  trimEnd: number,
  minHoldSec: number,
  sensitivity: number
): number[] {
  const clipDuration = Math.max(0.5, trimEnd - trimStart);
  const cuts: number[] = [0];
  if (mono.length === 0) return cuts;

  const stepSec = 0.05;
  let rollingAvg = 0.2;
  let lastCut = 0;

  for (let t = 0.25; t < clipDuration - 0.35; t += stepSec) {
    const metrics = analyzeAudioAtTime(mono, sampleRate, trimStart + t, sensitivity);
    const energy = metrics.bass * 0.75 + metrics.rms * 0.25;
    rollingAvg = rollingAvg * 0.88 + energy * 0.12;

    if (t - lastCut >= Math.max(0.6, minHoldSec) && energy > rollingAvg * 1.26 && energy > 0.28) {
      cuts.push(Number(t.toFixed(3)));
      lastCut = t;
    }
  }

  return cuts;
}

export interface TimelineClipSegment {
  clipIndex: number;
  startSec: number;
  endSec: number;
}

/**
 * Computes exact non-overlapping timeline segments for all clips across [0 .. clipDuration].
 */
export function computeClipTimelineSegments(
  mediaItems: VisualMediaState[],
  clipDuration: number,
  config: StudioConfig,
  beatCutTimestamps: number[]
): TimelineClipSegment[] {
  const count = mediaItems.length;
  if (count === 0) return [];
  if (count === 1) {
    return [{ clipIndex: 0, startSec: 0, endSec: clipDuration }];
  }

  const segments: TimelineClipSegment[] = [];

  if (config.slideshowMode === 'custom_durations') {
    let cursor = 0;
    let step = 0;
    while (cursor < clipDuration - 0.01 && step < 400) {
      const clipIndex = step % count;
      const dur = Math.max(0.4, mediaItems[clipIndex].durationSec || 4);
      const endSec = Math.min(clipDuration, cursor + dur);
      segments.push({ clipIndex, startSec: cursor, endSec });
      cursor = endSec;
      step++;
    }
    return segments;
  }

  if (config.slideshowMode === 'even') {
    const segLen = clipDuration / count;
    for (let i = 0; i < count; i++) {
      segments.push({
        clipIndex: i,
        startSec: i * segLen,
        endSec: i === count - 1 ? clipDuration : (i + 1) * segLen,
      });
    }
    return segments;
  }

  if (config.slideshowMode === 'fixed') {
    const segLen = Math.max(0.8, config.slideDurationSec);
    let cursor = 0;
    let step = 0;
    while (cursor < clipDuration - 0.01 && step < 400) {
      const endSec = Math.min(clipDuration, cursor + segLen);
      segments.push({ clipIndex: step % count, startSec: cursor, endSec });
      cursor = endSec;
      step++;
    }
    return segments;
  }

  // beat_cut
  for (let i = 0; i < beatCutTimestamps.length; i++) {
    const startSec = beatCutTimestamps[i];
    if (startSec >= clipDuration) break;
    const nextStart =
      i + 1 < beatCutTimestamps.length ? Math.min(clipDuration, beatCutTimestamps[i + 1]) : clipDuration;
    segments.push({
      clipIndex: i % count,
      startSec,
      endSec: nextStart,
    });
  }
  return segments;
}

export interface ActiveSlideshowSlice {
  activeIndex: number;
  prevIndex: number | null;
  transitionProgress: number;
  transitionType: SlideTransitionType;
  slideLocalTime: number;
  prevSlideLocalTime: number;
}

export function resolveActiveSlideshowSlice(
  mediaItems: VisualMediaState[],
  localTime: number,
  clipDuration: number,
  config: StudioConfig,
  beatCutTimestamps: number[]
): ActiveSlideshowSlice {
  const count = mediaItems.length;
  if (count <= 1) {
    return {
      activeIndex: 0,
      prevIndex: null,
      transitionProgress: 1,
      transitionType: 'cut',
      slideLocalTime: localTime,
      prevSlideLocalTime: 0,
    };
  }

  const segments = computeClipTimelineSegments(mediaItems, clipDuration, config, beatCutTimestamps);
  if (segments.length === 0) {
    return {
      activeIndex: 0,
      prevIndex: null,
      transitionProgress: 1,
      transitionType: 'cut',
      slideLocalTime: localTime,
      prevSlideLocalTime: 0,
    };
  }

  let segPos = segments.length - 1;
  for (let i = 0; i < segments.length; i++) {
    if (localTime < segments[i].endSec) {
      segPos = i;
      break;
    }
  }

  const currentSeg = segments[segPos];
  const prevSeg = segPos > 0 ? segments[segPos - 1] : null;
  const timeInSlide = Math.max(0, localTime - currentSeg.startSec);
  const prevTimeInSlide = prevSeg ? Math.max(0, localTime - prevSeg.startSec) : 0;

  if (!prevSeg) {
    return {
      activeIndex: currentSeg.clipIndex,
      prevIndex: null,
      transitionProgress: 1,
      transitionType: 'cut',
      slideLocalTime: timeInSlide,
      prevSlideLocalTime: 0,
    };
  }

  const prevClip = mediaItems[prevSeg.clipIndex];
  const tType =
    config.slideshowMode === 'custom_durations' && prevClip
      ? prevClip.transitionOut
      : config.transitionType;
  const tDur =
    tType === 'cut'
      ? 0
      : Math.max(
          0.05,
          config.slideshowMode === 'custom_durations' && prevClip
            ? prevClip.transitionDurationSec
            : config.transitionDurationSec
        );

  if (tDur <= 0 || timeInSlide >= tDur) {
    return {
      activeIndex: currentSeg.clipIndex,
      prevIndex: null,
      transitionProgress: 1,
      transitionType: tType,
      slideLocalTime: timeInSlide,
      prevSlideLocalTime: prevTimeInSlide,
    };
  }

  const rawP = Math.max(0, Math.min(1, timeInSlide / tDur));
  const easedP = rawP < 0.5 ? 4 * rawP * rawP * rawP : 1 - Math.pow(-2 * rawP + 2, 3) / 2;

  return {
    activeIndex: currentSeg.clipIndex,
    prevIndex: prevSeg.clipIndex,
    transitionProgress: easedP,
    transitionType: tType,
    slideLocalTime: timeInSlide,
    prevSlideLocalTime: prevTimeInSlide,
  };
}

export function computeFadeEnvelope(
  localTime: number,
  clipDuration: number,
  fadeInSec: number,
  fadeOutSec: number
): number {
  let gain = 1;
  if (fadeInSec > 0.02 && localTime < fadeInSec) {
    const p = Math.max(0, Math.min(1, localTime / fadeInSec));
    gain *= 0.5 - 0.5 * Math.cos(Math.PI * p);
  }
  if (fadeOutSec > 0.02 && localTime > clipDuration - fadeOutSec) {
    const remaining = Math.max(0, clipDuration - localTime);
    const p = Math.max(0, Math.min(1, remaining / fadeOutSec));
    gain *= 0.5 - 0.5 * Math.cos(Math.PI * p);
  }
  return gain;
}

export async function generateDemoAudioBuffer(): Promise<AudioBuffer> {
  const sampleRate = 44100;
  const duration = 24;
  const offline = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

  const bpm = 122;
  const beatSec = 60 / bpm;
  const totalBeats = Math.floor(duration / beatSec);

  const master = offline.createGain();
  master.gain.value = 0.72;
  master.connect(offline.destination);

  const chords = [
    [146.83, 220.0, 261.63, 329.63],
    [116.54, 174.61, 220.0, 293.66],
    [98.0, 146.83, 174.61, 233.08],
    [110.0, 164.81, 196.0, 293.66],
  ];

  const noiseBuffer = offline.createBuffer(1, sampleRate * 0.08, sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.015));
  }

  for (let b = 0; b < totalBeats; b++) {
    const t = b * beatSec;

    const kickOsc = offline.createOscillator();
    const kickGain = offline.createGain();
    kickOsc.type = 'sine';
    kickOsc.frequency.setValueAtTime(145, t);
    kickOsc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    kickGain.gain.setValueAtTime(0.95, t);
    kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    kickOsc.connect(kickGain);
    kickGain.connect(master);
    kickOsc.start(t);
    kickOsc.stop(t + 0.3);

    const hatTime = t + beatSec * 0.5;
    if (hatTime < duration - 0.1) {
      const hatSrc = offline.createBufferSource();
      hatSrc.buffer = noiseBuffer;
      const hatFilter = offline.createBiquadFilter();
      hatFilter.type = 'highpass';
      hatFilter.frequency.value = 6500;
      const hatGain = offline.createGain();
      hatGain.gain.value = 0.22;
      hatSrc.connect(hatFilter);
      hatFilter.connect(hatGain);
      hatGain.connect(master);
      hatSrc.start(hatTime);
    }

    if (b % 4 === 0) {
      const chordIdx = Math.floor(b / 4) % chords.length;
      const chord = chords[chordIdx];
      const padDur = beatSec * 4;

      const bassOsc = offline.createOscillator();
      const bassGain = offline.createGain();
      bassOsc.type = 'triangle';
      bassOsc.frequency.setValueAtTime(chord[0] * 0.5, t);
      bassGain.gain.setValueAtTime(0.01, t);
      bassGain.gain.linearRampToValueAtTime(0.36, t + 0.05);
      bassGain.gain.exponentialRampToValueAtTime(0.04, t + padDur);
      bassOsc.connect(bassGain);
      bassGain.connect(master);
      bassOsc.start(t);
      bassOsc.stop(t + padDur);

      chord.forEach((freq) => {
        const osc = offline.createOscillator();
        const g = offline.createGain();
        const filter = offline.createBiquadFilter();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(700, t);
        filter.frequency.linearRampToValueAtTime(1850, t + padDur * 0.45);
        filter.frequency.linearRampToValueAtTime(650, t + padDur);

        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.075, t + 0.12);
        g.gain.exponentialRampToValueAtTime(0.005, t + padDur);

        osc.connect(filter);
        filter.connect(g);
        g.connect(master);
        osc.start(t);
        osc.stop(t + padDur);
      });
    }

    for (let sub = 0; sub < 2; sub++) {
      const arpTime = t + sub * beatSec * 0.5;
      if (arpTime >= duration - 0.15) continue;
      const chordIdx = Math.floor(b / 4) % chords.length;
      const chord = chords[chordIdx];
      const noteFreq = chord[(b * 2 + sub) % chord.length] * 2;
      const arpOsc = offline.createOscillator();
      const arpGain = offline.createGain();
      arpOsc.type = 'sine';
      arpOsc.frequency.value = noteFreq;
      arpGain.gain.setValueAtTime(0.001, arpTime);
      arpGain.gain.linearRampToValueAtTime(0.11, arpTime + 0.015);
      arpGain.gain.exponentialRampToValueAtTime(0.001, arpTime + 0.22);
      arpOsc.connect(arpGain);
      arpGain.connect(master);
      arpOsc.start(arpTime);
      arpOsc.stop(arpTime + 0.24);
    }
  }

  return offline.startRendering();
}
