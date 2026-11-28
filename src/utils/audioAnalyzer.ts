import {
  AudioFrameMetrics,
  BeatGridMode,
  BeatSyncMode,
  KeyframeEasing,
  MediaBinItem,
  SlideTransitionType,
  StudioConfig,
  VisualMediaState,
} from '../types/studio';
import { Radix2FFT } from './fft';
import type { AutoClipLookId } from './presets';
export type { AutoClipLookId } from './presets';

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
  snapEnabled = false,
  allowMagneticSnap = true
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
  if (allowMagneticSnap && combinedSnaps.length > 0) {
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
  maxTimelineSec = 3600,
  stretchMode: 'push' | 'overlap' = 'push'
): VisualMediaState[] {
  const intervals = getNormalizedManualClipIntervals(mediaItems);
  const idx = intervals.findIndex((iv) => iv.id === clipId);
  if (idx === -1) return mediaItems;

  const target = intervals[idx];
  const maxAllowedDur = Math.max(0.4, Math.min(600, maxTimelineSec - target.startSec));
  const nextDur = Number(Math.max(0.4, Math.min(maxAllowedDur, desiredDurationSec)).toFixed(2));
  const targetStart = Number(target.startSec.toFixed(2));
  const newEnd = Number((targetStart + nextDur).toFixed(2));

  if (stretchMode === 'overlap') {
    const coverDropIds = new Set<string>();
    const trimPatch = new Map<string, { startSec: number; durationSec: number; sourceShiftSec: number }>();

    for (let i = idx + 1; i < intervals.length; i++) {
      const iv = intervals[i];
      if (iv.startSec >= newEnd - 0.005) break;
      if (iv.endSec <= newEnd + 0.39) {
        coverDropIds.add(iv.id);
      } else {
        const shift = Number((newEnd - iv.startSec).toFixed(2));
        const remDur = Number(Math.max(0.4, iv.endSec - newEnd).toFixed(2));
        trimPatch.set(iv.id, {
          startSec: newEnd,
          durationSec: remDur,
          sourceShiftSec: shift,
        });
      }
    }

    return mediaItems
      .map((m) => {
        if (m.id === clipId) {
          return {
            ...m,
            startSec: targetStart,
            durationSec: nextDur,
          };
        }
        if (coverDropIds.has(m.id)) return null;
        const patch = trimPatch.get(m.id);
        if (patch) {
          const avail = Math.max(0.4, maxTimelineSec - patch.startSec);
          const nextSourceStart =
            m.kind === 'video'
              ? Number(
                  Math.max(
                    0,
                    (m.sourceStartSec || 0) + patch.sourceShiftSec * Math.max(0.25, m.playbackRate || 1)
                  ).toFixed(2)
                )
              : m.sourceStartSec;
          return {
            ...m,
            startSec: patch.startSec,
            durationSec: Number(Math.min(patch.durationSec, avail).toFixed(2)),
            sourceStartSec: nextSourceStart,
          };
        }
        return m;
      })
      .filter((m): m is VisualMediaState => m !== null);
  }

  // Push / Ripple mode: fill downstream gaps first, then smoothly push downstream clips right.
  // Never block stretching of the dragged clip even when the timeline is already full to music end;
  // trailing clips pushed past maxTimelineSec are trimmed/dropped at the end cleanly.
  const startMap = new Map<string, number>();
  let cursor = newEnd;
  for (let i = idx + 1; i < intervals.length; i++) {
    const item = intervals[i];
    if (item.startSec < cursor - 0.001) {
      startMap.set(item.id, cursor);
      cursor = Number((cursor + item.durationSec).toFixed(2));
    } else {
      cursor = Number(Math.max(cursor, item.endSec).toFixed(2));
    }
  }

  return mediaItems
    .map((m) => {
      if (m.id === clipId) {
        return {
          ...m,
          startSec: targetStart,
          durationSec: nextDur,
        };
      }
      const shiftedStart = startMap.get(m.id);
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
 * Resolves [sourceStartSec, sourceEndSec] bounds for a Media Library item, honoring explicit user
 * start/end settings or excluding the first/last `excludeEdgeSec` (default 5s) on long videos (>=14s).
 */
export function resolveSafeVideoSourceRange(
  item: Pick<
    MediaBinItem,
    'kind' | 'videoDuration' | 'defaultDurationSec' | 'defaultSourceStartSec' | 'defaultSourceEndSec'
  >,
  excludeEdgeSec = 5
): { sourceStartSec: number; sourceEndSec: number; usableSpanSec: number; rawDurationSec: number } {
  const rawDur = Math.max(0.25, item.videoDuration || item.defaultDurationSec || 10);
  if (item.kind === 'image') {
    return { sourceStartSec: 0, sourceEndSec: rawDur, usableSpanSec: rawDur, rawDurationSec: rawDur };
  }

  const hasExplicitStart = item.defaultSourceStartSec !== undefined;
  const hasExplicitEnd = item.defaultSourceEndSec !== undefined;

  let startSec: number;
  let endSec: number;
  if (hasExplicitStart || hasExplicitEnd) {
    startSec = Math.max(0, Math.min(Math.max(0, rawDur - 0.3), item.defaultSourceStartSec ?? 0));
    endSec = Math.max(
      Math.min(rawDur, startSec + 0.3),
      Math.min(rawDur, item.defaultSourceEndSec ?? rawDur)
    );
  } else if (excludeEdgeSec > 0 && rawDur >= excludeEdgeSec * 2 + 4) {
    startSec = excludeEdgeSec;
    endSec = rawDur - excludeEdgeSec;
  } else {
    startSec = 0;
    endSec = rawDur;
  }

  return {
    sourceStartSec: Number(startSec.toFixed(2)),
    sourceEndSec: Number(endSec.toFixed(2)),
    usableSpanSec: Number(Math.max(0.3, endSec - startSec).toFixed(2)),
    rawDurationSec: Number(rawDur.toFixed(2)),
  };
}

/**
 * Places a dropped Media Library item cleanly into a bounded open gap `[gapStart..gapEnd]`
 * between neighboring clips so only the empty gap is filled (never inserting the whole 30s file
 * or shoving neighbor clips aside).
 */
export function dropBinItemIntoManualGap(
  mediaItems: VisualMediaState[],
  desiredStartSec: number,
  desiredDurSec: number,
  maxTimelineSec = 3600
): { startSec: number; durationSec: number; filledGap: boolean } {
  const dur = Math.max(0.25, desiredDurSec || 4);
  const others = getNormalizedManualClipIntervals(mediaItems);
  if (others.length === 0) {
    const start = Math.max(0, Math.min(Math.max(0, maxTimelineSec - 0.25), desiredStartSec));
    return {
      startSec: Number(start.toFixed(2)),
      durationSec: Number(Math.min(dur, Math.max(0.25, maxTimelineSec - start)).toFixed(2)),
      filledGap: false,
    };
  }

  const gaps: { start: number; end: number; boundedRight: boolean }[] = [];
  let cursor = 0;
  for (const item of others) {
    if (item.startSec > cursor + 0.04) {
      gaps.push({
        start: cursor,
        end: Math.min(maxTimelineSec, item.startSec),
        boundedRight: true,
      });
    }
    cursor = Math.max(cursor, item.endSec);
  }
  if (cursor < maxTimelineSec - 0.04) {
    gaps.push({ start: cursor, end: maxTimelineSec, boundedRight: false });
  }

  const clampedDesired = Math.max(0, Math.min(Math.max(0, maxTimelineSec - 0.25), desiredStartSec));
  const boundedMatch = gaps.find(
    (g) =>
      g.boundedRight &&
      clampedDesired >= g.start - 0.06 &&
      clampedDesired <= g.end + 0.06 &&
      g.end - g.start >= 0.25
  );
  const targetGap =
    boundedMatch ||
    gaps.find(
      (g) => clampedDesired >= g.start - 0.04 && clampedDesired <= g.end + 0.04 && g.end - g.start >= 0.25
    );

  if (targetGap) {
    const gapLen = Number((targetGap.end - targetGap.start).toFixed(2));
    if (targetGap.boundedRight) {
      // Bounded gap between existing clips: never overflow neighbor clips; trim to gap width when
      // clip length >= gap, or place custom shorter duration inside the gap cleanly.
      if (dur >= gapLen - 0.05) {
        return {
          startSec: Number(targetGap.start.toFixed(2)),
          durationSec: Math.max(0.25, gapLen),
          filledGap: true,
        };
      }
      const start = Math.max(
        targetGap.start,
        Math.min(targetGap.end - dur, clampedDesired)
      );
      return {
        startSec: Number(start.toFixed(2)),
        durationSec: Number(Math.max(0.25, Math.min(dur, targetGap.end - start)).toFixed(2)),
        filledGap: true,
      };
    }
    const start = Math.max(targetGap.start, Math.min(targetGap.end - 0.25, clampedDesired));
    return {
      startSec: Number(start.toFixed(2)),
      durationSec: Number(Math.max(0.25, Math.min(dur, targetGap.end - start)).toFixed(2)),
      filledGap: false,
    };
  }

  return {
    ...findManualInsertionSlot(mediaItems, desiredStartSec, dur, maxTimelineSec),
    filledGap: false,
  };
}

/**
 * Closes a specific open gap `[gapStartSec..gapEndSec]` by shifting all clips to its right
 * leftward cleanly (snapped to beats when enabled), optionally auto-adapting clip lengths
 * on beat/bar boundaries to reach `fitToMusicEndSec`.
 */
export function closeManualTimelineGap(
  mediaItems: VisualMediaState[],
  gapStartSec: number,
  gapEndSec: number,
  beatPoints: number[] = [],
  snapEnabled = false,
  fitToMusicEndSec?: number
): VisualMediaState[] {
  const rawShift = Math.max(0, gapEndSec - gapStartSec);
  if (rawShift < 0.04 || mediaItems.length === 0) return mediaItems;

  const intervals = getNormalizedManualClipIntervals(mediaItems);
  let targetStart = gapStartSec;
  if (snapEnabled && beatPoints.length > 0) {
    const snapped = snapTimeToBeat(gapStartSec, [0, ...beatPoints], 0.25);
    if (snapped <= gapEndSec + 0.01 && snapped >= Math.max(0, gapStartSec - 0.35)) {
      targetStart = snapped;
    }
  }
  const shift = Number(Math.max(0, gapEndSec - targetStart).toFixed(2));
  if (shift < 0.04) return mediaItems;

  const shiftedIds = new Set(
    intervals.filter((iv) => iv.startSec >= gapEndSec - 0.04).map((iv) => iv.id)
  );
  const startById = new Map(intervals.map((iv) => [iv.id, iv.startSec]));

  const shifted = mediaItems
    .map((m) => {
      const baseStart = startById.get(m.id) ?? Math.max(0, m.startSec ?? 0);
      if (shiftedIds.has(m.id)) {
        return {
          ...m,
          startSec: Number(Math.max(0, baseStart - shift).toFixed(2)),
        };
      }
      return {
        ...m,
        startSec: Number(baseStart.toFixed(2)),
      };
    })
    .sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));

  const leftUnchanged = shifted.filter((m) => (m.startSec ?? 0) < targetStart - 0.04);
  const rightTail = shifted.filter((m) => (m.startSec ?? 0) >= targetStart - 0.04);

  if (fitToMusicEndSec !== undefined && fitToMusicEndSec > targetStart + 0.5 && rightTail.length > 0) {
    const fittedRight = fitPackedClipsToBeatsAndMusic(
      rightTail,
      beatPoints,
      fitToMusicEndSec,
      targetStart
    );
    return [...leftUnchanged, ...fittedRight];
  }
  return shifted;
}

/**
 * Packs all manual clips left to eliminate all gaps (aligning seams to beats) and optionally
 * adapts clip lengths on beat/bar points to fit `maxTimelineSec` under the music track.
 */
export function closeAllManualGapsAndFitBeats(
  mediaItems: VisualMediaState[],
  beatPoints: number[] = [],
  maxTimelineSec = 3600,
  fitToMusicEnd = true
): VisualMediaState[] {
  if (mediaItems.length === 0) return mediaItems;
  const intervals = getNormalizedManualClipIntervals(mediaItems);
  const byId = new Map(mediaItems.map((m) => [m.id, m]));
  let cursor = 0;
  const packed: VisualMediaState[] = [];

  for (const iv of intervals) {
    const m = byId.get(iv.id);
    if (!m) continue;
    const rawDur = Math.max(0.4, iv.durationSec);
    if (cursor >= maxTimelineSec - 0.4) break;
    const clampedDur = Number(Math.min(rawDur, Math.max(0.4, maxTimelineSec - cursor)).toFixed(2));
    packed.push({
      ...m,
      startSec: Number(cursor.toFixed(2)),
      durationSec: clampedDur,
    });
    cursor = Number((cursor + clampedDur).toFixed(2));
  }

  if (fitToMusicEnd && maxTimelineSec > 0.5 && packed.length > 0) {
    return fitPackedClipsToBeatsAndMusic(packed, beatPoints, maxTimelineSec, 0);
  }
  return packed;
}

/**
 * Gently stretches or quantizes packed timeline clips onto beat boundaries so the timeline
 * ends cleanly at `musicEndSec` without bare audio or off-beat cuts.
 */
function fitPackedClipsToBeatsAndMusic(
  clips: VisualMediaState[],
  beatPoints: number[],
  musicEndSec: number,
  startAnchorSec = 0
): VisualMediaState[] {
  if (clips.length === 0 || musicEndSec <= startAnchorSec + 0.5) return clips;
  const ordered = [...clips].sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
  const last = ordered[ordered.length - 1];
  const currentEnd = (last.startSec ?? 0) + (last.durationSec || 4);
  if (Math.abs(currentEnd - musicEndSec) <= 0.12 && Math.abs((ordered[0].startSec ?? 0) - startAnchorSec) <= 0.05) {
    return ordered;
  }

  const targetTotalSpan = Math.max(0.4, musicEndSec - startAnchorSec);
  const totalSpan = ordered.reduce((s, c) => s + Math.max(0.4, c.durationSec || 4), 0);
  if (totalSpan <= 0.4) return ordered;

  const scale = targetTotalSpan / totalSpan;
  const grid =
    beatPoints.length >= 2
      ? beatPoints.filter((b) => b > startAnchorSec + 0.15 && b < musicEndSec - 0.15)
      : [];
  let cursor = Number(startAnchorSec.toFixed(2));
  const out: VisualMediaState[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const clip = ordered[i];
    const isLast = i === ordered.length - 1;
    const rawTargetDur = Math.max(0.5, clip.durationSec * scale);
    let endSec = isLast ? musicEndSec : cursor + rawTargetDur;

    if (!isLast && grid.length > 0) {
      const thresh = Math.max(0.35, Math.min(2.0, rawTargetDur * 0.35));
      const snapped = snapTimeToBeat(endSec, grid, thresh);
      if (snapped >= cursor + 0.45 && snapped <= musicEndSec - 0.45 * (ordered.length - 1 - i)) {
        endSec = snapped;
      }
    }
    const dur = Number(Math.max(0.4, endSec - cursor).toFixed(2));
    out.push({
      ...clip,
      startSec: Number(cursor.toFixed(2)),
      durationSec: dur,
    });
    cursor = Number((cursor + dur).toFixed(2));
  }

  return out;
}

/**
 * Moves 1 or more selected clips (`selectedIds`) cleanly across a manual timeline:
 * - Inside open free gaps: slides smoothly as a rigid block with beat/edge snapping.
 * - Across neighboring clips (e.g. packed Auto-Clip timelines): reorders the selected group
 *   around displaced neighbors without collisions or overflowing `maxTimelineSec`.
 */
export function moveManualClipGroup(
  mediaItems: VisualMediaState[],
  selectedIds: string[],
  rawTargetStartSec: number,
  maxTimelineSec = 3600,
  beatSnapPoints: number[] = [],
  snapEnabled = false
): VisualMediaState[] {
  if (selectedIds.length === 0 || mediaItems.length === 0) return mediaItems;
  const selSet = new Set(selectedIds);
  const intervals = getNormalizedManualClipIntervals(mediaItems);
  const byId = new Map(mediaItems.map((m) => [m.id, m]));

  const groupIntervals = intervals.filter((iv) => selSet.has(iv.id));
  if (groupIntervals.length === 0) return mediaItems;
  const otherIntervals = intervals.filter((iv) => !selSet.has(iv.id));

  const groupTotalDur = Number(
    groupIntervals.reduce((acc, iv) => acc + iv.durationSec, 0).toFixed(2)
  );
  const clampedTarget = Math.max(
    0,
    Math.min(Math.max(0, maxTimelineSec - groupTotalDur), rawTargetStartSec)
  );

  // Build free windows where the entire selected group can slide without moving any other clip
  const freeWindows: { minStart: number; maxStart: number }[] = [];
  const edgeSnapPoints: number[] = [0];
  let cursor = 0;
  for (const item of otherIntervals) {
    edgeSnapPoints.push(item.startSec, item.endSec);
    const maxStart = item.startSec - groupTotalDur;
    if (maxStart >= cursor - 0.005) {
      freeWindows.push({ minStart: cursor, maxStart: Math.max(cursor, maxStart) });
    }
    cursor = Math.max(cursor, item.endSec);
  }
  const tailMax = Math.max(cursor, maxTimelineSec - groupTotalDur);
  if (tailMax >= cursor - 0.005) {
    freeWindows.push({ minStart: cursor, maxStart: tailMax });
  }

  // Check if target falls reasonably inside or near an existing free window (preserve original gaps)
  const containingWindow = freeWindows.find(
    (w) => clampedTarget >= w.minStart - 0.25 && clampedTarget <= w.maxStart + 0.25
  );
  if (containingWindow && (groupIntervals.length === 1 || freeWindows.some((w) => w.maxStart > w.minStart + 0.08))) {
    const insideCurWindow = freeWindows.find((w) => {
      const origStart = groupIntervals[0].startSec;
      return origStart >= w.minStart - 0.02 && origStart <= w.maxStart + 0.02;
    });
    if (containingWindow === insideCurWindow || (containingWindow.maxStart - containingWindow.minStart >= 0.05 && otherIntervals.every((o) => clampedTarget + groupTotalDur <= o.startSec + 0.08 || clampedTarget >= o.endSec - 0.08))) {
      let nextStart = Math.max(
        containingWindow.minStart,
        Math.min(containingWindow.maxStart, clampedTarget)
      );
      const combinedSnaps = snapEnabled ? [...beatSnapPoints, ...edgeSnapPoints] : edgeSnapPoints;
      if (combinedSnaps.length > 0) {
        const thresh = snapEnabled ? 0.22 : 0.12;
        const sl = snapTimeToBeat(nextStart, combinedSnaps, thresh);
        const sr = snapTimeToBeat(nextStart + groupTotalDur, combinedSnaps, thresh) - groupTotalDur;
        const cand = Math.abs(sl - nextStart) <= Math.abs(sr - nextStart) ? sl : sr;
        if (cand >= containingWindow.minStart - 0.005 && cand <= containingWindow.maxStart + 0.005) {
          nextStart = Math.max(
            containingWindow.minStart,
            Math.min(containingWindow.maxStart, cand)
          );
        }
      }
      let gCursor = Number(nextStart.toFixed(2));
      const groupStartMap = new Map<string, number>();
      for (const giv of groupIntervals) {
        groupStartMap.set(giv.id, gCursor);
        gCursor = Number((gCursor + giv.durationSec).toFixed(2));
      }
      return mediaItems
        .map((m) => {
          const ns = groupStartMap.get(m.id);
          return ns !== undefined ? { ...m, startSec: ns } : m;
        })
        .sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
    }
  }

  // Packed / cross-neighbor reorder: insert selected group smoothly before the first neighbor whose midpoint we crossed
  const origGroupStart = groupIntervals[0].startSec;
  const draggingRight = rawTargetStartSec > origGroupStart;
  const refEdge = draggingRight ? rawTargetStartSec + groupTotalDur : rawTargetStartSec;

  let insertBeforeIdx = otherIntervals.length;
  for (let i = 0; i < otherIntervals.length; i++) {
    const mid = otherIntervals[i].startSec + otherIntervals[i].durationSec * 0.5;
    if (refEdge < mid) {
      insertBeforeIdx = i;
      break;
    }
  }

  const reorderedIds = [
    ...otherIntervals.slice(0, insertBeforeIdx).map((iv) => iv.id),
    ...groupIntervals.map((iv) => iv.id),
    ...otherIntervals.slice(insertBeforeIdx).map((iv) => iv.id),
  ];

  const out: VisualMediaState[] = [];
  let packCursor = 0;
  for (const id of reorderedIds) {
    const m = byId.get(id);
    if (!m) continue;
    if (packCursor >= maxTimelineSec - 0.4) break;
    const dur = Math.max(0.4, m.durationSec || 4);
    const clampedDur = Number(Math.min(dur, Math.max(0.4, maxTimelineSec - packCursor)).toFixed(2));
    out.push({
      ...m,
      startSec: Number(packCursor.toFixed(2)),
      durationSec: clampedDur,
    });
    packCursor = Number((packCursor + clampedDur).toFixed(2));
  }
  return out;
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
  exactBpm?: number; // sub-integer estimated BPM for drift-free strict grid
  anchorSec?: number; // primary phase anchor in [0..beatSec) relative to trimStart
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
  const startIdx = Math.max(0, Math.floor(trimStart * sampleRate));
  const totalSteps = Math.max(16, Math.floor(clipDuration / hopSec));
  const rawOnsets = new Float32Array(totalSteps);
  const rawLowOnsets = new Float32Array(totalSteps);
  const rawAttackOnsets = new Float32Array(totalSteps);

  // Two cascaded 1-pole crossover cutoffs for bass (<~180 Hz) & mid (~180..2200 Hz)
  const alphaLow = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate);
  const alphaMid = 1 - Math.exp((-2 * Math.PI * 2200) / sampleRate);
  let lpLow = 0;
  let lpMid = 0;
  let prevLowLog = 0;
  let prevMidLog = 0;
  let prevHighLog = 0;
  let prevAttack = 0;
  let maxRawOnset = 0;

  for (let s = 0; s < totalSteps; s++) {
    // Exact fractional sample boundaries eliminate integer truncation drift at 22050/11025 Hz
    const base = startIdx + Math.round(s * sampleRate * hopSec);
    if (base >= mono.length) break;
    const end = Math.min(mono.length, Math.max(base + 1, startIdx + Math.round((s + 1) * sampleRate * hopSec)));
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

    const flux = (lowFlux * 0.56 + midFlux * 0.32 + highFlux * 0.12) * sensitivity;
    const attackInstant = (midFlux * 0.45 + highFlux * 0.28 + lowFlux * 0.27) * sensitivity;
    // Emphasize sharp rising transient edge to avoid locking late onto kick boom / sidechain swells
    const attackEdge = attackInstant * 0.72 + Math.max(0, attackInstant - prevAttack * 0.65) * 0.55;
    prevAttack = attackInstant;

    rawOnsets[s] = flux;
    rawLowOnsets[s] = lowFlux * sensitivity;
    rawAttackOnsets[s] = attackEdge;
    if (flux > maxRawOnset) maxRawOnset = flux;
  }

  if (maxRawOnset < 0.002) {
    return { bpm: 0, beatSec: 0.5, beats: [] };
  }

  // Adaptive local baseline subtraction (±0.24s) sharpens real musical hits over sustained chords/drones
  const onsets = new Float32Array(totalSteps);
  const lowOnsets = new Float32Array(totalSteps);
  const attackOnsets = new Float32Array(totalSteps);
  const halfWin = Math.max(6, Math.round(0.24 / hopSec));
  let onsetSum = 0;
  let nonzeroCount = 0;
  for (let s = 0; s < totalSteps; s++) {
    const w0 = Math.max(0, s - halfWin);
    const w1 = Math.min(totalSteps - 1, s + halfWin);
    let sum = 0;
    let lowSum = 0;
    let atkSum = 0;
    for (let k = w0; k <= w1; k++) {
      sum += rawOnsets[k];
      lowSum += rawLowOnsets[k];
      atkSum += rawAttackOnsets[k];
    }
    const winLen = Math.max(1, w1 - w0 + 1);
    const localMean = sum / winLen;
    const localLowMean = lowSum / winLen;
    const localAtkMean = atkSum / winLen;
    const val = Math.max(0, rawOnsets[s] - localMean * 0.76);
    onsets[s] = val;
    lowOnsets[s] = Math.max(0, rawLowOnsets[s] - localLowMean * 0.72);
    attackOnsets[s] = Math.max(0, rawAttackOnsets[s] - localAtkMean * 0.78);
    if (val > 0) {
      onsetSum += val;
      nonzeroCount++;
    }
  }
  const activeOnsetMean = nonzeroCount > 0 ? onsetSum / nonzeroCount : maxRawOnset * 0.25;

  // Autocorrelation across full double/half-octave range so 93..131 BPM gets symmetric harmonic support
  const minLag = Math.max(16, Math.round(60 / 184 / hopSec));
  const maxLag = Math.min(Math.floor(totalSteps / 2), Math.round(60 / 66 / hopSec));
  const minAcfLag = Math.max(8, Math.floor(minLag / 2));
  const maxAcfLag = Math.min(Math.floor(totalSteps / 2), maxLag * 2);
  const acf = new Float32Array(maxAcfLag + 1);
  for (let lag = minAcfLag; lag <= maxAcfLag; lag++) {
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
      (doubleLag <= maxAcfLag ? acf[doubleLag] * 0.34 : 0) +
      (halfLag >= minAcfLag ? acf[halfLag] * 0.20 : 0);
    const tempoPrior =
      candBpm >= 84 && candBpm <= 148 ? 1.08 : candBpm >= 68 && candBpm <= 176 ? 1.0 : 0.94;
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

  const scoreCombInterp = (
    candBeatSec: number,
    phaseStartSec: number,
    neighborWeight = 0.28
  ): number => {
    let score = 0;
    let hits = 0;
    for (let t = phaseStartSec; t < clipDuration; t += candBeatSec) {
      const fIdx = Math.max(0, Math.min(totalSteps - 1.001, t / hopSec));
      const i0 = Math.floor(fIdx);
      const frac = fIdx - i0;
      const i1 = Math.min(totalSteps - 1, i0 + 1);
      const oCenter = onsets[i0] * (1 - frac) + onsets[i1] * frac;
      const lCenter = lowOnsets[i0] * (1 - frac) + lowOnsets[i1] * frac;
      const aCenter = attackOnsets[i0] * (1 - frac) + attackOnsets[i1] * frac;
      const centerHit = oCenter * 0.44 + lCenter * 0.30 + aCenter * 0.54;
      if (neighborWeight > 0) {
        const iPrev = Math.max(0, i0 - 1);
        const iNext = Math.min(totalSteps - 1, i0 + 1);
        const neighborHit = Math.max(
          onsets[iPrev] * 0.44 + lowOnsets[iPrev] * 0.30 + attackOnsets[iPrev] * 0.54,
          onsets[iNext] * 0.44 + lowOnsets[iNext] * 0.30 + attackOnsets[iNext] * 0.54
        );
        score += Math.max(centerHit, neighborHit * neighborWeight);
      } else {
        score += centerHit;
      }
      hits++;
    }
    return hits > 0 ? score / hits : 0;
  };

  // Pass 1: Full-phase 10ms comb sweep (±2.4 BPM in 0.15 BPM steps) across [0 .. beatSec)
  let lockedBpm = coarseBpm;
  let bestPhase = 0;
  let bestCombScore = -1;
  const fineStepCount = 16;
  const fineDeltaBpm = 0.15;
  const approxBeatSec = 60 / coarseBpm;
  const phaseSteps = Math.max(1, Math.min(totalSteps, Math.round(approxBeatSec / hopSec)));

  for (let bi = -fineStepCount; bi <= fineStepCount; bi++) {
    const candBpm = Math.max(60, Math.min(188, coarseBpm + bi * fineDeltaBpm));
    const candBeatSec = 60 / candBpm;
    for (let ph = 0; ph < phaseSteps; ph++) {
      const phSec = ph * hopSec;
      const avgScore = scoreCombInterp(candBeatSec, phSec, 0.28);
      if (avgScore > bestCombScore) {
        bestCombScore = avgScore;
        bestPhase = phSec;
        lockedBpm = candBpm;
      }
    }
  }

  // Pass 2: Ultra-fine 0.01 BPM & 2ms interpolated phase lock (±0.28 BPM) to eliminate multi-minute drift
  const ultraCenterBpm = lockedBpm;
  const ultraCenterPh = bestPhase;
  let ultraBestScore = -1;
  for (let bi = -28; bi <= 28; bi++) {
    const candBpm = Math.max(60, Math.min(188, ultraCenterBpm + bi * 0.01));
    const candBeatSec = 60 / candBpm;
    for (let dMs = -14; dMs <= 14; dMs += 2) {
      const phSec = ((ultraCenterPh + dMs * 0.001) % candBeatSec + candBeatSec) % candBeatSec;
      const avgScore = scoreCombInterp(candBeatSec, phSec, 0.22);
      if (avgScore > ultraBestScore) {
        ultraBestScore = avgScore;
        lockedBpm = candBpm;
        bestPhase = phSec;
      }
    }
  }

  const lockedBeatSec = Number((60 / lockedBpm).toFixed(5));
  const bpm = Math.round(lockedBpm);
  const beatSec = lockedBeatSec;
  bestPhase = Number((bestPhase % beatSec).toFixed(3));

  // Explicit off-beat (+0.5 * beatSec) disambiguation using zero-bleed sharp attack energy
  const altHalfPhase = Number(((bestPhase + beatSec * 0.5) % beatSec).toFixed(3));
  const primarySharpScore = scoreCombInterp(beatSec, bestPhase, 0);
  const halfBeatSharpScore = scoreCombInterp(beatSec, altHalfPhase, 0);
  if (halfBeatSharpScore > primarySharpScore * 1.12) {
    bestPhase = altHalfPhase;
  }

  // Dynamic-programming (Ellis-style) beat sequence tracking:
  // Combines exact global phase lattice support during silent/beatless passages with smooth log-ratio
  // tempo tracking so real-world tracks with tempo bends, rubato, or breakdown phase resets stay dead-on the kick.
  const combAnchorThresh = Math.max(0.015, activeOnsetMean * 0.72);
  if (bestPhase > beatSec * 0.85 && onsets[0] >= combAnchorThresh * 0.6) {
    bestPhase = 0;
  }

  const beatStepsExact = Math.max(4, beatSec / hopSec);
  const minPrevStep = Math.max(4, Math.round(beatStepsExact * 0.72));
  const maxPrevStep = Math.max(minPrevStep + 2, Math.round(beatStepsExact * 1.38));
  const minInitStep = Math.min(totalSteps - 1, Math.round(beatStepsExact * 1.45));
  const normScale = Math.max(0.03, activeOnsetMean * 1.6);

  const dpOnset = new Float32Array(totalSteps);
  for (let s = 0; s < totalSteps; s++) {
    const combo = onsets[s] * 0.46 + lowOnsets[s] * 0.34 + attackOnsets[s] * 0.54;
    dpOnset[s] = Math.min(4.0, combo / normScale);
  }

  const dpScore = new Float64Array(totalSteps);
  const prevBeat = new Int32Array(totalSteps).fill(-1);
  const tempoPenaltyWeight = 11.5;

  for (let s = 0; s < totalSteps; s++) {
    const t = s * hopSec;
    const cycles = (t - bestPhase) / beatSec;
    const distSteps = Math.abs(cycles - Math.round(cycles)) * beatStepsExact;
    const phaseGuide = distSteps < 2.2 ? (1 - distSteps / 2.2) * 0.045 : 0;
    const localScore = dpOnset[s] + phaseGuide;

    let bestPrev = -1;
    let bestVal = s <= minInitStep ? localScore : -1e9;
    const pStart = Math.max(0, s - maxPrevStep);
    const pEnd = s - minPrevStep;
    for (let p = pStart; p <= pEnd; p++) {
      const interval = s - p;
      const logRatio = Math.log(interval / beatStepsExact);
      const cand = dpScore[p] - tempoPenaltyWeight * logRatio * logRatio + localScore;
      if (cand > bestVal) {
        bestVal = cand;
        bestPrev = p;
      }
    }
    dpScore[s] = bestVal;
    prevBeat[s] = bestPrev;
  }

  let endBestIdx = totalSteps - 1;
  let endBestScore = -1e9;
  const endSearchStart = Math.max(
    0,
    totalSteps - Math.max(minPrevStep + 1, Math.round(beatStepsExact * 1.55))
  );
  for (let s = endSearchStart; s < totalSteps; s++) {
    if (dpScore[s] > endBestScore) {
      endBestScore = dpScore[s];
      endBestIdx = s;
    }
  }

  const dpPath: number[] = [];
  let cur = endBestIdx;
  while (cur >= 0) {
    dpPath.push(cur);
    cur = prevBeat[cur];
  }
  dpPath.reverse();

  const beats: number[] = [];
  for (const stepIdx of dpPath) {
    const rawCombo = onsets[stepIdx];
    const hasAttack =
      rawCombo >= combAnchorThresh || attackOnsets[stepIdx] >= combAnchorThresh * 0.8;
    let beatTimeSec: number;
    if (hasAttack && stepIdx > 0 && stepIdx < totalSteps - 1) {
      const y0 =
        onsets[stepIdx - 1] * 0.46 + lowOnsets[stepIdx - 1] * 0.34 + attackOnsets[stepIdx - 1] * 0.54;
      const y1 =
        onsets[stepIdx] * 0.46 + lowOnsets[stepIdx] * 0.34 + attackOnsets[stepIdx] * 0.54;
      const y2 =
        onsets[stepIdx + 1] * 0.46 + lowOnsets[stepIdx + 1] * 0.34 + attackOnsets[stepIdx + 1] * 0.54;
      const denom = 2 * (y0 - 2 * y1 + y2);
      let subStep = stepIdx;
      if (Math.abs(denom) > 1e-8 && denom < 0) {
        subStep += Math.max(-0.45, Math.min(0.45, (y0 - y2) / denom));
      }
      beatTimeSec = Math.max(0, subStep * hopSec);
    } else {
      // During silent intros / beatless gaps, lock tightly onto comb phase if within step jitter
      const approxT = stepIdx * hopSec;
      const gridSnap = bestPhase + Math.round((approxT - bestPhase) / beatSec) * beatSec;
      beatTimeSec =
        Math.abs(gridSnap - approxT) <= hopSec * 1.65 && gridSnap >= 0
          ? gridSnap
          : Math.max(0, approxT);
    }
    const snapped = Number(beatTimeSec.toFixed(3));
    if (
      snapped < clipDuration - 0.04 &&
      (beats.length === 0 || snapped - beats[beats.length - 1] > beatSec * 0.55)
    ) {
      beats.push(snapped);
    }
  }

  // Score modulo-4 bar phase prioritizing sub-bass kick attacks over mid/high beat-2/4 snares
  const barScores = [0, 0, 0, 0];
  for (let i = 0; i < beats.length; i++) {
    const stepIdx = Math.max(0, Math.min(totalSteps - 1, Math.round(beats[i] / hopSec)));
    let kickPeak = 0;
    let totalPeak = 0;
    for (let d = -2; d <= 2; d++) {
      const idx = Math.max(0, Math.min(totalSteps - 1, stepIdx + d));
      if (lowOnsets[idx] > kickPeak) kickPeak = lowOnsets[idx];
      if (onsets[idx] > totalPeak) totalPeak = onsets[idx];
    }
    const midHighExcess = Math.max(0, totalPeak - kickPeak);
    barScores[i % 4] += kickPeak * 1.9 - midHighExcess * 0.25;
  }
  let downbeatOffset = 0;
  for (let k = 1; k < 4; k++) {
    if (barScores[k] > barScores[downbeatOffset]) {
      downbeatOffset = k;
    }
  }

  return {
    bpm,
    beatSec,
    beats,
    downbeatOffset,
    exactBpm: Number(lockedBpm.toFixed(2)),
    anchorSec: Number(bestPhase.toFixed(3)),
  };
}

export interface BeatGridCalibrationOptions {
  mode?: BeatGridMode;
  manualBpm?: number;
  offsetSec?: number;
  downbeatShift?: number;
}

/**
 * Applies user beat-grid calibration (Strict BPM lattice, Manual BPM, phase offset ms,
 * and Beat-1 downbeat rotation) on top of an extracted raw TrackBeatGrid without losing bar-1 tracking.
 */
export function resolveCalibratedBeatGrid(
  rawGrid: TrackBeatGrid,
  clipDuration: number,
  options: BeatGridCalibrationOptions = {}
): TrackBeatGrid {
  const mode: BeatGridMode = options.mode ?? 'auto';
  const offsetSec = Number.isFinite(options.offsetSec)
    ? Math.max(-4, Math.min(4, options.offsetSec as number))
    : 0;
  const downbeatShift = ((((options.downbeatShift ?? 0) % 4) + 4) % 4) as 0 | 1 | 2 | 3;

  const hasCustomBpm =
    mode === 'custom_bpm' &&
    typeof options.manualBpm === 'number' &&
    Number.isFinite(options.manualBpm) &&
    options.manualBpm >= 40 &&
    options.manualBpm <= 240;

  const effectiveBpm = hasCustomBpm
    ? Number((options.manualBpm as number).toFixed(2))
    : rawGrid.exactBpm && rawGrid.exactBpm > 0
      ? rawGrid.exactBpm
      : rawGrid.bpm;

  if (effectiveBpm <= 0 || clipDuration <= 0.05) {
    return {
      bpm: 0,
      exactBpm: 0,
      beatSec: 0.5,
      beats: [],
      downbeatOffset: 0,
      anchorSec: 0,
    };
  }

  const beatSec = Number((60 / effectiveBpm).toFixed(5));
  const baseDownbeat = (((rawGrid.downbeatOffset ?? 0) % 4) + 4) % 4;

  if (mode === 'auto' && Math.abs(offsetSec) < 0.0005 && downbeatShift === 0) {
    return {
      ...rawGrid,
      bpm: Math.round(effectiveBpm),
      exactBpm: effectiveBpm,
      beatSec,
      downbeatOffset: baseDownbeat,
    };
  }

  const kept: Array<{ t: number; phase: number }> = [];

  if (mode === 'auto' && rawGrid.beats.length > 0) {
    // Preserve adaptive transient timings while allowing smooth ±offset nudging across boundaries
    const extended: Array<{ t: number; rawIdx: number }> = [];
    let backT = rawGrid.beats[0] - beatSec;
    let backIdx = -1;
    while (backT > -4.5) {
      extended.unshift({ t: backT, rawIdx: backIdx });
      backT -= beatSec;
      backIdx--;
    }
    for (let i = 0; i < rawGrid.beats.length; i++) {
      extended.push({ t: rawGrid.beats[i], rawIdx: i });
    }
    let fwdT = rawGrid.beats[rawGrid.beats.length - 1] + beatSec;
    let fwdIdx = rawGrid.beats.length;
    while (fwdT < clipDuration + 4.5) {
      extended.push({ t: fwdT, rawIdx: fwdIdx });
      fwdT += beatSec;
      fwdIdx++;
    }

    for (const item of extended) {
      const shifted = Number((item.t + offsetSec).toFixed(3));
      if (shifted > 0.02 && shifted < clipDuration - 0.02) {
        const phase = (((item.rawIdx - baseDownbeat) % 4) + 4) % 4;
        kept.push({ t: shifted, phase });
      }
    }
  } else {
    // Drift-free equidistant lattice locked to primary anchor phase + user offset
    const rawAnchor =
      rawGrid.anchorSec !== undefined
        ? rawGrid.anchorSec
        : rawGrid.beats.length > 0
          ? rawGrid.beats[0]
          : 0;
    const baseAnchor = ((rawAnchor % beatSec) + beatSec) % beatSec;
    const minK = Math.ceil((0.0205 - baseAnchor - offsetSec) / beatSec);
    const maxK = Math.floor((clipDuration - 0.0205 - baseAnchor - offsetSec) / beatSec);
    for (let k = minK; k <= maxK; k++) {
      const t = Number((baseAnchor + k * beatSec + offsetSec).toFixed(3));
      if (t > 0.02 && t < clipDuration - 0.02) {
        const phase = (((k - baseDownbeat) % 4) + 4) % 4;
        kept.push({ t, phase });
      }
    }
  }

  if (kept.length === 0) {
    return {
      bpm: Math.round(effectiveBpm),
      exactBpm: effectiveBpm,
      beatSec,
      beats: [],
      downbeatOffset: 0,
      anchorSec: Number(((((rawGrid.anchorSec ?? 0) + offsetSec) % beatSec + beatSec) % beatSec).toFixed(3)),
    };
  }

  const p0 = kept[0].phase;
  const nextDownbeatOffset = (((downbeatShift - p0) % 4) + 4) % 4;
  const anchorSec = Number((((kept[0].t % beatSec) + beatSec) % beatSec).toFixed(3));

  return {
    bpm: Math.round(effectiveBpm),
    exactBpm: effectiveBpm,
    beatSec,
    beats: kept.map((k) => k.t),
    downbeatOffset: nextDownbeatOffset,
    anchorSec,
  };
}

/**
 * Computes BPM from recent user tap timestamps (ms). Ignores pauses > 2.5s and trims outliers.
 */
export function computeTapTempoBpm(tapTimestampsMs: number[]): number | null {
  if (tapTimestampsMs.length < 2) return null;
  const recent: number[] = [tapTimestampsMs[tapTimestampsMs.length - 1]];
  for (let i = tapTimestampsMs.length - 2; i >= 0 && recent.length < 9; i--) {
    if (recent[0] - tapTimestampsMs[i] > 2500) break;
    recent.unshift(tapTimestampsMs[i]);
  }
  if (recent.length < 2) return null;

  const intervals: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const dt = recent[i] - recent[i - 1];
    if (dt >= 250 && dt <= 1500) {
      intervals.push(dt);
    }
  }
  if (intervals.length === 0) return null;

  let avgMs: number;
  if (intervals.length >= 4) {
    const sorted = [...intervals].sort((a, b) => a - b);
    const trimmed = sorted.slice(1, sorted.length - 1);
    avgMs = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  } else {
    avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  }
  const rawBpm = 60000 / Math.max(250, avgMs);
  return Number(Math.max(45, Math.min(220, Math.round(rawBpm * 2) / 2)).toFixed(1));
}

