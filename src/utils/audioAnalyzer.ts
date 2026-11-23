import {
  AudioFrameMetrics,
  BeatSyncMode,
  MediaBinItem,
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
  smoothing = 0.45,
  dtSec = 1 / 30
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
    // Convert 30fps reference alpha to dt-independent exponential coefficient
    const clampedDt = Math.max(0.001, Math.min(0.25, dtSec));
    const dtScale = clampedDt * 30;
    const baseDecay = Math.max(0.08, 0.45 * (1 - smoothing * 0.75));
    const baseAttack = Math.max(0.25, 0.85 * (1 - smoothing * 0.45));
    const decayRate = 1 - Math.pow(1 - baseDecay, dtScale);
    const attackRate = 1 - Math.pow(1 - baseAttack, dtScale);
    const midRate = 1 - Math.pow(1 - Math.max(0.15, baseDecay * 1.2), dtScale);
    const beatAttackRate = 1 - Math.pow(1 - Math.min(0.85, baseAttack * 1.1), dtScale);
    const beatDecayRate = 1 - Math.pow(1 - baseDecay * 0.8, dtScale);

    for (let i = 0; i < 48; i++) {
      const target = spectrumOut[i];
      const prev = smoothState.spectrum[i];
      const rate = target > prev ? attackRate : decayRate;
      smoothState.spectrum[i] = prev + (target - prev) * rate;
      spectrumOut[i] = smoothState.spectrum[i];
    }
    smoothState.bass +=
      (rawBass - smoothState.bass) * (rawBass > smoothState.bass ? attackRate : decayRate);
    smoothState.mid += (rawMid - smoothState.mid) * midRate;
    smoothState.treble += (rawTreble - smoothState.treble) * midRate;
    smoothState.rms += (rawRms - smoothState.rms) * midRate;
    smoothState.beatPulse +=
      (rawBeat - smoothState.beatPulse) *
      (rawBeat > smoothState.beatPulse ? beatAttackRate : beatDecayRate);

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
  const energies: number[] = [];
  const times: number[] = [];
  let maxEnergy = 0;

  for (let t = 0.2; t < clipDuration - 0.3; t += stepSec) {
    const metrics = analyzeAudioAtTime(mono, sampleRate, trimStart + t, sensitivity);
    const energy = metrics.bass * 0.75 + metrics.rms * 0.25;
    energies.push(energy);
    times.push(t);
    if (energy > maxEnergy) maxEnergy = energy;
  }

  if (energies.length === 0 || maxEnergy < 0.02) return cuts;

  // Adaptive floor scales with track loudness so quiet ambient tracks still get musical cuts
  const adaptiveFloor = Math.max(0.04, maxEnergy * 0.24);
  let rollingAvg = energies[0];
  let lastCut = 0;

  for (let i = 0; i < energies.length; i++) {
    const t = times[i];
    const energy = energies[i];
    rollingAvg = rollingAvg * 0.88 + energy * 0.12;

    if (
      t - lastCut >= Math.max(0.6, minHoldSec) &&
      energy > rollingAvg * 1.24 &&
      energy > adaptiveFloor
    ) {
      cuts.push(Number(t.toFixed(3)));
      lastCut = t;
    }
  }

  return cuts;
}

/**
 * Merges user-authored manual beat markers (relative to trimStart) with auto-detected cuts
 * when manual markers exist, returning a clean sorted timeline cut array starting at 0.
 */
export function resolveBeatCutPoints(
  autoCuts: number[],
  manualMarkersAbs: number[],
  trimStart: number,
  clipDuration: number
): number[] {
  if (!manualMarkersAbs || manualMarkersAbs.length === 0) return autoCuts;
  const rel = manualMarkersAbs
    .map((abs) => Number((abs - trimStart).toFixed(3)))
    .filter((t) => t > 0.15 && t < clipDuration - 0.15);
  const unique = Array.from(new Set([0, ...rel])).sort((a, b) => a - b);
  return unique.length > 1 ? unique : autoCuts;
}

export function snapTimeToBeat(
  timeSec: number,
  beatPointsAbs: number[],
  thresholdSec = 0.22
): number {
  let closest = timeSec;
  let bestDist = thresholdSec;
  for (const bp of beatPointsAbs) {
    const d = Math.abs(bp - timeSec);
    if (d < bestDist) {
      bestDist = d;
      closest = bp;
    }
  }
  return closest;
}

export interface TimelineClipSegment {
  clipIndex: number;
  startSec: number;
  endSec: number;
  isLoopRepeat?: boolean;
}

export interface NormalizedClipInterval {
  clipIndex: number;
  id: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export function getNormalizedManualClipIntervals(
  mediaItems: VisualMediaState[]
): NormalizedClipInterval[] {
  const result: NormalizedClipInterval[] = [];
  let cursor = 0;
  for (let i = 0; i < mediaItems.length; i++) {
    const clip = mediaItems[i];
    const dur = Math.max(0.4, clip.durationSec || 4);
    const startSec =
      clip.startSec !== undefined && Number.isFinite(clip.startSec)
        ? Math.max(0, clip.startSec)
        : cursor;
    const endSec = startSec + dur;
    cursor = Math.max(cursor, endSec);
    result.push({
      clipIndex: i,
      id: clip.id,
      startSec,
      endSec,
      durationSec: dur,
    });
  }
  result.sort((a, b) => a.startSec - b.startSec || a.clipIndex - b.clipIndex);
  return result;
}

export function getTimelineSpanSec(
  mediaItems: VisualMediaState[],
  config: Pick<StudioConfig, 'slideshowMode'>
): number {
  if (mediaItems.length === 0) return 12;
  if (config.slideshowMode === 'manual') {
    const intervals = getNormalizedManualClipIntervals(mediaItems);
    const maxEnd = intervals.reduce((acc, item) => Math.max(acc, item.endSec), 0);
    return Math.max(0.5, maxEnd);
  }
  const sum = mediaItems.reduce((acc, m) => acc + Math.max(0.5, m.durationSec || 4), 0);
  return Math.max(0.5, sum);
}

/**
 * Finds a non-overlapping [startSec, durationSec] slot for placing a new clip onto a manual timeline
 * without shifting or modifying any existing clips.
 */
export function findManualInsertionSlot(
  mediaItems: VisualMediaState[],
  desiredStartSec: number,
  desiredDurSec: number,
  maxTimelineSec = 3600
): { startSec: number; durationSec: number } {
  const dur = Math.max(0.5, desiredDurSec || 4);
  const clampedDesired = Math.max(0, Math.min(Math.max(0, maxTimelineSec - 0.5), desiredStartSec));
  const others = getNormalizedManualClipIntervals(mediaItems);
  if (others.length === 0) {
    return {
      startSec: Number(clampedDesired.toFixed(2)),
      durationSec: Number(Math.min(dur, Math.max(0.5, maxTimelineSec - clampedDesired)).toFixed(2)),
    };
  }

  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const item of others) {
    if (item.startSec > cursor + 0.02) {
      gaps.push({ start: cursor, end: Math.min(maxTimelineSec, item.startSec) });
    }
    cursor = Math.max(cursor, item.endSec);
  }
  if (cursor < maxTimelineSec - 0.02) {
    gaps.push({ start: cursor, end: maxTimelineSec });
  }

  // 1. Check if desiredStartSec falls inside any open gap (>= 0.5s)
  const directGap = gaps.find(
    (g) => clampedDesired >= g.start - 0.02 && clampedDesired <= g.end + 0.02 && g.end - g.start >= 0.5
  );
  if (directGap) {
    const start = Math.max(directGap.start, Math.min(directGap.end - 0.5, clampedDesired));
    const roomAfter = directGap.end - start;
    if (roomAfter >= dur) {
      return { startSec: Number(start.toFixed(2)), durationSec: Number(dur.toFixed(2)) };
    }
    if (directGap.end - directGap.start >= dur) {
      return {
        startSec: Number((directGap.end - dur).toFixed(2)),
        durationSec: Number(dur.toFixed(2)),
      };
    }
    return {
      startSec: Number(start.toFixed(2)),
      durationSec: Number(Math.max(0.5, roomAfter).toFixed(2)),
    };
  }

