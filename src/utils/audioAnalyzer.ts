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
  const dur = Math.max(0.4, desiredDurSec || 4);
  const others = getNormalizedManualClipIntervals(mediaItems);
  if (others.length === 0) {
    const start = Math.max(0, Math.min(Math.max(0, maxTimelineSec - 0.4), desiredStartSec));
    return {
      startSec: Number(start.toFixed(2)),
      durationSec: Number(Math.min(dur, Math.max(0.4, maxTimelineSec - start)).toFixed(2)),
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

  const clampedDesired = Math.max(0, Math.min(Math.max(0, maxTimelineSec - 0.4), desiredStartSec));
  const targetGap = gaps.find(
    (g) => clampedDesired >= g.start - 0.04 && clampedDesired <= g.end + 0.04 && g.end - g.start >= 0.4
  );

  if (targetGap) {
    const gapLen = Number((targetGap.end - targetGap.start).toFixed(2));
    if (targetGap.boundedRight) {
      // Bounded gap between existing clips: never overflow neighbor clips; fill edge-to-edge when
      // clip length >= gap, or place custom shorter duration inside the gap cleanly.
      if (dur >= gapLen - 0.05) {
        return {
          startSec: Number(targetGap.start.toFixed(2)),
          durationSec: Math.max(0.4, gapLen),
          filledGap: true,
        };
      }
      const start = Math.max(
        targetGap.start,
        Math.min(targetGap.end - dur, clampedDesired)
      );
      return {
        startSec: Number(start.toFixed(2)),
        durationSec: Number(Math.max(0.4, Math.min(dur, targetGap.end - start)).toFixed(2)),
        filledGap: true,
      };
    }
    const start = Math.max(targetGap.start, Math.min(targetGap.end - 0.4, clampedDesired));
    return {
      startSec: Number(start.toFixed(2)),
      durationSec: Number(Math.max(0.4, Math.min(dur, targetGap.end - start)).toFixed(2)),
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
  shuffleOrder: boolean;
  excludeEdgeSec?: number;
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
      mode: 'auto_rhythm',
      rhythm: 'beats_4',
      transitionStyle: 'punchy',
      motionLevel: 'dynamic',
      minClipSec: 2.0,
      maxClipSec: 8.0,
      avoidAdjacentRepeat: true,
      shuffleOrder: true,
      excludeEdgeSec: 5,
    },
  },
  {
    id: 'story_order',
    config: {
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
    id: 'beat_flash',
    config: {
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
  excludeEdgeSec: 5,
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
    shuffleOrder?: boolean;
    excludeEdgeSec?: number;
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
  const shouldShuffle = options.shuffleOrder ?? mode !== 'sequential';
  const fillToTargetEnd = options.fillToTargetEnd ?? false;
  const hasAudio = options.hasAudio ?? true;
  const excludeEdgeSec = Math.max(0, options.excludeEdgeSec ?? 5);
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
  const uniqueFileCount = Math.max(1, new Set(binItems.map((b) => b.url)).size);
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
      ? beatGrid.beats.filter((b) => b > startOffsetSec + 0.15 && b < targetLimit - 0.15)
      : [];
  const filteredIdx =
    beatGrid.beats.length >= 2
      ? beatGrid.beats.findIndex((b) => b > startOffsetSec + 0.15 && b < targetLimit - 0.15)
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

  const isDownbeatIndex = (idx: number): boolean =>
    ((idx - barAnchorIdx) % 4 + 4) % 4 === 0;

  const recentSteps: number[] = [];

  const getBeatStepsForIndex = (
    bIdx: number
  ): { steps: number[]; energy: number; hitStrength: number } => {
    const energy = phraseEnergy[bIdx] ?? 0.5;
    const curOnset = onsetAccent[bIdx] ?? 0.5;
    const curMelody = melodicNovelty[bIdx] ?? 0.4;
    const hitStrength = curOnset * 0.55 + curMelody * 0.45;
    const isShortSpan = totalSpanSec < 26;

    let preferredOrder: number[];
    if (rhythm === 'beats_1') {
      preferredOrder = beatSec < 0.44 ? [2, 1] : [1, 2];
    } else if (rhythm === 'beats_2') {
      preferredOrder = beatSec < 0.48 ? [2, 4, 3, 1] : [2, 4, 1, 3];
    } else if (rhythm === 'beats_4') {
      if (isShortSpan) {
        preferredOrder = [4, 8, 2];
      } else {
        preferredOrder = avgTargetPerFile >= 8 ? [12, 8, 16, 4] : [8, 12, 4, 16];
      }
    } else if (rhythm === 'smooth') {
      if (isShortSpan) {
        preferredOrder = energy > 0.72 ? [4, 8] : [8, 12, 4];
      } else {
        preferredOrder = energy > 0.72 ? [12, 8, 16, 20] : [16, 24, 12, 20, 8];
      }
    } else if (isShortSpan) {
      // Compact preview/test span (< 26s): clearly distinguish calm holds vs rhythmic drop while avoiding clutter
      if (energy < 0.38) {
        preferredOrder = [8, 6, 4];
      } else if (energy < 0.66) {
        preferredOrder = [4, 6, 8];
      } else {
        preferredOrder = [2, 4];
      }
    } else {
      // Standard full track ('auto'): keep shots long along 4-beat bar phrases (4, 8, 12, 16, 24 beats),
      // cutting strictly on bar downbeats ("тактовый бит") so visuals breathe smoothly without looping.
      if (energy < 0.38) {
        preferredOrder = avgTargetPerFile >= 9 ? [16, 24, 12, 8] : [12, 16, 8, 20];
      } else if (energy < 0.66) {
        preferredOrder = avgTargetPerFile >= 9 ? [12, 8, 16, 4] : [8, 12, 16, 4];
      } else {
        preferredOrder = [4, 8, 12];
      }
    }

    const minSteps = Math.max(1, Math.ceil(minClipBound / beatSec - 0.05));
    const maxSteps = Math.max(minSteps, Math.floor(maxClipBound / beatSec + 0.05));
    const clampedPreferred = Array.from(
      new Set(preferredOrder.map((s) => Math.max(minSteps, Math.min(maxSteps, s))))
    );
    const candSet = new Set<number>(clampedPreferred);
    if (enforceBarGrid) {
      // Also include clean 4-beat bar multiples aligned to the next downbeat phase
      const phaseRem = ((bIdx - barAnchorIdx) % 4 + 4) % 4;
      const firstBarStep = phaseRem === 0 ? 4 : 4 - phaseRem;
      const barExtMax = isShortSpan ? Math.min(maxSteps, 8) : maxSteps;
      for (let s = firstBarStep; s <= barExtMax; s += 4) {
        if (s >= minSteps) candSet.add(s);
      }
    }
    if (candSet.size === 0 || !enforceBarGrid) {
      candSet.add(minSteps);
      if (maxSteps > minSteps && candSet.size < 2) {
        candSet.add(Math.round((minSteps + maxSteps) / 2));
      }
    }

    let candidates = Array.from(candSet);
    if (enforceBarGrid && !(isShortSpan && energy >= 0.66 && rhythm === 'auto')) {
      const barAligned = candidates.filter((s) =>
        isDownbeatIndex(Math.min(beatTimes.length - 1, bIdx + s))
      );
      if (barAligned.length > 0) {
        candidates = barAligned;
      }
    }

    const isRigidBeatFlash = rhythm === 'beats_1';
    const hasCustomBarMode = rhythm !== 'auto' && rhythm !== 'smooth';
    const prevStep1 = recentSteps.length > 0 ? recentSteps[recentSteps.length - 1] : -1;
    const prevStep2 = recentSteps.length > 1 ? recentSteps[recentSteps.length - 2] : -1;

    candidates.sort((a, b) => {
      const idxA = Math.min(beatTimes.length - 1, bIdx + a);
      const idxB = Math.min(beatTimes.length - 1, bIdx + b);
      const musicalA = (onsetAccent[idxA] ?? 0.4) * 0.48 + (melodicNovelty[idxA] ?? 0.35) * 0.52;
      const musicalB = (onsetAccent[idxB] ?? 0.4) * 0.48 + (melodicNovelty[idxB] ?? 0.35) * 0.52;

      const skipPenalty = (stepLen: number): number => {
        if (hasCustomBarMode || stepLen <= Math.max(4, minSteps)) return 0;
        let maxDropJump = 0;
        for (let m = bIdx + Math.max(4, minSteps); m < Math.min(beatTimes.length - 1, bIdx + stepLen); m++) {
          const dE = (phraseEnergy[m] ?? energy) - energy;
          const mPeak = (onsetAccent[m] ?? 0) * 0.45 + (melodicNovelty[m] ?? 0) * 0.55;
          if (dE >= 0.24 || mPeak >= 0.85) {
            maxDropJump = Math.max(maxDropJump, 0.32);
          }
        }
        return maxDropJump;
      };

      const monotonyPenalty = (stepLen: number): number => {
        if (isRigidBeatFlash || candidates.length <= 1) return 0;
        if (stepLen === prevStep1 && stepLen === prevStep2) return hasCustomBarMode ? 0.14 : 0.22;
        if (stepLen === prevStep1) return hasCustomBarMode ? 0.04 : 0.08;
        return 0;
      };

      const rankA = clampedPreferred.indexOf(a);
      const rankB = clampedPreferred.indexOf(b);
      const decay = hasCustomBarMode ? 0.14 : 0.1;
      const prefA = rankA >= 0 ? Math.max(0.2, 1 - rankA * decay) : 0.12;
      const prefB = rankB >= 0 ? Math.max(0.2, 1 - rankB * decay) : 0.12;
      const barA = isDownbeatIndex(idxA) ? 0.28 : ((idxA - barAnchorIdx) % 2 + 2) % 2 === 0 ? 0.06 : 0;
      const barB = isDownbeatIndex(idxB) ? 0.28 : ((idxB - barAnchorIdx) % 2 + 2) % 2 === 0 ? 0.06 : 0;

      const weightMusical = isRigidBeatFlash ? 0.26 : hasCustomBarMode ? 0.42 : 0.52;
      const weightPref = 1 - weightMusical;
      const scoreA =
        musicalA * weightMusical +
        (prefA + barA) * weightPref -
        skipPenalty(a) -
        monotonyPenalty(a);
      const scoreB =
        musicalB * weightMusical +
        (prefB + barB) * weightPref -
        skipPenalty(b) -
        monotonyPenalty(b);
      return scoreB - scoreA;
    });

    return { steps: candidates, energy, hitStrength };
  };

  interface MusicalSlot {
    startSec: number;
    dur: number;
    beatStartIdx: number;
    beatEndIdx: number;
    energy: number;
    cutImpact: number;
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
            (workingSlots[workingSlots.length - 1].startSec + workingSlots[workingSlots.length - 1].dur).toFixed(2)
          )
        : Number(startOffsetSec.toFixed(2));
    if (cursorSec >= targetLimit - 0.45) break;
    while (beatIdx < beatTimes.length - 2 && beatTimes[beatIdx] < cursorSec - 0.04) {
      beatIdx++;
    }

    const { steps: stepCandidates, energy, hitStrength } = getBeatStepsForIndex(beatIdx);
    let chosenSlot: MusicalSlot | null = null;
    for (const stepCount of stepCandidates) {
      let nextIdx = Math.min(beatTimes.length - 1, beatIdx + stepCount);
      if (nextIdx <= beatIdx) continue;
      let rawEnd = Number(Math.min(targetLimit, beatTimes[nextIdx]).toFixed(2));
      let dur = Number((rawEnd - cursorSec).toFixed(2));
      if (dur > hardMaxDur) {
        const fallbackSteps = Math.max(1, Math.floor(maxClipBound / beatSec));
        const cappedEnd = Math.min(
          targetLimit,
          cursorSec + Math.min(maxClipBound, fallbackSteps * beatSec)
        );
        rawEnd = Number(Math.max(cursorSec + 0.45, cappedEnd).toFixed(2));
        dur = Number((rawEnd - cursorSec).toFixed(2));
        nextIdx = beatIdx + 1;
        while (nextIdx < beatTimes.length - 1 && beatTimes[nextIdx] < rawEnd - 0.04) {
          nextIdx++;
        }
      }
      const isShortDrop = totalSpanSec < 26 && energy >= 0.66 && rhythm === 'auto';
      const minAllow = isShortDrop
        ? Math.max(0.45, Math.min(1.0, targetLimit - cursorSec))
        : Math.max(0.45, Math.min(minClipBound * 0.85, targetLimit - cursorSec));
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
      };
      break;
    }

    if (!chosenSlot) {
      const rem = Number((targetLimit - cursorSec).toFixed(2));
      // Absorb tiny trailing remainder into previous slot when fillToTargetEnd is enabled
      if (
        fillToTargetEnd &&
        workingSlots.length > 0 &&
        rem < minClipBound &&
        workingSlots[workingSlots.length - 1].dur + rem <= hardMaxDur + 1.5
      ) {
        const prev = workingSlots[workingSlots.length - 1];
        prev.dur = Number((targetLimit - prev.startSec).toFixed(2));
        break;
      }
      if (rem >= 0.4) {
        const clamped = Number(Math.min(rem, hardMaxDur).toFixed(2));
        chosenSlot = {
          startSec: cursorSec,
          dur: clamped,
          beatStartIdx: beatIdx,
          beatEndIdx: Math.min(beatTimes.length - 1, beatIdx + 1),
          energy,
          cutImpact: hitStrength,
        };
      } else {
        break;
      }
    }

    const stepSpan = Math.max(1, chosenSlot.beatEndIdx - chosenSlot.beatStartIdx);
    recentSteps.push(stepSpan);
    if (recentSteps.length > 4) recentSteps.shift();
    workingSlots.push(chosenSlot);
    beatIdx = chosenSlot.beatEndIdx;
  }

  if (workingSlots.length === 0) return [];

  if (hasAudio) {
    const lastSlot = workingSlots[workingSlots.length - 1];
    if (lastSlot.startSec + lastSlot.dur > targetLimit) {
      lastSlot.dur = Number(Math.max(0.4, targetLimit - lastSlot.startSec).toFixed(2));
    } else if (fillToTargetEnd) {
      const targetSliceDur = Math.max(
        minClipBound,
        Math.min(maxClipBound, beatSec * (rhythm === 'beats_1' ? 1 : rhythm === 'beats_2' ? 2 : 8))
      );
      let guard = 0;
      while (guard < 2000 && workingSlots.length < maxSlots * 2) {
        guard++;
        const tail = workingSlots[workingSlots.length - 1];
        const tailEnd = Number((tail.startSec + tail.dur).toFixed(2));
        if (tailEnd >= targetLimit - 0.02) break;
        const rem = Number((targetLimit - tailEnd).toFixed(2));
        if (rem <= Math.min(beatSec * 3.5, Math.max(1.2, minClipBound * 0.9)) && tail.dur + rem <= hardMaxDur + 1.5) {
          tail.dur = Number((targetLimit - tail.startSec).toFixed(2));
          break;
        }
        const sliceDur =
          rem <= hardMaxDur
            ? rem
            : Number(Math.min(targetSliceDur, rem - minClipBound >= minClipBound ? targetSliceDur : rem).toFixed(2));
        const endBeat = Math.min(beatTimes.length - 1, tail.beatEndIdx + 1);
        workingSlots.push({
          startSec: tailEnd,
          dur: Math.max(0.4, sliceDur),
          beatStartIdx: tail.beatEndIdx,
          beatEndIdx: endBeat,
          energy: phraseEnergy[tail.beatEndIdx] ?? 0.5,
          cutImpact: (onsetAccent[endBeat] ?? 0.5) * 0.55 + (melodicNovelty[endBeat] ?? 0.4) * 0.45,
        });
      }
    }
  }

  // =========================================================================
  // STAGE 2: Anti-Loop Unique-File-First Long Slicing Across Bounded Video Spans
  // Excludes first/last `excludeEdgeSec` (default 5s) + honors per-file Start/End range.
  // Shows each unique source file once cleanly before any file ever repeats.
  // =========================================================================
  interface PoolImage {
    kind: 'image';
    binItem: MediaBinItem;
  }
  interface PoolVideo {
    kind: 'video';
    binItem: MediaBinItem;
    rate: number;
    initStart: number;
    initEnd: number;
    usableSpan: number;
    vDur: number;
  }
  type PoolAsset = PoolImage | PoolVideo;

  const urlFreeRanges = new Map<string, Array<[number, number]>>();
  const usedImageUrls = new Set<string>(options.excludeUsedUrls ?? []);
  const seqCursorByUrl = new Map<string, number>();
  const usedSlicesByUrl = new Map<string, Array<[number, number]>>();
  const usageCountByUrl = new Map<string, number>();
  const lastSlotIdxByUrl = new Map<string, number>();

  const minSliceKeep = 0.35;
  const slicePad = 0.06;

  const initPoolAndRanges = (respectExclusions: boolean): PoolAsset[] => {
    urlFreeRanges.clear();
    usedImageUrls.clear();
    if (respectExclusions && options.excludeUsedUrls) {
      for (const u of options.excludeUsedUrls) usedImageUrls.add(u);
    }
    const assets: PoolAsset[] = [];
    for (const b of binItems) {
      if (b.kind === 'image') {
        if (!usedImageUrls.has(b.url)) {
          assets.push({ kind: 'image', binItem: b });
        }
      } else {
        const safe = resolveSafeVideoSourceRange(b, excludeEdgeSec);
        const rate = Math.max(0.25, Math.min(4, b.defaultPlaybackRate ?? 1.0));
        if (!urlFreeRanges.has(b.url)) {
          const baseRange: [number, number] = [safe.sourceStartSec, safe.sourceEndSec];
          const excluded = respectExclusions
            ? options.excludeVideoRangesByUrl?.get(b.url) ?? []
            : [];
          const ranges =
            excluded.length > 0
              ? subtractUsedIntervals(baseRange, excluded, minSliceKeep)
              : baseRange[1] - baseRange[0] >= 0.25
                ? [baseRange]
                : [];
          urlFreeRanges.set(b.url, ranges);
          seqCursorByUrl.set(b.url, ranges.length > 0 ? ranges[0][0] : safe.sourceStartSec);
        }
        const availRanges = urlFreeRanges.get(b.url) ?? [];
        if (availRanges.length > 0) {
          assets.push({
            kind: 'video',
            binItem: b,
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
    if (entry.kind === 'image') return !usedImageUrls.has(entry.binItem.url);
    if (!isTrimmedOk(entry, dur, preferTrimmedSlice)) return false;
    const mediaNeed = dur * entry.rate;
    const ranges = urlFreeRanges.get(entry.binItem.url) ?? [];
    if (sequentialCursor) {
      const cursor = seqCursorByUrl.get(entry.binItem.url) ?? entry.initStart;
      return ranges.some(([rs, re]) => re - Math.max(rs, cursor) >= mediaNeed - 0.01);
    }
    return ranges.some(([rs, re]) => re - rs >= mediaNeed - 0.01);
  };

  const hasAnyUnusedFootage = (minVideoSpan = splitFloor): boolean => {
    for (const entry of pool) {
      if (entry.kind === 'image') {
        if (!usedImageUrls.has(entry.binItem.url)) return true;
      } else {
        const ranges = urlFreeRanges.get(entry.binItem.url) ?? [];
        if (ranges.some(([rs, re]) => re - rs >= minVideoSpan)) return true;
      }
    }
    return false;
  };

  const recordUsedSlice = (url: string, srcStart: number, srcEnd: number, slotOrderIdx: number) => {
    const list = usedSlicesByUrl.get(url) ?? [];
    list.push([srcStart, srcEnd]);
    usedSlicesByUrl.set(url, list);
    usageCountByUrl.set(url, (usageCountByUrl.get(url) ?? 0) + 1);
    lastSlotIdxByUrl.set(url, slotOrderIdx);
  };

  const takeUnusedSlice = (
    entry: PoolAsset,
    dur: number,
    sequentialCursor: boolean,
    slotOrderIdx: number
  ): { sourceStartSec: number; rate: number } => {
    if (entry.kind === 'image') {
      usedImageUrls.add(entry.binItem.url);
      usageCountByUrl.set(entry.binItem.url, (usageCountByUrl.get(entry.binItem.url) ?? 0) + 1);
      lastSlotIdxByUrl.set(entry.binItem.url, slotOrderIdx);
      return { sourceStartSec: 0, rate: 1.0 };
    }

    const mediaNeed = dur * entry.rate;
    const ranges = urlFreeRanges.get(entry.binItem.url) ?? [];
    let srcStart = entry.initStart;
    let srcEnd =
      entry.initStart + Math.min(mediaNeed, Math.max(0.25, entry.initEnd - entry.initStart));

    if (sequentialCursor) {
      const cursor = seqCursorByUrl.get(entry.binItem.url) ?? entry.initStart;
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
      seqCursorByUrl.set(entry.binItem.url, Number((srcEnd + slicePad).toFixed(2)));
    } else {
      const fitting: Array<[number, number]> = ranges.filter(([rs, re]) => re - rs >= mediaNeed - 0.01);
      const [rs, re] =
        fitting.length > 0 ? fitting[Math.floor(rng() * fitting.length)] : ranges[0];
      const clampedNeed = Math.min(mediaNeed, Math.max(0.25, re - rs));
      const slack = Math.max(0, re - rs - clampedNeed);
      if (slack >= Math.max(4.5, clampedNeed * 1.45)) {
        const prior = usedSlicesByUrl.get(entry.binItem.url) ?? [];
        const minEdgeBuf = Math.max(0.9, minSliceKeep + slicePad);
        let bestOffset = Number((rs + rng() * slack).toFixed(2));
        let bestScore = -Infinity;
        for (let k = 0; k < 7; k++) {
          let cand: number;
          if (k === 0 && rng() < 0.3) {
            cand = rs;
          } else if (k === 1 && rng() < 0.3) {
            cand = re - clampedNeed;
          } else {
            const innerLo = rs + minEdgeBuf;
            const innerHi = re - clampedNeed - minEdgeBuf;
            cand =
              innerHi > innerLo
                ? innerLo + ((k + rng()) / 7) * (innerHi - innerLo)
                : rs + rng() * slack;
          }
          cand = Number(Math.max(rs, Math.min(re - clampedNeed, cand)).toFixed(2));
          const candEnd = cand + clampedNeed;
          let minDist = prior.length === 0 ? slack : Infinity;
          for (const [ps, pe] of prior) {
            const d = candEnd <= ps ? ps - candEnd : cand >= pe ? cand - pe : 0;
            if (d < minDist) minDist = d;
          }
          const score = minDist + rng() * 0.6;
          if (score > bestScore) {
            bestScore = score;
            bestOffset = cand;
          }
        }
        srcStart = bestOffset;
        srcEnd = Number((srcStart + clampedNeed).toFixed(2));
      } else {
        const takeFromEnd = slack > 0.15 && rng() >= 0.45;
        srcStart = takeFromEnd ? Number((re - clampedNeed).toFixed(2)) : Number(rs.toFixed(2));
        srcEnd = Number((srcStart + clampedNeed).toFixed(2));
      }
    }

    const updated = subtractUsedIntervals(
      [entry.initStart, entry.initEnd],
      [
        ...(usedSlicesByUrl.get(entry.binItem.url) ?? []).map(
          ([us, ue]): [number, number] => [Math.max(entry.initStart, us - slicePad), ue + slicePad]
        ),
        [Math.max(entry.initStart, srcStart - slicePad), srcEnd + slicePad],
        ...(options.excludeVideoRangesByUrl?.get(entry.binItem.url) ?? []),
      ],
      minSliceKeep
    );
    urlFreeRanges.set(entry.binItem.url, updated);
    recordUsedSlice(entry.binItem.url, srcStart, srcEnd, slotOrderIdx);

    return { sourceStartSec: srcStart, rate: entry.rate };
  };

  // Exhaustion fallback strictly clamped inside [initStart .. initEnd]
  const reuseSeqCursorByUrl = new Map<string, number>();
  const takeExhaustedFallbackSlice = (
    entry: PoolAsset,
    dur: number,
    sequentialOrder: boolean,
    slotOrderIdx: number
  ): { sourceStartSec: number; rate: number } => {
    if (entry.kind === 'image') {
      usageCountByUrl.set(entry.binItem.url, (usageCountByUrl.get(entry.binItem.url) ?? 0) + 1);
      lastSlotIdxByUrl.set(entry.binItem.url, slotOrderIdx);
      return { sourceStartSec: 0, rate: 1.0 };
    }
    const mediaNeed = dur * entry.rate;
    const availSpan = Math.max(0.25, entry.initEnd - entry.initStart);
    if (sequentialOrder) {
      const cur = reuseSeqCursorByUrl.get(entry.binItem.url) ?? entry.initStart;
      const clampedCur = cur >= entry.initStart && cur + Math.min(mediaNeed, availSpan) <= entry.initEnd + 0.02
        ? cur
        : entry.initStart;
      const srcStart = Number(
        Math.max(entry.initStart, Math.min(entry.initEnd - 0.25, clampedCur)).toFixed(2)
      );
      const stepEnd = srcStart + Math.min(mediaNeed, entry.initEnd - srcStart) + slicePad;
      const nextCur = stepEnd <= entry.initEnd - 0.25 ? stepEnd : entry.initStart;
      reuseSeqCursorByUrl.set(entry.binItem.url, Number(nextCur.toFixed(2)));
      recordUsedSlice(
        entry.binItem.url,
        srcStart,
        Number((srcStart + Math.min(mediaNeed, entry.initEnd - srcStart)).toFixed(2)),
        slotOrderIdx
      );
      return { sourceStartSec: srcStart, rate: entry.rate };
    }

    const clampedNeed = Math.min(mediaNeed, availSpan);
    const maxOff = Math.max(0, availSpan - clampedNeed);
    const prior = usedSlicesByUrl.get(entry.binItem.url) ?? [];
    let bestOffset = Number((entry.initStart + rng() * maxOff).toFixed(2));
    if (maxOff > 0.2 && prior.length > 0) {
      const cands: number[] = [entry.initStart, Number((entry.initStart + maxOff).toFixed(2))];
      for (const [ps, pe] of prior) {
        if (ps - clampedNeed >= entry.initStart) cands.push(Number((ps - clampedNeed - 0.02).toFixed(2)));
        if (pe + 0.02 <= entry.initStart + maxOff) cands.push(Number((pe + 0.02).toFixed(2)));
      }
      for (let k = 0; k < 10; k++) {
        cands.push(
          Number((entry.initStart + (k === 0 ? rng() : (k - 1 + rng()) / 9) * maxOff).toFixed(2))
        );
      }
      let bestScore = -Infinity;
      for (const rawCand of cands) {
        const cand = Number(
          Math.max(entry.initStart, Math.min(entry.initStart + maxOff, rawCand)).toFixed(2)
        );
        const candEnd = cand + clampedNeed;
        let minOverlapDist = Infinity;
        for (const [ps, pe] of prior) {
          const dist =
            candEnd <= ps ? ps - candEnd : cand >= pe ? cand - pe : -Math.min(candEnd - ps, pe - cand);
          if (dist < minOverlapDist) minOverlapDist = dist;
        }
        if (minOverlapDist > bestScore) {
          bestScore = minOverlapDist;
          bestOffset = cand;
        }
      }
    }
    recordUsedSlice(
      entry.binItem.url,
      bestOffset,
      Number((bestOffset + Math.min(mediaNeed, entry.initEnd - bestOffset)).toFixed(2)),
      slotOrderIdx
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
    let trType: SlideTransitionType;
    if (transitionStyle === 'dissolve') {
      trType = 'crossfade';
    } else if (transitionStyle === 'cuts_only') {
      trType = 'cut';
    } else if (transitionStyle === 'punchy') {
      trType = slot.cutImpact > 0.62 || slotIdx % 3 === 2 ? 'zoom_cross' : 'cut';
    } else if (mode === 'auto_rhythm' || rhythm === 'auto') {
      if (slot.energy < 0.4 || rhythm === 'smooth') {
        trType = 'crossfade';
      } else if (slot.energy >= 0.65 || slot.cutImpact >= 0.56) {
        trType = slot.cutImpact >= 0.78 && slotIdx % 3 === 2 ? 'zoom_cross' : 'cut';
      } else if (asset.binItem.defaultTransitionOut) {
        trType = asset.binItem.defaultTransitionOut;
      } else {
        trType = slotIdx % 2 === 0 ? 'cut' : 'crossfade';
      }
    } else if (asset.binItem.defaultTransitionOut) {
      trType = asset.binItem.defaultTransitionOut;
    } else if (mode === 'sequential') {
      trType = slot.dur >= 2.2 ? 'crossfade' : 'cut';
    } else if (rhythm === 'smooth' || slot.dur >= 2.8) {
      trType = 'crossfade';
    } else if (rhythm === 'beats_1') {
      trType = 'cut';
    } else {
      trType = slot.cutImpact >= 0.55 || rng() < 0.58 ? 'cut' : rng() < 0.75 ? 'crossfade' : 'zoom_cross';
    }

    const isSlowDissolve =
      transitionStyle === 'dissolve' ||
      rhythm === 'smooth' ||
      ((mode === 'auto_rhythm' || rhythm === 'auto') && slot.energy < 0.4);
    const idealTrans =
      trType === 'cut'
        ? 0
        : Number(
            Math.max(
              0.14,
              Math.min(isSlowDissolve ? 0.68 : 0.28, slot.dur * (isSlowDissolve ? 0.3 : 0.24))
            ).toFixed(2)
          );

    const isImage = asset.kind === 'image';
    let scaleEnd = 1.0;
    if (motionLevel === 'gentle') {
      scaleEnd = isImage
        ? slot.dur >= 2.2
          ? 1.035
          : 1.02
        : (mode === 'auto_rhythm' || rhythm === 'auto') && slot.energy < 0.38
          ? 1.015
          : 1.0;
    } else if (motionLevel === 'dynamic') {
      scaleEnd = isImage ? (slot.dur >= 2.2 ? 1.06 : 1.035) : 1.02;
    }

    return {
      binItemId: asset.binItem.id,
      startSec: slot.startSec,
      durationSec: Number(Math.max(0.4, slot.dur).toFixed(2)),
      sourceStartSec,
      playbackRate: rate,
      transitionOut: trType,
      transitionDurationSec: idealTrans,
      scaleStart: 1.0,
      scaleEnd,
    };
  };

  const splitSlotAtBeat = (slot: MusicalSlot): [MusicalSlot, MusicalSlot] | null => {
    if (slot.dur < splitFloor * 2) return null;
    const midTime = Number((slot.startSec + slot.dur * 0.5).toFixed(2));
    let splitTime: number | null = null;
    let splitBeatIdx = Math.floor((slot.beatStartIdx + slot.beatEndIdx) / 2);

    if (slot.beatEndIdx - slot.beatStartIdx >= 2) {
      let bestBarDist = Infinity;
      let bestAnyDist = Infinity;
      let bestBarTime: number | null = null;
      let bestBarIdx = splitBeatIdx;
      for (let b = slot.beatStartIdx + 1; b < slot.beatEndIdx; b++) {
        const t = Number(beatTimes[b].toFixed(2));
        const d1 = t - slot.startSec;
        const d2 = slot.startSec + slot.dur - t;
        if (d1 >= splitFloor && d2 >= splitFloor) {
          const dist = Math.abs(t - midTime);
          if (enforceBarGrid && isDownbeatIndex(b) && dist < bestBarDist) {
            bestBarDist = dist;
            bestBarTime = t;
            bestBarIdx = b;
          }
          if (dist < bestAnyDist) {
            bestAnyDist = dist;
            splitTime = t;
            splitBeatIdx = b;
          }
        }
      }
      if (bestBarTime !== null) {
        splitTime = bestBarTime;
        splitBeatIdx = bestBarIdx;
      }
    }
    if (splitTime === null) {
      const halfDur = Number((slot.dur * 0.5).toFixed(2));
      if (halfDur < splitFloor || slot.dur - halfDur < splitFloor) return null;
      splitTime = Number((slot.startSec + halfDur).toFixed(2));
    }
    const leftDur = Number((splitTime - slot.startSec).toFixed(2));
    const rightDur = Number((slot.startSec + slot.dur - splitTime).toFixed(2));
    if (leftDur < splitFloor || rightDur < splitFloor) return null;
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
      },
      {
        startSec: splitTime,
        dur: rightDur,
        beatStartIdx: splitBeatIdx,
        beatEndIdx: slot.beatEndIdx,
        energy: phraseEnergy[splitBeatIdx] ?? slot.energy,
        cutImpact: slot.cutImpact,
      },
    ];
  };

  if (!shouldShuffle) {
    // Chronological library slicing mapped onto musical intervals
    const placements: AutoBeatSlicePlacement[] = [];
    let sIdx = 0;
    let seqPoolPointer = 0;
    let lastBinId: string | null = null;
    let splitGuard = 0;

    while (sIdx < workingSlots.length && placements.length < maxSlots * 2) {
      const slot = workingSlots[sIdx];
      let matchedIdx = -1;
      for (let off = 0; off < pool.length; off++) {
        const idx = (seqPoolPointer + off) % pool.length;
        if (canAssetFitUnused(pool[idx], slot.dur, true, true)) {
          matchedIdx = idx;
          break;
        }
      }

      if (matchedIdx < 0) {
        if (hasAnyUnusedFootage(splitFloor) && splitGuard < Math.max(400, workingSlots.length)) {
          const pair = splitSlotAtBeat(slot);
          if (pair) {
            splitGuard++;
            workingSlots.splice(sIdx, 1, pair[0], pair[1]);
            continue;
          }
        }
        for (let off = 0; off < pool.length; off++) {
          const idx = (seqPoolPointer + off) % pool.length;
          if (canAssetFitUnused(pool[idx], slot.dur, false, true)) {
            matchedIdx = idx;
            break;
          }
        }
      }

      if (matchedIdx < 0) {
        if (!fillToTargetEnd) {
          break;
        }
        let fbIdx = -1;
        for (const pt of [true, false]) {
          for (let off = 0; off < pool.length; off++) {
            const idx = (seqPoolPointer + off) % pool.length;
            const cand = pool[idx];
            if (avoidAdjacentRepeat && pool.length > 1 && cand.binItem.id === lastBinId) continue;
            if (cand.kind === 'image' || isTrimmedOk(cand, slot.dur, pt)) {
              fbIdx = idx;
              break;
            }
          }
          if (fbIdx >= 0) break;
        }
        if (fbIdx < 0) {
          fbIdx = seqPoolPointer % pool.length;
        }
        const chosen = pool[fbIdx];
        seqPoolPointer = (fbIdx + 1) % pool.length;
        const { sourceStartSec, rate } = takeExhaustedFallbackSlice(
          chosen,
          slot.dur,
          true,
          placements.length
        );
        placements.push(buildPlacementForSlot(slot, placements.length, chosen, sourceStartSec, rate));
        lastBinId = chosen.binItem.id;
        sIdx++;
        continue;
      }

      const chosen = pool[matchedIdx];
      seqPoolPointer = (matchedIdx + 1) % pool.length;
      const { sourceStartSec, rate } = takeUnusedSlice(chosen, slot.dur, true, placements.length);
      placements.push(
        buildPlacementForSlot(slot, placements.length, chosen, sourceStartSec, rate)
      );
      lastBinId = chosen.binItem.id;
      sIdx++;
    }

    return placements;
  }

  // Strictly prioritize unused files first (minUsage exact equality, zero +1 shortcut),
  // and maximize distance since last appearance to prevent quick back-and-forth looping.
  const pickShuffledAsset = (
    eligible: PoolAsset[],
    slot: MusicalSlot,
    slotIdx: number,
    prevUrl: string | null,
    nextUrl: string | null
  ): PoolAsset => {
    const nonAdj = avoidAdjacentRepeat
      ? eligible.filter((e) => e.binItem.url !== prevUrl && e.binItem.url !== nextUrl)
      : eligible;
    const poolStage1 = nonAdj.length > 0 ? nonAdj : eligible;

    const minUsage = Math.min(...poolStage1.map((e) => usageCountByUrl.get(e.binItem.url) ?? 0));
    const strictlyLeastUsed = poolStage1.filter(
      (e) => (usageCountByUrl.get(e.binItem.url) ?? 0) === minUsage
    );
    const poolToPick = strictlyLeastUsed.length > 0 ? strictlyLeastUsed : poolStage1;

    if (minUsage > 0 && poolToPick.length > 1) {
      // Maximize cooldown gap since this source file last appeared
      const cooled = [...poolToPick].sort((a, b) => {
        const lastA = lastSlotIdxByUrl.get(a.binItem.url) ?? -999;
        const lastB = lastSlotIdxByUrl.get(b.binItem.url) ?? -999;
        return lastA - lastB;
      });
      const topCooled = cooled.slice(0, Math.max(1, Math.ceil(cooled.length * 0.5)));
      return topCooled[Math.floor(rng() * topCooled.length)];
    }

    if ((mode === 'auto_rhythm' || rhythm === 'auto') && slot.energy < 0.4 && poolToPick.length > 1) {
      const calmSorted = [...poolToPick].sort((a, b) => {
        const aSpan =
          a.kind === 'image'
            ? 6
            : Math.max(...(urlFreeRanges.get(a.binItem.url) ?? []).map(([rs, re]) => re - rs), 0);
        const bSpan =
          b.kind === 'image'
            ? 6
            : Math.max(...(urlFreeRanges.get(b.binItem.url) ?? []).map(([rs, re]) => re - rs), 0);
        return bSpan - aSpan;
      });
      const topHalf = calmSorted.slice(0, Math.max(1, Math.ceil(calmSorted.length * 0.6)));
      return topHalf[Math.floor(rng() * topHalf.length)];
    }

    void slotIdx;
    return poolToPick[Math.floor(rng() * poolToPick.length)];
  };

  if (!fillToTargetEnd) {
    const placements: AutoBeatSlicePlacement[] = [];
    let sIdx = 0;
    let lastUrl: string | null = null;
    let splitGuard = 0;
    while (sIdx < workingSlots.length && placements.length < maxSlots * 2) {
      const slot = workingSlots[sIdx];
      let eligible = pool.filter((e) => canAssetFitUnused(e, slot.dur, true, false));
      if (eligible.length === 0) {
        if (hasAnyUnusedFootage(splitFloor) && splitGuard < Math.max(300, workingSlots.length)) {
          const pair = splitSlotAtBeat(slot);
          if (pair) {
            splitGuard++;
            workingSlots.splice(sIdx, 1, pair[0], pair[1]);
            continue;
          }
        }
        eligible = pool.filter((e) => canAssetFitUnused(e, slot.dur, false, false));
      }
      if (eligible.length === 0) {
        break;
      }
      const chosen = pickShuffledAsset(eligible, slot, placements.length, lastUrl, null);
      const { sourceStartSec, rate } = takeUnusedSlice(chosen, slot.dur, false, placements.length);
      placements.push(buildPlacementForSlot(slot, placements.length, chosen, sourceStartSec, rate));
      lastUrl = chosen.binItem.url;
      sIdx++;
    }
    return placements;
  }

  // Pass A (fillToTargetEnd === true): Longest-first chronological spread so each unique file gets
  // an initial continuous bar shot before any file gets sliced again.
  const binUrlById = new Map(pool.map((p) => [p.binItem.id, p.binItem.url]));
  const assigned: Array<AutoBeatSlicePlacement | null> = new Array(workingSlots.length).fill(null);
  let splitGuard = 0;
  const maxSplitBudget = Math.max(400, workingSlots.length * 2);
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
        (e) => (usageCountByUrl.get(e.binItem.url) ?? 0) === 0
      );
      unassignedIndices.sort((a, b) => {
        if (anyUnusedLeft) {
          // Showcase every unique source file cleanly across the opening sequence first
          return a - b;
        }
        const diff = workingSlots[b].dur - workingSlots[a].dur;
        if (Math.abs(diff) > 0.05) return diff;
        return a - b;
      });

      for (const idx of unassignedIndices) {
        const slot = workingSlots[idx];
        const eligible = pool.filter((e) => canAssetFitUnused(e, slot.dur, !allowUntrimmed, false));
        if (eligible.length > 0) {
          const prevId = idx > 0 ? assigned[idx - 1]?.binItemId ?? null : null;
          const nextId = idx + 1 < assigned.length ? assigned[idx + 1]?.binItemId ?? null : null;
          const prevUrl = prevId ? binUrlById.get(prevId) ?? null : null;
          const nextUrl = nextId ? binUrlById.get(nextId) ?? null : null;
          const chosen = pickShuffledAsset(eligible, slot, idx, prevUrl, nextUrl);
          const { sourceStartSec, rate } = takeUnusedSlice(chosen, slot.dur, false, idx);
          assigned[idx] = buildPlacementForSlot(slot, idx, chosen, sourceStartSec, rate);
          madeProgress = true;
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

  // Pass B: Exhaustion fallback ONLY after 100% of unique footage is depleted, picking least-used & most-cooled files
  for (let i = 0; i < workingSlots.length; i++) {
    if (assigned[i] !== null) continue;
    const slot = workingSlots[i];
    const prevId = i > 0 ? assigned[i - 1]?.binItemId ?? null : null;
    const nextId = i + 1 < assigned.length ? assigned[i + 1]?.binItemId ?? null : null;
    const prevUrl = prevId ? binUrlById.get(prevId) ?? null : null;
    const nextUrl = nextId ? binUrlById.get(nextId) ?? null : null;

    let candidates: PoolAsset[] = [];
    for (const pt of [true, false]) {
      const fitting = pool.filter((e) => e.kind === 'image' || isTrimmedOk(e, slot.dur, pt));
      if (fitting.length > 0) {
        candidates = fitting;
        break;
      }
    }
    if (candidates.length === 0) candidates = pool;

    const nonAdj = avoidAdjacentRepeat
      ? candidates.filter((e) => e.binItem.url !== prevUrl && e.binItem.url !== nextUrl)
      : candidates;
    const poolToPick = nonAdj.length > 0 ? nonAdj : candidates;
    const minUsage = Math.min(...poolToPick.map((e) => usageCountByUrl.get(e.binItem.url) ?? 0));
    const leastUsed = poolToPick
      .filter((e) => (usageCountByUrl.get(e.binItem.url) ?? 0) === minUsage)
      .sort((a, b) => (lastSlotIdxByUrl.get(a.binItem.url) ?? -999) - (lastSlotIdxByUrl.get(b.binItem.url) ?? -999));
    const topCooled = leastUsed.slice(0, Math.max(1, Math.ceil(leastUsed.length * 0.5)));
    const finalPickPool = topCooled.length > 0 ? topCooled : poolToPick;
    const chosen = finalPickPool[Math.floor(rng() * finalPickPool.length)];
    const { sourceStartSec, rate } = takeExhaustedFallbackSlice(chosen, slot.dur, false, i);
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