/**
 * Computes the phase offset and downbeat rotation needed so Beat 1 lands squarely on `targetLocalSec`.
 */
export function alignBeatGridToTime(
  rawGrid: TrackBeatGrid,
  clipDuration: number,
  targetLocalSec: number,
  mode: BeatGridMode,
  manualBpm?: number
): { offsetSec: number; downbeatShift: 0 | 1 | 2 | 3 } {
  const unshifted = resolveCalibratedBeatGrid(rawGrid, clipDuration, {
    mode,
    manualBpm,
    offsetSec: 0,
    downbeatShift: 0,
  });
  const beatSec =
    unshifted.beatSec > 0.2 && unshifted.beatSec < 1.5 ? unshifted.beatSec : 0.5;
  if (unshifted.beats.length === 0) {
    return { offsetSec: 0, downbeatShift: 0 };
  }

  let nearest = unshifted.beats[0];
  let bestDist = Math.abs(targetLocalSec - nearest);
  for (const b of unshifted.beats) {
    const d = Math.abs(targetLocalSec - b);
    if (d < bestDist) {
      bestDist = d;
      nearest = b;
    }
  }

  let offsetSec = Number((targetLocalSec - nearest).toFixed(3));
  if (Math.abs(offsetSec) > beatSec * 0.55) {
    // Wrap into [-beatSec/2 .. +beatSec/2]
    const anchor = unshifted.anchorSec ?? unshifted.beats[0] % beatSec;
    const k = Math.round((targetLocalSec - anchor) / beatSec);
    offsetSec = Number((targetLocalSec - (anchor + k * beatSec)).toFixed(3));
  }

  const shifted = resolveCalibratedBeatGrid(rawGrid, clipDuration, {
    mode,
    manualBpm,
    offsetSec,
    downbeatShift: 0,
  });
  if (shifted.beats.length === 0) {
    return { offsetSec, downbeatShift: 0 };
  }

  let targetIdx = 0;
  let targetDist = Infinity;
  for (let i = 0; i < shifted.beats.length; i++) {
    const d = Math.abs(targetLocalSec - shifted.beats[i]);
    if (d < targetDist) {
      targetDist = d;
      targetIdx = i;
    }
  }
  const downbeatShift = (((targetIdx - (shifted.downbeatOffset ?? 0)) % 4) + 4) % 4 as
    | 0
    | 1
    | 2
    | 3;
  return { offsetSec, downbeatShift };
}

/**
 * Generates beat_cut cut points from an already-calibrated TrackBeatGrid respecting minBeatCutSec.
 */