  // 2. Otherwise search forward (then closest overall) for a gap that fits full duration
  const forwardFull = gaps.find((g) => g.end >= clampedDesired && g.end - g.start >= dur);
  if (forwardFull) {
    const start = Math.max(forwardFull.start, clampedDesired);
    return { startSec: Number(start.toFixed(2)), durationSec: Number(dur.toFixed(2)) };
  }

  const anyFull = gaps.find((g) => g.end - g.start >= dur);
  if (anyFull) {
    return { startSec: Number(anyFull.start.toFixed(2)), durationSec: Number(dur.toFixed(2)) };
  }

  // 3. Fallback: pick largest available gap or append cleanly
  const largestGap = [...gaps].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  if (largestGap && largestGap.end - largestGap.start >= 0.5) {
    return {
      startSec: Number(largestGap.start.toFixed(2)),
      durationSec: Number(Math.min(dur, largestGap.end - largestGap.start).toFixed(2)),
    };
  }

  return {
    startSec: Number(cursor.toFixed(2)),
    durationSec: Number(dur.toFixed(2)),
  };
}

/**
 * Computes a collision-free startSec when dragging an existing clip horizontally in manual mode,
 * keeping all other clips stationary.
 */
export function clampManualClipMove(
  mediaItems: VisualMediaState[],
  movingClipId: string,
  desiredStartSec: number,
  maxTimelineSec = 3600,
  beatSnapPoints: number[] = [],
  snapEnabled = false
): number {
  const target = mediaItems.find((m) => m.id === movingClipId);
  if (!target) return Math.max(0, desiredStartSec);
  const clipDur = Math.max(0.4, target.durationSec || 4);
  const others = getNormalizedManualClipIntervals(mediaItems).filter((m) => m.id !== movingClipId);

  const windows: { minStart: number; maxStart: number }[] = [];
  const edgeSnapPoints: number[] = [0];
  let cursor = 0;
  for (const item of others) {
    edgeSnapPoints.push(item.startSec, item.endSec);
    const maxAllowedStart = item.startSec - clipDur;
    if (maxAllowedStart >= cursor - 0.005) {
      windows.push({
        minStart: cursor,
        maxStart: Math.max(cursor, maxAllowedStart),
      });
    }
    cursor = Math.max(cursor, item.endSec);
  }
  const finalMax = Math.max(cursor, maxTimelineSec - clipDur);
  windows.push({ minStart: cursor, maxStart: finalMax });

  let bestWin = windows[0];
  let bestDist = Infinity;
  const clampedDesired = Math.max(0, desiredStartSec);
  for (const w of windows) {
    const inside = Math.max(w.minStart, Math.min(w.maxStart, clampedDesired));
    const dist = Math.abs(inside - clampedDesired);
    if (dist < bestDist) {
      bestDist = dist;
      bestWin = w;
    }
  }

  let nextStart = Math.max(bestWin.minStart, Math.min(bestWin.maxStart, clampedDesired));
  const combinedSnaps = snapEnabled
    ? [...beatSnapPoints, ...edgeSnapPoints]
    : edgeSnapPoints;
  if (combinedSnaps.length > 0) {
    const thresh = snapEnabled ? 0.22 : 0.12;
    const snappedLeft = snapTimeToBeat(nextStart, combinedSnaps, thresh);
    const snappedRight = snapTimeToBeat(nextStart + clipDur, combinedSnaps, thresh) - clipDur;
    const diffLeft = Math.abs(snappedLeft - nextStart);
    const diffRight = Math.abs(snappedRight - nextStart);
    const candidate = diffLeft <= diffRight ? snappedLeft : snappedRight;
    if (candidate >= bestWin.minStart - 0.005 && candidate <= bestWin.maxStart + 0.005) {
      nextStart = Math.max(bestWin.minStart, Math.min(bestWin.maxStart, candidate));
    }
  }

  return Number(nextStart.toFixed(2));
}

/**
 * Updates a clip's duration in manual NLE mode. Shrinking leaves downstream clips in place;
 * extending fills free gaps first and smoothly pushes overlapping downstream clips right
 * so duration edits never overlap or get silently blocked.
 */
export function resizeManualClipDuration(
  mediaItems: VisualMediaState[],
  clipId: string,
  desiredDurationSec: number,
  maxTimelineSec = 3600
): VisualMediaState[] {
  const intervals = getNormalizedManualClipIntervals(mediaItems);
  const idx = intervals.findIndex((iv) => iv.id === clipId);
  if (idx === -1) return mediaItems;

  const target = intervals[idx];
  const maxAllowedDur = Math.max(0.4, Math.min(600, maxTimelineSec - target.startSec));
  const nextDur = Number(Math.max(0.4, Math.min(maxAllowedDur, desiredDurationSec)).toFixed(2));

  const nextStartById = new Map<string, number>();
  let cursor = Number((target.startSec + nextDur).toFixed(2));
  for (let i = idx + 1; i < intervals.length; i++) {
    const item = intervals[i];
    if (item.startSec < cursor - 0.001) {
      nextStartById.set(item.id, cursor);
      cursor = Number((cursor + item.durationSec).toFixed(2));
    } else {
      cursor = Number(Math.max(cursor, item.endSec).toFixed(2));
    }
  }

  return mediaItems.map((m) => {
    if (m.id === clipId) {
      return {
        ...m,
        startSec: Number(target.startSec.toFixed(2)),
        durationSec: nextDur,
      };
    }
    const shiftedStart = nextStartById.get(m.id);
    if (shiftedStart !== undefined) {
      return { ...m, startSec: shiftedStart };
    }
    return m;
  });
}

/**
 * Inserts a new clip into a manual timeline anchored right after `anchorStartSec` (playhead).
 * If an existing clip spans `anchorStartSec` with >= 0.4s to the left, its right tail is trimmed
 * to `anchorStartSec` (no split/duplication) and the new clip starts cleanly at `anchorStartSec`.
 * Any existing clip starting near/after `anchorStartSec` shifts right to stay non-overlapping.
 */
