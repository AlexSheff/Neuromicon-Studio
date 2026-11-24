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
  let prevSpec: Float32Array | null = null;

  for (let t = 0.2; t < clipDuration - 0.3; t += stepSec) {
    const metrics = analyzeAudioAtTime(mono, sampleRate, trimStart + t, sensitivity);
    let specDelta = 0;
    if (prevSpec) {
      for (let b = 3; b < Math.min(36, metrics.spectrum.length); b++) {
        specDelta += Math.abs(metrics.spectrum[b] - prevSpec[b]);
      }
      specDelta = Math.min(1.0, specDelta / 6);
    }
    prevSpec = metrics.spectrum.slice();
    const energy =
      metrics.bass * 0.56 + metrics.mid * 0.18 + metrics.rms * 0.14 + specDelta * 0.28;
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

  // 3. Fallback: pick largest available gap or clamp cleanly inside maxTimelineSec
  const largestGap = [...gaps].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  if (largestGap && largestGap.end - largestGap.start >= 0.45) {
    return {
      startSec: Number(largestGap.start.toFixed(2)),
      durationSec: Number(Math.max(0.4, Math.min(dur, largestGap.end - largestGap.start)).toFixed(2)),
    };
  }

  const clampedStart = Math.min(maxTimelineSec, cursor);
  const room = Math.max(0, maxTimelineSec - clampedStart);
  return {
    startSec: Number(clampedStart.toFixed(2)),
    durationSec: Number(Math.min(dur, room).toFixed(2)),
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
  let nextDur = Number(Math.max(0.4, Math.min(maxAllowedDur, desiredDurationSec)).toFixed(2));

  const simulatePush = (durCandidate: number) => {
    const startMap = new Map<string, number>();
    let cursor = Number((target.startSec + durCandidate).toFixed(2));
    for (let i = idx + 1; i < intervals.length; i++) {
      const item = intervals[i];
      if (item.startSec < cursor - 0.001) {
        startMap.set(item.id, cursor);
        cursor = Number((cursor + item.durationSec).toFixed(2));
      } else {
        cursor = Number(Math.max(cursor, item.endSec).toFixed(2));
      }
    }
    return { startMap, finalEnd: cursor };
  };

  let sim = simulatePush(nextDur);
  // If extending overlaps downstream clips past maxTimelineSec, shrink expansion to stay inside music track
  if (sim.finalEnd > maxTimelineSec + 0.005) {
    const excess = sim.finalEnd - maxTimelineSec;
    nextDur = Number(Math.max(0.4, nextDur - excess).toFixed(2));
    sim = simulatePush(nextDur);
  }

  return mediaItems
    .map((m) => {
      if (m.id === clipId) {
        const clampedDur = Number(
          Math.max(0.4, Math.min(nextDur, Math.max(0.4, maxTimelineSec - target.startSec))).toFixed(2)
        );
        return {
          ...m,
          startSec: Number(target.startSec.toFixed(2)),
          durationSec: clampedDur,
        };
      }
      const shiftedStart = sim.startMap.get(m.id);
      if (shiftedStart !== undefined) {
        if (shiftedStart >= maxTimelineSec - 0.4) {
          return null;
        }
        const avail = Math.max(0.4, maxTimelineSec - shiftedStart);
        return {
          ...m,
          startSec: shiftedStart,
          durationSec: Number(Math.min(m.durationSec || 4, avail).toFixed(2)),
        };
      }
      return m;
    })
    .filter((m): m is VisualMediaState => m !== null);
}

/**
 * Inserts a new clip into a manual timeline anchored right after `anchorStartSec` (playhead).
 * If an existing clip spans `anchorStartSec` with >= 0.4s to the left, its right tail is trimmed
 * to `anchorStartSec` (no split/duplication) and the new clip starts cleanly at `anchorStartSec`.
 * Any existing clip starting near/after `anchorStartSec` shifts right without overflowing `maxTimelineSec`.
 */
export function insertManualClipAtAnchor(
  mediaItems: VisualMediaState[],
  newClip: VisualMediaState,
  anchorStartSec: number,
  maxTimelineSec = 3600
): VisualMediaState[] {
  const clampedAnchor = Math.max(
    0,
    Math.min(Math.max(0, maxTimelineSec - 0.45), anchorStartSec)
  );
  const startSec = Number(clampedAnchor.toFixed(2));
  const roomForNew = Math.max(0.4, maxTimelineSec - startSec);
  const newDur = Number(
    Math.max(0.4, Math.min(600, roomForNew, newClip.durationSec || 4)).toFixed(2)
  );
  const insertedEnd = Number((startSec + newDur).toFixed(2));

  const placedNewClip: VisualMediaState = {
    ...newClip,
    startSec,
    durationSec: newDur,
  };

  if (mediaItems.length === 0) {
    return [placedNewClip];
  }

  const intervals = getNormalizedManualClipIntervals(mediaItems);
  const patchById = new Map<string, { startSec: number; durationSec?: number }>();
  const dropIds = new Set<string>();
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
      if (nextStart >= maxTimelineSec - 0.4) {
        dropIds.add(iv.id);
      } else {
        const clampedDur = Number(
          Math.max(0.4, Math.min(iv.durationSec, maxTimelineSec - nextStart)).toFixed(2)
        );
        patchById.set(iv.id, {
          startSec: nextStart,
          ...(clampedDur < iv.durationSec - 0.01 ? { durationSec: clampedDur } : {}),
        });
        downstreamCursor = Number((nextStart + clampedDur).toFixed(2));
      }
    }
  }

  const updatedExisting = mediaItems
    .filter((m) => !dropIds.has(m.id))
    .map((m) => {
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
  downbeatOffset?: number; // index offset (0..3) marking musical bar-1 downbeats
}

/**
 * Estimates track tempo (BPM) from 3-band perceptual onset flux (sub-bass kick + mid melody/snare + high attack)
 * with local adaptive baseline subtraction, harmonic comb autocorrelation, and transient-locked phase alignment.
 */
export function detectTrackBpmAndBeats(
  mono: Float32Array,
  sampleRate: number,
  trimStart: number,
  trimEnd: number,
  sensitivity: number
): TrackBeatGrid {
  const clipDuration = Math.max(0.5, trimEnd - trimStart);
  if (mono.length === 0 || sampleRate <= 0) {
    return { bpm: 0, beatSec: 0.5, beats: [] };
  }

  const hopSec = 0.01; // 100 Hz (10ms transient & tempo precision)
  const sampleWin = Math.max(64, Math.floor(sampleRate * hopSec));
  const startIdx = Math.max(0, Math.floor(trimStart * sampleRate));
  const totalSteps = Math.max(16, Math.floor(clipDuration / hopSec));
  const rawOnsets = new Float32Array(totalSteps);

  // Two cascaded 1-pole crossover cutoffs for bass (<~180 Hz) & mid (~180..2200 Hz)
  const alphaLow = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate);
  const alphaMid = 1 - Math.exp((-2 * Math.PI * 2200) / sampleRate);
  let lpLow = 0;
  let lpMid = 0;
  let prevLowLog = 0;
  let prevMidLog = 0;
  let prevHighLog = 0;
  let maxRawOnset = 0;

  for (let s = 0; s < totalSteps; s++) {
    const base = startIdx + s * sampleWin;
    if (base >= mono.length) break;
    const end = Math.min(mono.length, base + sampleWin);
    const count = Math.max(1, end - base);

    let lowSq = 0;
    let midSq = 0;
    let highSq = 0;
    for (let i = base; i < end; i++) {
      const v = mono[i];
      lpLow += (v - lpLow) * alphaLow;
      lpMid += (v - lpMid) * alphaMid;
      const midBand = lpMid - lpLow;
      const highBand = v - lpMid;
      lowSq += lpLow * lpLow;
      midSq += midBand * midBand;
      highSq += highBand * highBand;
    }

    const lowLog = Math.log1p(14 * Math.sqrt(lowSq / count));
    const midLog = Math.log1p(16 * Math.sqrt(midSq / count));
    const highLog = Math.log1p(18 * Math.sqrt(highSq / count));

    const lowFlux = Math.max(0, lowLog - prevLowLog * 0.96);
    const midFlux = Math.max(0, midLog - prevMidLog * 0.94);
    const highFlux = Math.max(0, highLog - prevHighLog * 0.92);
    prevLowLog = lowLog;
    prevMidLog = midLog;
    prevHighLog = highLog;

    const flux = (lowFlux * 0.48 + midFlux * 0.36 + highFlux * 0.16) * sensitivity;
    rawOnsets[s] = flux;
    if (flux > maxRawOnset) maxRawOnset = flux;
  }

  if (maxRawOnset < 0.002) {
    return { bpm: 0, beatSec: 0.5, beats: [] };
  }

  // Adaptive local baseline subtraction (±0.24s) sharpens real musical hits over sustained chords/drones
  const onsets = new Float32Array(totalSteps);
  const halfWin = Math.max(6, Math.round(0.24 / hopSec));
  let onsetSum = 0;
  let nonzeroCount = 0;
  for (let s = 0; s < totalSteps; s++) {
    const w0 = Math.max(0, s - halfWin);
    const w1 = Math.min(totalSteps - 1, s + halfWin);
    let sum = 0;
    for (let k = w0; k <= w1; k++) sum += rawOnsets[k];
    const localMean = sum / Math.max(1, w1 - w0 + 1);
    const val = Math.max(0, rawOnsets[s] - localMean * 0.76);
    onsets[s] = val;
    if (val > 0) {
      onsetSum += val;
      nonzeroCount++;
    }
  }
  const activeOnsetMean = nonzeroCount > 0 ? onsetSum / nonzeroCount : maxRawOnset * 0.25;

  // Autocorrelation across 66..184 BPM with octave comb scoring to eliminate half/double-time drift
  const minLag = Math.max(16, Math.round(60 / 184 / hopSec));
  const maxLag = Math.min(Math.floor(totalSteps / 2), Math.round(60 / 66 / hopSec));
  const acf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const len = totalSteps - lag;
    for (let i = 0; i < len; i++) {
      sum += onsets[i] * onsets[i + lag];
    }
    acf[lag] = len > 0 ? sum / len : 0;
  }

  let bestLag = Math.round(0.5 / hopSec);
  let bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const candBpm = 60 / (lag * hopSec);
    const halfLag = Math.round(lag / 2);
    const doubleLag = lag * 2;
    const harmonicSupport =
      acf[lag] +
      (doubleLag <= maxLag ? acf[doubleLag] * 0.35 : 0) +
      (halfLag >= minLag ? acf[halfLag] * 0.18 : 0);
    const tempoPrior =
      candBpm >= 88 && candBpm <= 142 ? 1.15 : candBpm >= 72 && candBpm <= 165 ? 1.03 : 0.94;
    const score = harmonicSupport * tempoPrior;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // Parabolic interpolation around bestLag for sub-frame initial BPM estimate
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = acf[bestLag - 1];
    const y1 = acf[bestLag];
    const y2 = acf[bestLag + 1];
    const denom = 2 * (y0 - 2 * y1 + y2);
    if (Math.abs(denom) > 1e-9) {
      const shift = Math.max(-0.5, Math.min(0.5, (y0 - y2) / denom));
      refinedLag = bestLag + shift;
    }
  }

  const coarseBpm = Math.max(60, Math.min(188, 60 / (refinedLag * hopSec)));

  // Fine period + phase comb sweep (±2.4 BPM in 0.15 BPM steps) so fractional tempos lock tightly end-to-end
  let lockedBpm = coarseBpm;
  let bestPhase = 0;
  let bestCombScore = -1;
  const fineStepCount = 16;
  const fineDeltaBpm = 0.15;
  const approxBeatSec = 60 / coarseBpm;
  const phaseSteps = Math.max(1, Math.min(totalSteps, Math.round((approxBeatSec * 1.15) / hopSec)));
  const phaseStride = phaseSteps > 64 ? 2 : 1;

  for (let bi = -fineStepCount; bi <= fineStepCount; bi++) {
    const candBpm = Math.max(60, Math.min(188, coarseBpm + bi * fineDeltaBpm));
    const candBeatSec = 60 / candBpm;
    for (let ph = 0; ph < phaseSteps; ph += phaseStride) {
      let score = 0;
      let hits = 0;
      for (let t = ph * hopSec; t < clipDuration; t += candBeatSec) {
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
      if (avgScore > bestCombScore) {
        bestCombScore = avgScore;
        bestPhase = ph * hopSec;
        lockedBpm = candBpm;
      }
    }
  }

  // Final single-hop phase refinement around winning BPM & phase
  const lockedBeatSec = Number((60 / lockedBpm).toFixed(5));
  const phCenter = Math.round(bestPhase / hopSec);
  let refinedPhaseScore = -1;
  for (let d = -2; d <= 2; d++) {
    const phIdx = Math.max(0, Math.min(phaseSteps - 1, phCenter + d));
    let score = 0;
    let hits = 0;
    for (let t = phIdx * hopSec; t < clipDuration; t += lockedBeatSec) {
      const idx = Math.min(totalSteps - 1, Math.round(t / hopSec));
      score += onsets[idx];
      hits++;
    }
    const avgScore = hits > 0 ? score / hits : 0;
    if (avgScore > refinedPhaseScore) {
      refinedPhaseScore = avgScore;
      bestPhase = phIdx * hopSec;
    }
  }

  const bpm = Math.round(lockedBpm);
  const beatSec = lockedBeatSec;

  // Adaptive transient-locked PLL tracker: snaps each beat to real onset attacks and steers phase smoothly
  const beats: number[] = [];
  const searchRadiusSteps = Math.max(
    4,
    Math.round(Math.min(0.085, beatSec * 0.16) / hopSec)
  );
  const pllSteerThreshold = Math.max(0.015, activeOnsetMean * 0.72);
  let expectedT = bestPhase;

  while (expectedT < clipDuration - 0.04) {
    const centerIdx = Math.round(expectedT / hopSec);
    let bestPeakIdx = Math.max(0, Math.min(totalSteps - 1, centerIdx));
    let bestPeakWeighted = -1;
    let bestPeakRaw = onsets[bestPeakIdx] || 0;

    for (let d = -searchRadiusSteps; d <= searchRadiusSteps; d++) {
      const idx = Math.max(0, Math.min(totalSteps - 1, centerIdx + d));
      const proxWeight = 1 - Math.abs(d) / (searchRadiusSteps * 2.2);
      const weighted = onsets[idx] * proxWeight;
      if (weighted > bestPeakWeighted) {
        bestPeakWeighted = weighted;
        bestPeakIdx = idx;
        bestPeakRaw = onsets[idx];
      }
    }

    const snapped = Number((bestPeakIdx * hopSec).toFixed(3));
    if (beats.length === 0 || snapped - beats[beats.length - 1] > beatSec * 0.48) {
      beats.push(snapped);
    }

    if (bestPeakRaw >= pllSteerThreshold) {
      const err = snapped - expectedT;
      expectedT += beatSec + err * 0.34;
    } else {
      expectedT += beatSec;
    }
  }

  // Score modulo-4 bar phase so downbeatOffset aligns with real musical 4/4 bar 1
  const barScores = [0, 0, 0, 0];
  for (let i = 0; i < beats.length; i++) {
    const stepIdx = Math.max(0, Math.min(totalSteps - 1, Math.round(beats[i] / hopSec)));
    barScores[i % 4] += onsets[stepIdx] || 0;
  }
  let downbeatOffset = 0;
  for (let k = 1; k < 4; k++) {
    if (barScores[k] > barScores[downbeatOffset]) {
      downbeatOffset = k;
    }
  }

  return { bpm, beatSec, beats, downbeatOffset };
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
 * to musical beats & melodic phrase turns across [0..clipDuration], strictly <= clipDuration.
 */
export function computeAutoBeatAlignedClips(
  clipCount: number,
  clipDuration: number,
  beatGrid: TrackBeatGrid,
  manualMarkersAbs: number[],
  trimStart: number,
  mode: BeatSyncMode = 'fit_track',
  monoData?: Float32Array,
  sampleRate?: number
): BeatAlignedClipPlan[] {
  if (clipCount <= 0 || clipDuration < 0.4) return [];
  const beatSec = beatGrid.beatSec > 0.2 && beatGrid.beatSec < 1.5 ? beatGrid.beatSec : 0.5;
  const rhythmicTransitions: SlideTransitionType[] = ['cut', 'crossfade', 'cut', 'zoom_cross'];

  const makeMotionAndTrans = (idx: number, dur: number): BeatAlignedClipPlan => {
    const tr = rhythmicTransitions[idx % rhythmicTransitions.length];
    const idealTrans =
      tr === 'cut'
        ? 0
        : Math.max(0.14, Math.min(dur >= 2.8 ? 0.52 : 0.28, beatSec * 0.44, dur * 0.28));
    // Gentle unidirectional drift avoids alternating yo-yo zoom bounce between cuts
    const scaleSpan = dur >= 2.2 ? 1.035 : 1.02;
    return {
      durationSec: Number(dur.toFixed(2)),
      transitionDurationSec: Number(idealTrans.toFixed(2)),
      suggestedTransition: tr,
      suggestedScaleStart: 1.0,
      suggestedScaleEnd: scaleSpan,
    };
  };

  if (mode !== 'fit_track') {
    const beatMult =
      mode === 'beats_1' ? 1 : mode === 'beats_2' ? 2 : mode === 'beats_8' ? 8 : 4;
    const detectedGrid =
      beatGrid.beats.length >= 2
        ? [0, ...beatGrid.beats.filter((b) => b > 0.2 && b < clipDuration - 0.15)]
        : null;
    const plans: BeatAlignedClipPlan[] = [];
    let cursor = 0;
    let gridIdx = 0;
    for (let i = 0; i < clipCount; i++) {
      const remaining = Number((clipDuration - cursor).toFixed(2));
      if (remaining < 0.4) break;
      let targetEnd: number;
      if (detectedGrid && gridIdx + beatMult < detectedGrid.length) {
        gridIdx += beatMult;
        targetEnd = Math.min(clipDuration, detectedGrid[gridIdx]);
      } else {
        targetEnd = Math.min(clipDuration, cursor + Math.max(0.5, Math.min(30, beatSec * beatMult)));
      }
      const d = Number(Math.max(0.4, Math.min(30, targetEnd - cursor)).toFixed(2));
      plans.push(makeMotionAndTrans(i, Math.min(d, remaining)));
      cursor = Number((cursor + Math.min(d, remaining)).toFixed(2));
    }
    return plans;
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
    // Score beats by transient onset, melodic/harmonic novelty, and 4/4 downbeat phase
    const accents =
      monoData && monoData.length > 0 && sampleRate && sampleRate > 0
        ? computeBeatMusicalAccents(uniqueGrid, trimStart, monoData, sampleRate)
        : null;
    const downbeatShift = beatGrid.downbeatOffset ?? 0;
    const step = (uniqueGrid.length - 1) / clipCount;
    const cutPoints: number[] = [0];

    for (let i = 1; i < clipCount; i++) {
      const targetIdx = Math.min(uniqueGrid.length - 1, Math.max(i, Math.round(i * step)));
      const prev = cutPoints[cutPoints.length - 1];
      let chosenIdx = targetIdx;
      let bestScore = -1;
      const minIdx = Math.max(i, targetIdx - 2);
      const maxIdx = Math.min(uniqueGrid.length - (clipCount - i), targetIdx + 2);
      for (let cIdx = minIdx; cIdx <= maxIdx; cIdx++) {
        const candTime = uniqueGrid[cIdx];
        if (candTime <= prev + 0.45) continue;
        const barBonus = ((cIdx - downbeatShift) % 4 + 4) % 4 === 0 ? 0.22 : cIdx % 2 === 0 ? 0.08 : 0;
        const musicalScore = accents
          ? (accents.onsetAccent[cIdx] ?? 0.4) * 0.45 +
            (accents.melodicNovelty[cIdx] ?? 0.35) * 0.55
          : 0.4;
        const distPenalty = Math.abs(cIdx - targetIdx) * 0.09;
        const totalScore = musicalScore + barBonus - distPenalty;
        if (totalScore > bestScore) {
          bestScore = totalScore;
          chosenIdx = cIdx;
        }
      }
      const candidate = uniqueGrid[chosenIdx];
      cutPoints.push(
        candidate > prev + 0.45
          ? Math.min(clipDuration - 0.4 * (clipCount - i), candidate)
          : Number((prev + Math.max(0.45, Math.min(beatSec, (clipDuration - prev) / (clipCount - i + 1)))).toFixed(2))
      );
    }
    cutPoints.push(clipDuration);

    return Array.from({ length: clipCount }, (_, i) => {
      const rawDur = Math.max(0.4, Math.min(30, cutPoints[i + 1] - cutPoints[i]));
      return makeMotionAndTrans(i, rawDur);
    });
  }

  // Fallback: quantize target duration per clip to integer number of beats while keeping total <= clipDuration
  const rawPerClip = clipDuration / clipCount;
  const beatsPerClip = Math.max(1, Math.floor(rawPerClip / beatSec) || Math.round(rawPerClip / beatSec));
  const quantizedDur = Math.max(0.4, Math.min(rawPerClip, beatsPerClip * beatSec));

  const plans: BeatAlignedClipPlan[] = [];
  let remaining = clipDuration;
  for (let i = 0; i < clipCount; i++) {
    if (remaining < 0.4) break;
    const isLast = i === clipCount - 1;
    const d = isLast ? Math.min(30, remaining) : Math.min(quantizedDur, remaining);
    plans.push(makeMotionAndTrans(i, d));
    remaining = Number((remaining - d).toFixed(3));
  }
  return plans;
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

function normalizeScores01(arr: number[]): number[] {
  if (arr.length === 0) return [];
  const sorted = [...arr].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const high = sorted[Math.floor(sorted.length * 0.94)] ?? low + 0.01;
  const span = Math.max(0.005, high - low);
  return arr.map((v) => Math.max(0, Math.min(1, (v - low) / span)));
}

/**
 * Computes per-beat onset transient accent [0..1] and FFT-based melodic/harmonic novelty [0..1]
 * across beats so cut points lock onto both rhythmic kicks/snares and pitch/chord shifts.
 */
export function computeBeatMusicalAccents(
  beatTimes: number[],
  trimStart: number,
  monoData?: Float32Array,
  sampleRate?: number
): { onsetAccent: number[]; melodicNovelty: number[] } {
  const count = beatTimes.length;
  if (count === 0) return { onsetAccent: [], melodicNovelty: [] };

  if (!monoData || monoData.length === 0 || !sampleRate || sampleRate <= 0) {
    return {
      onsetAccent: beatTimes.map((_, i) => (i % 4 === 0 ? 0.95 : i % 2 === 0 ? 0.65 : 0.35)),
      melodicNovelty: beatTimes.map((_, i) => (i % 8 === 0 ? 0.9 : i % 4 === 0 ? 0.6 : 0.25)),
    };
  }

  const ACCENT_FFT_SIZE = 2048;
  const fft = new Radix2FFT(ACCENT_FFT_SIZE);
  const slice = new Float32Array(ACCENT_FFT_SIZE);
  const mags = new Float32Array(ACCENT_FFT_SIZE >> 1);
  const hann = new Float32Array(ACCENT_FFT_SIZE);
  for (let i = 0; i < ACCENT_FFT_SIZE; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (ACCENT_FFT_SIZE - 1)));
  }

  const BANDS = 24;
  const CHROMA = 12;
  const minFreq = 55;
  const maxFreq = Math.min(8000, sampleRate * 0.45);
  const logMin = Math.log(minFreq);
  const logMax = Math.log(Math.max(minFreq * 2, maxFreq));
  const binHz = sampleRate / ACCENT_FFT_SIZE;
  const maxChromaFreq = Math.min(3600, sampleRate * 0.42);
  const minChromaBin = Math.max(1, Math.floor(75 / binHz));
  const maxChromaBin = Math.min(mags.length - 1, Math.ceil(maxChromaFreq / binHz));

  const beatSpectra: Float32Array[] = new Array(count);
  const beatChromas: Float32Array[] = new Array(count);
  const rawOnset = new Array<number>(count).fill(0);
  const rawMelody = new Array<number>(count).fill(0);
  const totalSamples = monoData.length;

  for (let i = 0; i < count; i++) {
    const bt = beatTimes[i];
    const centerSample = Math.max(0, Math.min(totalSamples - 1, Math.floor((trimStart + bt) * sampleRate)));

    // 1. Transient jump across beat onset (±30ms pre vs post RMS delta)
    const winSamp = Math.max(64, Math.floor(sampleRate * 0.03));
    const pre0 = Math.max(0, centerSample - winSamp);
    const post1 = Math.min(totalSamples, centerSample + winSamp);
    let preSq = 0;
    for (let s = pre0; s < centerSample; s++) preSq += monoData[s] * monoData[s];
    let postSq = 0;
    for (let s = centerSample; s < post1; s++) postSq += monoData[s] * monoData[s];
    const preRms = Math.sqrt(preSq / Math.max(1, centerSample - pre0));
    const postRms = Math.sqrt(postSq / Math.max(1, post1 - centerSample));
    rawOnset[i] = Math.max(0, postRms - preRms * 0.8) + postRms * 0.35;

    // 2. Melodic chroma + harmonic spectrum inside the beat body (+40ms after transient)
    const segNext = i + 1 < count ? beatTimes[i + 1] : bt + 0.5;
    const bodyCenterTime = trimStart + bt + Math.min(0.12, Math.max(0.02, (segNext - bt) * 0.35));
    const sStart = Math.max(0, Math.floor(bodyCenterTime * sampleRate) - (ACCENT_FFT_SIZE >> 1));
    for (let k = 0; k < ACCENT_FFT_SIZE; k++) {
      const idx = sStart + k;
      slice[k] = (idx < totalSamples ? monoData[idx] : 0) * hann[k];
    }
    fft.computeMagnitudes(slice, mags);

    const bands = new Float32Array(BANDS);
    let norm = 1e-6;
    for (let b = 0; b < BANDS; b++) {
      const f0 = Math.exp(logMin + ((logMax - logMin) * b) / BANDS);
      const f1 = Math.exp(logMin + ((logMax - logMin) * (b + 1)) / BANDS);
      const k0 = Math.max(1, Math.floor(f0 / binHz));
      const k1 = Math.min(mags.length - 1, Math.max(k0, Math.ceil(f1 / binHz)));
      let sum = 0;
      for (let k = k0; k <= k1; k++) sum += mags[k];
      const val = Math.log1p(12 * (sum / Math.max(1, k1 - k0 + 1)));
      bands[b] = val;
      norm += val * val;
    }
    const invNorm = 1 / Math.sqrt(norm);
    for (let b = 0; b < BANDS; b++) bands[b] *= invNorm;
    beatSpectra[i] = bands;

    // 12-semitone Pitch-Class Chroma for chord/melody harmonic turn sensitivity
    const chroma = new Float32Array(CHROMA);
    for (let k = minChromaBin; k <= maxChromaBin; k++) {
      const freq = k * binHz;
      if (freq <= 0) continue;
      const semitone = Math.round(12 * Math.log2(freq / 440));
      const pitchClass = ((semitone % 12) + 12) % 12;
      chroma[pitchClass] += mags[k];
    }
    let cNorm = 1e-6;
    for (let c = 0; c < CHROMA; c++) cNorm += chroma[c] * chroma[c];
    const invCNorm = 1 / Math.sqrt(cNorm);
    for (let c = 0; c < CHROMA; c++) chroma[c] *= invCNorm;
    beatChromas[i] = chroma;

    if (i > 0) {
      const prev = beatSpectra[i - 1];
      let cos = 0;
      let melodicShift = 0;
      for (let b = 0; b < BANDS; b++) {
        cos += bands[b] * prev[b];
        const w = b >= 4 && b <= 20 ? 1.4 : 0.6;
        melodicShift += Math.abs(bands[b] - prev[b]) * w;
      }
      const prevChroma = beatChromas[i - 1];
      let chromaCos = 0;
      for (let c = 0; c < CHROMA; c++) {
        chromaCos += chroma[c] * prevChroma[c];
      }
      const specChange = Math.max(0, 1 - cos) * 0.6 + melodicShift * 0.4;
      const chromaChange = Math.max(0, 1 - chromaCos);
      rawMelody[i] = chromaChange * 0.55 + specChange * 0.45;
    }
  }

  return {
    onsetAccent: normalizeScores01(rawOnset),
    melodicNovelty: normalizeScores01(rawMelody),
  };
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
 * Generates an editorial beat- and melody-aligned montage in one of 3 user-selectable modes:
 * - `auto_rhythm`: analyzes phrase energy, beat transients, and harmonic/melodic shifts so
 *   calm passages dissolve smoothly and rhythmic/melodic turns cut cleanly on real beats.
 * - `sequential`: follows Media Library order chronologically without jumps.
 * - `random`: non-repeating random selection across unused images and non-overlapping
 *   video intervals without back-to-back source repeats.
 *
 * Strictly enforces `<= maxTimelineSec` when `hasAudio` is true, and when `fillToTargetEnd`
 * is enabled extends cleanly all the way to `targetLimit` without leaving bare trailing music.
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
    fillToTargetEnd?: boolean;
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
  const fillToTargetEnd = options.fillToTargetEnd ?? false;
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
  let barAnchorIdx = 0;
  if (manualRel.length >= 2) {
    baseBeats = [startOffsetSec, ...manualRel];
    barAnchorIdx = manualRel[0] > startOffsetSec + 0.05 ? 1 : 0;
  } else if (beatGrid.beats.length >= 2) {
    const filteredIdx = beatGrid.beats.findIndex(
      (b) => b > startOffsetSec + 0.15 && b < targetLimit - 0.15
    );
    const filtered = beatGrid.beats.filter(
      (b) => b > startOffsetSec + 0.15 && b < targetLimit - 0.15
    );
    baseBeats = [startOffsetSec, ...filtered];
    const gridDownbeat = beatGrid.downbeatOffset ?? 0;
    if (filteredIdx >= 0) {
      // Shift anchor so modulo-4 bar downbeats align to detected musical bar 1 even if startOffsetSec was prepended
      const offsetInFiltered = ((gridDownbeat - filteredIdx) % 4 + 4) % 4;
      barAnchorIdx = (filtered[0] > startOffsetSec + 0.05 ? 1 : 0) + offsetInFiltered;
    }
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
  while (lastBeat + beatSec < targetLimit + beatSec * 6 && beatTimes.length < 2400) {
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
  const { onsetAccent, melodicNovelty } = computeBeatMusicalAccents(
    beatTimes,
    trimStart,
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
    initStart: number;
    vDur: number;
    freeRanges: Array<[number, number]>;
  }
  type PoolAsset = PoolImage | PoolVideo;

  const minSliceMediaSec = Math.max(0.45, minClipBound * 0.9);

  const buildPool = (respectExclusions: boolean, allowShortLoopFallback = false): PoolAsset[] => {
    const out: PoolAsset[] = [];
    for (const b of binItems) {
      if (b.kind === 'image') {
        const alreadyUsed = respectExclusions && Boolean(options.excludeUsedUrls?.has(b.url));
        if (!alreadyUsed) {
          out.push({ kind: 'image', binItem: b, used: false });
        }
      } else {
        const rawDur = Math.max(0.25, b.videoDuration || b.defaultDurationSec || 10);
        const rate = Math.max(0.25, Math.min(4, b.defaultPlaybackRate ?? 1.0));
        const rawInit = Math.max(0, b.defaultSourceStartSec ?? 0);
        const initStart =
          rawDur - rawInit >= 0.35
            ? rawInit
            : Math.max(0, rawDur - Math.min(rawDur, minSliceMediaSec));
        const spanAvail = rawDur - initStart;
        const canFitStandard = spanAvail >= minSliceMediaSec;

        if (canFitStandard || allowShortLoopFallback) {
          const effectiveStart = canFitStandard ? initStart : 0;
          const baseRange: [number, number] = [
            Number(effectiveStart.toFixed(2)),
            Number(rawDur.toFixed(2)),
          ];
          const usedForUrl = respectExclusions
            ? options.excludeVideoRangesByUrl?.get(b.url) || []
            : [];
          const reqLen = canFitStandard ? minSliceMediaSec : 0.25;
          const freeRanges =
            usedForUrl.length > 0
              ? subtractUsedIntervals(baseRange, usedForUrl, reqLen)
              : [baseRange];
          const finalRanges =
            freeRanges.length > 0 ? freeRanges : allowShortLoopFallback ? [baseRange] : [];
          if (finalRanges.length > 0) {
            out.push({
              kind: 'video',
              binItem: b,
              rate,
              seqCursor: finalRanges[0][0],
              initStart: Number(effectiveStart.toFixed(2)),
              vDur: Number(rawDur.toFixed(2)),
              freeRanges: finalRanges,
            });
          }
        }
      }
    }
    return out;
  };

  let pool = buildPool(true, false);
  if (pool.length === 0) {
    pool = buildPool(false, false);
  }
  let loopFallbackActive = false;
  if (pool.length === 0) {
    pool = buildPool(false, true);
    loopFallbackActive = true;
  }
  if (pool.length === 0) return [];

  const refillExhaustedPool = (forceLoopFallback = false) => {
    const fresh = buildPool(false, forceLoopFallback);
    if (fresh.length === 0) return false;
    pool = fresh;
    return true;
  };

  const canAssetFitDur = (entry: PoolAsset, dur: number, allowLoopWrap = false): boolean => {
    if (entry.kind === 'image') return !entry.used || allowLoopWrap;
    if (allowLoopWrap) return entry.vDur >= 0.25;
    const mediaNeed = dur * entry.rate;
    if (mode === 'sequential') {
      return entry.freeRanges.some(([rs, re]) => re - Math.max(rs, entry.seqCursor) >= mediaNeed - 0.01);
    }
    return entry.freeRanges.some(([rs, re]) => re - rs >= mediaNeed - 0.01);
  };

  const getBeatStepsForIndex = (bIdx: number): { steps: number[]; energy: number; hitStrength: number } => {
    const energy = phraseEnergy[bIdx] ?? 0.5;
    const curOnset = onsetAccent[bIdx] ?? 0.5;
    const curMelody = melodicNovelty[bIdx] ?? 0.4;
    const hitStrength = curOnset * 0.55 + curMelody * 0.45;

    let preferredOrder: number[];
    if (rhythm === 'beats_1') {
      preferredOrder = beatSec < 0.44 ? [2, 1] : [1, 2];
    } else if (rhythm === 'beats_2') {
      preferredOrder = beatSec < 0.48 ? [2, 4, 3, 1] : [2, 4, 1];
    } else if (rhythm === 'beats_4') {
      preferredOrder = [4, 2, 8, 1];
    } else if (rhythm === 'smooth') {
      preferredOrder = energy > 0.72 ? [4, 6, 8, 2] : [8, 6, 4, 2];
    } else if (mode === 'auto_rhythm') {
      if (energy < 0.36) {
        preferredOrder = [8, 6, 4, 2];
      } else if (energy < 0.68) {
        preferredOrder = [4, 2, 6, 3, 1];
      } else {
        preferredOrder = beatSec >= 0.55 ? [2, 1, 4] : [2, 4, 1];
      }
    } else if (mode === 'sequential') {
      preferredOrder = [4, 2, 6, 8, 1];
    } else {
      preferredOrder = [4, 2, 6, 1, 3];
    }

    const minSteps = Math.max(1, Math.ceil(minClipBound / beatSec - 0.05));
    const maxSteps = Math.max(minSteps, Math.floor(maxClipBound / beatSec + 0.05));
    const clampedPreferred = Array.from(
      new Set(preferredOrder.map((s) => Math.max(minSteps, Math.min(maxSteps, s))))
    );
    const candSet = new Set<number>(clampedPreferred);
    candSet.add(minSteps);
    if (maxSteps > minSteps && candSet.size < 2) {
      candSet.add(Math.round((minSteps + maxSteps) / 2));
    }

    // Score each candidate step by energy pacing rank + real musical cues (onset transient + melodic shift)
    const candidates = Array.from(candSet);
    const hasCustomBarMode = rhythm !== 'auto' && rhythm !== 'smooth';
    candidates.sort((a, b) => {
      const idxA = Math.min(beatTimes.length - 1, bIdx + a);
      const idxB = Math.min(beatTimes.length - 1, bIdx + b);
      const musicalA = (onsetAccent[idxA] ?? 0.4) * 0.48 + (melodicNovelty[idxA] ?? 0.35) * 0.52;
      const musicalB = (onsetAccent[idxB] ?? 0.4) * 0.48 + (melodicNovelty[idxB] ?? 0.35) * 0.52;

      const rankA = clampedPreferred.indexOf(a);
      const rankB = clampedPreferred.indexOf(b);
      const prefA = rankA >= 0 ? Math.max(0.1, 1 - rankA * 0.22) : 0.05;
      const prefB = rankB >= 0 ? Math.max(0.1, 1 - rankB * 0.22) : 0.05;
      const barA = ((idxA - barAnchorIdx) % 4 + 4) % 4 === 0 ? 0.14 : ((idxA - barAnchorIdx) % 2 + 2) % 2 === 0 ? 0.05 : 0;
      const barB = ((idxB - barAnchorIdx) % 4 + 4) % 4 === 0 ? 0.14 : ((idxB - barAnchorIdx) % 2 + 2) % 2 === 0 ? 0.05 : 0;

      const weightMusical = hasCustomBarMode ? 0.24 : 0.44;
      const weightPref = hasCustomBarMode ? 0.76 : 0.56;
      const scoreA = musicalA * weightMusical + (prefA + barA) * weightPref;
      const scoreB = musicalB * weightMusical + (prefB + barB) * weightPref;
      return scoreB - scoreA;
    });

    return { steps: candidates, energy, hitStrength };
  };

  const placements: AutoBeatSlicePlacement[] = [];
  let beatIdx = 0;
  let lastBinItemId: string | null = null;
  let seqPoolPointer = 0;
  const maxPlacements = 480;

  while (beatIdx < beatTimes.length - 1 && placements.length < maxPlacements) {
    // Anchor clip start directly onto the previous clip's exact rounded end to prevent micro-gaps/drift
    const cursorSec =
      placements.length > 0
        ? Number((placements[placements.length - 1].startSec + placements[placements.length - 1].durationSec).toFixed(2))
        : Number(startOffsetSec.toFixed(2));
    if (cursorSec >= targetLimit - 0.45) break;
    while (beatIdx < beatTimes.length - 2 && beatTimes[beatIdx] < cursorSec - 0.04) {
      beatIdx++;
    }

    const { steps: stepCandidates, energy, hitStrength } = getBeatStepsForIndex(beatIdx);
    let chosenResult: {
      nextBeatIdx: number;
      dur: number;
      asset: PoolAsset;
      sourceStartSec: number;
      rate: number;
      cutImpact: number;
    } | null = null;

    const trySelect = (stepsToTry: number[], relaxMinDur: boolean, allowLoopWrap: boolean) => {
      for (const stepCount of stepsToTry) {
        const nextIdx = Math.min(beatTimes.length - 1, beatIdx + stepCount);
        if (nextIdx <= beatIdx) continue;
        const rawEnd = Number(Math.min(targetLimit, beatTimes[nextIdx]).toFixed(2));
        const dur = Number((rawEnd - cursorSec).toFixed(2));
        const minAllow = relaxMinDur
          ? 0.4
          : Math.max(0.45, Math.min(minClipBound * 0.85, targetLimit - cursorSec));
        if (dur < minAllow) continue;

        const eligible: PoolAsset[] = pool.filter((entry) =>
          canAssetFitDur(entry, dur, allowLoopWrap)
        );
        if (eligible.length === 0) continue;

        let chosen: PoolAsset;
        if (mode === 'sequential') {
          let found: PoolAsset | null = null;
          for (let offset = 0; offset < pool.length; offset++) {
            const idx = (seqPoolPointer + offset) % pool.length;
            if (canAssetFitDur(pool[idx], dur, allowLoopWrap)) {
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

        const cutImpact =
          (onsetAccent[nextIdx] ?? hitStrength) * 0.55 + (melodicNovelty[nextIdx] ?? 0.4) * 0.45;

        if (chosen.kind === 'image') {
          return {
            nextBeatIdx: nextIdx,
            dur,
            asset: chosen,
            sourceStartSec: 0,
            rate: 1.0,
            cutImpact,
          };
        }

        if (allowLoopWrap) {
          const maxOffset = Math.max(0, chosen.vDur - 0.5);
          const wrappedStart =
            mode === 'sequential'
              ? Number((chosen.seqCursor % Math.max(0.25, chosen.vDur)).toFixed(2))
              : Number((rng() * maxOffset).toFixed(2));
          if (mode === 'sequential') {
            chosen.seqCursor = Number(
              ((wrappedStart + dur * chosen.rate) % Math.max(0.25, chosen.vDur)).toFixed(2)
            );
          }
          return {
            nextBeatIdx: nextIdx,
            dur,
            asset: chosen,
            sourceStartSec: wrappedStart,
            rate: chosen.rate,
            cutImpact,
          };
        }

        if (mode === 'sequential') {
          const mediaNeed = dur * chosen.rate;
          let rangePicked: [number, number] | null = null;
          for (const [rs, re] of chosen.freeRanges) {
            const startAt = Math.max(rs, chosen.seqCursor);
            if (re - startAt >= mediaNeed - 0.01) {
              rangePicked = [startAt, re];
              break;
            }
          }
          const [rs, re] = rangePicked || chosen.freeRanges[0];
          const avail = Math.max(0, re - rs);
          const clampedNeed = Math.min(mediaNeed, avail);
          const srcStart = Number(rs.toFixed(2));
          chosen.seqCursor = Number((srcStart + clampedNeed).toFixed(2));
          return {
            nextBeatIdx: nextIdx,
            dur,
            asset: chosen,
            sourceStartSec: srcStart,
            rate: chosen.rate,
            cutImpact,
          };
        }

        const mediaNeed = dur * chosen.rate;
        const fittingRanges: number[] = [];
        for (let r = 0; r < chosen.freeRanges.length; r++) {
          const [rs, re] = chosen.freeRanges[r];
          if (re - rs >= mediaNeed - 0.01) fittingRanges.push(r);
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

        return {
          nextBeatIdx: nextIdx,
          dur,
          asset: chosen,
          sourceStartSec: srcStart,
          rate: chosen.rate,
          cutImpact,
        };
      }
      return null;
    };

    chosenResult = trySelect(stepCandidates, false, loopFallbackActive);

    // If strict unlooped constraints could not fit stepCandidates:
    // 1. In fillToTargetEnd mode (or before producing ANY placement), relax/refill cleanly so generation never stalls!
    // 2. When fillToTargetEnd === false and we already produced placements, allow shorter unlooped steps before stopping at unique-slice exhaustion.
    if (!chosenResult && placements.length === 0) {
      const relaxedSteps = Array.from(new Set([...stepCandidates, 2, 1])).sort((a, b) => a - b);
      chosenResult = trySelect(relaxedSteps, true, false);
      if (!chosenResult) {
        refillExhaustedPool(true);
        loopFallbackActive = true;
        chosenResult = trySelect(stepCandidates, true, true);
      }
    } else if (!chosenResult && fillToTargetEnd) {
      if (refillExhaustedPool(true)) {
        chosenResult = trySelect(stepCandidates, false, loopFallbackActive);
      }
      if (!chosenResult) {
        loopFallbackActive = true;
        chosenResult = trySelect(stepCandidates, true, true);
      }
    }

    if (!chosenResult) {
      break;
    }

    if (chosenResult.asset.kind === 'image') {
      chosenResult.asset.used = true;
    }

    // Explicit preset transition styles ('dissolve', 'cuts_only', 'punchy') override bin item defaults so presets behave accurately
    let trType: SlideTransitionType;
    if (transitionStyle === 'dissolve') {
      trType = 'crossfade';
    } else if (transitionStyle === 'cuts_only') {
      trType = 'cut';
    } else if (transitionStyle === 'punchy') {
      trType = chosenResult.cutImpact > 0.62 || placements.length % 3 === 2 ? 'zoom_cross' : 'cut';
    } else if (mode === 'auto_rhythm') {
      if (energy < 0.4 || rhythm === 'smooth') {
        trType = 'crossfade';
      } else if (energy >= 0.65 || chosenResult.cutImpact >= 0.56) {
        trType = chosenResult.cutImpact >= 0.78 && placements.length % 3 === 2 ? 'zoom_cross' : 'cut';
      } else if (chosenResult.asset.binItem.defaultTransitionOut) {
        trType = chosenResult.asset.binItem.defaultTransitionOut;
      } else {
        trType = placements.length % 2 === 0 ? 'cut' : 'crossfade';
      }
    } else if (chosenResult.asset.binItem.defaultTransitionOut) {
      trType = chosenResult.asset.binItem.defaultTransitionOut;
    } else if (mode === 'sequential') {
      trType = chosenResult.dur >= 2.2 ? 'crossfade' : 'cut';
    } else if (rhythm === 'smooth' || chosenResult.dur >= 2.8) {
      trType = 'crossfade';
    } else if (rhythm === 'beats_1') {
      trType = 'cut';
    } else {
      trType = chosenResult.cutImpact >= 0.55 || rng() < 0.58 ? 'cut' : rng() < 0.75 ? 'crossfade' : 'zoom_cross';
    }

    // Keep beat transitions snappy (0s on cut, 0.16..0.28s on upbeat fades/zooms) so cuts visually hit ON the beat
    const isSlowDissolve =
      transitionStyle === 'dissolve' || rhythm === 'smooth' || (mode === 'auto_rhythm' && energy < 0.4);
    const idealTrans =
      trType === 'cut'
        ? 0
        : Number(
            Math.max(
              0.14,
              Math.min(
                isSlowDissolve ? 0.68 : 0.28,
                chosenResult.dur * (isSlowDissolve ? 0.3 : 0.24)
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

    const clampedDur = Number(
      Math.max(0.4, Math.min(chosenResult.dur, targetLimit - cursorSec)).toFixed(2)
    );
    placements.push({
      binItemId: chosenResult.asset.binItem.id,
      startSec: cursorSec,
      durationSec: clampedDur,
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

  // Ensure full coverage up to targetLimit when requested without ever overshooting targetLimit
  if (placements.length > 0 && hasAudio) {
    const last = placements[placements.length - 1];
    const lastEnd = Number((last.startSec + last.durationSec).toFixed(2));
    if (lastEnd > targetLimit) {
      last.durationSec = Number(Math.max(0.4, targetLimit - last.startSec).toFixed(2));
    } else if (fillToTargetEnd && lastEnd < targetLimit - 0.02) {
      const rem = targetLimit - lastEnd;
      if (rem <= Math.max(beatSec * 3, 4.0) || placements.length >= maxPlacements) {
        last.durationSec = Number(Math.max(0.4, targetLimit - last.startSec).toFixed(2));
      } else {
        const fallbackAsset =
          pool.find((p) => p.binItem.id !== lastBinItemId) || pool[0];
        if (fallbackAsset) {
          placements.push({
            binItemId: fallbackAsset.binItem.id,
            startSec: lastEnd,
            durationSec: Number(rem.toFixed(2)),
            sourceStartSec: fallbackAsset.kind === 'video' ? fallbackAsset.initStart : 0,
            playbackRate: fallbackAsset.kind === 'video' ? fallbackAsset.rate : 1.0,
            transitionOut: transitionStyle === 'cuts_only' ? 'cut' : 'crossfade',
            transitionDurationSec: transitionStyle === 'cuts_only' ? 0 : 0.35,
            scaleStart: 1.0,
            scaleEnd: motionLevel === 'off' ? 1.0 : 1.03,
          });
        }
      }
    }
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
    { ...options, mode: 'random', fillToTargetEnd: false }
  );
}