export function computeBeatCutsFromGrid(
  beatGrid: TrackBeatGrid,
  clipDuration: number,
  minBeatCutSec: number
): number[] {
  const cuts: number[] = [0];
  const minHold = Math.max(0.35, minBeatCutSec - 0.04);
  const downbeat = beatGrid.downbeatOffset ?? 0;
  let lastCut = 0;
  for (let i = 0; i < beatGrid.beats.length; i++) {
    const b = beatGrid.beats[i];
    if (b <= 0.15 || b >= clipDuration - 0.15) continue;
    const isDownbeat = (((i - downbeat) % 4) + 4) % 4 === 0;
    const dt = b - lastCut;
    if (dt >= minHold || (isDownbeat && dt >= minHold * 0.82 && lastCut === 0)) {
      cuts.push(Number(b.toFixed(3)));
      lastCut = b;
    }
  }
  return cuts;
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
  const rhythmicTransitions: SlideTransitionType[] = [
    'cut',
    'cut',
    'crossfade',
    'cut',
    'slide',
    'wipe_right',
  ];

  const makeMotionAndTrans = (idx: number, dur: number): BeatAlignedClipPlan => {
    const tr = rhythmicTransitions[idx % rhythmicTransitions.length];
    const isDissolve = tr === 'crossfade';
    const idealTrans =
      tr === 'cut'
        ? 0
        : Math.max(
            0.09,
            Math.min(
              isDissolve ? 0.26 : 0.14,
              beatSec * (isDissolve ? 0.48 : 0.26),
              dur * 0.22
            )
          );
    // Keep short beat clips static to avoid zoom bounce; allow gentle drift only on holds >= 2.2s
    const scaleSpan = dur >= 2.2 ? 1.018 : 1.0;
    return {
      durationSec: Number(dur.toFixed(3)),
      transitionDurationSec: Number(idealTrans.toFixed(3)),
      suggestedTransition: tr,
      suggestedScaleStart: 1.0,
      suggestedScaleEnd: scaleSpan,
    };
  };

  // Prefer manual markers if >=2 exist inside trim range, otherwise use detected beat grid
  const manualRel = manualMarkersAbs
    .map((m) => Number((m - trimStart).toFixed(3)))
    .filter((t) => t > 0.15 && t < clipDuration - 0.15)
    .sort((a, b) => a - b);

  if (mode !== 'fit_track') {
    const beatMult =
      mode === 'beats_1' ? 1 : mode === 'beats_2' ? 2 : mode === 'beats_8' ? 8 : 4;
    const detectedGrid =
      manualRel.length >= 2
        ? [0, ...manualRel]
        : beatGrid.beats.length >= 2
          ? [0, ...beatGrid.beats.filter((b) => b > 0.04 && b < clipDuration - 0.1)]
          : null;
    const plans: BeatAlignedClipPlan[] = [];
    let cursor = 0;
    let gridIdx = 0;
    for (let i = 0; i < clipCount; i++) {
      const remaining = Number((clipDuration - cursor).toFixed(3));
      if (remaining < 0.4) break;
      let targetEnd: number;
      if (detectedGrid && gridIdx + beatMult < detectedGrid.length) {
        gridIdx += beatMult;
        targetEnd = Math.min(clipDuration, detectedGrid[gridIdx]);
      } else {
        targetEnd = Math.min(clipDuration, cursor + Math.max(0.5, Math.min(30, beatSec * beatMult)));
      }
      const d = Number(Math.max(0.4, Math.min(30, targetEnd - cursor)).toFixed(3));
      plans.push(makeMotionAndTrans(i, Math.min(d, remaining)));
      cursor = Number((cursor + Math.min(d, remaining)).toFixed(3));
    }
    return plans;
  }

  const grid =
    manualRel.length >= clipCount
      ? [0, ...manualRel]
      : beatGrid.beats.length >= 2
        ? [0, ...beatGrid.beats.filter((b) => b > 0.04 && b < clipDuration - 0.15)]
        : [0];

  const uniqueGrid = Array.from(new Set(grid)).sort((a, b) => a - b);

  if (uniqueGrid.length > clipCount) {
    // Score beats by transient onset, melodic/harmonic novelty, and 4/4 downbeat phase with dynamic phrasing
    const accents =
      monoData && monoData.length > 0 && sampleRate && sampleRate > 0
        ? computeBeatMusicalAccents(uniqueGrid, trimStart, monoData, sampleRate)
        : null;
    const downbeatShift = beatGrid.downbeatOffset ?? 0;
    const step = (uniqueGrid.length - 1) / clipCount;
    const searchRad = Math.max(2, Math.min(6, Math.round(step * 0.45)));
    const cutPoints: number[] = [0];
    let prevSegDur = -1;

    for (let i = 1; i < clipCount; i++) {
      const prev = cutPoints[cutPoints.length - 1];
      const remBeats = uniqueGrid.length - 1;
      const targetIdx = Math.min(
        uniqueGrid.length - (clipCount - i),
        Math.max(i, Math.round(i * step))
      );
      let chosenIdx = targetIdx;
      let bestScore = -1e9;
      const minIdx = Math.max(i, targetIdx - searchRad);
      const maxIdx = Math.min(uniqueGrid.length - (clipCount - i), targetIdx + searchRad);
      for (let cIdx = minIdx; cIdx <= maxIdx; cIdx++) {
        const candTime = uniqueGrid[cIdx];
        const segDur = candTime - prev;
        if (segDur <= 0.45 || (clipDuration - candTime) < 0.4 * (clipCount - i)) continue;
        const barBonus = ((cIdx - downbeatShift) % 4 + 4) % 4 === 0 ? 0.26 : cIdx % 2 === 0 ? 0.08 : 0;
        const musicalScore = accents
          ? (accents.onsetAccent[cIdx] ?? 0.4) * 0.45 +
            (accents.melodicNovelty[cIdx] ?? 0.35) * 0.55
          : 0.4;
        const distPenalty = (Math.abs(cIdx - targetIdx) / Math.max(1, searchRad)) * 0.16;
        const uniformPenalty =
          prevSegDur > 0 && Math.abs(segDur - prevSegDur) < beatSec * 0.6 && searchRad >= 2
            ? 0.14
            : 0;
        const totalScore = musicalScore + barBonus - distPenalty - uniformPenalty;
        if (totalScore > bestScore && cIdx < remBeats) {
          bestScore = totalScore;
          chosenIdx = cIdx;
        }
      }
      const candidate = uniqueGrid[chosenIdx];
      const nextCut =
        candidate > prev + 0.45
          ? Math.min(clipDuration - 0.4 * (clipCount - i), candidate)
          : Number((prev + Math.max(0.45, Math.min(beatSec, (clipDuration - prev) / (clipCount - i + 1)))).toFixed(3));
      prevSegDur = nextCut - prev;
      cutPoints.push(nextCut);
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
  const candidateNext = segPos + 1 < segments.length ? segments[segPos + 1] : null;
  const nextSeg =
    candidateNext && candidateNext.startSec - currentSeg.endSec <= 0.08 ? candidateNext : null;
  const currentSegLen = Math.max(0.1, currentSeg.endSec - currentSeg.startSec);
  const prevSegLen = prevSeg ? Math.max(0.1, prevSeg.endSec - prevSeg.startSec) : currentSegLen;
  const timeInSlide = Math.max(0, localTime - currentSeg.startSec);
  const prevTimeInSlide = prevSeg ? Math.max(0, localTime - prevSeg.startSec) : 0;

  const usePerClipTransition =
    config.slideshowMode === 'custom_durations' || config.slideshowMode === 'manual';

  const resolveBoundaryTransition = (
    outgoingSeg: { clipIndex: number; startSec: number; endSec: number },
    incomingSeg: { clipIndex: number; startSec: number; endSec: number }
  ): { tType: SlideTransitionType; tDur: number } => {
    const outClip = mediaItems[outgoingSeg.clipIndex];
    const tType = usePerClipTransition && outClip ? outClip.transitionOut : config.transitionType;
    if (tType === 'cut') return { tType, tDur: 0 };
    const reqDur = Math.max(
      0.05,
      usePerClipTransition && outClip
        ? outClip.transitionDurationSec
        : config.transitionDurationSec
    );
    const outLen = Math.max(0.1, outgoingSeg.endSec - outgoingSeg.startSec);
    const inLen = Math.max(0.1, incomingSeg.endSec - incomingSeg.startSec);
    // Cap strictly below min(outLen, inLen) * 0.85 so adjacent centered halves (<= 0.425 each) never overlap.
    const maxAllowed = Math.min(outLen * 0.85, inLen * 0.85);
    if (maxAllowed < 0.05) return { tType, tDur: 0 };
    return { tType, tDur: Math.min(reqDur, maxAllowed) };
  };

  if (config.beatCenteredTransitions) {
    const inBoundary = prevSeg ? resolveBoundaryTransition(prevSeg, currentSeg) : { tType: 'cut' as SlideTransitionType, tDur: 0 };
    const outBoundary = nextSeg ? resolveBoundaryTransition(currentSeg, nextSeg) : { tType: 'cut' as SlideTransitionType, tDur: 0 };
    const inHalf = inBoundary.tDur * 0.5;
    const outHalf = outBoundary.tDur * 0.5;

    // 1. Pre-beat half [cut - outHalf .. cut]: blend current -> next, rawP goes 0 -> 0.5 at beat cut
    const timeToCut = Math.max(0, currentSeg.endSec - localTime);
    if (nextSeg && outHalf > 0 && timeToCut < outHalf) {
      const nextSegLen = Math.max(0.1, nextSeg.endSec - nextSeg.startSec);
      const elapsed = outHalf - timeToCut;
      const rawP = Math.max(0, Math.min(1, elapsed / outBoundary.tDur));
      const easedP = rawP * rawP * rawP * (rawP * (rawP * 6 - 15) + 10);
      return {
        activeIndex: nextSeg.clipIndex,
        prevIndex: currentSeg.clipIndex,
        transitionProgress: easedP,
        transitionType: outBoundary.tType,
        slideLocalTime: elapsed,
        prevSlideLocalTime: inHalf + timeInSlide,
        activeSegmentDuration: nextSegLen,
        prevSegmentDuration: currentSegLen,
      };
    }

    // 2. Post-beat half [cut .. cut + inHalf]: finish prev -> current, rawP goes 0.5 -> 1.0
    if (prevSeg && inHalf > 0 && timeInSlide < inHalf) {
      const prevInHalf =
        segPos > 1 && prevSeg.startSec - segments[segPos - 2].endSec <= 0.08
          ? resolveBoundaryTransition(segments[segPos - 2], prevSeg).tDur * 0.5
          : 0;
      const elapsed = inHalf + timeInSlide;
      const rawP = Math.max(0, Math.min(1, elapsed / inBoundary.tDur));
      const easedP = rawP * rawP * rawP * (rawP * (rawP * 6 - 15) + 10);
      return {
        activeIndex: currentSeg.clipIndex,
        prevIndex: prevSeg.clipIndex,
        transitionProgress: easedP,
        transitionType: inBoundary.tType,
        slideLocalTime: elapsed,
        prevSlideLocalTime: prevInHalf + prevTimeInSlide,
        activeSegmentDuration: currentSegLen,
        prevSegmentDuration: prevSegLen,
      };
    }

    return {
      activeIndex: currentSeg.clipIndex,
      prevIndex: null,
      transitionProgress: 1,
      transitionType: inBoundary.tType,
      slideLocalTime: inHalf + timeInSlide,
      prevSlideLocalTime: prevTimeInSlide,
      activeSegmentDuration: currentSegLen,
      prevSegmentDuration: prevSegLen,
    };
  }

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
export type AutoClipMediaPriority = 'auto' | 'video_first' | 'photo_beats';
export type AutoClipPresetId =
  | 'music_story'
  | 'cinema_flow'
  | 'dynamic_drop'
  | 'cinema_trailer'
  | 'crescendo_arc'
  | 'hiphop_groove'
  | 'acoustic_breath'
  | 'shorts_viral'
  | 'story_order'
  | 'remix_shuffle'
  | 'slow_dream'
  | 'beat_flash';

export type AutoClipEditorialProfile =
  | 'story_arc'
  | 'cinema_flow'
  | 'edm_drop'
  | 'trailer'
  | 'crescendo'
  | 'groove'
  | 'acoustic'
  | 'viral_hook'
  | 'sequential'
  | 'remix'
  | 'dream'
  | 'beat_flash';

export type MusicalSectionType =
  | 'intro'
  | 'verse'
  | 'beatless'
  | 'buildup'
  | 'drop'
  | 'outro';

export interface MusicalSectionSegment {
  type: MusicalSectionType;
  startSec: number;
  endSec: number;
  beatStartIdx: number;
  beatEndIdx: number;
  avgEnergy: number;
}

export interface TrackStructureAnalysis {
  beatSections: MusicalSectionType[];
  segments: MusicalSectionSegment[];
  phraseEnergy: number[];
  onsetAccent: number[];
  melodicNovelty: number[];
  rhythmicPulse: number[];
  subBassDrive: number[];
  energySlope: number[];
  dropImpactBeats: number[];
  beatlessMelodicCues: number[];
}

export function createSeededRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 4; i++) next();
  return next;
}

export function getDefaultBoundsForAutoClipRhythm(
  rhythm: AutoClipRhythm
): { minClipSec: number; maxClipSec: number } {
  switch (rhythm) {
    case 'beats_1':
      return { minClipSec: 0.5, maxClipSec: 2.0 };
    case 'beats_2':
      return { minClipSec: 1.0, maxClipSec: 4.0 };
    case 'beats_4':
      return { minClipSec: 2.0, maxClipSec: 10.0 };
    case 'smooth':
      return { minClipSec: 4.0, maxClipSec: 16.0 };
    case 'auto':
    case 'mixed':
    default:
      return { minClipSec: 2.0, maxClipSec: 12.0 };
  }
}

export interface AutoClipGenerateConfig {
  presetId?: AutoClipPresetId;
  editorialProfile?: AutoClipEditorialProfile;
  mode: AutoClipMode;
  rhythm: AutoClipRhythm;
  transitionStyle: AutoClipTransitionStyle;
  motionLevel: AutoClipMotionLevel;
  targetMode: AutoClipTargetMode;
  minClipSec: number;
  maxClipSec: number;
  targetDurationSec: number | null; // null = auto / full available span
  avoidAdjacentRepeat: boolean;
  shuffleOrder: boolean;
  beatCenteredTransitions?: boolean;
  excludeEdgeSec?: number;
  mediaPriority?: AutoClipMediaPriority;
  allowReuseWhenExhausted?: boolean;
  variationSeed?: number;
}

export interface AutoClipPresetDef {
  id: AutoClipPresetId;
  config: Omit<AutoClipGenerateConfig, 'presetId' | 'targetMode' | 'targetDurationSec' | 'variationSeed'>;
}

export const AUTO_CLIP_PRESETS: AutoClipPresetDef[] = [
  {
    id: 'music_story',
    config: {
      editorialProfile: 'story_arc',
      mode: 'auto_rhythm',
      rhythm: 'auto',
      transitionStyle: 'musical',
      motionLevel: 'gentle',
      minClipSec: 2.0,
      maxClipSec: 12.0,
      avoidAdjacentRepeat: true,
      shuffleOrder: true,
      excludeEdgeSec: 5,
    },
  },
  {
    id: 'cinema_flow',
    config: {
      editorialProfile: 'cinema_flow',
      mode: 'auto_rhythm',
      rhythm: 'smooth',
      transitionStyle: 'dissolve',
      motionLevel: 'gentle',
      minClipSec: 4.0,
      maxClipSec: 16.0,
      avoidAdjacentRepeat: true,
      shuffleOrder: true,
      excludeEdgeSec: 5,
    },
  },
  {
    id: 'dynamic_drop',
    config: {
      editorialProfile: 'edm_drop',
      mode: 'auto_rhythm',
      rhythm: 'auto',
      transitionStyle: 'punchy',
      motionLevel: 'dynamic',
      minClipSec: 1.5,
      maxClipSec: 8.5,
      avoidAdjacentRepeat: true,
      shuffleOrder: true,
      excludeEdgeSec: 5,
    },
  },
  {
    id: 'cinema_trailer',
    config: {
      editorialProfile: 'trailer',
      mode: 'auto_rhythm',
      rhythm: 'auto',
      transitionStyle: 'punchy',
      motionLevel: 'dynamic',
      minClipSec: 1.5,
      maxClipSec: 11.0,
      avoidAdjacentRepeat: true,
      shuffleOrder: true,
      excludeEdgeSec: 5,
    },
  },
  {
    id: 'crescendo_arc',
    config: {
      editorialProfile: 'crescendo',
      mode: 'auto_rhythm',
      rhythm: 'auto',
      transitionStyle: 'musical',
      motionLevel: 'gentle',
      minClipSec: 1.5,
      maxClipSec: 14.0,
      avoidAdjacentRepeat: true,
      shuffleOrder: true,
      excludeEdgeSec: 5,
    },
  },
  {
    id: 'hiphop_groove',
    config: {
      editorialProfile: 'groove',
      mode: 'auto_rhythm',
      rhythm: 'beats_4',
      transitionStyle: 'punchy',
      motionLevel: 'gentle',
      minClipSec: 1.5,
      maxClipSec: 8.0,
      avoidAdjacentRepeat: true,
      shuffleOrder: true,
      excludeEdgeSec: 5,
    },
  },
  {
    id: 'acoustic_breath',
    config: {
      editorialProfile: 'acoustic',
      mode: 'auto_rhythm',
      rhythm: 'smooth',
      transitionStyle: 'dissolve',
      motionLevel: 'gentle',
      minClipSec: 3.5,
      maxClipSec: 16.0,
      avoidAdjacentRepeat: true,
      shuffleOrder: true,
      excludeEdgeSec: 5,
    },
  },
  {
    id: 'shorts_viral',
    config: {
      editorialProfile: 'viral_hook',
      mode: 'auto_rhythm',
      rhythm: 'beats_2',
      transitionStyle: 'punchy',
      motionLevel: 'dynamic',
      minClipSec: 0.9,
      maxClipSec: 4.5,
      avoidAdjacentRepeat: true,
      shuffleOrder: true,
      excludeEdgeSec: 4,
    },
  },
  {
    id: 'story_order',
    config: {
      editorialProfile: 'sequential',
      mode: 'sequential',
      rhythm: 'beats_4',
      transitionStyle: 'dissolve',
      motionLevel: 'gentle',
      minClipSec: 3.5,
      maxClipSec: 14.0,
      avoidAdjacentRepeat: true,
      shuffleOrder: false,
      excludeEdgeSec: 5,
    },
  },
  {
    id: 'remix_shuffle',
    config: {
      editorialProfile: 'remix',
      mode: 'random',
      rhythm: 'auto',
      transitionStyle: 'musical',
      motionLevel: 'gentle',
      minClipSec: 2.0,
      maxClipSec: 12.0,
      avoidAdjacentRepeat: true,
      shuffleOrder: true,
      excludeEdgeSec: 5,
    },
  },
  {
    id: 'slow_dream',
    config: {
      editorialProfile: 'dream',
      mode: 'auto_rhythm',
      rhythm: 'smooth',
      transitionStyle: 'dissolve',
      motionLevel: 'gentle',
      minClipSec: 6.0,
      maxClipSec: 18.0,
      avoidAdjacentRepeat: true,
      shuffleOrder: true,
      excludeEdgeSec: 5,
    },
  },
  {
    id: 'beat_flash',
    config: {
      editorialProfile: 'beat_flash',
      mode: 'random',
      rhythm: 'beats_1',
      transitionStyle: 'cuts_only',
      motionLevel: 'off',
      minClipSec: 0.5,
      maxClipSec: 2.0,
      avoidAdjacentRepeat: true,
      shuffleOrder: true,
      excludeEdgeSec: 5,
    },
  },
];

export const DEFAULT_AUTO_CLIP_CONFIG: AutoClipGenerateConfig = {
  presetId: 'music_story',
  editorialProfile: 'story_arc',
  mode: 'auto_rhythm',
  rhythm: 'auto',
  transitionStyle: 'musical',
  motionLevel: 'gentle',
  targetMode: 'replace',
  minClipSec: 2.0,
  maxClipSec: 12.0,
  targetDurationSec: null,
  avoidAdjacentRepeat: true,
  shuffleOrder: true,
  beatCenteredTransitions: true,
  excludeEdgeSec: 5,
  mediaPriority: 'auto',
  allowReuseWhenExhausted: false,
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
  panStartX?: number;
  panStartY?: number;
  panEndX?: number;
  panEndY?: number;
  easing?: KeyframeEasing;
  cutImpact?: number;
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

  const linearNorm = rawEnergy.map((v) => Math.max(0, Math.min(1, (v - lowRef) / span)));
  // Blend percentile rank so loudness-mastered tracks still distinguish verses, bridges, and peaks
  const indexedRanks = rawEnergy
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v);
  const rankNorm = new Array<number>(count).fill(0.5);
  const denom = Math.max(1, count - 1);
  for (let r = 0; r < indexedRanks.length; r++) {
    rankNorm[indexedRanks[r].i] = r / denom;
  }
  const normalized = linearNorm.map((lin, i) => Math.max(0, Math.min(1, lin * 0.58 + rankNorm[i] * 0.42)));

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
 * Analyzes musical macro-structure along aligned beats: detects quiet intros,
 * no-beat ambient/breakdown pockets ('beatless'), rising crescendos/buildups ('buildup'),
 * high-impact drop/chorus sections ('drop'), steady grooves ('verse'), and soft endings ('outro').
 */
export function analyzeMusicalStructure(
  beatTimes: number[],
  trimStart: number,
  targetLimit: number,
  monoData?: Float32Array,
  sampleRate?: number,
  barAnchorIdx = 0
): TrackStructureAnalysis {
  const count = beatTimes.length;
  const empty: TrackStructureAnalysis = {
    beatSections: [],
    segments: [],
    phraseEnergy: [],
    onsetAccent: [],
    melodicNovelty: [],
    rhythmicPulse: [],
    subBassDrive: [],
    energySlope: [],
    dropImpactBeats: [],
    beatlessMelodicCues: [],
  };
  if (count === 0) return empty;

  const phraseEnergy = computePhraseEnergyCurve(
    beatTimes,
    trimStart,
    targetLimit,
    monoData,
    sampleRate
  );
  const { onsetAccent, melodicNovelty } = computeBeatMusicalAccents(
    beatTimes,
    trimStart,
    monoData,
    sampleRate
  );

  const rhythmicPulse = new Array<number>(count).fill(0.5);
  const subBassDrive = new Array<number>(count).fill(0.5);
  const hasAudioSignal = Boolean(monoData && monoData.length > 0 && sampleRate && sampleRate > 0);

  if (hasAudioSignal && monoData && sampleRate) {
    const totalSamples = monoData.length;
    const rawPulse = new Array<number>(count).fill(0);
    const rawSub = new Array<number>(count).fill(0);
    const lowAlpha = Math.min(0.45, Math.max(0.03, (2 * Math.PI * 145) / sampleRate));

    for (let i = 0; i < count; i++) {
      const bt = beatTimes[i];
      const nextBt =
        i + 1 < count
          ? beatTimes[i + 1]
          : bt + (i > 0 ? beatTimes[i] - beatTimes[i - 1] : 0.5);
      const sBeat = Math.max(0, Math.min(totalSamples - 1, Math.floor((trimStart + bt) * sampleRate)));
      const sPre0 = Math.max(0, sBeat - Math.floor(sampleRate * 0.02));
      const sPost1 = Math.min(totalSamples, sBeat + Math.floor(sampleRate * 0.065));
      const sBody0 = Math.min(totalSamples - 1, sBeat + Math.floor(sampleRate * 0.095));
      const sBody1 = Math.max(
        sBody0 + 1,
        Math.min(totalSamples, Math.floor((trimStart + nextBt) * sampleRate) - Math.floor(sampleRate * 0.02))
      );

      let atkSq = 0;
      let atkN = 0;
      let lp = 0;
      let lpSq = 0;
      const stepA = Math.max(1, Math.floor((sPost1 - sPre0) / 140));
      for (let s = sPre0; s < sPost1; s += stepA) {
        const v = monoData[s];
        atkSq += v * v;
        lp += lowAlpha * (v - lp);
        lpSq += lp * lp;
        atkN++;
      }

      let bodySq = 0;
      let bodyN = 0;
      const stepB = Math.max(1, Math.floor((sBody1 - sBody0) / 140));
      for (let s = sBody0; s < sBody1; s += stepB) {
        const v = monoData[s];
        bodySq += v * v;
        bodyN++;
      }

      const atkRms = Math.sqrt(atkSq / Math.max(1, atkN));
      const bodyRms = Math.sqrt(bodySq / Math.max(1, bodyN));
      const ratio = atkRms / Math.max(0.008, bodyRms);
      // Kick/snare pulse combines attack transient strength with sharp attack-over-sustain contrast
      rawPulse[i] = atkRms * 0.52 + Math.max(0, ratio - 0.85) * 0.14 + (onsetAccent[i] ?? 0) * 0.25;
      rawSub[i] = Math.sqrt(lpSq / Math.max(1, atkN));
    }

    const normPulse = normalizeScores01(rawPulse);
    const normSub = normalizeScores01(rawSub);
    for (let i = 0; i < count; i++) {
      let accP = 0;
      let accS = 0;
      let w = 0;
      for (let k = -1; k <= 1; k++) {
        const j = i + k;
        if (j >= 0 && j < count) {
          const wt = k === 0 ? 2 : 1;
          accP += normPulse[j] * wt;
          accS += normSub[j] * wt;
          w += wt;
        }
      }
      rhythmicPulse[i] = w > 0 ? accP / w : 0.5;
      subBassDrive[i] = w > 0 ? accS / w : 0.5;
    }
  } else {
    for (let i = 0; i < count; i++) {
      const e = phraseEnergy[i] ?? 0.5;
      rhythmicPulse[i] = Math.max(0.15, Math.min(0.95, e * 0.85 + (((i - barAnchorIdx) % 4 + 4) % 4 === 0 ? 0.15 : 0)));
      subBassDrive[i] = e;
    }
  }

  // Per-beat smoothed energy slope over +/- 3..4 beats to catch slowdowns & crescendos cleanly
  const energySlope = new Array<number>(count).fill(0);
  for (let i = 0; i < count; i++) {
    const back = Math.max(0, i - 3);
    const fwd = Math.min(count - 1, i + 3);
    const span = Math.max(1, fwd - back);
    energySlope[i] = ((phraseEnergy[fwd] ?? 0.5) - (phraseEnergy[back] ?? 0.5)) / span;
  }

  // Raw per-beat label classification
  const totalDur = Math.max(1, beatTimes[count - 1] - beatTimes[0]);
  const isShort = totalDur < 26;
  const rawSections: MusicalSectionType[] = new Array(count).fill('verse');

  for (let i = 0; i < count; i++) {
    const bt = beatTimes[i];
    const progress = (bt - beatTimes[0]) / totalDur;
    const e = phraseEnergy[i] ?? 0.5;
    const pulse = rhythmicPulse[i] ?? 0.5;
    const bass = subBassDrive[i] ?? 0.5;
    const slope = energySlope[i] ?? 0;
    const fwdIdx = Math.min(count - 1, i + (isShort ? 3 : 6));
    const fwdEnergy = phraseEnergy[fwdIdx] ?? e;
    const fwdPulse = rhythmicPulse[fwdIdx] ?? pulse;

    if (progress <= (isShort ? 0.24 : 0.16) && e < 0.56 && (pulse < 0.55 || e < 0.42)) {
      rawSections[i] = 'intro';
    } else if (progress >= (isShort ? 0.76 : 0.84) && e < 0.54 && slope <= 0.01) {
      rawSections[i] = 'outro';
    } else if (
      hasAudioSignal &&
      ((pulse < 0.24 && bass < 0.34) || (e < 0.26 && pulse < 0.35))
    ) {
      // Quiet or beatless breakdown / ambient vocal pocket
      rawSections[i] = 'beatless';
    } else if (
      ((slope >= 0.032 && fwdEnergy - e >= 0.14 && fwdEnergy >= 0.58 && e < 0.78) ||
        (slope >= 0.02 && fwdPulse - pulse >= 0.42 && pulse < 0.45)) &&
      fwdPulse >= 0.52
    ) {
      rawSections[i] = 'buildup';
    } else if (
      (e >= 0.68 && (pulse >= 0.32 || !hasAudioSignal)) ||
      (e >= 0.58 && (pulse >= 0.45 || !hasAudioSignal)) ||
      (pulse >= 0.62 && bass >= 0.55) ||
      (pulse >= 0.72 && bass >= 0.42)
    ) {
      rawSections[i] = 'drop';
    } else if (!hasAudioSignal && e < 0.35) {
      rawSections[i] = progress < 0.3 ? 'intro' : progress > 0.7 ? 'outro' : 'beatless';
    } else {
      rawSections[i] = 'verse';
    }
  }

  // Smoothing hysteresis so sections dwell cleanly for at least ~1-2 bars instead of flickering
  const beatSections: MusicalSectionType[] = [...rawSections];
  const radius = isShort ? 1 : 2;
  for (let i = 0; i < count; i++) {
    const counts = new Map<MusicalSectionType, number>();
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < count) {
        const label = rawSections[j];
        counts.set(label, (counts.get(label) ?? 0) + (k === 0 ? 1.5 : 1));
      }
    }
    let bestLabel = rawSections[i];
    let bestW = -1;
    counts.forEach((w, lbl) => {
      if (w > bestW) {
        bestW = w;
        bestLabel = lbl;
      }
    });
    beatSections[i] = bestLabel;
  }

  // Enforce minimum dwell run length (>= 4 beats on normal tracks, >= 2 on short tracks)
  const minRunBeats = isShort ? 2 : 4;
  let runStart = 0;
  while (runStart < count) {
    let runEnd = runStart + 1;
    while (runEnd < count && beatSections[runEnd] === beatSections[runStart]) {
      runEnd++;
    }
    const runLen = runEnd - runStart;
    if (runLen < minRunBeats && runStart > 0 && runEnd < count) {
      const prevType = beatSections[runStart - 1];
      const nextType = beatSections[runEnd];
      const replacement =
        prevType === 'drop' || nextType === 'drop'
          ? 'drop'
          : beatSections[runStart] === 'beatless'
            ? beatSections[runStart]
            : prevType;
      for (let k = runStart; k < runEnd; k++) {
        beatSections[k] = replacement;
      }
    }
    runStart = runEnd;
  }

  // Group into contiguous segments
  const segments: MusicalSectionSegment[] = [];
  let segStart = 0;
  while (segStart < count) {
    let segEnd = segStart + 1;
    while (segEnd < count && beatSections[segEnd] === beatSections[segStart]) {
      segEnd++;
    }
    let sumE = 0;
    for (let k = segStart; k < segEnd; k++) {
      sumE += phraseEnergy[k] ?? 0.5;
    }
    const avgSecEnd =
      segEnd < count
        ? beatTimes[segEnd]
        : Math.max(beatTimes[segEnd - 1] + 0.5, targetLimit);
    segments.push({
      type: beatSections[segStart],
      startSec: Number(beatTimes[segStart].toFixed(3)),
      endSec: Number(avgSecEnd.toFixed(3)),
      beatStartIdx: segStart,
      beatEndIdx: segEnd - 1,
      avgEnergy: Number((sumE / Math.max(1, segEnd - segStart)).toFixed(3)),
    });
    segStart = segEnd;
  }

  // Detect true drop impact beats & beatless melodic cues
  const dropImpactBeats: number[] = [];
  for (let i = 1; i < count; i++) {
    const prevSec = beatSections[i - 1];
    const curSec = beatSections[i];
    const dE = (phraseEnergy[i] ?? 0.5) - (phraseEnergy[Math.max(0, i - 4)] ?? 0.5);
    const dPulse = (rhythmicPulse[i] ?? 0.5) - (rhythmicPulse[Math.max(0, i - 3)] ?? 0.5);
    const isDropEntry =
      curSec === 'drop' && prevSec !== 'drop';
    const isBarImpact =
      ((i - barAnchorIdx) % 4 + 4) % 4 === 0 &&
      curSec === 'drop' &&
      (dE >= 0.22 || dPulse >= 0.28) &&
      (onsetAccent[i] ?? 0) >= 0.62;
    if (isDropEntry || isBarImpact) {
      if (dropImpactBeats.length === 0 || i - dropImpactBeats[dropImpactBeats.length - 1] >= 4) {
        dropImpactBeats.push(i);
      }
    }
  }

  const beatlessMelodicCues: number[] = [];
  for (let i = 2; i < count - 2; i++) {
    if (beatSections[i] !== 'beatless' && beatSections[i] !== 'intro' && beatSections[i] !== 'outro') {
      continue;
    }
    const m = melodicNovelty[i] ?? 0;
    const isLocalPeak =
      m >= 0.52 &&
      m >= (melodicNovelty[i - 1] ?? 0) &&
      m >= (melodicNovelty[i + 1] ?? 0);
    if (
      isLocalPeak &&
      (beatlessMelodicCues.length === 0 ||
        i - beatlessMelodicCues[beatlessMelodicCues.length - 1] >= 4)
    ) {
      beatlessMelodicCues.push(i);
    }
  }

  return {
    beatSections,
    segments,
    phraseEnergy,
    onsetAccent,
    melodicNovelty,
    rhythmicPulse,
    subBassDrive,
    energySlope,
    dropImpactBeats,
    beatlessMelodicCues,
  };
}