export function insertManualClipAtAnchor(
  mediaItems: VisualMediaState[],
  newClip: VisualMediaState,
  anchorStartSec: number,
  maxTimelineSec = 3600
): VisualMediaState[] {
  const newDur = Math.max(0.4, Math.min(600, newClip.durationSec || 4));
  const clampedAnchor = Math.max(
    0,
    Math.min(Math.max(0, maxTimelineSec - 0.5), anchorStartSec)
  );
  const startSec = Number(clampedAnchor.toFixed(2));
  const insertedEnd = Number((startSec + newDur).toFixed(2));

  const placedNewClip: VisualMediaState = {
    ...newClip,
    startSec,
    durationSec: Number(newDur.toFixed(2)),
  };

  if (mediaItems.length === 0) {
    return [placedNewClip];
  }

  const intervals = getNormalizedManualClipIntervals(mediaItems);
  const patchById = new Map<string, { startSec: number; durationSec?: number }>();
  let downstreamCursor = insertedEnd;

  for (const iv of intervals) {
    if (iv.endSec <= startSec + 0.01) {
      continue;
    }

    if (iv.startSec <= startSec - 0.4) {
      const trimmedDur = Number(Math.max(0.4, startSec - iv.startSec).toFixed(2));
      patchById.set(iv.id, {
        startSec: Number(iv.startSec.toFixed(2)),
        durationSec: trimmedDur,
      });
    } else {
      const nextStart = Number(Math.max(downstreamCursor, iv.startSec).toFixed(2));
      patchById.set(iv.id, { startSec: nextStart });
      downstreamCursor = Number((nextStart + iv.durationSec).toFixed(2));
    }
  }

  const updatedExisting = mediaItems.map((m) => {
    const patch = patchById.get(m.id);
    if (!patch) return m;
    return patch.durationSec !== undefined
      ? { ...m, startSec: patch.startSec, durationSec: patch.durationSec }
      : { ...m, startSec: patch.startSec };
  });

  return [...updatedExisting, placedNewClip].sort(
    (a, b) => (a.startSec ?? 0) - (b.startSec ?? 0)
  );
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
  if (count === 0 || clipDuration <= 0) return [];

  if (config.slideshowMode === 'manual') {
    const intervals = getNormalizedManualClipIntervals(mediaItems);
    const segments: TimelineClipSegment[] = [];
    let prevEnd = 0;
    for (const item of intervals) {
      const startSec = Math.max(prevEnd, item.startSec);
      if (startSec >= clipDuration - 0.005) continue;
      const endSec = Math.min(clipDuration, Math.max(startSec, item.endSec));
      if (endSec - startSec < 0.05) continue;
      segments.push({
        clipIndex: item.clipIndex,
        startSec,
        endSec,
        isLoopRepeat: false,
      });
      prevEnd = endSec;
    }
    return segments;
  }

  if (count === 1 && config.slideshowMode !== 'custom_durations') {
    return [{ clipIndex: 0, startSec: 0, endSec: clipDuration, isLoopRepeat: false }];
  }

  const segments: TimelineClipSegment[] = [];

  if (config.slideshowMode === 'custom_durations') {
    let cursor = 0;
    let step = 0;
    while (cursor < clipDuration - 0.005 && step < 400) {
      const clipIndex = step % count;
      const dur = Math.max(0.4, mediaItems[clipIndex].durationSec || 4);
      const rawEnd = cursor + dur;
      const endSec = clipDuration - rawEnd < 0.01 ? clipDuration : Math.min(clipDuration, rawEnd);
      segments.push({ clipIndex, startSec: cursor, endSec, isLoopRepeat: step >= count });
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
        isLoopRepeat: false,
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
      segments.push({
        clipIndex: step % count,
        startSec: cursor,
        endSec,
        isLoopRepeat: step >= count,
      });
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
      isLoopRepeat: i >= count,
    });
  }
  return segments;
}

export interface TrackBeatGrid {
  bpm: number;
  beatSec: number;
  beats: number[]; // relative to trimStart (0..clipDuration)
}

/**
 * Estimates track tempo (BPM) from low-frequency + RMS onset flux and constructs
 * a phase-aligned musical beat grid across [trimStart .. trimEnd].
 */
export function detectTrackBpmAndBeats(
  mono: Float32Array,
  sampleRate: number,
  trimStart: number,
  trimEnd: number,
  sensitivity: number
): TrackBeatGrid {
  const clipDuration = Math.max(0.5, trimEnd - trimStart);
  if (mono.length === 0) {
    return { bpm: 0, beatSec: 0.5, beats: [] };
  }

  const hopSec = 0.04; // 25 Hz analysis grid
  const sampleWin = Math.max(256, Math.floor(sampleRate * hopSec));
  const startIdx = Math.max(0, Math.floor(trimStart * sampleRate));
  const totalSteps = Math.max(4, Math.floor(clipDuration / hopSec));
  const onsets = new Float32Array(totalSteps);

  let prevLowEnergy = 0;
  let maxOnset = 0;
  for (let s = 0; s < totalSteps; s++) {
    const base = startIdx + s * sampleWin;
    if (base >= mono.length) break;
    const end = Math.min(mono.length, base + sampleWin);
    let sq = 0;
    let lowAcc = 0;
    let lp = 0;
    const count = Math.max(1, end - base);
    for (let i = base; i < end; i++) {
      const v = mono[i];
      sq += v * v;
      lp = lp * 0.88 + v * 0.12;
      lowAcc += lp * lp;
    }
    const energy = (Math.sqrt(lowAcc / count) * 0.72 + Math.sqrt(sq / count) * 0.28) * sensitivity;
    const flux = Math.max(0, energy - prevLowEnergy * 0.92);
    prevLowEnergy = energy;
    onsets[s] = flux;
    if (flux > maxOnset) maxOnset = flux;
  }

  if (maxOnset < 0.002) {
    return { bpm: 0, beatSec: 0.5, beats: [] };
  }

  // Autocorrelation over musical BPM range (68 .. 176 BPM)
  const minLag = Math.max(4, Math.round(60 / 176 / hopSec));
  const maxLag = Math.min(Math.floor(totalSteps / 2), Math.round(60 / 68 / hopSec));
  let bestLag = Math.round(0.5 / hopSec); // 120 BPM default if short
  let bestScore = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < totalSteps - lag; i++) {
      sum += onsets[i] * onsets[i + lag];
    }
    // Slight preference toward standard 95-138 BPM window to avoid half/double-time drift
    const candBpm = 60 / (lag * hopSec);
    const weight = candBpm >= 92 && candBpm <= 142 ? 1.12 : 1.0;
    const score = (sum / Math.max(1, totalSteps - lag)) * weight;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  const rawBpm = 60 / (bestLag * hopSec);
  const bpm = Math.max(60, Math.min(185, Math.round(rawBpm)));
  const beatSec = 60 / bpm;

  // Find strongest initial phase offset within the first 2 beats
  const phaseSteps = Math.max(1, Math.min(totalSteps, Math.round((beatSec * 1.5) / hopSec)));
  let bestPhase = 0;
  let bestPhaseScore = -1;
  for (let ph = 0; ph < phaseSteps; ph++) {
    let score = 0;
    let hits = 0;
    for (let t = ph * hopSec; t < clipDuration; t += beatSec) {
      const idx = Math.min(totalSteps - 1, Math.round(t / hopSec));
      const localPeak = Math.max(
        onsets[Math.max(0, idx - 1)],
        onsets[idx],
        onsets[Math.min(totalSteps - 1, idx + 1)]
      );
      score += localPeak;
      hits++;
    }
    const avgScore = hits > 0 ? score / hits : 0;
    if (avgScore > bestPhaseScore) {
      bestPhaseScore = avgScore;
      bestPhase = ph * hopSec;
    }
  }

  const beats: number[] = [];
  // Refine each steady beat slightly toward local onset peak within ±60ms
  for (let t = bestPhase; t < clipDuration - 0.05; t += beatSec) {
    const centerIdx = Math.round(t / hopSec);
    let peakIdx = centerIdx;
    let peakVal = onsets[Math.max(0, Math.min(totalSteps - 1, centerIdx))] || 0;
    for (let d = -1; d <= 1; d++) {
      const idx = Math.max(0, Math.min(totalSteps - 1, centerIdx + d));
      if (onsets[idx] > peakVal * 1.15) {
        peakVal = onsets[idx];
        peakIdx = idx;
      }
    }
    const snapped = Number((peakIdx * hopSec).toFixed(3));
    if (beats.length === 0 || snapped - beats[beats.length - 1] > beatSec * 0.45) {
      beats.push(snapped);
    }
  }

  return { bpm, beatSec, beats };
}

export interface BeatAlignedClipPlan {
  durationSec: number;
  transitionDurationSec: number;
  suggestedTransition: SlideTransitionType;
  suggestedScaleStart: number;
  suggestedScaleEnd: number;
}

/**
 * Aligns every clip's duration, outgoing transition, and optional gentle motion keyframes
 * to musical beats across [0..clipDuration].
 */