/**
 * Generates a composition-, beat-, melody-, and transition-aware montage:
 * - Analyzes song structure (intro / beatless / buildup / drop / verse / outro) so
 *   calm/beatless passages breathe on melodic chord changes, crescendos accelerate into
 *   drop downbeats, and drops hit with rhythmic energy.
 * - Budgets transition durations & video tail headroom per cut slot.
 * - Uses `variationSeed` for genuinely distinct takes across regenerations.
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
    editorialProfile?: AutoClipEditorialProfile;
    transitionStyle?: AutoClipTransitionStyle;
    motionLevel?: AutoClipMotionLevel;
    mediaPriority?: AutoClipMediaPriority;
    minClipSec?: number;
    maxClipSec?: number;
    targetDurationSec?: number | null;
    startOffsetSec?: number;
    avoidAdjacentRepeat?: boolean;
    shuffleOrder?: boolean;
    excludeEdgeSec?: number;
    excludeUsedUrls?: Set<string>;
    excludeVideoRangesByUrl?: Map<string, Array<[number, number]>>;
    preferAvoidUrls?: Set<string>;
    preferAvoidVideoRangesByUrl?: Map<string, Array<[number, number]>>;
    fillToTargetEnd?: boolean;
    strictSingleUse?: boolean;
    hasAudio?: boolean;
    monoData?: Float32Array;
    sampleRate?: number;
    variationSeed?: number;
    rng?: () => number;
  } = {}
): AutoBeatSlicePlacement[] {
  if (binItems.length === 0) return [];
  const mode: AutoClipMode = options.mode ?? 'auto_rhythm';
  const rawRhythm = options.rhythm ?? 'auto';
  const rhythm: Exclude<AutoClipRhythm, 'mixed'> = rawRhythm === 'mixed' ? 'auto' : rawRhythm;
  const editorialProfile: AutoClipEditorialProfile =
    options.editorialProfile ??
    (mode === 'sequential'
      ? 'sequential'
      : mode === 'random'
        ? rhythm === 'beats_1'
          ? 'beat_flash'
          : 'remix'
        : rhythm === 'smooth'
          ? 'cinema_flow'
          : 'story_arc');
  const transitionStyle: AutoClipTransitionStyle = options.transitionStyle ?? 'musical';
  const motionLevel: AutoClipMotionLevel = options.motionLevel ?? 'gentle';
  const mediaPriority: AutoClipMediaPriority = options.mediaPriority ?? 'auto';
  const avoidAdjacentRepeat = options.avoidAdjacentRepeat ?? true;
  const shouldShuffle = options.shuffleOrder ?? mode !== 'sequential';
  const strictSingleUse = options.strictSingleUse ?? false;
  const fillToTargetEnd = options.fillToTargetEnd ?? false;
  const hasAudio = options.hasAudio ?? true;
  const excludeEdgeSec = Math.max(0, options.excludeEdgeSec ?? 5);
  const rng =
    options.rng ??
    (options.variationSeed !== undefined ? createSeededRng(options.variationSeed) : Math.random);
  const beatSec =
    beatGrid.beatSec > 0.2 && beatGrid.beatSec < 1.5 ? beatGrid.beatSec : 0.5;
  const startOffsetSec = Math.max(0, Number((options.startOffsetSec ?? 0).toFixed(3)));

  // Prepare media pool up-front so Stage 1 & Stage 2 share exact knowledge of mixed photo + video assets
  const getAssetContentKey = (b: MediaBinItem): string => {
    const cleanName = (b.fileName || '').trim().toLowerCase();
    const sizeKey = b.fileSize !== undefined && b.fileSize > 0 ? `:${b.fileSize}` : '';
    if (b.kind === 'image') {
      return cleanName ? `img:${cleanName}:${b.width}x${b.height}${sizeKey}` : `url:${b.url}`;
    }
    const durKey = Math.round((b.videoDuration ?? b.defaultDurationSec ?? 0) * 10);
    const sKey =
      b.defaultSourceStartSec !== undefined ? Number(b.defaultSourceStartSec.toFixed(1)) : '';
    const eKey =
      b.defaultSourceEndSec !== undefined ? Number(b.defaultSourceEndSec.toFixed(1)) : '';
    return cleanName
      ? `vid:${cleanName}:${durKey}:${b.width}x${b.height}${sizeKey}:${sKey}:${eKey}`
      : `url:${b.url}`;
  };

  interface PoolImage {
    kind: 'image';
    binItem: MediaBinItem;
    contentKey: string;
  }
  interface PoolVideo {
    kind: 'video';
    binItem: MediaBinItem;
    contentKey: string;
    rate: number;
    initStart: number;
    initEnd: number;
    usableSpan: number;
    vDur: number;
  }
  type PoolAsset = PoolImage | PoolVideo;

  const freeRangesByKey = new Map<string, Array<[number, number]>>();
  const usedImageKeys = new Set<string>();
  const seqCursorByKey = new Map<string, number>();
  const usedSlicesByKey = new Map<string, Array<[number, number]>>();
  const usageCountByKey = new Map<string, number>();
  const lastSlotIdxByKey = new Map<string, number>();
  const placedIndicesByKey = new Map<string, number[]>();
  const SLICE_BUCKET_COUNT = 48;
  const sliceBucketsByKey = new Map<
    string,
    { counts: Float32Array; lastUsed: Int32Array; initStart: number; initEnd: number }
  >();
  let placementSeq = 0;

  // Map URL-based external exclusions onto canonical content keys so duplicate files in bin also honor them
  const urlToKey = new Map<string, string>();
  for (const b of binItems) {
    urlToKey.set(b.url, getAssetContentKey(b));
  }
  const excludedImgKeys = new Set<string>();
  if (options.excludeUsedUrls) {
    for (const u of options.excludeUsedUrls) {
      excludedImgKeys.add(urlToKey.get(u) ?? `url:${u}`);
    }
  }
  const excludedRangesByKey = new Map<string, Array<[number, number]>>();
  if (options.excludeVideoRangesByUrl) {
    for (const [u, list] of options.excludeVideoRangesByUrl.entries()) {
      const k = urlToKey.get(u) ?? `url:${u}`;
      const merged = excludedRangesByKey.get(k) ?? [];
      merged.push(...list);
      excludedRangesByKey.set(k, merged);
    }
  }
  const softExcludedImgKeys = new Set<string>();
  if (options.preferAvoidUrls) {
    for (const u of options.preferAvoidUrls) {
      softExcludedImgKeys.add(urlToKey.get(u) ?? `url:${u}`);
    }
  }
  const softExcludedRangesByKey = new Map<string, Array<[number, number]>>();
  if (options.preferAvoidVideoRangesByUrl) {
    for (const [u, list] of options.preferAvoidVideoRangesByUrl.entries()) {
      const k = urlToKey.get(u) ?? `url:${u}`;
      const merged = softExcludedRangesByKey.get(k) ?? [];
      merged.push(...list);
      softExcludedRangesByKey.set(k, merged);
    }
  }

  const getMinSlotDist = (key: string, slotIdx: number): number => {
    const list = placedIndicesByKey.get(key);
    if (!list || list.length === 0) return 9999;
    let best = Infinity;
    for (let k = 0; k < list.length; k++) {
      const d = Math.abs(slotIdx - list[k]);
      if (d < best) best = d;
    }
    return best;
  };

  const minSliceKeep = 0.35;
  const slicePad = 0.08;

  const initPoolAndRanges = (respectExclusions: boolean): PoolAsset[] => {
    freeRangesByKey.clear();
    usedImageKeys.clear();
    if (respectExclusions) {
      for (const k of excludedImgKeys) usedImageKeys.add(k);
    }
    const assets: PoolAsset[] = [];
    for (const b of binItems) {
      const cKey = getAssetContentKey(b);
      if (b.kind === 'image') {
        if (!usedImageKeys.has(cKey)) {
          assets.push({ kind: 'image', binItem: b, contentKey: cKey });
        }
      } else {
        const safe = resolveSafeVideoSourceRange(b, excludeEdgeSec);
        const rate = Math.max(0.25, Math.min(4, b.defaultPlaybackRate ?? 1.0));
        if (!freeRangesByKey.has(cKey)) {
          const baseRange: [number, number] = [safe.sourceStartSec, safe.sourceEndSec];
          const excluded = respectExclusions ? excludedRangesByKey.get(cKey) ?? [] : [];
          const ranges =
            excluded.length > 0
              ? subtractUsedIntervals(baseRange, excluded, minSliceKeep)
              : baseRange[1] - baseRange[0] >= 0.25
                ? [baseRange]
                : [];
          freeRangesByKey.set(cKey, ranges);
          seqCursorByKey.set(cKey, ranges.length > 0 ? ranges[0][0] : safe.sourceStartSec);
        }
        const availRanges = freeRangesByKey.get(cKey) ?? [];
        if (availRanges.length > 0) {
          assets.push({
            kind: 'video',
            binItem: b,
            contentKey: cKey,
            rate,
            initStart: safe.sourceStartSec,
            initEnd: safe.sourceEndSec,
            usableSpan: safe.usableSpanSec,
            vDur: safe.rawDurationSec,
          });
        }
      }
    }
    return assets;
  };

  let pool = initPoolAndRanges(true);
  if (pool.length === 0) {
    pool = initPoolAndRanges(false);
  }
  if (pool.length === 0) return [];

  if (shouldShuffle && pool.length > 1) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
  }

  const poolVideos = pool.filter((e): e is PoolVideo => e.kind === 'video');
  const poolImages = pool.filter((e): e is PoolImage => e.kind === 'image');
  const uniqueVideoContentKeysCount = new Set(poolVideos.map((v) => v.contentKey)).size;
  const hasUsableVideos = poolVideos.some(
    (v) => (freeRangesByKey.get(v.contentKey) ?? []).length > 0
  );
  const hasUsableImages = poolImages.some((img) => !excludedImgKeys.has(img.contentKey));
  const hasMixedPool = hasUsableVideos && hasUsableImages;
  const shortBeatMaxSec = Math.max(1.4, Math.min(2.6, beatSec * 3.1));

  const estimateNoAudioBinSpan = (): number => {
    let total = 0;
    for (const b of binItems) {
      if (b.kind === 'image') {
        total += Math.max(0.5, b.defaultDurationSec || 4);
      } else {
        const safe = resolveSafeVideoSourceRange(b, excludeEdgeSec);
        const rate = Math.max(0.25, Math.min(4, b.defaultPlaybackRate ?? 1.0));
        total += safe.usableSpanSec / rate;
      }
    }
    return Math.max(12, Math.min(Math.max(12, maxTimelineSec), Math.min(600, total + 12)));
  };

  const baseLimit = hasAudio
    ? Math.max(0.5, maxTimelineSec)
    : Math.max(12, Math.min(maxTimelineSec, estimateNoAudioBinSpan()));
  const targetLimit =
    options.targetDurationSec && options.targetDurationSec > 0.5
      ? Math.min(hasAudio ? Math.max(0.5, maxTimelineSec) : Math.max(12, maxTimelineSec), startOffsetSec + options.targetDurationSec)
      : baseLimit;
  if (startOffsetSec >= targetLimit - 0.45) return [];

  const totalSpanSec = targetLimit - startOffsetSec;
  const minClipBound = Math.max(
    0.45,
    Math.min(
      16,
      options.minClipSec ??
        (rhythm === 'beats_1' ? 0.5 : rhythm === 'beats_2' ? 0.95 : rhythm === 'smooth' ? 4.0 : 2.0)
    )
  );
  const maxClipBound = Math.max(
    minClipBound + 0.3,
    Math.min(
      24,
      options.maxClipSec ??
        (rhythm === 'beats_1' ? 2.0 : rhythm === 'beats_2' ? 4.0 : rhythm === 'smooth' ? 16.0 : 12.0)
    )
  );
  const hardMaxDur = Math.max(maxClipBound + beatSec * 0.5, maxClipBound * 1.12);
  const enforceBarGrid =
    (rhythm === 'auto' || rhythm === 'smooth' || rhythm === 'beats_4') &&
    maxClipBound >= beatSec * 3.8;
  const uniqueFileCount = Math.max(1, new Set(binItems.map((b) => getAssetContentKey(b))).size);
  const avgTargetPerFile = totalSpanSec / uniqueFileCount;

  // =========================================================================
  // STAGE 1: Audio-First Bar & Phrase Segmentation
  // Quantizes cuts cleanly onto musical bar downbeats ("тактовый бит") while keeping
  // segments as long as possible to avoid choppy rapid-fire fragmentation.
  // =========================================================================
  const manualRel = manualMarkersAbs
    .map((m) => Number((m - trimStart).toFixed(3)))
    .filter((t) => t > startOffsetSec + 0.15 && t < targetLimit - 0.15)
    .sort((a, b) => a - b);

  const detectedFiltered =
    beatGrid.beats.length >= 2
      ? beatGrid.beats.filter((b) => b > startOffsetSec + 0.05 && b < targetLimit - 0.12)
      : [];
  const filteredIdx =
    beatGrid.beats.length >= 2
      ? beatGrid.beats.findIndex((b) => b > startOffsetSec + 0.05 && b < targetLimit - 0.12)
      : -1;

  let baseBeats: number[];
  let barAnchorIdx = 0;
  if (manualRel.length >= 2) {
    const merged: number[] = [startOffsetSec];
    const denseMarkers = [startOffsetSec, ...manualRel];
    for (let i = 0; i < denseMarkers.length; i++) {
      const a = denseMarkers[i];
      if (i > 0 && a - merged[merged.length - 1] >= 0.15) {
        merged.push(a);
      }
      const nextAnchor = i + 1 < denseMarkers.length ? denseMarkers[i + 1] : null;
      if (nextAnchor !== null && nextAnchor - a > beatSec * 1.65) {
        const innerDetected = detectedFiltered.filter(
          (b) => b > a + beatSec * 0.48 && b < nextAnchor - beatSec * 0.48
        );
        if (innerDetected.length > 0) {
          for (const b of innerDetected) {
            if (b - merged[merged.length - 1] >= beatSec * 0.48) {
              merged.push(b);
            }
          }
        } else {
          let filler = a + beatSec;
          while (filler < nextAnchor - beatSec * 0.48) {
            merged.push(Number(filler.toFixed(3)));
            filler += beatSec;
          }
        }
      }
    }
    baseBeats = merged;
    barAnchorIdx = manualRel[0] > startOffsetSec + 0.05 ? 1 : 0;
  } else if (detectedFiltered.length >= 1) {
    baseBeats = [startOffsetSec, ...detectedFiltered];
    const gridDownbeat = beatGrid.downbeatOffset ?? 0;
    if (filteredIdx >= 0) {
      const offsetInFiltered = ((gridDownbeat - filteredIdx) % 4 + 4) % 4;
      barAnchorIdx = (detectedFiltered[0] > startOffsetSec + 0.05 ? 1 : 0) + offsetInFiltered;
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
  const maxBeatEntries = Math.max(
    2400,
    Math.ceil(totalSpanSec / Math.max(0.25, beatSec)) + 32
  );
  while (lastBeat + beatSec < targetLimit + beatSec * 6 && beatTimes.length < maxBeatEntries) {
    lastBeat = Number((lastBeat + beatSec).toFixed(3));
    beatTimes.push(lastBeat);
  }

  const structure = analyzeMusicalStructure(
    beatTimes,
    trimStart,
    targetLimit,
    options.monoData,
    options.sampleRate,
    barAnchorIdx
  );
  const {
    phraseEnergy,
    onsetAccent,
    melodicNovelty,
    beatSections,
    dropImpactBeats,
    beatlessMelodicCues,
  } = structure;
  const dropImpactSet = new Set(dropImpactBeats);
  const beatlessCueSet = new Set(beatlessMelodicCues);

  const isDownbeatIndex = (idx: number): boolean =>
    ((idx - barAnchorIdx) % 4 + 4) % 4 === 0;

  // Compute run-level personality dials once via RNG when shouldShuffle=true so every
  // take/regeneration produces a noticeably different montage arc and pacing pattern.
  const takeEnergyBias = shouldShuffle ? (rng() - 0.5) * 0.14 : 0;
  const takeSyncopationPref = shouldShuffle ? rng() : 0.5;
  const takeOpeningRoll = shouldShuffle ? rng() : 0.5;

  const recentSteps: number[] = [];
  let stage1SlotOrd = 0;
  const hasRealAudioSignals = Boolean(
    options.monoData && options.monoData.length > 0 && options.sampleRate && options.sampleRate > 0
  );

  const getBeatStepsForIndex = (
    bIdx: number
  ): {
    steps: number[];
    energy: number;
    hitStrength: number;
    allowShortPhotoPunch: boolean;
    section: MusicalSectionType;
  } => {
    const rawEnergy = phraseEnergy[bIdx] ?? 0.5;
    const energy = Math.max(0, Math.min(1, rawEnergy + takeEnergyBias * 0.5));
    const section = beatSections[bIdx] ?? 'verse';
    const curOnset = onsetAccent[bIdx] ?? 0.5;
    const curMelody = melodicNovelty[bIdx] ?? 0.4;
    const hitStrength = curOnset * 0.55 + curMelody * 0.45;
    const isShortSpan = totalSpanSec < 26;
    const prevStep1 = recentSteps.length > 0 ? recentSteps[recentSteps.length - 1] : 0;
    const prevStep2 = recentSteps.length > 1 ? recentSteps[recentSteps.length - 2] : 0;

    // Locate next upcoming drop impact beat within the next maxClipBound window so long holds
    // land right onto the drop downbeat instead of overshooting across it.
    let nextDropDelta = -1;
    for (let d = 1; d <= 20 && bIdx + d < beatTimes.length; d++) {
      if (dropImpactSet.has(bIdx + d)) {
        nextDropDelta = d;
        break;
      }
    }
    const isBuildupBeforeDrop =
      section === 'buildup' || (nextDropDelta > 0 && nextDropDelta <= 8 && section !== 'drop');

    const uniqueImageKeysCount = new Set(poolImages.map((img) => img.contentKey)).size;
    const richPhotoBin = hasMixedPool && mediaPriority !== 'video_first' && uniqueImageKeysCount > 3;
    const photoMajorityBin =
      richPhotoBin && uniqueImageKeysCount >= Math.max(6, Math.round(uniqueVideoContentKeysCount * 1.4));

    const allowShortPhotoPunch =
      hasMixedPool &&
      shouldShuffle &&
      section !== 'beatless' &&
      mediaPriority !== 'video_first' &&
      (rhythm === 'auto' || rhythm === 'beats_4') &&
      maxClipBound >= beatSec * 1.8 &&
      recentSteps.length > 0 &&
      (prevStep1 >= 4 || (photoMajorityBin && stage1SlotOrd % 2 === 1 && prevStep2 >= 4)) &&
      (section === 'intro'
        ? (uniqueVideoContentKeysCount <= 2 && stage1SlotOrd >= 1) ||
          (stage1SlotOrd >= 2 && (photoMajorityBin || (takeOpeningRoll > 0.4 && curOnset >= 0.45)))
        : isShortSpan
          ? hasRealAudioSignals
            ? energy >= 0.5 || hitStrength >= 0.58 || (prevStep2 >= 4 && curOnset >= 0.5)
            : prevStep2 >= 4 || stage1SlotOrd % 2 === 1
          : rhythm === 'auto'
            ? (prevStep2 >= 4 ||
                energy >= 0.65 ||
                section === 'drop' ||
                uniqueVideoContentKeysCount <= 2 ||
                richPhotoBin) &&
              (hasRealAudioSignals
                ? energy >= 0.48 ||
                  hitStrength >= (richPhotoBin ? 0.44 : 0.56) ||
                  stage1SlotOrd % (richPhotoBin ? 2 : 4) === (richPhotoBin ? 1 : 3)
                : stage1SlotOrd % 2 === 1)
            : (prevStep2 >= 4 || richPhotoBin) &&
              (hasRealAudioSignals
                ? stage1SlotOrd % (richPhotoBin ? 2 : 3) === (richPhotoBin ? 1 : 2) ||
                  hitStrength >= (richPhotoBin ? 0.45 : 0.56)
                : stage1SlotOrd % (richPhotoBin ? 2 : 3) === (richPhotoBin ? 1 : 2)));

    let preferredOrder: number[];
    const effectiveRhythm =
      mode === 'random' && rhythm === 'auto' && takeSyncopationPref > 0.6
        ? 'beats_4'
        : rhythm;

    if (rhythm === 'beats_1') {
      preferredOrder = beatSec < 0.44 ? [2, 1] : [1, 2];
    } else if (rhythm === 'beats_2') {
      if (editorialProfile === 'viral_hook' && bIdx < 6) {
        preferredOrder = [2, 1, 3];
      } else {
        preferredOrder = beatSec < 0.48 ? [2, 4, 3, 1] : [2, 4, 1, 3];
      }
    } else if (effectiveRhythm === 'beats_4') {
      if (allowShortPhotoPunch) {
        preferredOrder = [2, 4, 6, 8];
      } else if (
        mode !== 'sequential' &&
        (section === 'beatless' || section === 'intro' || section === 'outro')
      ) {
        preferredOrder = isShortSpan ? [8, 6, 4] : [12, 8, 16, 6];
      } else if (isShortSpan) {
        preferredOrder = [4, 6, 8, 2];
      } else if (editorialProfile === 'groove') {
        preferredOrder =
          section === 'drop' || rawEnergy >= 0.68
            ? [4, 6, 2, 8]
            : takeSyncopationPref > 0.5
              ? [4, 6, 8, 2]
              : [6, 4, 8, 12];
      } else {
        preferredOrder = avgTargetPerFile >= 8 ? [12, 8, 6, 16, 4] : [8, 4, 12, 6, 16];
      }
    } else if (rhythm === 'smooth' || editorialProfile === 'acoustic' || editorialProfile === 'dream') {
      if (isShortSpan) {
        preferredOrder =
          editorialProfile === 'dream'
            ? [12, 8, 16]
            : energy > 0.72
              ? [4, 6, 8]
              : [8, 12, 6, 4];
      } else if (editorialProfile === 'dream') {
        preferredOrder =
          section === 'beatless' || section === 'intro' || section === 'outro'
            ? [24, 20, 16]
            : [20, 24, 16, 12];
      } else if (editorialProfile === 'acoustic') {
        preferredOrder =
          section === 'beatless' || section === 'intro' || section === 'outro'
            ? [16, 12, 8]
            : curMelody >= 0.58 || energy > 0.64
              ? [8, 12, 6, 16]
              : [12, 8, 16, 6];
      } else if (section === 'beatless' || section === 'intro' || section === 'outro') {
        preferredOrder = [16, 20, 12, 24];
      } else {
        preferredOrder = energy > 0.72 ? [12, 8, 16, 20] : [16, 24, 12, 20, 8];
      }
    } else if (editorialProfile === 'viral_hook' && beatTimes[bIdx] - startOffsetSec < 2.6) {
      // Viral hook: snappy opening hook regardless of quiet intro before locking into music flow
      preferredOrder = beatSec < 0.46 ? [2, 3, 4] : [2, 1, 4];
    } else if (section === 'beatless' && !isShortSpan) {
      // No-beat / breakdown / ambient pocket: hold calm wide shots until chord shift / drop entry
      const slowCalm =
        editorialProfile === 'crescendo' ||
        editorialProfile === 'cinema_flow' ||
        editorialProfile === 'trailer';
      preferredOrder = slowCalm ? [16, 12, 8, 20] : [8, 12, 6, 4];
    } else if (isBuildupBeforeDrop && section === 'buildup') {
      // Crescendo / buildup: progressive staircase acceleration heading into drop
      if (nextDropDelta > 0 && nextDropDelta <= 2) {
        preferredOrder = [nextDropDelta, 2, 1];
      } else if (nextDropDelta > 2 && nextDropDelta <= 4) {
        preferredOrder = editorialProfile === 'trailer' ? [2, 1, nextDropDelta] : [2, nextDropDelta, 4];
      } else {
        preferredOrder =
          editorialProfile === 'trailer'
            ? [4, 2, 1, 6]
            : isShortSpan
              ? [4, 2, 6]
              : [4, 2, 6, 8];
      }
    } else if (isShortSpan) {
      if (section === 'intro' || section === 'outro' || section === 'beatless' || rawEnergy < 0.38) {
        preferredOrder = [8, 6, 4];
      } else if (section === 'drop' || rawEnergy >= 0.66) {
        preferredOrder = allowShortPhotoPunch ? [1, 2, 4] : [2, 4, 6];
      } else {
        preferredOrder = allowShortPhotoPunch ? [2, 4, 6] : [4, 6, 8];
      }
    } else {
      // Full-track narrative phrasing adapted per section & editorial profile
      const isSlowEditorial =
        editorialProfile === 'crescendo' ||
        editorialProfile === 'cinema_flow' ||
        editorialProfile === 'trailer';
      if (allowShortPhotoPunch) {
        preferredOrder =
          rawEnergy >= 0.68 && beatSec >= 0.45 ? [2, 1, 4, 6] : [2, 4, 6, 8];
      } else if (section === 'intro') {
        preferredOrder =
          editorialProfile === 'edm_drop'
            ? takeOpeningRoll < 0.34
              ? [6, 8, 4, 12]
              : takeOpeningRoll < 0.68
                ? [8, 6, 4, 12]
                : [4, 8, 6, 12]
            : isSlowEditorial
              ? takeOpeningRoll < 0.34
                ? [12, 16, 8]
                : takeOpeningRoll < 0.68
                  ? [16, 12, 8]
                  : [8, 12, 16]
              : hasRealAudioSignals && rawEnergy < 0.34
                ? takeOpeningRoll < 0.34
                  ? [12, 8, 16, 6]
                  : takeOpeningRoll < 0.68
                    ? [8, 12, 6, 16]
                    : [6, 8, 12, 16]
                : takeOpeningRoll < 0.34
                  ? [8, 6, 4, 12]
                  : takeOpeningRoll < 0.68
                    ? [6, 8, 12, 4]
                    : [12, 8, 6, 4];
      } else if (section === 'outro') {
        preferredOrder = isSlowEditorial
          ? [12, 16, 8, 20]
          : hasRealAudioSignals && rawEnergy < 0.34
            ? [12, 8, 16, 6]
            : [8, 6, 12, 4];
      } else if (section === 'drop') {
        preferredOrder =
          editorialProfile === 'edm_drop'
            ? [2, 4, 6, 1]
            : editorialProfile === 'trailer'
              ? [4, 2, 6, 8]
              : takeSyncopationPref > 0.55
                ? [4, 6, 8, 2]
                : [6, 4, 8, 12];
      } else if (editorialProfile === 'crescendo') {
        const trackProg = (beatTimes[bIdx] - startOffsetSec) / Math.max(1, totalSpanSec);
        preferredOrder =
          trackProg < 0.35 ? [12, 16, 8] : trackProg < 0.68 ? [8, 6, 12, 4] : [4, 6, 2, 8];
      } else if (editorialProfile === 'trailer') {
        preferredOrder = rawEnergy >= 0.55 ? [4, 6, 2, 8] : [12, 8, 16, 6];
      } else if (editorialProfile === 'edm_drop') {
        preferredOrder = rawEnergy >= 0.52 ? [4, 2, 6, 8] : [6, 4, 8, 2];
      } else if (rawEnergy < 0.36) {
        preferredOrder = isSlowEditorial
          ? [12, 16, 8, 20]
          : hasRealAudioSignals
            ? [12, 8, 6, 16]
            : [8, 6, 12, 4];
      } else if (rawEnergy < 0.64) {
        preferredOrder = avgTargetPerFile >= 9 ? [8, 6, 12, 4] : [6, 8, 4, 12];
      } else {
        preferredOrder = [4, 8, 6, 12];
      }
    }

    const effectiveMinBound = allowShortPhotoPunch
      ? Math.min(minClipBound, beatSec >= 0.45 && rawEnergy >= 0.68 ? beatSec : beatSec * 2)
      : minClipBound;
    const minSteps = Math.max(1, Math.ceil(effectiveMinBound / beatSec - 0.05));
    const maxSteps = Math.max(minSteps, Math.floor(maxClipBound / beatSec + 0.05));
    const clampedPreferred = Array.from(
      new Set(preferredOrder.map((s) => Math.max(minSteps, Math.min(maxSteps, s))))
    );
    const candSet = new Set<number>(clampedPreferred);

    // Ensure nextDropDelta can be landed directly without over-stretching short clips into giant holds
    const maxDirectDropStep = isShortSpan ? Math.min(maxSteps, 8) : Math.min(maxSteps, 12);
    if (nextDropDelta >= minSteps && nextDropDelta <= maxDirectDropStep && rhythm !== 'beats_1') {
      candSet.add(nextDropDelta);
    }

    if (enforceBarGrid) {
      const phaseRem = ((bIdx - barAnchorIdx) % 4 + 4) % 4;
      const firstBarStep = phaseRem === 0 ? 4 : 4 - phaseRem;
      const barExtMax = isShortSpan ? Math.min(maxSteps, 8) : maxSteps;
      for (let s = firstBarStep; s <= barExtMax; s += 4) {
        if (s >= minSteps) candSet.add(s);
      }
      if (!isShortSpan && maxSteps >= 6 && minSteps <= 6 && rhythm !== 'smooth') {
        candSet.add(6);
      }
    }
    if (candSet.size === 0 || !enforceBarGrid) {
      candSet.add(minSteps);
      if (maxSteps > minSteps && candSet.size < 2) {
        candSet.add(Math.round((minSteps + maxSteps) / 2));
      }
    }

    let candidates = Array.from(candSet);
    if (
      enforceBarGrid &&
      !allowShortPhotoPunch &&
      section !== 'buildup' &&
      !(isShortSpan && rawEnergy >= 0.66 && rhythm === 'auto')
    ) {
      const barOrHalfBar = candidates.filter((s) => {
        if (s === nextDropDelta) return true;
        const nextIdx = Math.min(beatTimes.length - 1, bIdx + s);
        const halfBar = ((nextIdx - barAnchorIdx) % 2 + 2) % 2 === 0;
        return isDownbeatIndex(nextIdx) || (s === 6 && halfBar);
      });
      if (barOrHalfBar.length > 0) {
        candidates = barOrHalfBar;
      }
    }

    const isRigidBeatFlash = rhythm === 'beats_1';
    const hasCustomBarMode = rhythm !== 'auto' && rhythm !== 'smooth';

    // Draw meaningful RNG jitter per candidate step when shouldShuffle is active so
    // multiple regenerations genuinely vary cut rhythm without violating musical phrasing.
    const jitterByStep = new Map<number, number>();
    if (shouldShuffle && !isRigidBeatFlash && candidates.length > 1) {
      const openingBoost = bIdx < 12 ? 0.26 : 0;
      for (const s of candidates) {
        jitterByStep.set(s, (rng() - 0.5) * (0.54 + openingBoost));
      }
    }

    candidates.sort((a, b) => {
      if (allowShortPhotoPunch) {
        const aShort = a <= 2;
        const bShort = b <= 2;
        if (aShort !== bShort) return aShort ? -1 : 1;
      }
      const idxA = Math.min(beatTimes.length - 1, bIdx + a);
      const idxB = Math.min(beatTimes.length - 1, bIdx + b);
      const musicalA =
        (onsetAccent[idxA] ?? 0.4) * 0.48 +
        (melodicNovelty[idxA] ?? 0.35) * 0.52 +
        (dropImpactSet.has(idxA) ? 0.55 : beatlessCueSet.has(idxA) ? 0.25 : 0);
      const musicalB =
        (onsetAccent[idxB] ?? 0.4) * 0.48 +
        (melodicNovelty[idxB] ?? 0.35) * 0.52 +
        (dropImpactSet.has(idxB) ? 0.55 : beatlessCueSet.has(idxB) ? 0.25 : 0);

      const skipPenalty = (stepLen: number): number => {
        if (hasCustomBarMode || stepLen <= Math.max(2, minSteps)) return 0;
        if (nextDropDelta > 0 && stepLen > nextDropDelta) {
          return 0.75; // Never overshoot an incoming drop impact!
        }
        let maxDropJump = 0;
        for (let m = bIdx + Math.max(4, minSteps); m < Math.min(beatTimes.length - 1, bIdx + stepLen); m++) {
          const dE = (phraseEnergy[m] ?? rawEnergy) - rawEnergy;
          const mPeak = (onsetAccent[m] ?? 0) * 0.45 + (melodicNovelty[m] ?? 0) * 0.55;
          if (
            dropImpactSet.has(m) ||
            dE >= 0.26 ||
            (isDownbeatIndex(m) && (dE >= 0.16 || (mPeak >= 0.93 && Math.abs(dE) >= 0.08)))
          ) {
            maxDropJump = Math.max(maxDropJump, 0.36);
          }
        }
        return maxDropJump;
      };

      const monotonyPenalty = (stepLen: number): number => {
        if (isRigidBeatFlash || candidates.length <= 1) return 0;
        if (stepLen === prevStep1 && stepLen === prevStep2) return hasCustomBarMode ? 0.24 : 0.56;
        if (stepLen === prevStep1) return hasCustomBarMode ? 0.12 : 0.28;
        if (candidates.length >= 3 && stepLen === prevStep2) return hasCustomBarMode ? 0.04 : 0.09;
        return 0;
      };

      const rankA = clampedPreferred.indexOf(a);
      const rankB = clampedPreferred.indexOf(b);
      const decay = hasCustomBarMode ? 0.14 : 0.09;
      const prefA = rankA >= 0 ? Math.max(0.2, 1 - rankA * decay) : 0.16;
      const prefB = rankB >= 0 ? Math.max(0.2, 1 - rankB * decay) : 0.16;
      const barA = isDownbeatIndex(idxA) ? 0.28 : ((idxA - barAnchorIdx) % 2 + 2) % 2 === 0 ? 0.1 : 0;
      const barB = isDownbeatIndex(idxB) ? 0.28 : ((idxB - barAnchorIdx) % 2 + 2) % 2 === 0 ? 0.1 : 0;

      const weightMusical = isRigidBeatFlash ? 0.26 : hasCustomBarMode ? 0.44 : 0.52;
      const weightPref = 1 - weightMusical;
      const scoreA =
        musicalA * weightMusical +
        (prefA + barA) * weightPref -
        skipPenalty(a) -
        monotonyPenalty(a) +
        (jitterByStep.get(a) ?? 0);
      const scoreB =
        musicalB * weightMusical +
        (prefB + barB) * weightPref -
        skipPenalty(b) -
        monotonyPenalty(b) +
        (jitterByStep.get(b) ?? 0);
      return scoreB - scoreA;
    });

    return { steps: candidates, energy: rawEnergy, hitStrength, allowShortPhotoPunch, section };
  };

  interface MusicalSlot {
    startSec: number;
    dur: number;
    beatStartIdx: number;
    beatEndIdx: number;
    energy: number;
    cutImpact: number;
    section: MusicalSectionType;
    isPreDrop: boolean;
  }

  const maxSlots = Math.max(
    960,
    Math.ceil(totalSpanSec / Math.max(0.32, Math.min(beatSec, 0.45))) + 64
  );
  const workingSlots: MusicalSlot[] = [];
  let beatIdx = 0;

  while (beatIdx < beatTimes.length - 1 && workingSlots.length < maxSlots) {
    const cursorSec =
      workingSlots.length > 0
        ? Number(
            (workingSlots[workingSlots.length - 1].startSec + workingSlots[workingSlots.length - 1].dur).toFixed(3)
          )
        : Number(startOffsetSec.toFixed(3));
    if (cursorSec >= targetLimit - 0.45) break;
    if (
      fillToTargetEnd &&
      workingSlots.length > 0 &&
      targetLimit - cursorSec < Math.min(minClipBound * 0.75, Math.max(0.85, beatSec * 1.75)) &&
      workingSlots[workingSlots.length - 1].dur + (targetLimit - cursorSec) <= hardMaxDur + 1.5
    ) {
      const prev = workingSlots[workingSlots.length - 1];
      prev.dur = Number((targetLimit - prev.startSec).toFixed(3));
      break;
    }
    while (beatIdx < beatTimes.length - 2 && beatTimes[beatIdx] < cursorSec - 0.04) {
      beatIdx++;
    }

    const { steps: stepCandidates, energy, hitStrength, allowShortPhotoPunch, section } = getBeatStepsForIndex(beatIdx);
    let chosenSlot: MusicalSlot | null = null;
    for (const stepCount of stepCandidates) {
      let nextIdx = Math.min(beatTimes.length - 1, beatIdx + stepCount);
      if (nextIdx <= beatIdx) continue;
      let rawEnd = Number(Math.min(targetLimit, beatTimes[nextIdx]).toFixed(3));
      let dur = Number((rawEnd - cursorSec).toFixed(3));
      if (dur > hardMaxDur) {
        let capBeat = -1;
        for (let b = beatIdx + 1; b < beatTimes.length; b++) {
          if (beatTimes[b] > targetLimit + 0.02 || beatTimes[b] - cursorSec > hardMaxDur) break;
          capBeat = b;
        }
        if (capBeat > beatIdx) {
          nextIdx = capBeat;
          rawEnd = Number(Math.min(targetLimit, beatTimes[capBeat]).toFixed(3));
        } else {
          nextIdx = Math.min(beatTimes.length - 1, beatIdx + 1);
          rawEnd = Number(Math.min(targetLimit, beatTimes[nextIdx], cursorSec + maxClipBound).toFixed(3));
        }
        dur = Number((rawEnd - cursorSec).toFixed(3));
      }
      const isShortDrop = totalSpanSec < 26 && (energy >= 0.66 || section === 'drop') && rhythm === 'auto';
      const minAllow =
        isShortDrop || (allowShortPhotoPunch && stepCount <= 2) || section === 'buildup'
          ? Math.max(
              0.36,
              fillToTargetEnd ? Math.min(beatSec * 0.85, targetLimit - cursorSec) : beatSec * 0.85
            )
          : Math.max(
              0.45,
              fillToTargetEnd
                ? Math.min(minClipBound * 0.85, targetLimit - cursorSec)
                : minClipBound * 0.93
            );
      if (dur < minAllow) continue;
      const cutImpact =
        (onsetAccent[nextIdx] ?? hitStrength) * 0.55 + (melodicNovelty[nextIdx] ?? 0.4) * 0.45;
      chosenSlot = {
        startSec: cursorSec,
        dur,
        beatStartIdx: beatIdx,
        beatEndIdx: nextIdx,
        energy,
        cutImpact,
        section,
        isPreDrop: dropImpactSet.has(nextIdx),
      };
      break;
    }

    if (!chosenSlot) {
      const rem = Number((targetLimit - cursorSec).toFixed(3));
      if (
        workingSlots.length > 0 &&
        rem < minClipBound &&
        workingSlots[workingSlots.length - 1].dur + rem <= (fillToTargetEnd ? hardMaxDur + 1.5 : maxClipBound + 0.05)
      ) {
        const prev = workingSlots[workingSlots.length - 1];
        prev.dur = Number((targetLimit - prev.startSec).toFixed(3));
        break;
      }
      if (!fillToTargetEnd && rem < minClipBound) {
        break;
      }
      if (rem >= 0.4) {
        let endIdx = Math.min(beatTimes.length - 1, beatIdx + 1);
        for (let b = beatIdx + 1; b < beatTimes.length; b++) {
          if (beatTimes[b] - cursorSec <= hardMaxDur && beatTimes[b] <= targetLimit - 0.12) {
            endIdx = b;
          } else {
            break;
          }
        }
        const snappedEnd =
          beatTimes[endIdx] > cursorSec + 0.35 && beatTimes[endIdx] <= targetLimit
            ? beatTimes[endIdx]
            : targetLimit;
        const clamped = Number(Math.max(0.4, Math.min(rem, snappedEnd - cursorSec, hardMaxDur)).toFixed(3));
        chosenSlot = {
          startSec: cursorSec,
          dur: clamped,
          beatStartIdx: beatIdx,
          beatEndIdx: endIdx,
          energy,
          cutImpact: hitStrength,
          section,
          isPreDrop: dropImpactSet.has(endIdx),
        };
      } else {
        break;
      }
    }

    const stepSpan = Math.max(1, chosenSlot.beatEndIdx - chosenSlot.beatStartIdx);
    recentSteps.push(stepSpan);
    if (recentSteps.length > 4) recentSteps.shift();
    stage1SlotOrd++;
    workingSlots.push(chosenSlot);
    beatIdx = chosenSlot.beatEndIdx;
  }

  if (workingSlots.length === 0) return [];

  if (hasAudio) {
    const lastSlot = workingSlots[workingSlots.length - 1];
    if (lastSlot.startSec + lastSlot.dur > targetLimit) {
      lastSlot.dur = Number(Math.max(0.4, targetLimit - lastSlot.startSec).toFixed(3));
    } else if (fillToTargetEnd) {
      let guard = 0;
      while (guard < 2000 && workingSlots.length < maxSlots * 2) {
        guard++;
        const tail = workingSlots[workingSlots.length - 1];
        const tailEnd = Number((tail.startSec + tail.dur).toFixed(3));
        if (tailEnd >= targetLimit - 0.02) break;
        const rem = Number((targetLimit - tailEnd).toFixed(3));
        if (
          rem <= Math.min(beatSec * 3.5, Math.max(1.2, minClipBound * 0.9)) &&
          tail.dur + rem <= hardMaxDur + 1.5
        ) {
          tail.dur = Number((targetLimit - tail.startSec).toFixed(3));
          break;
        }

        let startBeatIdx = Math.min(beatTimes.length - 1, tail.beatEndIdx);
        while (startBeatIdx < beatTimes.length - 2 && beatTimes[startBeatIdx] < tailEnd - 0.04) {
          startBeatIdx++;
        }
        const { steps: tailSteps, allowShortPhotoPunch: tailPhotoPunch, section: tailSection } =
          getBeatStepsForIndex(startBeatIdx);
        const chosenTailSteps =
          tailSteps[0] ?? (rhythm === 'beats_1' ? 1 : rhythm === 'beats_2' ? 2 : 8);
        const effTailMin =
          tailPhotoPunch && chosenTailSteps <= 2 ? Math.max(0.42, beatSec * chosenTailSteps) : minClipBound;
        const targetSliceDur = Math.max(
          effTailMin,
          Math.min(maxClipBound, beatSec * chosenTailSteps)
        );

        let sliceDur: number;
        let endBeat = startBeatIdx;
        if (rem <= hardMaxDur) {
          sliceDur = rem;
          while (endBeat < beatTimes.length - 1 && beatTimes[endBeat] < targetLimit - 0.04) {
            endBeat++;
          }
        } else {
          const desiredEnd = tailEnd + targetSliceDur;
          let bestBeat = -1;
          let bestDiff = Infinity;
          for (let b = startBeatIdx + 1; b < beatTimes.length; b++) {
            const candEnd = beatTimes[b];
            const candDur = candEnd - tailEnd;
            if (candDur < effTailMin * 0.85) continue;
            if (candDur > hardMaxDur || candEnd > targetLimit - 0.4) break;
            const diff = Math.abs(candEnd - desiredEnd);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestBeat = b;
            }
          }
          if (bestBeat > startBeatIdx) {
            endBeat = bestBeat;
            sliceDur = Number((beatTimes[bestBeat] - tailEnd).toFixed(3));
          } else {
            // Fall back strictly to an actual beat timestamp within [0.4s .. hardMaxDur] instead of off-beat duration
            let anyBeat = -1;
            for (let b = startBeatIdx + 1; b < beatTimes.length; b++) {
              const candEnd = beatTimes[b];
              const candDur = candEnd - tailEnd;
              if (candDur < 0.4) continue;
              if (candDur > hardMaxDur || candEnd > targetLimit - 0.4) break;
              anyBeat = b;
            }
            if (anyBeat > startBeatIdx) {
              endBeat = anyBeat;
              sliceDur = Number((beatTimes[anyBeat] - tailEnd).toFixed(3));
            } else {
              endBeat = Math.min(beatTimes.length - 1, startBeatIdx + 1);
              sliceDur = Number(Math.max(0.4, Math.min(rem, hardMaxDur)).toFixed(3));
            }
          }
        }
        if (endBeat === startBeatIdx && startBeatIdx < beatTimes.length - 1) {
          endBeat = startBeatIdx + 1;
        }
        const stepSpan = Math.max(1, endBeat - startBeatIdx);
        recentSteps.push(stepSpan);
        if (recentSteps.length > 4) recentSteps.shift();
        stage1SlotOrd++;
        workingSlots.push({
          startSec: tailEnd,
          dur: Math.max(0.4, sliceDur),
          beatStartIdx: startBeatIdx,
          beatEndIdx: endBeat,
          energy: phraseEnergy[startBeatIdx] ?? 0.5,
          cutImpact: (onsetAccent[endBeat] ?? 0.5) * 0.55 + (melodicNovelty[endBeat] ?? 0.4) * 0.45,
          section: tailSection,
          isPreDrop: dropImpactSet.has(endBeat),
        });
      }
    }
  }

  // =========================================================================
  // STAGE 2: Anti-Loop Unique-File-First Long Slicing & Video Priority
  // Prioritizes videos on main/long bar shots and assigns photos to short beat punches.
  // =========================================================================

  const allShortPool = pool.every(
    (e) => e.kind === 'video' && e.usableSpan < Math.max(1.5, minClipBound * 0.95)
  );
  const splitFloor =
    allShortPool || totalSpanSec < 26
      ? Math.max(0.45, Math.min(1.0, minClipBound * 0.5))
      : enforceBarGrid
        ? Math.max(beatSec * 2, Math.min(minClipBound, beatSec * 4))
        : Math.max(0.45, minClipBound * 0.85);

  const isTrimmedOk = (v: PoolVideo, dur: number, preferTrimmedSlice: boolean): boolean => {
    if (!preferTrimmedSlice) return true;
    const mediaNeed = dur * v.rate;
    // Keep short b-roll (e.g. 4s..8s) trimmed cleanly below full duration rather than dropping in whole,
    // while allowing long bounded spans (>=10s raw / >=6s usable) to play continuous 6s-12s bar shots.
    if (v.vDur < 10 && v.usableSpan >= Math.max(2.0, minClipBound * 1.45) && mediaNeed > v.usableSpan * 0.7) {
      return false;
    }
    return true;
  };

  const canAssetFitUnused = (
    entry: PoolAsset,
    dur: number,
    preferTrimmedSlice: boolean,
    sequentialCursor: boolean
  ): boolean => {
    if (entry.kind === 'image') return !usedImageKeys.has(entry.contentKey);
    if (!isTrimmedOk(entry, dur, preferTrimmedSlice)) return false;
    const mediaNeed = dur * entry.rate;
    const ranges = freeRangesByKey.get(entry.contentKey) ?? [];
    if (sequentialCursor) {
      const cursor = seqCursorByKey.get(entry.contentKey) ?? entry.initStart;
      return ranges.some(([rs, re]) => re - Math.max(rs, cursor) >= mediaNeed - 0.01);
    }
    return ranges.some(([rs, re]) => re - rs >= mediaNeed - 0.01);
  };

  const hasAnyUnusedFootage = (minVideoSpan = splitFloor): boolean => {
    for (const entry of pool) {
      if (entry.kind === 'image') {
        if (!usedImageKeys.has(entry.contentKey)) return true;
      } else {
        const ranges = freeRangesByKey.get(entry.contentKey) ?? [];
        if (ranges.some(([rs, re]) => re - rs >= minVideoSpan)) return true;
      }
    }
    return false;
  };

  const ensureVideoBuckets = (cKey: string, initStart: number, initEnd: number) => {
    let bucket = sliceBucketsByKey.get(cKey);
    if (!bucket) {
      bucket = {
        counts: new Float32Array(SLICE_BUCKET_COUNT),
        lastUsed: new Int32Array(SLICE_BUCKET_COUNT),
        initStart,
        initEnd: Math.max(initStart + 0.25, initEnd),
      };
      sliceBucketsByKey.set(cKey, bucket);
    }
    return bucket;
  };

  const recordUsedSlice = (
    cKey: string,
    srcStart: number,
    srcEnd: number,
    slotOrderIdx: number,
    initStart?: number,
    initEnd?: number
  ) => {
    const list = usedSlicesByKey.get(cKey) ?? [];
    list.push([srcStart, srcEnd]);
    usedSlicesByKey.set(cKey, list);
    usageCountByKey.set(cKey, (usageCountByKey.get(cKey) ?? 0) + 1);
    lastSlotIdxByKey.set(cKey, slotOrderIdx);
    const idxs = placedIndicesByKey.get(cKey) ?? [];
    idxs.push(slotOrderIdx);
    placedIndicesByKey.set(cKey, idxs);

    const bStart = initStart ?? srcStart;
    const bEnd = initEnd ?? Math.max(bStart + 0.25, srcEnd);
    const bucket = ensureVideoBuckets(cKey, bStart, bEnd);
    const span = Math.max(0.25, bucket.initEnd - bucket.initStart);
    const seq = ++placementSeq;
    const normLo = Math.max(0, Math.min(1, (srcStart - bucket.initStart) / span));
    const normHi = Math.max(normLo, Math.min(1, (srcEnd - bucket.initStart) / span));
    const lo = Math.max(0, Math.min(SLICE_BUCKET_COUNT - 1, Math.floor(normLo * SLICE_BUCKET_COUNT)));
    const hi = Math.max(lo, Math.min(SLICE_BUCKET_COUNT - 1, Math.ceil(normHi * SLICE_BUCKET_COUNT) - 1));
    for (let b = lo; b <= hi; b++) {
      bucket.counts[b] += 1;
      bucket.lastUsed[b] = seq;
    }
  };

  const takeUnusedSlice = (
    entry: PoolAsset,
    dur: number,
    sequentialCursor: boolean,
    slotOrderIdx: number
  ): { sourceStartSec: number; rate: number } => {
    if (entry.kind === 'image') {
      usedImageKeys.add(entry.contentKey);
      usageCountByKey.set(entry.contentKey, (usageCountByKey.get(entry.contentKey) ?? 0) + 1);
      lastSlotIdxByKey.set(entry.contentKey, slotOrderIdx);
      const idxs = placedIndicesByKey.get(entry.contentKey) ?? [];
      idxs.push(slotOrderIdx);
      placedIndicesByKey.set(entry.contentKey, idxs);
      return { sourceStartSec: 0, rate: 1.0 };
    }

    const mediaNeed = dur * entry.rate;
    const ranges = freeRangesByKey.get(entry.contentKey) ?? [];
    let srcStart = entry.initStart;
    let srcEnd =
      entry.initStart + Math.min(mediaNeed, Math.max(0.25, entry.initEnd - entry.initStart));

    if (sequentialCursor) {
      const cursor = seqCursorByKey.get(entry.contentKey) ?? entry.initStart;
      let picked: [number, number] | null = null;
      for (const [rs, re] of ranges) {
        const startAt = Math.max(rs, cursor);
        if (re - startAt >= mediaNeed - 0.01) {
          picked = [startAt, re];
          break;
        }
      }
      const [rs, re] = picked || ranges[0];
      const clampedNeed = Math.min(mediaNeed, Math.max(0.25, re - rs));
      srcStart = Number(rs.toFixed(2));
      srcEnd = Number((srcStart + clampedNeed).toFixed(2));
      seqCursorByKey.set(entry.contentKey, Number((srcEnd + slicePad).toFixed(2)));
    } else {
      const transHeadroom =
        transitionStyle === 'cuts_only' ? 0 : Math.min(0.4, dur * 0.14) * entry.rate;
      const priorSoft = softExcludedRangesByKey.get(entry.contentKey);
      const unseenByPrior =
        priorSoft && priorSoft.length > 0
          ? subtractUsedIntervals(ranges[0] ? [entry.initStart, entry.initEnd] : [0, 0], [
              ...(usedSlicesByKey.get(entry.contentKey) ?? []).map(
                ([us, ue]): [number, number] => [Math.max(entry.initStart, us - slicePad), ue + slicePad]
              ),
              ...(excludedRangesByKey.get(entry.contentKey) ?? []),
              ...priorSoft,
            ], minSliceKeep).filter(([rs, re]) => re - rs >= mediaNeed - 0.01)
          : [];
      const activeRanges = unseenByPrior.length > 0 ? unseenByPrior : ranges;
      const fittingWithHeadroom: Array<[number, number]> =
        transHeadroom > 0
          ? activeRanges.filter(([rs, re]) => re - rs >= mediaNeed + transHeadroom)
          : [];
      const fitting: Array<[number, number]> =
        fittingWithHeadroom.length > 0
          ? fittingWithHeadroom
          : activeRanges.filter(([rs, re]) => re - rs >= mediaNeed - 0.01);
      const [rs, re] =
        fitting.length > 0 ? fitting[Math.floor(rng() * fitting.length)] : ranges[0];
      const clampedNeed = Math.min(mediaNeed, Math.max(0.25, re - rs));
      const slack = Math.max(0, re - rs - clampedNeed);
      const safeTailMargin = slack > transHeadroom + 0.1 ? Math.min(transHeadroom, slack * 0.5) : 0;
      const prior = usedSlicesByKey.get(entry.contentKey) ?? [];
      const wasteFloor = Math.max(1.0, minSliceKeep + slicePad);

      if (slack <= 0.18) {
        srcStart = Number(rs.toFixed(2));
        srcEnd = Number((srcStart + clampedNeed).toFixed(2));
      } else if (slack < wasteFloor * 2) {
        // Moderate slack: pop cleanly from head or tail so the remaining range stays one contiguous non-fragmented span
        const useTail = rng() < 0.5;
        const rawCand = useTail ? re - clampedNeed - safeTailMargin : rs;
        srcStart = Number(Math.max(rs, Math.min(re - clampedNeed, rawCand)).toFixed(2));
        srcEnd = Number((srcStart + clampedNeed).toFixed(2));
      } else {
        // Large slack: generate only clean non-fragmenting candidates (head, tail, or interior splits leaving >= wasteFloor on both sides)
        const cleanCands: number[] = [
          Number(rs.toFixed(2)),
          Number(Math.max(rs, re - clampedNeed - safeTailMargin).toFixed(2)),
        ];
        const innerLo = rs + wasteFloor;
        const innerHi = re - clampedNeed - wasteFloor;
        if (innerHi > innerLo + 0.1) {
          const steps = 6;
          for (let k = 0; k <= steps; k++) {
            const frac = (k + rng() * 0.7) / (steps + 1);
            cleanCands.push(
              Number(Math.max(innerLo, Math.min(innerHi, innerLo + frac * (innerHi - innerLo))).toFixed(2))
            );
          }
        }
        if (prior.length === 0) {
          srcStart = cleanCands[Math.floor(rng() * cleanCands.length)];
        } else {
          let bestOffset = cleanCands[0];
          let bestScore = -Infinity;
          for (const cand of cleanCands) {
            const candEnd = cand + clampedNeed;
            let minDist = Infinity;
            for (const [ps, pe] of prior) {
              const d = candEnd <= ps ? ps - candEnd : cand >= pe ? cand - pe : 0;
              if (d < minDist) minDist = d;
            }
            const score = minDist + rng() * 1.1;
            if (score > bestScore) {
              bestScore = score;
              bestOffset = cand;
            }
          }
          srcStart = bestOffset;
        }
        srcEnd = Number((srcStart + clampedNeed).toFixed(2));
      }
    }

    const updated = subtractUsedIntervals(
      [entry.initStart, entry.initEnd],
      [
        ...(usedSlicesByKey.get(entry.contentKey) ?? []).map(
          ([us, ue]): [number, number] => [Math.max(entry.initStart, us - slicePad), ue + slicePad]
        ),
        [Math.max(entry.initStart, srcStart - slicePad), srcEnd + slicePad],
        ...(excludedRangesByKey.get(entry.contentKey) ?? []),
      ],
      minSliceKeep
    );
    freeRangesByKey.set(entry.contentKey, updated);
    recordUsedSlice(entry.contentKey, srcStart, srcEnd, slotOrderIdx, entry.initStart, entry.initEnd);

    return { sourceStartSec: srcStart, rate: entry.rate };
  };

  // Exhaustion fallback strictly clamped inside [initStart .. initEnd]
  const reuseSeqCursorByKey = new Map<string, number>();
  const reusePassByKey = new Map<string, number>();
  const takeExhaustedFallbackSlice = (
    entry: PoolAsset,
    dur: number,
    sequentialOrder: boolean,
    slotOrderIdx: number
  ): { sourceStartSec: number; rate: number } => {
    if (entry.kind === 'image') {
      usageCountByKey.set(entry.contentKey, (usageCountByKey.get(entry.contentKey) ?? 0) + 1);
      lastSlotIdxByKey.set(entry.contentKey, slotOrderIdx);
      const idxs = placedIndicesByKey.get(entry.contentKey) ?? [];
      idxs.push(slotOrderIdx);
      placedIndicesByKey.set(entry.contentKey, idxs);
      return { sourceStartSec: 0, rate: 1.0 };
    }
    const mediaNeed = dur * entry.rate;
    const availSpan = Math.max(0.25, entry.initEnd - entry.initStart);
    if (sequentialOrder) {
      const clampedNeed = Math.min(mediaNeed, availSpan);
      const maxOff = Math.max(0, availSpan - clampedNeed);
      const passCount = reusePassByKey.get(entry.contentKey) ?? 1;
      const storedCur = reuseSeqCursorByKey.get(entry.contentKey);
      const initFallbackShift = Math.min(
        maxOff,
        ((passCount * 0.381966) % 0.85) * Math.min(maxOff, Math.max(0.8, clampedNeed * 0.75))
      );
      const cur = storedCur ?? entry.initStart + initFallbackShift;
      const validCur =
        cur >= entry.initStart && cur + clampedNeed <= entry.initEnd + 0.02
          ? cur
          : entry.initStart + initFallbackShift;
      const srcStart = Number(
        Math.max(entry.initStart, Math.min(entry.initEnd - 0.25, validCur)).toFixed(2)
      );
      const stepEnd = srcStart + Math.min(mediaNeed, entry.initEnd - srcStart) + slicePad;
      if (stepEnd <= entry.initEnd - 0.25) {
        reuseSeqCursorByKey.set(entry.contentKey, Number(stepEnd.toFixed(2)));
      } else {
        const nextPass = passCount + 1;
        reusePassByKey.set(entry.contentKey, nextPass);
        const phaseShift = Math.min(
          maxOff,
          (((nextPass * 0.381966) % 0.85) * Math.min(maxOff, Math.max(0.8, clampedNeed * 0.75)))
        );
        reuseSeqCursorByKey.set(
          entry.contentKey,
          Number((entry.initStart + phaseShift).toFixed(2))
        );
      }
      recordUsedSlice(
        entry.contentKey,
        srcStart,
        Number((srcStart + Math.min(mediaNeed, entry.initEnd - srcStart)).toFixed(2)),
        slotOrderIdx,
        entry.initStart,
        entry.initEnd
      );
      return { sourceStartSec: srcStart, rate: entry.rate };
    }

    const clampedNeed = Math.min(mediaNeed, availSpan);
    const maxOff = Math.max(0, availSpan - clampedNeed);
    const prior = usedSlicesByKey.get(entry.contentKey) ?? [];
    const bucket = ensureVideoBuckets(entry.contentKey, entry.initStart, entry.initEnd);
    let bestOffset = Number((entry.initStart + rng() * maxOff).toFixed(2));
    if (maxOff > 0.2) {
      const cands: number[] = [];
      const GRID_STEPS = 32;
      const binWidth = maxOff / GRID_STEPS;
      const phaseShift = (((prior.length * 0.61803398875 + rng() * 0.35) % 1) * binWidth);
      for (let g = 0; g <= GRID_STEPS; g++) {
        const base = entry.initStart + (g / GRID_STEPS) * maxOff;
        cands.push(Number(base.toFixed(2)));
        if (g < GRID_STEPS) {
          cands.push(
            Number(Math.min(entry.initStart + maxOff, base + phaseShift).toFixed(2))
          );
        }
      }
      for (let k = 0; k < 6; k++) {
        const phiFrac = ((prior.length + k + 1) * 0.61803398875 + rng() * 0.18) % 1;
        cands.push(Number((entry.initStart + phiFrac * maxOff).toFixed(2)));
      }
      for (const [ps, pe] of prior) {
        if (ps - clampedNeed >= entry.initStart) cands.push(Number((ps - clampedNeed - 0.04).toFixed(2)));
        if (pe + 0.04 <= entry.initStart + maxOff) cands.push(Number((pe + 0.04).toFixed(2)));
      }
      const span = Math.max(0.25, bucket.initEnd - bucket.initStart);
      const startDupThreshold = Math.max(0.75, clampedNeed * 0.45);
      const recentStartIdx = Math.max(0, prior.length - 8);
      const distWindowIdx = Math.max(0, prior.length - 4);
      const normSeq = Math.max(1, placementSeq);

      let bestCost = Infinity;

      for (const rawCand of cands) {
        const cand = Number(
          Math.max(entry.initStart, Math.min(entry.initStart + maxOff, rawCand)).toFixed(2)
        );
        const candEnd = cand + clampedNeed;
        const normLo = Math.max(0, Math.min(1, (cand - bucket.initStart) / span));
        const normHi = Math.max(normLo, Math.min(1, (candEnd - bucket.initStart) / span));
        const lo = Math.max(0, Math.min(SLICE_BUCKET_COUNT - 1, Math.floor(normLo * SLICE_BUCKET_COUNT)));
        const hi = Math.max(lo, Math.min(SLICE_BUCKET_COUNT - 1, Math.ceil(normHi * SLICE_BUCKET_COUNT) - 1));
        let sumCount = 0;
        let maxCount = 0;
        let sumLast = 0;
        const bLen = hi - lo + 1;
        for (let b = lo; b <= hi; b++) {
          const c = bucket.counts[b];
          sumCount += c;
          if (c > maxCount) maxCount = c;
          sumLast += bucket.lastUsed[b];
        }
        const avgCount = sumCount / bLen;
        const avgLast = sumLast / bLen;

        // Score against ALL prior slices of this source footage to prevent A->B->A->B frame loops
        let nearStartPenalty = 0;
        let weightedOverlap = 0;
        let recentWeightedDist = prior.length === 0 ? maxOff : Infinity;
        let globalMinStartGap = prior.length === 0 ? maxOff : Infinity;

        for (let pIdx = 0; pIdx < prior.length; pIdx++) {
          const [ps, pe] = prior[pIdx];
          const age = prior.length - 1 - pIdx;
          const recencyWeight = age < 3 ? 3.5 / (1 + age * 0.6) : 1 / (1 + age * 0.35);
          const startGap = Math.abs(cand - ps);
          if (startGap < globalMinStartGap) globalMinStartGap = startGap;
          if (startGap < startDupThreshold) {
            const sev = 1 - startGap / startDupThreshold;
            nearStartPenalty += sev * (pIdx >= recentStartIdx ? 2.2 * recencyWeight : 0.8);
          }
          const overlapSec = Math.max(0, Math.min(candEnd, pe) - Math.max(cand, ps));
          if (overlapSec > 0) {
            weightedOverlap += (overlapSec / Math.max(0.25, clampedNeed)) * recencyWeight;
          }
          if (pIdx >= distWindowIdx) {
            const d = candEnd <= ps ? ps - candEnd : cand >= pe ? cand - pe : -overlapSec;
            const adjDist = d - age * 0.15;
            if (adjDist < recentWeightedDist) recentWeightedDist = adjDist;
          }
        }

        const cost =
          avgCount * 12.0 +
          maxCount * 5.0 +
          nearStartPenalty * 6.5 +
          weightedOverlap * 4.5 +
          (avgLast / normSeq) * 2.5 -
          Math.min(maxOff, Math.max(-clampedNeed, recentWeightedDist)) * 0.35 -
          Math.min(maxOff, globalMinStartGap) * 0.45 -
          rng() * 0.25;

        if (cost < bestCost) {
          bestCost = cost;
          bestOffset = cand;
        }
      }
    }
    recordUsedSlice(
      entry.contentKey,
      bestOffset,
      Number((bestOffset + Math.min(mediaNeed, entry.initEnd - bestOffset)).toFixed(2)),
      slotOrderIdx,
      entry.initStart,
      entry.initEnd
    );
    return { sourceStartSec: bestOffset, rate: entry.rate };
  };

    const buildPlacementForSlot = (
    slot: MusicalSlot,
    slotIdx: number,
    asset: PoolAsset,
    sourceStartSec: number,
    rate: number
  ): AutoBeatSlicePlacement => {
    const isImage = asset.kind === 'image';
    const isShortSlot = slot.dur <= shortBeatMaxSec || slot.beatEndIdx - slot.beatStartIdx <= 2;
    const isCalmSection =
      slot.section === 'intro' || slot.section === 'beatless' || slot.section === 'outro';
    const musicalPalette: SlideTransitionType[] = isImage
      ? ['cut', 'cut', 'crossfade', 'cut', 'cut']
      : ['cut', 'cut', 'zoom_cross', 'crossfade', 'cut'];
    const punchyPalette: SlideTransitionType[] = isImage
      ? ['cut', 'slide', 'wipe_right', 'cut']
      : ['cut', 'zoom_cross', 'wipe_right', 'slide'];
    let trType: SlideTransitionType;
    if (transitionStyle === 'dissolve') {
      trType = 'crossfade';
    } else if (transitionStyle === 'cuts_only' || rhythm === 'beats_1') {
      trType = 'cut';
    } else if (transitionStyle === 'punchy') {
      if (
        (editorialProfile === 'trailer' || editorialProfile === 'edm_drop') &&
        slot.isPreDrop &&
        slot.dur >= 1.2
      ) {
        trType = 'dip_black';
      } else if (slot.section === 'beatless' || (slot.section === 'intro' && slot.dur >= 2.8)) {
        trType = 'crossfade';
      } else if (editorialProfile === 'groove') {
        trType =
          slot.cutImpact >= 0.72
            ? slotIdx % 2 === 0
              ? 'slide'
              : 'wipe_right'
            : slotIdx % 3 === 1
              ? 'cut'
              : 'slide';
      } else {
        trType =
          slot.cutImpact >= 0.72
            ? slotIdx % 4 === 2 && !isImage
              ? 'zoom_cross'
              : 'slide'
            : slot.cutImpact >= 0.52 && slotIdx % 3 === 1
              ? 'wipe_right'
              : punchyPalette[slotIdx % punchyPalette.length];
      }
    } else if (mode === 'auto_rhythm' || rhythm === 'auto') {
      if (rhythm === 'smooth' || isCalmSection || slot.energy < 0.38) {
        trType = 'crossfade';
      } else if (editorialProfile === 'trailer' && slot.isPreDrop && slot.dur >= 1.2) {
        trType = 'dip_black';
      } else if (slot.energy >= 0.45 || slot.cutImpact >= 0.52) {
        const allowZoomTransition =
          (!isImage || (slot.dur >= 1.85 && !isShortSlot)) &&
          (slot.cutImpact >= 0.64 ||
            ((slot.section === 'drop' || slot.energy >= 0.56) && slotIdx % 4 === 2));
        trType = allowZoomTransition ? 'zoom_cross' : 'cut';
      } else if (
        asset.binItem.defaultTransitionOut &&
        asset.binItem.defaultTransitionOut !== 'crossfade' &&
        (!isImage || asset.binItem.defaultTransitionOut !== 'zoom_cross')
      ) {
        trType = asset.binItem.defaultTransitionOut;
      } else {
        trType = musicalPalette[slotIdx % musicalPalette.length];
      }
    } else if (
      asset.binItem.defaultTransitionOut &&
      asset.binItem.defaultTransitionOut !== 'crossfade' &&
      (!isImage || asset.binItem.defaultTransitionOut !== 'zoom_cross')
    ) {
      trType = asset.binItem.defaultTransitionOut;
    } else if (mode === 'sequential') {
      trType = isCalmSection || (slot.dur >= 2.8 && slot.energy < 0.45) ? 'crossfade' : 'cut';
    } else if (rhythm === 'smooth') {
      trType = 'crossfade';
    } else {
      trType =
        slot.cutImpact >= 0.6
          ? !isImage && slotIdx % 3 === 0
            ? 'zoom_cross'
            : 'cut'
          : musicalPalette[slotIdx % musicalPalette.length];
    }

    // Never allow zoom_cross on tight short beat photos (prevents abrupt photo jump)
    if (isImage && isShortSlot && trType === 'zoom_cross') {
      trType = 'cut';
    }

    // Tighten tight short punches (< ~1.35 beats) to clean hard cuts unless explicit dissolve is selected
    if (
      trType !== 'cut' &&
      transitionStyle !== 'dissolve' &&
      slot.dur < Math.max(0.75, beatSec * 1.35)
    ) {
      trType = 'cut';
    }

    const isSlowDissolve =
      transitionStyle === 'dissolve' ||
      rhythm === 'smooth' ||
      isCalmSection ||
      ((mode === 'auto_rhythm' || rhythm === 'auto') && slot.energy < 0.36);
    const allowLongDissolve =
      transitionStyle === 'dissolve' ||
      rhythm === 'smooth' ||
      editorialProfile === 'dream' ||
      editorialProfile === 'acoustic';
    const maxDissolveSec =
      editorialProfile === 'dream' ? 0.72 : allowLongDissolve ? 0.58 : 0.32;
    const isWhipOrMotion =
      trType === 'wipe_right' || trType === 'slide' || trType === 'zoom_cross';

    const idealTrans =
      trType === 'cut'
        ? 0
        : trType === 'dip_black'
          ? Number(Math.max(0.12, Math.min(0.24, beatSec * 0.45, slot.dur * 0.20)).toFixed(3))
          : isWhipOrMotion
            ? Number(Math.max(0.08, Math.min(0.13, beatSec * 0.24, slot.dur * 0.16)).toFixed(3))
            : isSlowDissolve
              ? Number(
                  Math.max(
                    0.16,
                    Math.min(maxDissolveSec, beatSec * (editorialProfile === 'dream' ? 1.15 : 0.9), slot.dur * 0.28)
                  ).toFixed(3)
                )
              : Number(
                  Math.max(
                    0.10,
                    Math.min(0.20, beatSec * 0.35, slot.dur * 0.20)
                  ).toFixed(3)
                );

    // Editorial alternating camera choreography: push-in, lateral pan drift, tilt, or pull-out.
    // Short punch photos (<1.85s or short beat slots) stay strictly static (1.0 -> 1.0, pan=0)
    // so rhythmic flashes never jump in zoom.
    const isShortPunchPhoto = isImage && (isShortSlot || slot.dur < 1.85);
    let scaleStart = 1.0;
    let scaleEnd = 1.0;
    let panStartX = 0;
    let panStartY = 0;
    let panEndX = 0;
    let panEndY = 0;

    if (motionLevel !== 'off' && !isShortPunchPhoto) {
      const camPattern = slotIdx % 4;
      if (motionLevel === 'gentle') {
        const pushAmt = isCalmSection ? 0.026 : slot.section === 'drop' ? 0.038 : 0.032;
        scaleStart = 1.0;
        if (camPattern === 0) {
          scaleEnd = Number((1 + pushAmt).toFixed(3));
        } else if (camPattern === 1) {
          scaleEnd = Number((1 + pushAmt * 0.92).toFixed(3));
          panEndX = 0.011;
        } else if (camPattern === 2) {
          scaleEnd = Number((1 + pushAmt * 0.88).toFixed(3));
          panEndY = -0.008;
        } else {
          scaleEnd = Number((1 + pushAmt * 0.92).toFixed(3));
          panEndX = -0.011;
        }
      } else {
        // Dynamic editorial motion: bold push-ins, lateral sweeps, and pull-out reveals on long video shots
        if (camPattern === 0) {
          scaleStart = 1.0;
          scaleEnd = Number((slot.section === 'drop' ? 1.068 : 1.052).toFixed(3));
        } else if (camPattern === 1) {
          scaleStart = 1.042;
          scaleEnd = 1.042;
          panStartX = -0.017;
          panEndX = 0.017;
        } else if (camPattern === 2 && !isImage) {
          scaleStart = 1.06;
          scaleEnd = 1.0;
          panStartY = 0.006;
          panEndY = 0;
        } else {
          scaleStart = 1.042;
          scaleEnd = 1.042;
          panStartX = 0.017;
          panEndX = -0.017;
        }
      }
    }

    const easing: KeyframeEasing =
      slot.section === 'drop' || slot.cutImpact >= 0.62 ? 'ease_out' : 'ease_in_out';

    return {
      binItemId: asset.binItem.id,
      startSec: Number(slot.startSec.toFixed(3)),
      durationSec: Number(Math.max(0.4, slot.dur).toFixed(3)),
      sourceStartSec,
      playbackRate: rate,
      transitionOut: trType,
      transitionDurationSec: idealTrans,
      scaleStart,
      scaleEnd,
      panStartX,
      panStartY,
      panEndX,
      panEndY,
      easing,
      cutImpact: Number(slot.cutImpact.toFixed(3)),
    };
  };

  const splitSlotAtBeat = (
    slot: MusicalSlot,
    floorOverride?: number
  ): [MusicalSlot, MusicalSlot] | null => {
    const effFloor = floorOverride !== undefined ? Math.max(0.4, floorOverride) : splitFloor;
    if (slot.dur < effFloor * 2 || slot.beatEndIdx - slot.beatStartIdx < 2) return null;
    const midTime = Number((slot.startSec + slot.dur * 0.5).toFixed(3));
    let splitTime: number | null = null;
    let splitBeatIdx = Math.floor((slot.beatStartIdx + slot.beatEndIdx) / 2);

    let bestScore = -1e9;
    const preferAsymmetric = slot.dur >= effFloor * 2.45;
    for (let b = slot.beatStartIdx + 1; b < slot.beatEndIdx; b++) {
      const t = Number(beatTimes[b].toFixed(3));
      const d1 = t - slot.startSec;
      const d2 = slot.startSec + slot.dur - t;
      if (d1 >= effFloor && d2 >= effFloor) {
        const barBonus = enforceBarGrid && isDownbeatIndex(b) ? 0.5 : 0;
        const accentBonus =
          (onsetAccent[b] ?? 0.4) * 0.3 + (melodicNovelty[b] ?? 0.35) * 0.3;
        const asymBonus =
          preferAsymmetric && Math.abs(d1 - d2) >= beatSec * 1.4
            ? 0.24
            : preferAsymmetric && Math.abs(d1 - d2) < 0.18
              ? -0.22
              : 0;
        const centerTerm = 1 - Math.min(1, Math.abs(t - midTime) / Math.max(0.5, slot.dur * 0.5));
        const score = barBonus + accentBonus + asymBonus + centerTerm * 0.25;
        if (score > bestScore) {
          bestScore = score;
          splitTime = t;
          splitBeatIdx = b;
        }
      }
    }
    // Strictly require an interior beat timestamp — never create off-beat midpoint splits
    if (splitTime === null) return null;
    const leftDur = Number((splitTime - slot.startSec).toFixed(3));
    const rightDur = Number((slot.startSec + slot.dur - splitTime).toFixed(3));
    if (leftDur < effFloor || rightDur < effFloor) return null;
    const midImpact =
      (onsetAccent[splitBeatIdx] ?? slot.cutImpact) * 0.55 +
      (melodicNovelty[splitBeatIdx] ?? 0.4) * 0.45;
    return [
      {
        startSec: slot.startSec,
        dur: leftDur,
        beatStartIdx: slot.beatStartIdx,
        beatEndIdx: splitBeatIdx,
        energy: slot.energy,
        cutImpact: midImpact,
        section: slot.section,
        isPreDrop: dropImpactSet.has(splitBeatIdx),
      },
      {
        startSec: splitTime,
        dur: rightDur,
        beatStartIdx: splitBeatIdx,
        beatEndIdx: slot.beatEndIdx,
        energy: phraseEnergy[splitBeatIdx] ?? slot.energy,
        cutImpact: slot.cutImpact,
        section: beatSections[splitBeatIdx] ?? slot.section,
        isPreDrop: slot.isPreDrop,
      },
    ];
  };

  if (!shouldShuffle) {
    // Chronological library slicing mapped onto musical intervals
    const placements: AutoBeatSlicePlacement[] = [];
    let sIdx = 0;
    let seqPoolPointer = 0;
    let lastContentKey: string | null = null;
    let splitGuard = 0;
    const uniqueKeyCount = new Set(pool.map((e) => e.contentKey)).size;

    while (sIdx < workingSlots.length && placements.length < maxSlots * 2) {
      const slot = workingSlots[sIdx];
      let matchedIdx = -1;
      for (let off = 0; off < pool.length; off++) {
        const idx = (seqPoolPointer + off) % pool.length;
        if (avoidAdjacentRepeat && uniqueKeyCount > 1 && pool[idx].contentKey === lastContentKey) {
          continue;
        }
        if (canAssetFitUnused(pool[idx], slot.dur, true, true)) {
          matchedIdx = idx;
          break;
        }
      }

      if (matchedIdx < 0) {
        const hasNonAdjUnused = pool.some(
          (e) =>
            (!avoidAdjacentRepeat || uniqueKeyCount <= 1 || e.contentKey !== lastContentKey) &&
            (e.kind === 'image'
              ? !usedImageKeys.has(e.contentKey)
              : (freeRangesByKey.get(e.contentKey) ?? []).some(([rs, re]) => re - rs >= splitFloor))
        );
        if (hasNonAdjUnused && splitGuard < Math.max(400, workingSlots.length)) {
          const pair = splitSlotAtBeat(slot);
          if (pair) {
            splitGuard++;
            workingSlots.splice(sIdx, 1, pair[0], pair[1]);
            continue;
          }
        }
        for (let off = 0; off < pool.length; off++) {
          const idx = (seqPoolPointer + off) % pool.length;
          if (avoidAdjacentRepeat && uniqueKeyCount > 1 && pool[idx].contentKey === lastContentKey) {
            continue;
          }
          if (canAssetFitUnused(pool[idx], slot.dur, false, true)) {
            matchedIdx = idx;
            break;
          }
        }
      }

      if (matchedIdx < 0) {
        if (strictSingleUse && splitGuard < Math.max(450, workingSlots.length * 2)) {
          const fineFloor = Math.max(0.42, Math.min(splitFloor, beatSec * 0.92));
          if (hasAnyUnusedFootage(fineFloor)) {
            const finePair = splitSlotAtBeat(slot, fineFloor);
            if (finePair) {
              splitGuard++;
              workingSlots.splice(sIdx, 1, finePair[0], finePair[1]);
              continue;
            }
          }
        }
        if (!fillToTargetEnd || strictSingleUse) {
          for (let off = 0; off < pool.length; off++) {
            const idx = (seqPoolPointer + off) % pool.length;
            if (canAssetFitUnused(pool[idx], slot.dur, true, true) || canAssetFitUnused(pool[idx], slot.dur, false, true)) {
              matchedIdx = idx;
              break;
            }
          }
          if (matchedIdx < 0) break;
        } else {
          let fbIdx = -1;
          for (const pt of [true, false]) {
            for (let off = 0; off < pool.length; off++) {
              const idx = (seqPoolPointer + off) % pool.length;
              const cand = pool[idx];
              if (avoidAdjacentRepeat && uniqueKeyCount > 1 && cand.contentKey === lastContentKey) {
                continue;
              }
              if (cand.kind === 'image' || isTrimmedOk(cand, slot.dur, pt)) {
                fbIdx = idx;
                break;
              }
            }
            if (fbIdx >= 0) break;
          }
          if (fbIdx < 0) {
            for (let off = 0; off < pool.length; off++) {
              const idx = (seqPoolPointer + off) % pool.length;
              if (!avoidAdjacentRepeat || uniqueKeyCount <= 1 || pool[idx].contentKey !== lastContentKey) {
                fbIdx = idx;
                break;
              }
            }
          }
          if (fbIdx < 0) {
            fbIdx = seqPoolPointer % pool.length;
          }
          const chosen = pool[fbIdx];
          seqPoolPointer = (fbIdx + 1) % pool.length;
          const { sourceStartSec, rate } = canAssetFitUnused(chosen, slot.dur, false, true)
            ? takeUnusedSlice(chosen, slot.dur, true, placements.length)
            : takeExhaustedFallbackSlice(chosen, slot.dur, true, placements.length);
          placements.push(buildPlacementForSlot(slot, placements.length, chosen, sourceStartSec, rate));
          lastContentKey = chosen.contentKey;
          sIdx++;
          continue;
        }
      }

      const chosen = pool[matchedIdx];
      seqPoolPointer = (matchedIdx + 1) % pool.length;
      const { sourceStartSec, rate } = takeUnusedSlice(chosen, slot.dur, true, placements.length);
      placements.push(
        buildPlacementForSlot(slot, placements.length, chosen, sourceStartSec, rate)
      );
      lastContentKey = chosen.contentKey;
      sIdx++;
    }

    return placements;
  }

  const isShortBeatSlot = (slot: MusicalSlot): boolean =>
    slot.dur <= shortBeatMaxSec || slot.beatEndIdx - slot.beatStartIdx <= 2;

  const filterByMixedPriority = (
    list: PoolAsset[],
    slot: MusicalSlot,
    strictVideoOnLongSlots: boolean,
    ctx: {
      prevKey?: string | null;
      nextKey?: string | null;
      isFallbackPass?: boolean;
      reserveShortForPhotos?: boolean;
    } = {}
  ): PoolAsset[] => {
    if (!hasMixedPool || list.length === 0) return list;
    const basePool =
      avoidAdjacentRepeat && list.length > 1 && (ctx.prevKey || ctx.nextKey)
        ? list.filter((e) => e.contentKey !== ctx.prevKey && e.contentKey !== ctx.nextKey)
        : list;
    const activeList = basePool.length > 0 ? basePool : list;

    const preferPhotoHere =
      mediaPriority === 'video_first'
        ? slot.dur <= Math.max(beatSec * 2.1, shortBeatMaxSec * 0.78) &&
          (slot.section === 'drop' || slot.cutImpact >= 0.58)
        : mediaPriority === 'photo_beats'
          ? isShortBeatSlot(slot) ||
            (slot.dur <= beatSec * 4.1 && (slot.section === 'drop' || slot.cutImpact >= 0.56))
          : isShortBeatSlot(slot);

    if (preferPhotoHere) {
      const photos = activeList.filter((e) => e.kind === 'image');
      if (photos.length > 0) return photos;
      if (ctx.reserveShortForPhotos) return [];
      const fallbackPhotos = list.filter((e) => e.kind === 'image');
      return fallbackPhotos.length > 0 ? fallbackPhotos : activeList;
    }

    const videos = activeList.filter((e) => e.kind === 'video');
    if (videos.length > 0) return videos;
    const isAutoRhythmPool = mode === 'auto_rhythm' || rhythm === 'auto';
    const nonAdjImages = activeList.filter((e) => e.kind === 'image');
    const uniqueVideoKeys = new Set(poolVideos.map((v) => v.contentKey)).size;
    if (
      ctx.isFallbackPass &&
      avoidAdjacentRepeat &&
      nonAdjImages.length > 0 &&
      (uniqueVideoKeys <= 1 ||
        !isAutoRhythmPool ||
        !list.some(
          (v) =>
            v.kind === 'video' && v.contentKey !== ctx.prevKey && v.contentKey !== ctx.nextKey
        ))
    ) {
      return nonAdjImages;
    }
    if (!strictVideoOnLongSlots) {
      const allVideos = list.filter((e) => e.kind === 'video');
      if (allVideos.length > 0) return allVideos;
    }
    return strictVideoOnLongSlots ? [] : activeList;
  };

  const isFreshRelativeToPriorTakes = (entry: PoolAsset, dur: number): boolean => {
    if (entry.kind === 'image') return !softExcludedImgKeys.has(entry.contentKey);
    const priorSoft = softExcludedRangesByKey.get(entry.contentKey);
    if (!priorSoft || priorSoft.length === 0) return true;
    const mediaNeed = Math.min(dur * entry.rate, Math.max(0.4, entry.initEnd - entry.initStart));
    const unseen = subtractUsedIntervals(
      [entry.initStart, entry.initEnd],
      [
        ...(usedSlicesByKey.get(entry.contentKey) ?? []).map(
          ([us, ue]): [number, number] => [Math.max(entry.initStart, us - slicePad), ue + slicePad]
        ),
        ...(excludedRangesByKey.get(entry.contentKey) ?? []),
        ...priorSoft,
      ],
      minSliceKeep
    );
    return unseen.some(([rs, re]) => re - rs >= mediaNeed - 0.01);
  };

  // Strictly prioritize unused files first (minUsage exact equality, zero +1 shortcut),
  // prefer files/slices not already shown in recent takes, and maximize distance since nearest timeline placement.
  const pickShuffledAsset = (
    eligible: PoolAsset[],
    slot: MusicalSlot,
    slotIdx: number,
    prevKey: string | null,
    nextKey: string | null,
    prev2Key: string | null = null,
    next2Key: string | null = null,
    prev3Key: string | null = null,
    next3Key: string | null = null
  ): PoolAsset => {
    const nonAdj = avoidAdjacentRepeat
      ? eligible.filter((e) => e.contentKey !== prevKey && e.contentKey !== nextKey)
      : eligible;
    const poolStage1 = nonAdj.length > 0 ? nonAdj : eligible;

    const minUsage = Math.min(...poolStage1.map((e) => usageCountByKey.get(e.contentKey) ?? 0));
    const strictlyLeastUsed = poolStage1.filter(
      (e) => (usageCountByKey.get(e.contentKey) ?? 0) === minUsage
    );
    const freshInLeast =
      softExcludedImgKeys.size > 0 || softExcludedRangesByKey.size > 0
        ? strictlyLeastUsed.filter((e) => isFreshRelativeToPriorTakes(e, slot.dur))
        : [];
    const poolLeast =
      freshInLeast.length > 0
        ? freshInLeast
        : strictlyLeastUsed.length > 0
          ? strictlyLeastUsed
          : poolStage1;
    const nonPingPong2 =
      poolLeast.length > 1
        ? poolLeast.filter((e) => e.contentKey !== prev2Key && e.contentKey !== next2Key)
        : poolLeast;
    const stage2Pool = nonPingPong2.length > 0 ? nonPingPong2 : poolLeast;
    const nonPingPong3 =
      stage2Pool.length > 1 && (prev3Key || next3Key)
        ? stage2Pool.filter((e) => e.contentKey !== prev3Key && e.contentKey !== next3Key)
        : stage2Pool;
    const poolToPick = nonPingPong3.length > 0 ? nonPingPong3 : stage2Pool;

    if (minUsage > 0 && poolToPick.length > 1) {
      const cooled = [...poolToPick].sort(
        (a, b) => getMinSlotDist(b.contentKey, slotIdx) - getMinSlotDist(a.contentKey, slotIdx)
      );
      // Allow top ~72% cooled non-adjacent/non-ping-pong candidates so Pass 2+ reshuffles order
      // genuinely instead of locking into a fixed FIFO queue [A, B, C, D -> A, B, C, D].
      const keepCount = Math.max(2, Math.ceil(cooled.length * 0.72));
      const pickPool = cooled.slice(0, Math.min(cooled.length, keepCount));
      return pickPool[Math.floor(rng() * pickPool.length)];
    }

    return poolToPick[Math.floor(rng() * poolToPick.length)];
  };

  if (!fillToTargetEnd || strictSingleUse) {
    // Chronological 100% single-use pass: every photo & non-overlapping video slice is used at most once,
    // never leaving empty timeline gaps before placed clips and never running Pass B exhaustion repeats.
    const placements: AutoBeatSlicePlacement[] = [];
    let sIdx = 0;
    let lastKey: string | null = null;
    let last2Key: string | null = null;
    let last3Key: string | null = null;
    let splitGuard = 0;
    const fineSplitFloor = strictSingleUse
      ? Math.max(0.42, Math.min(splitFloor, beatSec * 0.92))
      : splitFloor;

    const getUnusedRemainingSec = (entry: PoolAsset): number => {
      if (entry.kind === 'image') return usedImageKeys.has(entry.contentKey) ? 0 : 1.5;
      const ranges = freeRangesByKey.get(entry.contentKey) ?? [];
      let sum = 0;
      for (const [rs, re] of ranges) sum += Math.max(0, re - rs);
      return sum / entry.rate;
    };

    const pickStrictCandidate = (candidates: PoolAsset[], slot: MusicalSlot): PoolAsset => {
      if (candidates.length === 1) return candidates[0];
      const neverUsed = candidates.filter((e) => (usageCountByKey.get(e.contentKey) ?? 0) === 0);
      const base = neverUsed.length > 0 ? neverUsed : candidates;
      if (strictSingleUse && neverUsed.length === 0 && base.length > 1) {
        // Load-balance remaining unused span so multiple source videos drain evenly without bunching one file at the end
        const sortedByRem = [...base].sort(
          (a, b) => getUnusedRemainingSec(b) - getUnusedRemainingSec(a)
        );
        const topPool = sortedByRem.slice(0, Math.max(2, Math.ceil(sortedByRem.length * 0.65)));
        return pickShuffledAsset(
          topPool,
          slot,
          placements.length,
          lastKey,
          null,
          last2Key,
          null,
          last3Key,
          null
        );
      }
      return pickShuffledAsset(
        base,
        slot,
        placements.length,
        lastKey,
        null,
        last2Key,
        null,
        last3Key,
        null
      );
    };

    while (sIdx < workingSlots.length && placements.length < maxSlots * 2) {
      const slot = workingSlots[sIdx];
      let rawEligible = pool.filter((e) => canAssetFitUnused(e, slot.dur, true, false));
      if (rawEligible.length === 0) {
        const canSplitThisSlot = slot.dur >= splitFloor * 2 - 0.05 && splitSlotAtBeat(slot) !== null;
        if (!canSplitThisSlot) {
          const untrimmedUnused = pool.filter(
            (e) =>
              (usageCountByKey.get(e.contentKey) ?? 0) === 0 &&
              canAssetFitUnused(e, slot.dur, false, false)
          );
          if (untrimmedUnused.length > 0) {
            rawEligible = untrimmedUnused;
          }
        }
      }
      let eligible = filterByMixedPriority(rawEligible, slot, false, { prevKey: lastKey });

      // Showcase unused photos on crisp 1-2 beat punches rather than slicing already-shown videos a 2nd/3rd time
      if (
        hasMixedPool &&
        mediaPriority !== 'video_first' &&
        eligible.length > 0 &&
        eligible.every((e) => e.kind === 'video' && (usageCountByKey.get(e.contentKey) ?? 0) >= 1) &&
        poolImages.some(
          (img) =>
            !usedImageKeys.has(img.contentKey) &&
            (!avoidAdjacentRepeat || img.contentKey !== lastKey)
        )
      ) {
        if (
          !isShortBeatSlot(slot) &&
          slot.beatEndIdx - slot.beatStartIdx >= 3 &&
          slot.section !== 'beatless' &&
          splitGuard < Math.max(450, workingSlots.length * 2)
        ) {
          const punchBeats = beatSec * 2 <= shortBeatMaxSec + 0.02 ? 2 : 1;
          const splitIdx = slot.beatEndIdx - punchBeats;
          if (splitIdx > slot.beatStartIdx) {
            const splitT = Number(beatTimes[splitIdx].toFixed(3));
            const leftDur = Number((splitT - slot.startSec).toFixed(3));
            const rightDur = Number((slot.startSec + slot.dur - splitT).toFixed(3));
            if (leftDur >= 0.45 && rightDur >= 0.4 && rightDur <= shortBeatMaxSec + 0.02) {
              splitGuard++;
              const midImpact =
                (onsetAccent[splitIdx] ?? slot.cutImpact) * 0.55 +
                (melodicNovelty[splitIdx] ?? 0.4) * 0.45;
              const remainingVideosHaveSlices = poolVideos.some(
                (v) =>
                  (!avoidAdjacentRepeat || v.contentKey !== lastKey) &&
                  canAssetFitUnused(v, leftDur, false, false)
              );
              const leftSlot: MusicalSlot = {
                startSec: slot.startSec,
                dur: leftDur,
                beatStartIdx: slot.beatStartIdx,
                beatEndIdx: splitIdx,
                energy: slot.energy,
                cutImpact: midImpact,
                section: slot.section,
                isPreDrop: dropImpactSet.has(splitIdx),
              };
              const rightSlot: MusicalSlot = {
                startSec: splitT,
                dur: rightDur,
                beatStartIdx: splitIdx,
                beatEndIdx: slot.beatEndIdx,
                energy: phraseEnergy[splitIdx] ?? slot.energy,
                cutImpact: slot.cutImpact,
                section: beatSections[splitIdx] ?? slot.section,
                isPreDrop: slot.isPreDrop,
              };
              if (remainingVideosHaveSlices) {
                workingSlots.splice(sIdx, 1, leftSlot, rightSlot);
                continue;
              }
            }
          }
        }
      }

      if (eligible.length === 0) {
        if (hasAnyUnusedFootage(splitFloor) && splitGuard < Math.max(350, workingSlots.length)) {
          const pair = splitSlotAtBeat(slot);
          if (pair) {
            splitGuard++;
            workingSlots.splice(sIdx, 1, pair[0], pair[1]);
            continue;
          }
        }
        rawEligible = pool.filter((e) => canAssetFitUnused(e, slot.dur, false, false));
        eligible = filterByMixedPriority(rawEligible, slot, false, { prevKey: lastKey });
        if (
          strictSingleUse &&
          eligible.length === 0 &&
          hasAnyUnusedFootage(fineSplitFloor) &&
          splitGuard < Math.max(450, workingSlots.length * 2)
        ) {
          const finePair = splitSlotAtBeat(slot, fineSplitFloor);
          if (finePair) {
            splitGuard++;
            workingSlots.splice(sIdx, 1, finePair[0], finePair[1]);
            continue;
          }
        }
      }
      // If only unused photos remain once videos are spent and slot is long (>2 beats), split into crisp beat-synced photo cuts
      if (
        hasMixedPool &&
        mediaPriority !== 'video_first' &&
        eligible.length > 0 &&
        eligible.every((e) => e.kind === 'image') &&
        slot.dur > Math.max(shortBeatMaxSec, beatSec * 2.4) &&
        slot.beatEndIdx - slot.beatStartIdx >= 2 &&
        splitGuard < Math.max(450, workingSlots.length * 2)
      ) {
        const photoFloor = Math.max(0.45, Math.min(beatSec * 1.8, shortBeatMaxSec * 0.85));
        const photoPair = splitSlotAtBeat(slot, photoFloor);
        if (photoPair) {
          splitGuard++;
          workingSlots.splice(sIdx, 1, photoPair[0], photoPair[1]);
          continue;
        }
      }
      if (eligible.length === 0) {
        break;
      }
      const chosen = pickStrictCandidate(eligible, slot);
      const { sourceStartSec, rate } = takeUnusedSlice(chosen, slot.dur, false, placements.length);
      placements.push(buildPlacementForSlot(slot, placements.length, chosen, sourceStartSec, rate));
      last3Key = last2Key;
      last2Key = lastKey;
      lastKey = chosen.contentKey;
      sIdx++;
    }
    return placements;
  }

  // Pass A (fillToTargetEnd === true): Showcase every unique source file first,
  // reserving longer bar slots for videos and keeping short beat punches for photos when mixed media is present.
  const binKeyById = new Map(pool.map((p) => [p.binItem.id, p.contentKey]));
  const assigned: Array<AutoBeatSlicePlacement | null> = new Array(workingSlots.length).fill(null);
  let splitGuard = 0;
  const maxSplitBudget = Math.max(400, workingSlots.length * 2);
  const uniquePoolVideosCount = new Set(poolVideos.map((v) => v.contentKey)).size;
  const uniqueAssetKeyCount = new Set(pool.map((e) => e.contentKey)).size;

  for (const allowUntrimmed of [false, true]) {
    let madeProgress = true;
    while (madeProgress) {
      madeProgress = false;
      const unassignedIndices: number[] = [];
      for (let i = 0; i < workingSlots.length; i++) {
        if (assigned[i] === null) unassignedIndices.push(i);
      }
      if (unassignedIndices.length === 0) break;

      const anyUnusedLeft = pool.some(
        (e) => (usageCountByKey.get(e.contentKey) ?? 0) === 0
      );
      unassignedIndices.sort((a, b) => {
        if (anyUnusedLeft || uniqueAssetKeyCount <= 2 || uniquePoolVideosCount <= 2) {
          return a - b;
        }
        const diff = workingSlots[b].dur - workingSlots[a].dur;
        if (Math.abs(diff) > 0.05) return diff;
        return a - b;
      });

      for (const idx of unassignedIndices) {
        if (uniqueAssetKeyCount <= 2 && idx > 0 && assigned[idx - 1] === null) {
          break;
        }
        const slot = workingSlots[idx];
        const prevId = idx > 0 ? assigned[idx - 1]?.binItemId ?? null : null;
        const nextId = idx + 1 < assigned.length ? assigned[idx + 1]?.binItemId ?? null : null;
        const prev2Id = idx > 1 ? assigned[idx - 2]?.binItemId ?? null : null;
        const next2Id = idx + 2 < assigned.length ? assigned[idx + 2]?.binItemId ?? null : null;
        const prev3Id = idx > 2 ? assigned[idx - 3]?.binItemId ?? null : null;
        const next3Id = idx + 3 < assigned.length ? assigned[idx + 3]?.binItemId ?? null : null;
        const prevKey = prevId ? binKeyById.get(prevId) ?? null : null;
        const nextKey = nextId ? binKeyById.get(nextId) ?? null : null;
        const prev2Key = prev2Id ? binKeyById.get(prev2Id) ?? null : null;
        const next2Key = next2Id ? binKeyById.get(next2Id) ?? null : null;
        const prev3Key = prev3Id ? binKeyById.get(prev3Id) ?? null : null;
        const next3Key = next3Id ? binKeyById.get(next3Id) ?? null : null;

        const rawEligible = pool.filter((e) => canAssetFitUnused(e, slot.dur, !allowUntrimmed, false));
        const eligible = filterByMixedPriority(rawEligible, slot, !allowUntrimmed, {
          prevKey,
          nextKey,
          reserveShortForPhotos: hasMixedPool,
        });
        if (eligible.length > 0) {
          if (
            hasMixedPool &&
            mediaPriority !== 'video_first' &&
            !isShortBeatSlot(slot) &&
            slot.beatEndIdx - slot.beatStartIdx >= 3 &&
            slot.section !== 'beatless' &&
            splitGuard < maxSplitBudget &&
            eligible.every((e) => e.kind === 'video' && (usageCountByKey.get(e.contentKey) ?? 0) >= 1) &&
            poolImages.some(
              (img) =>
                !usedImageKeys.has(img.contentKey) &&
                (!avoidAdjacentRepeat || (img.contentKey !== prevKey && img.contentKey !== nextKey))
            )
          ) {
            const punchBeats = beatSec * 2 <= shortBeatMaxSec + 0.02 ? 2 : 1;
            const splitIdx = slot.beatEndIdx - punchBeats;
            if (splitIdx > slot.beatStartIdx) {
              const splitT = Number(beatTimes[splitIdx].toFixed(3));
              const leftDur = Number((splitT - slot.startSec).toFixed(3));
              const rightDur = Number((slot.startSec + slot.dur - splitT).toFixed(3));
              if (leftDur >= 0.45 && rightDur >= 0.4 && rightDur <= shortBeatMaxSec + 0.02) {
                splitGuard++;
                const midImpact =
                  (onsetAccent[splitIdx] ?? slot.cutImpact) * 0.55 +
                  (melodicNovelty[splitIdx] ?? 0.4) * 0.45;
                workingSlots.splice(
                  idx,
                  1,
                  {
                    startSec: slot.startSec,
                    dur: leftDur,
                    beatStartIdx: slot.beatStartIdx,
                    beatEndIdx: splitIdx,
                    energy: slot.energy,
                    cutImpact: midImpact,
                    section: slot.section,
                    isPreDrop: dropImpactSet.has(splitIdx),
                  },
                  {
                    startSec: splitT,
                    dur: rightDur,
                    beatStartIdx: splitIdx,
                    beatEndIdx: slot.beatEndIdx,
                    energy: phraseEnergy[splitIdx] ?? slot.energy,
                    cutImpact: slot.cutImpact,
                    section: beatSections[splitIdx] ?? slot.section,
                    isPreDrop: slot.isPreDrop,
                  }
                );
                assigned.splice(idx, 1, null, null);
                madeProgress = true;
                break;
              }
            }
          }
          const wouldForceAdjRepeat =
            avoidAdjacentRepeat &&
            uniqueAssetKeyCount > 1 &&
            eligible.every((e) => e.contentKey === prevKey || e.contentKey === nextKey) &&
            pool.some((e) => e.contentKey !== prevKey && e.contentKey !== nextKey);
          if (wouldForceAdjRepeat) {
            if (uniqueAssetKeyCount <= 2) break;
            continue;
          }
          const chosen = pickShuffledAsset(
            eligible,
            slot,
            idx,
            prevKey,
            nextKey,
            prev2Key,
            next2Key,
            prev3Key,
            next3Key
          );
          const { sourceStartSec, rate } = takeUnusedSlice(chosen, slot.dur, false, idx);
          assigned[idx] = buildPlacementForSlot(slot, idx, chosen, sourceStartSec, rate);
          madeProgress = true;
        } else if (uniqueAssetKeyCount <= 2) {
          break;
        }
      }

      if (!madeProgress && !allowUntrimmed && hasAnyUnusedFootage(splitFloor) && splitGuard < maxSplitBudget) {
        let splitAny = false;
        for (let i = 0; i < workingSlots.length && splitGuard < maxSplitBudget; i++) {
          if (assigned[i] !== null) continue;
          const pair = splitSlotAtBeat(workingSlots[i]);
          if (pair) {
            workingSlots.splice(i, 1, pair[0], pair[1]);
            assigned.splice(i, 1, null, null);
            splitGuard++;
            splitAny = true;
            i++;
          }
        }
        if (splitAny) {
          madeProgress = true;
        }
      }
    }
  }

  // Pass B: Exhaustion fallback ONLY after unique footage is depleted; maintains video priority on long slots
  // and photo priority on short beat punches while keeping least-used, max-distance cooled files and 0 adjacent repeats.
  let passBSplitCount = 0;
  for (let i = 0; i < workingSlots.length; i++) {
    if (assigned[i] !== null) continue;
    const slot = workingSlots[i];
    const prevId = i > 0 ? assigned[i - 1]?.binItemId ?? null : null;
    const nextId = i + 1 < assigned.length ? assigned[i + 1]?.binItemId ?? null : null;
    const prev2Id = i > 1 ? assigned[i - 2]?.binItemId ?? null : null;
    const next2Id = i + 2 < assigned.length ? assigned[i + 2]?.binItemId ?? null : null;
    const prev3Id = i > 2 ? assigned[i - 3]?.binItemId ?? null : null;
    const next3Id = i + 3 < assigned.length ? assigned[i + 3]?.binItemId ?? null : null;
    const prevKey = prevId ? binKeyById.get(prevId) ?? null : null;
    const nextKey = nextId ? binKeyById.get(nextId) ?? null : null;
    const prev2Key = prev2Id ? binKeyById.get(prev2Id) ?? null : null;
    const next2Key = next2Id ? binKeyById.get(next2Id) ?? null : null;
    const prev3Key = prev3Id ? binKeyById.get(prev3Id) ?? null : null;
    const next3Key = next3Id ? binKeyById.get(next3Id) ?? null : null;

    if (
      hasMixedPool &&
      avoidAdjacentRepeat &&
      (mode === 'auto_rhythm' || rhythm === 'auto') &&
      !isShortBeatSlot(slot) &&
      uniquePoolVideosCount >= 2 &&
      poolVideos.every((v) => v.contentKey === prevKey || v.contentKey === nextKey) &&
      slot.beatEndIdx - slot.beatStartIdx >= 3 &&
      passBSplitCount < workingSlots.length
    ) {
      const punchBeats = beatSec * 2 <= shortBeatMaxSec + 0.01 ? 2 : 1;
      const splitIdx = slot.beatEndIdx - punchBeats;
      if (splitIdx > slot.beatStartIdx) {
        const splitT = Number(beatTimes[splitIdx].toFixed(3));
        const leftDur = Number((splitT - slot.startSec).toFixed(3));
        const rightDur = Number((slot.startSec + slot.dur - splitT).toFixed(3));
        if (leftDur >= 0.45 && rightDur >= 0.4 && rightDur <= shortBeatMaxSec + 0.01) {
          passBSplitCount++;
          const midImpact =
            (onsetAccent[splitIdx] ?? slot.cutImpact) * 0.55 +
            (melodicNovelty[splitIdx] ?? 0.4) * 0.45;
          workingSlots.splice(
            i,
            1,
            {
              startSec: slot.startSec,
              dur: leftDur,
              beatStartIdx: slot.beatStartIdx,
              beatEndIdx: splitIdx,
              energy: slot.energy,
              cutImpact: midImpact,
              section: slot.section,
              isPreDrop: dropImpactSet.has(splitIdx),
            },
            {
              startSec: splitT,
              dur: rightDur,
              beatStartIdx: splitIdx,
              beatEndIdx: slot.beatEndIdx,
              energy: phraseEnergy[splitIdx] ?? slot.energy,
              cutImpact: slot.cutImpact,
              section: beatSections[splitIdx] ?? slot.section,
              isPreDrop: slot.isPreDrop,
            }
          );
          assigned.splice(i, 1, null, null);
          i--;
          continue;
        }
      }
    }

    let candidates: PoolAsset[] = [];
    for (const pt of [true, false]) {
      const fitting = pool.filter((e) => e.kind === 'image' || isTrimmedOk(e, slot.dur, pt));
      const prioritized = filterByMixedPriority(fitting, slot, false, {
        prevKey,
        nextKey,
        isFallbackPass: true,
      });
      if (prioritized.length > 0) {
        candidates = prioritized;
        break;
      }
    }
    if (candidates.length === 0) {
      candidates = filterByMixedPriority(pool, slot, false, {
        prevKey,
        nextKey,
        isFallbackPass: true,
      });
    }

    const nonAdj = avoidAdjacentRepeat
      ? candidates.filter((e) => e.contentKey !== prevKey && e.contentKey !== nextKey)
      : candidates;
    if (
      avoidAdjacentRepeat &&
      uniqueAssetKeyCount >= 2 &&
      nonAdj.length === 0 &&
      slot.beatEndIdx - slot.beatStartIdx >= 2 &&
      passBSplitCount < workingSlots.length
    ) {
      const midBeatIdx = Math.floor((slot.beatStartIdx + slot.beatEndIdx) / 2);
      if (midBeatIdx > slot.beatStartIdx && midBeatIdx < slot.beatEndIdx) {
        const splitT = Number(beatTimes[midBeatIdx].toFixed(3));
        const leftDur = Number((splitT - slot.startSec).toFixed(3));
        const rightDur = Number((slot.startSec + slot.dur - splitT).toFixed(3));
        if (leftDur >= 0.4 && rightDur >= 0.4) {
          passBSplitCount++;
          const midImpact =
            (onsetAccent[midBeatIdx] ?? slot.cutImpact) * 0.55 +
            (melodicNovelty[midBeatIdx] ?? 0.4) * 0.45;
          workingSlots.splice(
            i,
            1,
            {
              startSec: slot.startSec,
              dur: leftDur,
              beatStartIdx: slot.beatStartIdx,
              beatEndIdx: midBeatIdx,
              energy: slot.energy,
              cutImpact: midImpact,
              section: slot.section,
              isPreDrop: dropImpactSet.has(midBeatIdx),
            },
            {
              startSec: splitT,
              dur: rightDur,
              beatStartIdx: midBeatIdx,
              beatEndIdx: slot.beatEndIdx,
              energy: phraseEnergy[midBeatIdx] ?? slot.energy,
              cutImpact: slot.cutImpact,
              section: beatSections[midBeatIdx] ?? slot.section,
              isPreDrop: slot.isPreDrop,
            }
          );
          assigned.splice(i, 1, null, null);
          i--;
          continue;
        }
      }
    }
    const poolStage1 = nonAdj.length > 0 ? nonAdj : candidates;
    const minUsage = Math.min(...poolStage1.map((e) => usageCountByKey.get(e.contentKey) ?? 0));
    const leastUsed = poolStage1
      .filter((e) => (usageCountByKey.get(e.contentKey) ?? 0) === minUsage)
      .sort((a, b) => getMinSlotDist(b.contentKey, i) - getMinSlotDist(a.contentKey, i));
    const nonPingPong2 = leastUsed.filter(
      (e) => e.contentKey !== prev2Key && e.contentKey !== next2Key
    );
    const stage2Pool = nonPingPong2.length > 0 ? nonPingPong2 : leastUsed;
    const nonPingPong3 =
      stage2Pool.length > 1 && (prev3Key || next3Key)
        ? stage2Pool.filter((e) => e.contentKey !== prev3Key && e.contentKey !== next3Key)
        : stage2Pool;
    const pickSource = nonPingPong3.length > 0 ? nonPingPong3 : stage2Pool;
    const cooledPool =
      pickSource.length > 2
        ? pickSource.slice(0, Math.max(2, Math.ceil(pickSource.length * 0.72)))
        : pickSource;
    const finalPickPool = cooledPool.length > 0 ? cooledPool : poolStage1;
    const chosen = finalPickPool[Math.floor(rng() * finalPickPool.length)];
    const { sourceStartSec, rate } = canAssetFitUnused(chosen, slot.dur, false, false)
      ? takeUnusedSlice(chosen, slot.dur, false, i)
      : takeExhaustedFallbackSlice(chosen, slot.dur, false, i);
    assigned[i] = buildPlacementForSlot(slot, i, chosen, sourceStartSec, rate);
  }

  const finalPlacements: AutoBeatSlicePlacement[] = [];
  for (let i = 0; i < assigned.length; i++) {
    const p = assigned[i];
    if (p) finalPlacements.push(p);
  }
  return finalPlacements;
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

export interface AutoReplaceClipResult {
  binItem: MediaBinItem;
  sourceStartSec: number;
  playbackRate: number;
}

export function getMediaContentSignature(
  item: Pick<
    MediaBinItem | VisualMediaState,
    'kind' | 'fileName' | 'fileSize' | 'url' | 'width' | 'height' | 'videoDuration'
  > & {
    defaultDurationSec?: number;
    generatorId?: string;
  }
): string {
  if (item.kind === 'generator') {
    return `gen:${item.generatorId || item.fileName || 'fx'}`;
  }
  const cleanName = (item.fileName || '').trim().toLowerCase();
  const sizeKey = item.fileSize !== undefined && item.fileSize > 0 ? `:${item.fileSize}` : '';
  if (item.kind === 'image') {
    return cleanName ? `img:${cleanName}:${item.width}x${item.height}${sizeKey}` : `url:${item.url}`;
  }
  const durKey = Math.round((item.videoDuration ?? item.defaultDurationSec ?? 0) * 10);
  return cleanName
    ? `vid:${cleanName}:${durKey}:${item.width}x${item.height}${sizeKey}`
    : `url:${item.url}`;
}

/**
 * Picks an automatic replacement clip from Media Bin for a timeline clip,
 * avoiding both the current clip and adjacent timeline neighbors while
 * selecting an unused/distant source segment for video clips.
 */