export function computeAutoBeatAlignedClips(
  clipCount: number,
  clipDuration: number,
  beatGrid: TrackBeatGrid,
  manualMarkersAbs: number[],
  trimStart: number,
  mode: BeatSyncMode = 'fit_track'
): BeatAlignedClipPlan[] {
  if (clipCount <= 0) return [];
  const beatSec = beatGrid.beatSec > 0.2 && beatGrid.beatSec < 1.5 ? beatGrid.beatSec : 0.5;
  const rhythmicTransitions: SlideTransitionType[] = ['crossfade', 'cut', 'crossfade', 'zoom_cross'];

  const makeMotionAndTrans = (idx: number, dur: number): BeatAlignedClipPlan => {
    const idealTrans = Math.max(0.16, Math.min(0.75, beatSec * 0.55, dur * 0.34));
    // Gentle unidirectional drift avoids alternating yo-yo zoom bounce between cuts
    const scaleSpan = dur >= 2.2 ? 1.035 : 1.02;
    return {
      durationSec: Number(dur.toFixed(2)),
      transitionDurationSec: Number(idealTrans.toFixed(2)),
      suggestedTransition: rhythmicTransitions[idx % rhythmicTransitions.length],
      suggestedScaleStart: 1.0,
      suggestedScaleEnd: scaleSpan,
    };
  };

  if (mode !== 'fit_track') {
    const beatMult =
      mode === 'beats_1' ? 1 : mode === 'beats_2' ? 2 : mode === 'beats_8' ? 8 : 4;
    const rawDur = Math.max(0.5, Math.min(30, beatSec * beatMult));
    return Array.from({ length: clipCount }, (_, i) => makeMotionAndTrans(i, rawDur));
  }

  // Prefer manual markers if >=clipCount exist inside trim range, otherwise use detected beat grid
  const manualRel = manualMarkersAbs
    .map((m) => Number((m - trimStart).toFixed(3)))
    .filter((t) => t > 0.15 && t < clipDuration - 0.15)
    .sort((a, b) => a - b);

  const grid =
    manualRel.length >= clipCount
      ? [0, ...manualRel]
      : beatGrid.beats.length >= 2
        ? [0, ...beatGrid.beats.filter((b) => b > 0.25 && b < clipDuration - 0.2)]
        : [0];

  const uniqueGrid = Array.from(new Set(grid)).sort((a, b) => a - b);

  if (uniqueGrid.length > clipCount) {
    // Pick evenly spaced beat indices across the musical grid so every cut hits a beat
    const step = (uniqueGrid.length - 1) / clipCount;
    const cutPoints: number[] = [0];
    for (let i = 1; i < clipCount; i++) {
      const idx = Math.min(uniqueGrid.length - 1, Math.max(i, Math.round(i * step)));
      const candidate = uniqueGrid[idx];
      const prev = cutPoints[cutPoints.length - 1];
      cutPoints.push(
        candidate > prev + 0.45 ? candidate : Number((prev + Math.max(0.5, beatSec)).toFixed(2))
      );
    }
    cutPoints.push(clipDuration);

    return Array.from({ length: clipCount }, (_, i) => {
      const rawDur = Math.max(0.5, Math.min(30, cutPoints[i + 1] - cutPoints[i]));
      return makeMotionAndTrans(i, rawDur);
    });
  }

  // Fallback: quantize target duration per clip to integer number of beats
  const rawPerClip = clipDuration / clipCount;
  const beatsPerClip = Math.max(1, Math.round(rawPerClip / beatSec));
  const quantizedDur = Math.max(0.5, Math.min(30, beatsPerClip * beatSec));

  return Array.from({ length: clipCount }, (_, i) => makeMotionAndTrans(i, quantizedDur));
}

export function snapFxOverlayToBeats(
  startSec: number,
  durationSec: number,
  beatGrid: TrackBeatGrid,
  clipDuration: number
): { startSec: number; durationSec: number } {
  const beatSec = beatGrid.beatSec > 0.2 && beatGrid.beatSec < 1.5 ? beatGrid.beatSec : 0.5;
  const points = beatGrid.beats.length >= 2 ? [0, ...beatGrid.beats, clipDuration] : [];
  let snappedStart = Math.max(0, Math.min(clipDuration - 0.4, startSec));
  if (points.length > 0) {
    snappedStart = snapTimeToBeat(snappedStart, points, Math.max(0.35, beatSec * 0.6));
  }
  const endTarget = Math.min(clipDuration, snappedStart + Math.max(0.4, durationSec));
  let snappedEnd =
    points.length > 0
      ? snapTimeToBeat(endTarget, points, Math.max(0.35, beatSec * 0.6))
      : endTarget;
  if (snappedEnd - snappedStart < Math.max(0.4, beatSec)) {
    snappedEnd = Math.min(clipDuration, snappedStart + beatSec * 2);
  }
  return {
    startSec: Number(Math.max(0, snappedStart).toFixed(2)),
    durationSec: Number(Math.max(0.4, snappedEnd - snappedStart).toFixed(2)),
  };
}

/**
 * Greedy interval packing: assigns each item a non-overlapping horizontal lane index
 * so simultaneous FX or overlay items stack cleanly without hiding one another.
 */
export function packTimelineLanes<T extends { startSec: number; durationSec: number }>(
  items: T[]
): { laneByIndex: number[]; laneCount: number } {
  if (items.length === 0) return { laneByIndex: [], laneCount: 1 };
  const indexed = items.map((item, idx) => ({
    idx,
    start: Math.max(0, item.startSec),
    end: Math.max(0, item.startSec) + Math.max(0.1, item.durationSec),
  }));
  indexed.sort((a, b) => a.start - b.start || a.end - b.end);

  const laneEnds: number[] = [];
  const laneByIndex = new Array<number>(items.length).fill(0);

  for (const item of indexed) {
    let assigned = -1;
    for (let l = 0; l < laneEnds.length; l++) {
      if (laneEnds[l] <= item.start + 0.01) {
        assigned = l;
        laneEnds[l] = item.end;
        break;
      }
    }
    if (assigned === -1) {
      assigned = laneEnds.length;
      laneEnds.push(item.end);
    }
    laneByIndex[item.idx] = assigned;
  }

  return {
    laneByIndex,
    laneCount: Math.max(1, laneEnds.length),
  };
}

export interface ActiveSlideshowSlice {
  activeIndex: number | null;
  prevIndex: number | null;
  transitionProgress: number;
  transitionType: SlideTransitionType;
  slideLocalTime: number;
  prevSlideLocalTime: number;
  activeSegmentDuration: number;
  prevSegmentDuration: number;
}

export function resolveActiveSlideshowSlice(
  mediaItems: VisualMediaState[],
  localTime: number,
  clipDuration: number,
  config: StudioConfig,
  beatCutTimestamps: number[]
): ActiveSlideshowSlice {
  const emptySlice: ActiveSlideshowSlice = {
    activeIndex: null,
    prevIndex: null,
    transitionProgress: 1,
    transitionType: 'cut',
    slideLocalTime: localTime,
    prevSlideLocalTime: 0,
    activeSegmentDuration: clipDuration,
    prevSegmentDuration: clipDuration,
  };

  const count = mediaItems.length;
  if (count === 0) {
    return emptySlice;
  }
  if (count === 1 && config.slideshowMode !== 'manual') {
    return {
      activeIndex: 0,
      prevIndex: null,
      transitionProgress: 1,
      transitionType: 'cut',
      slideLocalTime: localTime,
      prevSlideLocalTime: 0,
      activeSegmentDuration: clipDuration,
      prevSegmentDuration: clipDuration,
    };
  }

  const segments = computeClipTimelineSegments(mediaItems, clipDuration, config, beatCutTimestamps);
  if (segments.length === 0) {
    return emptySlice;
  }

  let segPos = -1;
  for (let i = 0; i < segments.length; i++) {
    if (localTime >= segments[i].startSec - 1e-6 && localTime < segments[i].endSec) {
      segPos = i;
      break;
    }
  }
  if (segPos === -1) {
    const lastSeg = segments[segments.length - 1];
    if (localTime >= lastSeg.endSec - 1e-6 && Math.abs(lastSeg.endSec - clipDuration) < 0.02) {
      segPos = segments.length - 1;
    } else {
      return emptySlice;
    }
  }

  const currentSeg = segments[segPos];
  const candidatePrev = segPos > 0 ? segments[segPos - 1] : null;
  // Only trigger clip-to-clip transition when the outgoing clip actually touches the incoming clip
  const prevSeg =
    candidatePrev && currentSeg.startSec - candidatePrev.endSec <= 0.08 ? candidatePrev : null;
  const currentSegLen = Math.max(0.1, currentSeg.endSec - currentSeg.startSec);
  const prevSegLen = prevSeg ? Math.max(0.1, prevSeg.endSec - prevSeg.startSec) : currentSegLen;
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
      activeSegmentDuration: currentSegLen,
      prevSegmentDuration: currentSegLen,
    };
  }

  const usePerClipTransition =
    config.slideshowMode === 'custom_durations' || config.slideshowMode === 'manual';
  const prevClip = mediaItems[prevSeg.clipIndex];
  const tType =
    usePerClipTransition && prevClip ? prevClip.transitionOut : config.transitionType;
  const requestedTDur =
    tType === 'cut'
      ? 0
      : Math.max(
          0.05,
          usePerClipTransition && prevClip
            ? prevClip.transitionDurationSec
            : config.transitionDurationSec
        );

  // Strictly clamp transition duration within both adjacent segment lengths so transitions
  // always finish cleanly before the next cut boundary (prevents abrupt mid-fade pops).
  const maxAllowedTDur = Math.min(currentSegLen * 0.85, prevSegLen * 0.85);
  const tDur = tType === 'cut' || maxAllowedTDur < 0.05 ? 0 : Math.min(requestedTDur, maxAllowedTDur);

  if (tDur <= 0 || timeInSlide >= tDur) {
    return {
      activeIndex: currentSeg.clipIndex,
      prevIndex: null,
      transitionProgress: 1,
      transitionType: tType,
      slideLocalTime: timeInSlide,
      prevSlideLocalTime: prevTimeInSlide,
      activeSegmentDuration: currentSegLen,
      prevSegmentDuration: prevSegLen,
    };
  }

  const rawP = Math.max(0, Math.min(1, timeInSlide / tDur));
  // Quintic smootherstep for ultra-smooth onset and finish with zero velocity kink
  const easedP = rawP * rawP * rawP * (rawP * (rawP * 6 - 15) + 10);

  return {
    activeIndex: currentSeg.clipIndex,
    prevIndex: prevSeg.clipIndex,
    transitionProgress: easedP,
    transitionType: tType,
    slideLocalTime: timeInSlide,
    prevSlideLocalTime: prevTimeInSlide,
    activeSegmentDuration: currentSegLen,
    prevSegmentDuration: prevSegLen,
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

export interface ResolvedOverlayWindow {
  visible: boolean;
  startSec: number;
  durationSec: number;
  endSec: number | null;
  relTime: number;
}

/**
 * Resolves overlay layer visibility and active time window:
 * - missing startSec => 0
 * - missing or <= 0 durationSec => visible until end of clipDuration
 */
export function resolveOverlayWindow(
  ov: { startSec?: number; durationSec?: number },
  localTime: number,
  clipDuration: number
): ResolvedOverlayWindow {
  const safeClipDur = Math.max(0.4, clipDuration);
  const startSec = Math.max(0, Math.min(safeClipDur - 0.1, ov.startSec ?? 0));
  const hasBoundedDur = typeof ov.durationSec === 'number' && ov.durationSec > 0;
  const durationSec = hasBoundedDur
    ? Math.max(0.4, Math.min(safeClipDur - startSec, ov.durationSec!))
    : Math.max(0.4, safeClipDur - startSec);
  const endSec = hasBoundedDur ? startSec + ov.durationSec! : null;
  const visible = localTime >= startSec && (endSec === null || localTime <= endSec);
  return {
    visible,
    startSec,
    durationSec,
    endSec,
    relTime: Math.max(0, localTime - startSec),
  };
}

export type AutoClipMode = 'auto_rhythm' | 'sequential' | 'random';
export type AutoClipRhythm = 'auto' | 'smooth' | 'beats_1' | 'beats_2' | 'beats_4' | 'mixed';
export type AutoClipTransitionStyle = 'musical' | 'dissolve' | 'cuts_only' | 'punchy';
export type AutoClipMotionLevel = 'off' | 'gentle' | 'dynamic';
export type AutoClipTargetMode = 'replace' | 'append';
export type AutoClipPresetId =
  | 'music_story'
  | 'cinema_flow'
  | 'dynamic_drop'
  | 'story_order'
  | 'remix_shuffle'
  | 'beat_flash';

export interface AutoClipGenerateConfig {
  presetId?: AutoClipPresetId;
  mode: AutoClipMode;
  rhythm: AutoClipRhythm;
  transitionStyle: AutoClipTransitionStyle;
  motionLevel: AutoClipMotionLevel;
  targetMode: AutoClipTargetMode;
  minClipSec: number;
  maxClipSec: number;
  targetDurationSec: number | null; // null = auto / full available span
  avoidAdjacentRepeat: boolean;
}

export interface AutoClipPresetDef {
  id: AutoClipPresetId;
  config: Omit<AutoClipGenerateConfig, 'presetId' | 'targetMode' | 'targetDurationSec'>;
}

export const AUTO_CLIP_PRESETS: AutoClipPresetDef[] = [
  {
    id: 'music_story',
    config: {
      mode: 'auto_rhythm',
      rhythm: 'auto',
      transitionStyle: 'musical',
      motionLevel: 'gentle',
      minClipSec: 1.0,
      maxClipSec: 5.5,
      avoidAdjacentRepeat: true,
    },
  },
  {
    id: 'cinema_flow',
    config: {
      mode: 'auto_rhythm',
      rhythm: 'smooth',
      transitionStyle: 'dissolve',
      motionLevel: 'gentle',
      minClipSec: 2.2,
      maxClipSec: 8.0,
      avoidAdjacentRepeat: true,
    },
  },
  {
    id: 'dynamic_drop',
    config: {
      mode: 'auto_rhythm',
      rhythm: 'beats_2',
      transitionStyle: 'punchy',
      motionLevel: 'dynamic',
      minClipSec: 0.75,
      maxClipSec: 3.4,
      avoidAdjacentRepeat: true,
    },
  },
  {
    id: 'story_order',
    config: {
      mode: 'sequential',
      rhythm: 'beats_4',
      transitionStyle: 'dissolve',
      motionLevel: 'gentle',
      minClipSec: 1.6,
      maxClipSec: 6.5,
      avoidAdjacentRepeat: true,
    },
  },
  {
    id: 'remix_shuffle',
    config: {
      mode: 'random',
      rhythm: 'auto',
      transitionStyle: 'musical',
      motionLevel: 'gentle',
      minClipSec: 1.0,
      maxClipSec: 4.5,
      avoidAdjacentRepeat: true,
    },
  },
  {
    id: 'beat_flash',
    config: {
      mode: 'random',
      rhythm: 'beats_1',
      transitionStyle: 'cuts_only',
      motionLevel: 'off',
      minClipSec: 0.5,
      maxClipSec: 2.2,
      avoidAdjacentRepeat: true,
    },
  },
];

export const DEFAULT_AUTO_CLIP_CONFIG: AutoClipGenerateConfig = {
  presetId: 'music_story',
  mode: 'auto_rhythm',
  rhythm: 'auto',
  transitionStyle: 'musical',
  motionLevel: 'gentle',
  targetMode: 'replace',
  minClipSec: 1.0,
  maxClipSec: 5.5,
  targetDurationSec: null,
  avoidAdjacentRepeat: true,
};

export interface AutoBeatSlicePlacement {
  binItemId: string;
  startSec: number;
  durationSec: number;
  sourceStartSec: number;
  playbackRate: number;
  transitionOut: SlideTransitionType;
  transitionDurationSec: number;
  scaleStart: number;
  scaleEnd: number;
}

/**
 * Computes a smoothed normalized energy curve [0..1] aligned to each beat index
 * across [trimStart .. trimStart + targetLimit] so Auto-Rhythm distinguishes
 * calm melodic passages from energetic rhythmic sections.
 */
export function computePhraseEnergyCurve(
  beatTimes: number[],
  trimStart: number,
  targetLimit: number,
  monoData?: Float32Array,
  sampleRate?: number
): number[] {
  const count = beatTimes.length;
  if (count === 0) return [];

  // Fallback cinematic 3-act energy arc when no audio buffer is loaded:
  // gentle calm intro -> energetic mid-section -> calm outro
  if (!monoData || monoData.length === 0 || !sampleRate || sampleRate <= 0) {
    return beatTimes.map((bt) => {
      const p = targetLimit > 0 ? Math.max(0, Math.min(1, bt / targetLimit)) : 0.5;
      if (p < 0.22) return 0.28 + (p / 0.22) * 0.22;
      if (p > 0.78) return 0.5 - ((p - 0.78) / 0.22) * 0.25;
      return 0.62 + 0.22 * Math.sin((p - 0.22) * Math.PI * 3);
    });
  }

  const rawEnergy = new Array<number>(count).fill(0);
  const totalSamples = monoData.length;

  for (let i = 0; i < count; i++) {
    const segStartRel = beatTimes[i];
    const segEndRel =
      i + 1 < count
        ? beatTimes[i + 1]
        : segStartRel + (i > 0 ? beatTimes[i] - beatTimes[i - 1] : 0.5);
    const s0 = Math.max(0, Math.min(totalSamples - 1, Math.floor((trimStart + segStartRel) * sampleRate)));
    const s1 = Math.max(s0 + 1, Math.min(totalSamples, Math.floor((trimStart + segEndRel) * sampleRate)));
    const step = Math.max(1, Math.floor((s1 - s0) / 180));

    let sqSum = 0;
    let fluxSum = 0;
    let samples = 0;
    let prev = monoData[s0];
    for (let s = s0; s < s1; s += step) {
      const v = monoData[s];
      sqSum += v * v;
      fluxSum += Math.abs(v - prev);
      prev = v;
      samples++;
    }
    const rms = Math.sqrt(sqSum / Math.max(1, samples));
    const flux = fluxSum / Math.max(1, samples);
    rawEnergy[i] = rms * 0.72 + flux * 0.28;
  }

  const sorted = [...rawEnergy].sort((a, b) => a - b);
  const lowRef = sorted[Math.floor(sorted.length * 0.12)] ?? 0;
  const highRef = sorted[Math.floor(sorted.length * 0.9)] ?? lowRef + 0.01;
  const span = Math.max(0.008, highRef - lowRef);

  const normalized = rawEnergy.map((v) => Math.max(0, Math.min(1, (v - lowRef) / span)));

  // Smooth over +-2 beats (~1 bar) so pacing changes smoothly with musical phrases
  return normalized.map((_, idx) => {
    let acc = 0;
    let w = 0;
    for (let k = -2; k <= 2; k++) {
      const j = idx + k;
      if (j >= 0 && j < normalized.length) {
        const weight = 3 - Math.abs(k);
        acc += normalized[j] * weight;
        w += weight;
      }
    }
    return w > 0 ? acc / w : 0.5;
  });
}

function subtractUsedIntervals(
  baseRange: [number, number],
  used: Array<[number, number]>,
  minLen: number
): Array<[number, number]> {
  let ranges: Array<[number, number]> = [baseRange];
  for (const [us, ue] of used) {
    const next: Array<[number, number]> = [];
    for (const [rs, re] of ranges) {
      if (ue <= rs + 0.02 || us >= re - 0.02) {
        next.push([rs, re]);
      } else {
        if (us - rs >= minLen) next.push([rs, us]);
        if (re - ue >= minLen) next.push([ue, re]);
      }
    }
    ranges = next;
  }
  return ranges;
}

/**
 * Generates an editorial beat-aligned montage in one of 3 user-selectable modes:
 * - `auto_rhythm`: analyzes musical phrase energy so calm intros/bridges play as smooth
 *   4-8 beat dissolves while drops/choruses shift into snappier rhythmic cuts.
 * - `sequential`: follows the exact order of files in Media Library and slices videos
 *   chronologically forward without jumps or repeats.
 * - `random`: non-repeating random selection across unused images and non-overlapping
 *   video intervals without back-to-back source repeats.
 *
 * Supports `startOffsetSec` for appending a 2nd auto-clip after existing clips without
 * compressing prior timeline items, plus customizable transition style, motion level,
 * min/max slice durations, and optional target span cap.
 */
export function generateAutoClipPlan(
  binItems: MediaBinItem[],
  beatGrid: TrackBeatGrid,
  manualMarkersAbs: number[],
  trimStart: number,
  maxTimelineSec: number,
  options: {
    mode?: AutoClipMode;
    rhythm?: AutoClipRhythm;
    transitionStyle?: AutoClipTransitionStyle;
    motionLevel?: AutoClipMotionLevel;
    minClipSec?: number;
    maxClipSec?: number;
    targetDurationSec?: number | null;
    startOffsetSec?: number;
    avoidAdjacentRepeat?: boolean;
    excludeUsedUrls?: Set<string>;
    excludeVideoRangesByUrl?: Map<string, Array<[number, number]>>;
    hasAudio?: boolean;
    monoData?: Float32Array;
    sampleRate?: number;
    rng?: () => number;
  } = {}
): AutoBeatSlicePlacement[] {
  if (binItems.length === 0) return [];
  const mode: AutoClipMode = options.mode ?? 'auto_rhythm';
  const rawRhythm = options.rhythm ?? 'auto';
  const rhythm: Exclude<AutoClipRhythm, 'mixed'> = rawRhythm === 'mixed' ? 'auto' : rawRhythm;
  const transitionStyle: AutoClipTransitionStyle = options.transitionStyle ?? 'musical';
  const motionLevel: AutoClipMotionLevel = options.motionLevel ?? 'gentle';
  const avoidAdjacentRepeat = options.avoidAdjacentRepeat ?? true;
  const hasAudio = options.hasAudio ?? true;
  const rng = options.rng ?? Math.random;
  const beatSec =
    beatGrid.beatSec > 0.2 && beatGrid.beatSec < 1.5 ? beatGrid.beatSec : 0.5;
  const startOffsetSec = Math.max(0, Number((options.startOffsetSec ?? 0).toFixed(2)));

  const baseLimit = hasAudio ? Math.max(0.5, maxTimelineSec) : Math.max(60, maxTimelineSec);
  const targetLimit =
    options.targetDurationSec && options.targetDurationSec > 0.5
      ? Math.min(baseLimit, startOffsetSec + options.targetDurationSec)
      : baseLimit;
  if (startOffsetSec >= targetLimit - 0.45) return [];

  const minClipBound = Math.max(
    0.45,
    Math.min(12, options.minClipSec ?? (rhythm === 'beats_1' ? 0.5 : rhythm === 'smooth' ? 1.8 : 0.95))
  );
  const maxClipBound = Math.max(
    minClipBound + 0.3,
    Math.min(20, options.maxClipSec ?? (rhythm === 'beats_1' ? 2.5 : rhythm === 'smooth' ? 8.5 : 5.5))
  );

  const manualRel = manualMarkersAbs
    .map((m) => Number((m - trimStart).toFixed(3)))
    .filter((t) => t > startOffsetSec + 0.15 && t < targetLimit - 0.15)
    .sort((a, b) => a - b);

  let baseBeats: number[];
  if (manualRel.length >= 2) {
    baseBeats = [startOffsetSec, ...manualRel];
  } else if (beatGrid.beats.length >= 2) {
    baseBeats = [
      startOffsetSec,
      ...beatGrid.beats.filter((b) => b > startOffsetSec + 0.15 && b < targetLimit - 0.15),
    ];
  } else {
    baseBeats = [startOffsetSec];
  }
  const beatTimes = Array.from(new Set(baseBeats.map((b) => Number(b.toFixed(3))))).sort(
    (a, b) => a - b
  );
  if (beatTimes.length === 0 || beatTimes[0] > startOffsetSec + 0.05) {
    beatTimes.unshift(startOffsetSec);
  }
  let lastBeat = beatTimes[beatTimes.length - 1];
  while (lastBeat + beatSec < targetLimit + beatSec * 6 && beatTimes.length < 1500) {
    lastBeat = Number((lastBeat + beatSec).toFixed(3));
    beatTimes.push(lastBeat);
  }

  const phraseEnergy = computePhraseEnergyCurve(
    beatTimes,
    trimStart,
    targetLimit,
    options.monoData,
    options.sampleRate
  );

  interface PoolImage {
    kind: 'image';
    binItem: MediaBinItem;
    used: boolean;
  }
  interface PoolVideo {
    kind: 'video';
    binItem: MediaBinItem;
    rate: number;
    seqCursor: number;
    maxEnd: number;
    freeRanges: Array<[number, number]>;
  }
  type PoolAsset = PoolImage | PoolVideo;

  const minSliceMediaSec = Math.max(0.45, minClipBound * 0.9);

  const buildPool = (respectExclusions: boolean): PoolAsset[] => {
    const out: PoolAsset[] = [];
    for (const b of binItems) {
      if (b.kind === 'image') {
        const alreadyUsed = respectExclusions && Boolean(options.excludeUsedUrls?.has(b.url));
        if (!alreadyUsed) {
          out.push({ kind: 'image', binItem: b, used: false });
        }
      } else {
        const vDur = Math.max(0.5, b.videoDuration || b.defaultDurationSec || 10);
        const rate = Math.max(0.25, Math.min(4, b.defaultPlaybackRate ?? 1.0));
        const initStart = Math.max(
          0,
          Math.min(Math.max(0, vDur - minSliceMediaSec), b.defaultSourceStartSec ?? 0)
        );
        if (vDur - initStart >= minSliceMediaSec) {
          const baseRange: [number, number] = [
            Number(initStart.toFixed(2)),
            Number(vDur.toFixed(2)),
          ];
          const usedForUrl = respectExclusions
            ? options.excludeVideoRangesByUrl?.get(b.url) || []
            : [];
          const freeRanges =
            usedForUrl.length > 0
              ? subtractUsedIntervals(baseRange, usedForUrl, minSliceMediaSec)
              : [baseRange];
          if (freeRanges.length > 0) {
            out.push({
              kind: 'video',
              binItem: b,
              rate,
              seqCursor: freeRanges[0][0],
              maxEnd: freeRanges[freeRanges.length - 1][1],
              freeRanges,
            });
          }
        }
      }
    }
    return out;
  };

  let pool = buildPool(true);
  if (pool.length === 0 && (options.excludeUsedUrls || options.excludeVideoRangesByUrl)) {
    // Fallback cleanly if appending after all source footage was already used once
    pool = buildPool(false);
  }
  if (pool.length === 0) return [];

  const canAssetFitDur = (entry: PoolAsset, dur: number): boolean => {
    if (entry.kind === 'image') return !entry.used;
    const mediaNeed = dur * entry.rate;
    if (mode === 'sequential') {
      return entry.freeRanges.some(([rs, re]) => re - Math.max(rs, entry.seqCursor) >= mediaNeed - 0.02);
    }
    return entry.freeRanges.some(([rs, re]) => re - rs >= mediaNeed - 0.02);
  };

  const getBeatStepsForIndex = (bIdx: number): { steps: number[]; energy: number } => {
    const energy = phraseEnergy[bIdx] ?? 0.5;
    let rawSteps: number[];
    if (rhythm === 'beats_1') {
      rawSteps = beatSec < 0.44 ? [2, 1] : [1, 2];
    } else if (rhythm === 'beats_2') {
      rawSteps = beatSec < 0.48 ? [3, 2, 4] : [2, 4, 1];
    } else if (rhythm === 'beats_4') {
      rawSteps = [4, 2, 1];
    } else if (rhythm === 'smooth') {
      rawSteps = energy > 0.72 ? [4, 6, 2] : [6, 8, 4, 2];
    } else if (mode === 'auto_rhythm') {
      if (energy < 0.36) {
        rawSteps = [6, 4, 8, 2];
      } else if (energy < 0.68) {
        rawSteps = bIdx % 8 === 0 ? [4, 2] : [3, 4, 2];
      } else {
        rawSteps = beatSec >= 0.62 && rng() < 0.25 ? [1, 2] : [2, 4, 1];
      }
    } else if (mode === 'sequential') {
      rawSteps = [4, 2, 6, 1];
    } else {
      const roll = rng();
      rawSteps = roll < 0.45 ? [4, 2] : roll < 0.85 ? [2, 4] : [6, 4, 2];
    }

    // Clamp candidate beat counts to respect user's minClipBound .. maxClipBound cleanly
    const minSteps = Math.max(1, Math.ceil(minClipBound / beatSec - 0.05));
    const maxSteps = Math.max(minSteps, Math.floor(maxClipBound / beatSec + 0.05));
    const clampedSet = new Set<number>();
    for (const s of rawSteps) {
      clampedSet.add(Math.max(minSteps, Math.min(maxSteps, s)));
    }
    clampedSet.add(minSteps);
    if (maxSteps > minSteps) {
      clampedSet.add(Math.round((minSteps + maxSteps) / 2));
    }
    return { steps: Array.from(clampedSet), energy };
  };

  const placements: AutoBeatSlicePlacement[] = [];
  let beatIdx = 0;
  let lastBinItemId: string | null = null;
  let seqPoolPointer = 0;
  // Cap generated segment count so browser decoders and editability stay fast & uncluttered
  const maxPlacements = 96;

  while (beatIdx < beatTimes.length - 1 && placements.length < maxPlacements) {
    const startSec = beatTimes[beatIdx];
    if (startSec >= targetLimit - 0.45) break;

    const { steps: stepCandidates, energy } = getBeatStepsForIndex(beatIdx);
    let chosenResult: {
      nextBeatIdx: number;
      dur: number;
      asset: PoolAsset;
      sourceStartSec: number;
      rate: number;
    } | null = null;

    for (const stepCount of stepCandidates) {
      const nextIdx = Math.min(beatTimes.length - 1, beatIdx + stepCount);
      if (nextIdx <= beatIdx) continue;
      const rawEnd = Math.min(targetLimit, beatTimes[nextIdx]);
      const dur = Number((rawEnd - startSec).toFixed(2));
      const minAllow = Math.max(0.45, Math.min(minClipBound * 0.85, targetLimit - startSec));
      if (dur < minAllow) continue;

      const eligible: PoolAsset[] = pool.filter((entry) => canAssetFitDur(entry, dur));
      if (eligible.length === 0) continue;

      let chosen: PoolAsset;
      if (mode === 'sequential') {
        let found: PoolAsset | null = null;
        for (let offset = 0; offset < pool.length; offset++) {
          const idx = (seqPoolPointer + offset) % pool.length;
          if (canAssetFitDur(pool[idx], dur)) {
            found = pool[idx];
            seqPoolPointer = (idx + 1) % pool.length;
            break;
          }
        }
        chosen = found || eligible[0];
      } else {
        const nonAdjacent: PoolAsset[] =
          avoidAdjacentRepeat && lastBinItemId && eligible.length > 1
            ? eligible.filter((e) => e.binItem.id !== lastBinItemId)
            : eligible;
        const poolToPick: PoolAsset[] = nonAdjacent.length > 0 ? nonAdjacent : eligible;

        if (mode === 'auto_rhythm' && energy < 0.4 && poolToPick.length > 1) {
          const calmSorted: PoolAsset[] = [...poolToPick].sort((a, b) => {
            const aSpan =
              a.kind === 'image'
                ? 6
                : Math.max(...a.freeRanges.map(([rs, re]) => re - rs), 0);
            const bSpan =
              b.kind === 'image'
                ? 6
                : Math.max(...b.freeRanges.map(([rs, re]) => re - rs), 0);
            return bSpan - aSpan;
          });
          const topHalf: PoolAsset[] = calmSorted.slice(
            0,
            Math.max(1, Math.ceil(calmSorted.length * 0.6))
          );
          chosen = topHalf[Math.floor(rng() * topHalf.length)];
        } else {
          chosen = poolToPick[Math.floor(rng() * poolToPick.length)];
        }
      }

      if (chosen.kind === 'image') {
        chosenResult = {
          nextBeatIdx: nextIdx,
          dur,
          asset: chosen,
          sourceStartSec: 0,
          rate: 1.0,
        };
      } else if (mode === 'sequential') {
        const mediaNeed = dur * chosen.rate;
        let rangePicked: [number, number] | null = null;
        for (const [rs, re] of chosen.freeRanges) {
          const startAt = Math.max(rs, chosen.seqCursor);
          if (re - startAt >= mediaNeed - 0.02) {
            rangePicked = [startAt, re];
            break;
          }
        }
        const [rs, re] = rangePicked || chosen.freeRanges[0];
        const avail = Math.max(0, re - rs);
        const clampedNeed = Math.min(mediaNeed, avail);
        const srcStart = Number(rs.toFixed(2));
        chosen.seqCursor = Number((srcStart + clampedNeed).toFixed(2));
        const effectiveDur = Number(Math.min(dur, clampedNeed / chosen.rate).toFixed(2));
        chosenResult = {
          nextBeatIdx: nextIdx,
          dur: Math.max(0.45, effectiveDur),
          asset: chosen,
          sourceStartSec: srcStart,
          rate: chosen.rate,
        };
      } else {
        const mediaNeed = dur * chosen.rate;
        const fittingRanges: number[] = [];
        for (let r = 0; r < chosen.freeRanges.length; r++) {
          const [rs, re] = chosen.freeRanges[r];
          if (re - rs >= mediaNeed - 0.02) fittingRanges.push(r);
        }
        const pickedRangeIdx = fittingRanges[Math.floor(rng() * fittingRanges.length)];
        const [rs, re] = chosen.freeRanges[pickedRangeIdx];
        const clampedNeed = Math.min(mediaNeed, re - rs);
        const slack = Math.max(0, re - rs - clampedNeed);
        const srcStart = Number((rs + rng() * slack).toFixed(2));
        const srcEnd = Number((srcStart + clampedNeed).toFixed(2));

        chosen.freeRanges.splice(pickedRangeIdx, 1);
        if (srcStart - rs >= minSliceMediaSec) {
          chosen.freeRanges.push([rs, srcStart]);
        }
        if (re - srcEnd >= minSliceMediaSec) {
          chosen.freeRanges.push([srcEnd, re]);
        }

        const effectiveDur = Number(Math.min(dur, clampedNeed / chosen.rate).toFixed(2));
        chosenResult = {
          nextBeatIdx: nextIdx,
          dur: Math.max(0.45, effectiveDur),
          asset: chosen,
          sourceStartSec: srcStart,
          rate: chosen.rate,
        };
      }
      break;
    }

    if (!chosenResult) {
      break;
    }

    if (chosenResult.asset.kind === 'image') {
      chosenResult.asset.used = true;
    }

    let trType: SlideTransitionType;
    if (chosenResult.asset.binItem.defaultTransitionOut) {
      trType = chosenResult.asset.binItem.defaultTransitionOut;
    } else if (transitionStyle === 'dissolve') {
      trType = 'crossfade';
    } else if (transitionStyle === 'cuts_only') {
      trType = 'cut';
    } else if (transitionStyle === 'punchy') {
      trType = placements.length % 3 === 2 ? 'zoom_cross' : 'cut';
    } else if (mode === 'auto_rhythm') {
      if (energy < 0.42 || rhythm === 'smooth') {
        trType = 'crossfade';
      } else if (energy >= 0.75) {
        trType = placements.length % 4 === 3 ? 'zoom_cross' : 'cut';
      } else {
        trType = placements.length % 2 === 0 ? 'crossfade' : 'cut';
      }
    } else if (mode === 'sequential') {
      trType = chosenResult.dur >= 2.0 ? 'crossfade' : 'cut';
    } else if (rhythm === 'smooth' || chosenResult.dur >= 2.4) {
      trType = 'crossfade';
    } else if (rhythm === 'beats_1') {
      trType = 'cut';
    } else {
      const roll = rng();
      trType = roll < 0.58 ? 'crossfade' : roll < 0.88 ? 'cut' : 'zoom_cross';
    }

    const idealTrans =
      trType === 'cut'
        ? 0.08
        : Number(
            Math.max(
              0.18,
              Math.min(
                transitionStyle === 'dissolve' || energy < 0.45 || rhythm === 'smooth' ? 0.85 : 0.48,
                chosenResult.dur * 0.34
              )
            ).toFixed(2)
          );

    const isImage = chosenResult.asset.kind === 'image';
    let scaleEnd = 1.0;
    if (motionLevel === 'gentle') {
      scaleEnd = isImage
        ? chosenResult.dur >= 2.2
          ? 1.035
          : 1.02
        : mode === 'auto_rhythm' && energy < 0.38
          ? 1.015
          : 1.0;
    } else if (motionLevel === 'dynamic') {
      scaleEnd = isImage ? (chosenResult.dur >= 2.2 ? 1.06 : 1.035) : 1.02;
    }

    placements.push({
      binItemId: chosenResult.asset.binItem.id,
      startSec: Number(startSec.toFixed(2)),
      durationSec: chosenResult.dur,
      sourceStartSec: chosenResult.sourceStartSec,
      playbackRate: chosenResult.rate,
      transitionOut: trType,
      transitionDurationSec: idealTrans,
      scaleStart: 1.0,
      scaleEnd,
    });

    lastBinItemId = chosenResult.asset.binItem.id;
    beatIdx = chosenResult.nextBeatIdx;
  }

  return placements;
}

/**
 * Backwards-compatible wrapper defaulting to random non-repeating mode.
 */
export function generateRandomBeatAutoClips(
  binItems: MediaBinItem[],
  beatGrid: TrackBeatGrid,
  manualMarkersAbs: number[],
  trimStart: number,
  maxTimelineSec: number,
  options: {
    rhythm?: AutoClipRhythm;
    hasAudio?: boolean;
    monoData?: Float32Array;
    sampleRate?: number;
    rng?: () => number;
  } = {}
): AutoBeatSlicePlacement[] {
  return generateAutoClipPlan(
    binItems,
    beatGrid,
    manualMarkersAbs,
    trimStart,
    maxTimelineSec,
    { ...options, mode: 'random' }
  );
}