export function pickAutoReplacementForTimelineClip(
  targetClip: VisualMediaState,
  timelineItems: VisualMediaState[],
  binItems: MediaBinItem[],
  excludeEdgeSec = 5,
  rng: () => number = Math.random
): AutoReplaceClipResult | null {
  if (binItems.length === 0) return null;
  const targetIdx = timelineItems.findIndex((c) => c.id === targetClip.id);
  const targetSig = getMediaContentSignature(targetClip);
  const prevClip = targetIdx > 0 ? timelineItems[targetIdx - 1] : null;
  const nextClip =
    targetIdx >= 0 && targetIdx + 1 < timelineItems.length ? timelineItems[targetIdx + 1] : null;
  const prev2Clip = targetIdx > 1 ? timelineItems[targetIdx - 2] : null;
  const next2Clip =
    targetIdx >= 0 && targetIdx + 2 < timelineItems.length ? timelineItems[targetIdx + 2] : null;
  const prevSig = prevClip ? getMediaContentSignature(prevClip) : null;
  const nextSig = nextClip ? getMediaContentSignature(nextClip) : null;
  const prev2Sig = prev2Clip ? getMediaContentSignature(prev2Clip) : null;
  const next2Sig = next2Clip ? getMediaContentSignature(next2Clip) : null;

  const usageBySig = new Map<string, number>();
  const usedSlicesBySig = new Map<string, Array<[number, number]>>();
  for (const item of timelineItems) {
    if (item.id === targetClip.id) continue;
    const sig = getMediaContentSignature(item);
    usageBySig.set(sig, (usageBySig.get(sig) ?? 0) + 1);
    if (item.kind === 'video') {
      const list = usedSlicesBySig.get(sig) ?? [];
      const s = Math.max(0, item.sourceStartSec || 0);
      const e = s + Math.max(0.4, item.durationSec || 4) * Math.max(0.25, item.playbackRate || 1);
      list.push([s, e]);
      usedSlicesBySig.set(sig, list);
    }
  }
  if (targetClip.kind === 'video') {
    const list = usedSlicesBySig.get(targetSig) ?? [];
    const s = Math.max(0, targetClip.sourceStartSec || 0);
    const e =
      s + Math.max(0.4, targetClip.durationSec || 4) * Math.max(0.25, targetClip.playbackRate || 1);
    list.push([s, e]);
    usedSlicesBySig.set(targetSig, list);
  }

  // Deduplicate identical bin uploads by content signature so duplicate files don't bias weight
  const uniqueBySig = new Map<string, MediaBinItem>();
  for (const b of binItems) {
    const sig = getMediaContentSignature(b);
    if (!uniqueBySig.has(sig)) uniqueBySig.set(sig, b);
  }
  const uniquePool = Array.from(uniqueBySig.values());

  const diffCurrent = uniquePool.filter((b) => getMediaContentSignature(b) !== targetSig);
  const stage1 = diffCurrent.length > 0 ? diffCurrent : uniquePool;
  const nonAdj = stage1.filter((b) => {
    const sig = getMediaContentSignature(b);
    return sig !== prevSig && sig !== nextSig;
  });
  const stage2 = nonAdj.length > 0 ? nonAdj : stage1;
  const nonPingPong =
    stage2.length > 1
      ? stage2.filter((b) => {
          const sig = getMediaContentSignature(b);
          return sig !== prev2Sig && sig !== next2Sig;
        })
      : stage2;
  const stage3 = nonPingPong.length > 0 ? nonPingPong : stage2;

  const slotDur = Math.max(0.4, targetClip.durationSec || 4);
  const preferVideo = slotDur > 2.6;
  const minUsage = Math.min(...stage3.map((b) => usageBySig.get(getMediaContentSignature(b)) ?? 0));
  const leastUsed = stage3.filter(
    (b) => (usageBySig.get(getMediaContentSignature(b)) ?? 0) <= minUsage + 1
  );
  const scoredPool = (leastUsed.length > 0 ? leastUsed : stage3).map((b) => {
    const sig = getMediaContentSignature(b);
    const uses = usageBySig.get(sig) ?? 0;
    let score = -uses * 2.0 + rng() * 1.4;
    if (preferVideo && b.kind === 'video') {
      const safe = resolveSafeVideoSourceRange(b, excludeEdgeSec);
      const rate = Math.max(0.25, Math.min(4, b.defaultPlaybackRate ?? 1.0));
      score += safe.usableSpanSec / rate >= slotDur ? 2.2 : 0.8;
    } else if (!preferVideo && b.kind === 'image') {
      score += 1.2;
    }
    return { item: b, score };
  });
  scoredPool.sort((a, b) => b.score - a.score);
  const chosen = scoredPool[0].item;
  const chosenSig = getMediaContentSignature(chosen);

  if (chosen.kind !== 'video') {
    return {
      binItem: chosen,
      sourceStartSec: 0,
      playbackRate: 1.0,
    };
  }

  const rate = Math.max(0.25, Math.min(4, chosen.defaultPlaybackRate ?? 1.0));
  const safe = resolveSafeVideoSourceRange(chosen, excludeEdgeSec);
  const need = slotDur * rate;
  const maxOff = Math.max(0, safe.usableSpanSec - Math.min(need, safe.usableSpanSec));
  const prior = usedSlicesBySig.get(chosenSig) ?? [];

  let bestStart = safe.sourceStartSec;
  if (maxOff > 0.2) {
    if (prior.length === 0) {
      bestStart = Number((safe.sourceStartSec + rng() * maxOff).toFixed(2));
    } else {
      let bestScore = -Infinity;
      const STEPS = 18;
      for (let k = 0; k <= STEPS; k++) {
        const cand = Number(
          (
            safe.sourceStartSec +
            Math.min(maxOff, Math.max(0, ((k + rng() * 0.65) / (STEPS + 1)) * maxOff))
          ).toFixed(2)
        );
        const candEnd = cand + Math.min(need, safe.usableSpanSec);
        let minDist = Infinity;
        let totalOverlap = 0;
        for (const [ps, pe] of prior) {
          const overlap = Math.max(0, Math.min(candEnd, pe) - Math.max(cand, ps));
          totalOverlap += overlap;
          const d = candEnd <= ps ? ps - candEnd : cand >= pe ? cand - pe : -overlap;
          if (d < minDist) minDist = d;
        }
        const score = minDist - totalOverlap * 4 + rng() * 0.55;
        if (score > bestScore) {
          bestScore = score;
          bestStart = cand;
        }
      }
    }
  }

  return {
    binItem: chosen,
    sourceStartSec: bestStart,
    playbackRate: rate,
  };
}

export interface LockedPlanGapResult {
  lockedClips: VisualMediaState[];
  placements: AutoBeatSlicePlacement[];
}

/**
 * Generates fresh Auto-Clip slices around any user-locked timeline clips (`clip.locked === true`)
 * while preserving locked clip timing and excluding locked media slices from reuse so
 * hero shots stay anchored across regenerations without overlaps or duplicate frames.
 */
export function planAutoClipsAroundLocked(
  existingItems: VisualMediaState[],
  binItems: MediaBinItem[],
  beatGrid: TrackBeatGrid,
  manualMarkersAbs: number[],
  trimBase: number,
  maxTimelineSec: number,
  autoCfg: AutoClipGenerateConfig,
  options: {
    hasAudio?: boolean;
    monoData?: Float32Array;
    sampleRate?: number;
    preferAvoidUrls?: Set<string>;
    preferAvoidVideoRangesByUrl?: Map<string, Array<[number, number]>>;
  } = {}
): LockedPlanGapResult {
  const lockedRaw = existingItems
    .filter((c) => Boolean(c.locked))
    .map((c) => {
      const st = Math.max(0, Number((c.startSec ?? 0).toFixed(3)));
      const dur = Math.max(0.4, Number((c.durationSec || 0.4).toFixed(3)));
      return { ...c, startSec: st, durationSec: dur };
    })
    .filter((c) => c.startSec < maxTimelineSec - 0.1)
    .sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));

  // Clamp locked intervals so they never overlap one another or overrun maxTimelineSec
  const lockedClips: VisualMediaState[] = [];
  let lockCursor = 0;
  for (const lc of lockedRaw) {
    const startSec = Math.max(lockCursor, lc.startSec ?? 0);
    const maxAllowed = Math.max(0, maxTimelineSec - startSec);
    if (maxAllowed < 0.4) continue;
    const dur = Math.min(lc.durationSec, maxAllowed);
    lockedClips.push({
      ...lc,
      startSec: Number(startSec.toFixed(3)),
      durationSec: Number(dur.toFixed(3)),
    });
    lockCursor = Number((startSec + dur).toFixed(3));
  }

  const effectiveLimit =
    autoCfg.targetDurationSec && autoCfg.targetDurationSec > 0.5
      ? Math.min(maxTimelineSec, autoCfg.targetDurationSec)
      : maxTimelineSec;

  if (lockedClips.length === 0) {
    const placements = generateAutoClipPlan(
      binItems,
      beatGrid,
      manualMarkersAbs,
      trimBase,
      effectiveLimit,
      {
        mode: autoCfg.mode,
        rhythm: autoCfg.rhythm,
        editorialProfile: autoCfg.editorialProfile,
        transitionStyle: autoCfg.transitionStyle,
        motionLevel: autoCfg.motionLevel,
        mediaPriority: autoCfg.mediaPriority,
        minClipSec: autoCfg.minClipSec,
        maxClipSec: autoCfg.maxClipSec,
        targetDurationSec: autoCfg.targetDurationSec,
        startOffsetSec: 0,
        avoidAdjacentRepeat: autoCfg.avoidAdjacentRepeat,
        shuffleOrder: autoCfg.shuffleOrder,
        excludeEdgeSec: autoCfg.excludeEdgeSec ?? 5,
        preferAvoidUrls: options.preferAvoidUrls,
        preferAvoidVideoRangesByUrl: options.preferAvoidVideoRangesByUrl,
        fillToTargetEnd: Boolean(options.hasAudio),
        strictSingleUse: !autoCfg.allowReuseWhenExhausted,
        hasAudio: Boolean(options.hasAudio),
        monoData: options.monoData,
        sampleRate: options.sampleRate,
        variationSeed: autoCfg.variationSeed,
      }
    );
    return { lockedClips: [], placements };
  }

  const usedUrls = new Set<string>();
  const usedVideoRanges = new Map<string, Array<[number, number]>>();
  for (const lc of lockedClips) {
    if (!lc.url) continue;
    if (lc.kind === 'image') {
      usedUrls.add(lc.url);
    } else if (lc.kind === 'video') {
      const list = usedVideoRanges.get(lc.url) ?? [];
      const srcStart = Math.max(0, lc.sourceStartSec || 0);
      const srcEnd = srcStart + lc.durationSec * Math.max(0.25, lc.playbackRate || 1);
      list.push([Number(srcStart.toFixed(2)), Number(srcEnd.toFixed(2))]);
      usedVideoRanges.set(lc.url, list);
    }
  }

  // Build open intervals [gapStart, gapEnd] around locked clips
  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const lc of lockedClips) {
    const st = lc.startSec ?? 0;
    if (st - cursor >= 0.45) {
      gaps.push([Number(cursor.toFixed(3)), Number(st.toFixed(3))]);
    }
    cursor = Math.max(cursor, st + lc.durationSec);
  }
  const outerEnd = options.hasAudio
    ? effectiveLimit
    : Math.max(effectiveLimit, cursor + 24);
  if (outerEnd - cursor >= 0.45) {
    gaps.push([Number(cursor.toFixed(3)), Number(outerEnd.toFixed(3))]);
  }

  const binById = new Map(binItems.map((b) => [b.id, b]));
  const allPlacements: AutoBeatSlicePlacement[] = [];
  gaps.forEach(([gapStart, gapEnd], gapIdx) => {
    const gapSpan = Number((gapEnd - gapStart).toFixed(3));
    if (gapSpan < 0.45) return;
    const gapSeed =
      autoCfg.variationSeed !== undefined
        ? (autoCfg.variationSeed + (gapIdx + 1) * 7919) >>> 0
        : undefined;
    const gapPlacements = generateAutoClipPlan(
      binItems,
      beatGrid,
      manualMarkersAbs,
      trimBase,
      gapEnd,
      {
        mode: autoCfg.mode,
        rhythm: autoCfg.rhythm,
        editorialProfile: autoCfg.editorialProfile,
        transitionStyle: autoCfg.transitionStyle,
        motionLevel: autoCfg.motionLevel,
        mediaPriority: autoCfg.mediaPriority,
        minClipSec: Math.min(autoCfg.minClipSec, Math.max(0.45, gapSpan * 0.9)),
        maxClipSec: autoCfg.maxClipSec,
        targetDurationSec: gapSpan,
        startOffsetSec: gapStart,
        avoidAdjacentRepeat: autoCfg.avoidAdjacentRepeat,
        shuffleOrder: autoCfg.shuffleOrder,
        excludeEdgeSec: autoCfg.excludeEdgeSec ?? 5,
        excludeUsedUrls: usedUrls,
        excludeVideoRangesByUrl: usedVideoRanges,
        preferAvoidUrls: options.preferAvoidUrls,
        preferAvoidVideoRangesByUrl: options.preferAvoidVideoRangesByUrl,
        fillToTargetEnd: true,
        strictSingleUse: !autoCfg.allowReuseWhenExhausted,
        hasAudio: Boolean(options.hasAudio),
        monoData: options.monoData,
        sampleRate: options.sampleRate,
        variationSeed: gapSeed,
      }
    );
    for (const p of gapPlacements) {
      allPlacements.push(p);
      const asset = binById.get(p.binItemId);
      if (!asset?.url) continue;
      if (asset.kind === 'image') {
        usedUrls.add(asset.url);
      } else {
        const list = usedVideoRanges.get(asset.url) ?? [];
        const sEnd = p.sourceStartSec + p.durationSec * Math.max(0.25, p.playbackRate || 1);
        list.push([Number(p.sourceStartSec.toFixed(2)), Number(sEnd.toFixed(2))]);
        usedVideoRanges.set(asset.url, list);
      }
    }
  });

  allPlacements.sort((a, b) => a.startSec - b.startSec);
  return { lockedClips, placements: allPlacements };
}





