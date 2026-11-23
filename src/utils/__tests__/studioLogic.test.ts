import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaBinItem, StudioConfig, VisualMediaState } from '../../types/studio';
import {
  AUTO_CLIP_PRESETS,
  clampManualClipMove,
  computeAutoBeatAlignedClips,
  computeBeatMusicalAccents,
  computeClipTimelineSegments,
  computeFadeEnvelope,
  computePhraseEnergyCurve,
  detectTrackBpmAndBeats,
  findManualInsertionSlot,
  generateAutoClipPlan,
  generateRandomBeatAutoClips,
  getTimelineSpanSec,
  insertManualClipAtAnchor,
  packTimelineLanes,
  resizeManualClipDuration,
  resolveActiveSlideshowSlice,
  resolveOverlayWindow,
  snapTimeToBeat,
} from '../audioAnalyzer';
import { parseID3Tags } from '../id3Parser';
import {
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_STUDIO_CONFIG,
  STUDIO_CINEMA_PRESETS,
} from '../presets';
import {
  hexToHueDeg,
  hsvToHex,
  hsvToRgb,
  normalizeHueDeg,
  rgbToHsv,
  shiftHexHue,
} from '../proceduralShaders';
import { formatSrtTime, parseSubtitles } from '../subtitleParser';

function makeClip(id: string, durationSec: number): VisualMediaState {
  return {
    id,
    kind: 'generator',
    fileName: `${id}.scene`,
    url: '',
    width: 1920,
    height: 1080,
    durationSec,
    sourceStartSec: 0,
    playbackRate: 1,
    transitionOut: 'crossfade',
    transitionDurationSec: 0.6,
    generatorId: 'cosmic_particles',
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    clipAudioVolume: 0,
    clipAudioMuted: true,
  };
}

test('computeClipTimelineSegments handles even split mode accurately', () => {
  const clips = [makeClip('a', 3), makeClip('b', 5), makeClip('c', 2)];
  const cfg: StudioConfig = { ...DEFAULT_STUDIO_CONFIG, slideshowMode: 'even' };
  const segs = computeClipTimelineSegments(clips, 12, cfg, [0]);

  assert.equal(segs.length, 3);
  assert.deepEqual(segs[0], { clipIndex: 0, startSec: 0, endSec: 4, isLoopRepeat: false });
  assert.deepEqual(segs[1], { clipIndex: 1, startSec: 4, endSec: 8, isLoopRepeat: false });
  assert.deepEqual(segs[2], { clipIndex: 2, startSec: 8, endSec: 12, isLoopRepeat: false });
});

test('computeClipTimelineSegments handles custom_durations loop wrapping cleanly', () => {
  const clips = [makeClip('a', 4), makeClip('b', 3)];
  const cfg: StudioConfig = { ...DEFAULT_STUDIO_CONFIG, slideshowMode: 'custom_durations' };
  const segs = computeClipTimelineSegments(clips, 10, cfg, [0]);

  assert.equal(segs.length, 3);
  assert.equal(segs[0].clipIndex, 0);
  assert.equal(segs[0].endSec, 4);
  assert.equal(segs[0].isLoopRepeat, false);

  assert.equal(segs[1].clipIndex, 1);
  assert.equal(segs[1].endSec, 7);
  assert.equal(segs[1].isLoopRepeat, false);

  assert.equal(segs[2].clipIndex, 0);
  assert.equal(segs[2].startSec, 7);
  assert.equal(segs[2].endSec, 10);
  assert.equal(segs[2].isLoopRepeat, true);
});

test('computeClipTimelineSegments follows beat_cut timestamps', () => {
  const clips = [makeClip('a', 4), makeClip('b', 4)];
  const cfg: StudioConfig = { ...DEFAULT_STUDIO_CONFIG, slideshowMode: 'beat_cut' };
  const segs = computeClipTimelineSegments(clips, 9, cfg, [0, 2.5, 5.2]);

  assert.equal(segs.length, 3);
  assert.deepEqual(segs[0], { clipIndex: 0, startSec: 0, endSec: 2.5, isLoopRepeat: false });
  assert.deepEqual(segs[1], { clipIndex: 1, startSec: 2.5, endSec: 5.2, isLoopRepeat: false });
  assert.deepEqual(segs[2], { clipIndex: 0, startSec: 5.2, endSec: 9, isLoopRepeat: true });
});

test('resolveOverlayWindow handles full clip, start-only, 0-duration, and explicit windows', () => {
  assert.equal(resolveOverlayWindow({}, 5, 20).visible, true);
  assert.equal(resolveOverlayWindow({ startSec: 6 }, 5.9, 20).visible, false);
  assert.equal(resolveOverlayWindow({ startSec: 6 }, 19.5, 20).visible, true);
  assert.equal(resolveOverlayWindow({ startSec: 6, durationSec: 0 }, 15, 20).visible, true);
  assert.equal(resolveOverlayWindow({ startSec: 2, durationSec: 3 }, 4.5, 20).visible, true);
  assert.equal(resolveOverlayWindow({ startSec: 2, durationSec: 3 }, 5.1, 20).visible, false);
});

test('resolveActiveSlideshowSlice clamps transition durations cleanly on short clips', () => {
  const clips = [
    { ...makeClip('a', 1.0), transitionDurationSec: 2.0 },
    { ...makeClip('b', 1.0), transitionDurationSec: 2.0 },
  ];
  const cfg: StudioConfig = { ...DEFAULT_STUDIO_CONFIG, slideshowMode: 'custom_durations' };
  // Max allowed transition = 0.85s, so at t=1.425 we are mid-transition (~0.5 progress)
  const mid = resolveActiveSlideshowSlice(clips, 1.425, 2.0, cfg, [0]);
  assert.equal(mid.activeIndex, 1);
  assert.equal(mid.prevIndex, 0);
  assert.ok(mid.transitionProgress > 0.3 && mid.transitionProgress < 0.7);

  // After clamped transition finishes (1.9s >= 1.0 + 0.85), prevIndex clears cleanly
  const done = resolveActiveSlideshowSlice(clips, 1.9, 2.0, cfg, [0]);
  assert.equal(done.activeIndex, 1);
  assert.equal(done.prevIndex, null);
  assert.equal(done.transitionProgress, 1);
});

test('computeFadeEnvelope computes smooth cosine fades at start and end', () => {
  assert.equal(computeFadeEnvelope(0, 10, 1, 1), 0);
  assert.ok(Math.abs(computeFadeEnvelope(0.5, 10, 1, 1) - 0.5) < 1e-6);
  assert.equal(computeFadeEnvelope(5, 10, 1, 1), 1);
  assert.ok(Math.abs(computeFadeEnvelope(9.5, 10, 1, 1) - 0.5) < 1e-6);
  assert.equal(computeFadeEnvelope(10, 10, 1, 1), 0);
});

test('detectTrackBpmAndBeats and computeAutoBeatAlignedClips track 120 BPM kick pulses', () => {
  const sr = 8000;
  const dur = 8;
  const mono = new Float32Array(sr * dur);
  for (let beatIdx = 0; beatIdx < 16; beatIdx++) {
    const startSample = Math.round(beatIdx * 0.5 * sr);
    for (let j = 0; j < 600 && startSample + j < mono.length; j++) {
      mono[startSample + j] = Math.sin((j / sr) * 2 * Math.PI * 65) * Math.exp(-j / 180);
    }
  }
  const grid = detectTrackBpmAndBeats(mono, sr, 0, dur, 1.2);
  assert.ok(grid.bpm >= 115 && grid.bpm <= 125, `Expected ~120 BPM, got ${grid.bpm}`);
  assert.ok(grid.beats.length >= 12);

  const plan = computeAutoBeatAlignedClips(4, dur, grid, [], 0, 'fit_track');
  assert.equal(plan.length, 4);
  const totalDur = plan.reduce((acc, p) => acc + p.durationSec, 0);
  assert.ok(Math.abs(totalDur - dur) < 0.05);
});

test('snapTimeToBeat snaps inside threshold and preserves raw value outside threshold', () => {
  const beats = [0, 0.5, 1.0, 1.5, 2.0];
  assert.equal(snapTimeToBeat(1.08, beats, 0.22), 1.0);
  assert.equal(snapTimeToBeat(1.42, beats, 0.22), 1.5);
  assert.equal(snapTimeToBeat(1.26, beats, 0.2), 1.26);
  assert.equal(snapTimeToBeat(3.33, [], 0.25), 3.33);
});

test('packTimelineLanes packs non-overlapping intervals on lane 0 and separates overlapping items', () => {
  const result = packTimelineLanes([
    { startSec: 0, durationSec: 3 },
    { startSec: 1, durationSec: 4 },
    { startSec: 3.1, durationSec: 2 },
    { startSec: 2.5, durationSec: 1.5 },
  ]);

  assert.equal(result.laneCount, 3);
  assert.equal(result.laneByIndex[0], 0);
  assert.equal(result.laneByIndex[1], 1);
  assert.equal(result.laneByIndex[2], 0);
  assert.equal(result.laneByIndex[3], 2);
});

test('parseSubtitles and formatSrtTime round-trip cleanly across SRT and WebVTT', () => {
  const srt = `2
00:00:05,500 --> 00:00:08,000
Second line here

1
00:00:01,000 --> 00:00:03,250
<i>First</i> line
here`;

  const cues = parseSubtitles(srt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'First line here');
  assert.equal(cues[0].startSec, 1);
  assert.equal(cues[0].endSec, 3.25);
  assert.equal(cues[1].text, 'Second line here');
  assert.equal(cues[1].startSec, 5.5);

  const exportedSrt = cues
    .map((c, idx) => `${idx + 1}\n${formatSrtTime(c.startSec)} --> ${formatSrtTime(c.endSec)}\n${c.text}\n`)
    .join('\n');
  const reparsed = parseSubtitles(exportedSrt);
  assert.equal(reparsed.length, 2);
  assert.equal(reparsed[0].startSec, 1);
  assert.equal(reparsed[0].endSec, 3.25);

  const vtt = `WEBVTT

00:12.500 --> 00:15.000 align:center
Night drive`;
  const vttCues = parseSubtitles(vtt);
  assert.equal(vttCues.length, 1);
  assert.equal(vttCues[0].startSec, 12.5);
  assert.equal(vttCues[0].endSec, 15);
  assert.equal(vttCues[0].text, 'Night drive');
});

function buildSynchsafeInt(value: number): [number, number, number, number] {
  return [
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ];
}

function makeID3FrameV23(id: string, encoding: number, payload: number[]): number[] {
  const size = 1 + payload.length;
  return [
    id.charCodeAt(0),
    id.charCodeAt(1),
    id.charCodeAt(2),
    id.charCodeAt(3),
    (size >> 24) & 0xff,
    (size >> 16) & 0xff,
    (size >> 8) & 0xff,
    size & 0xff,
    0,
    0,
    encoding,
    ...payload,
  ];
}

function makeID3FrameV22(id: string, encoding: number, payload: number[]): number[] {
  const size = 1 + payload.length;
  return [
    id.charCodeAt(0),
    id.charCodeAt(1),
    id.charCodeAt(2),
    (size >> 16) & 0xff,
    (size >> 8) & 0xff,
    size & 0xff,
    encoding,
    ...payload,
  ];
}

test('parseID3Tags decodes UTF-8, Windows-1251, unsynchronised frames, and ID3v2.2 frames', () => {
  const titleUtf8 = Array.from(new TextEncoder().encode('Cosmic Pulse'));
  const cyrillic1251 = [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2];

  const framesV23 = [
    ...makeID3FrameV23('TIT2', 3, titleUtf8),
    ...makeID3FrameV23('TPE1', 0, cyrillic1251),
    ...makeID3FrameV23('TYER', 3, Array.from(new TextEncoder().encode('2026'))),
  ];

  const headerV23 = [
    0x49,
    0x44,
    0x33,
    3,
    0,
    0,
    ...buildSynchsafeInt(framesV23.length),
  ];

  const parsedV23 = parseID3Tags(new Uint8Array([...headerV23, ...framesV23]).buffer, 'fallback.mp3');
  assert.equal(parsedV23.title, 'Cosmic Pulse');
  assert.equal(parsedV23.artist, 'Привет');
  assert.equal(parsedV23.year, '2026');

  // ID3v2.2 with TT2 & TP1
  const framesV22 = [
    ...makeID3FrameV22('TT2', 0, Array.from(new TextEncoder().encode('Retro Echo'))),
    ...makeID3FrameV22('TP1', 0, Array.from(new TextEncoder().encode('Signal Lab'))),
  ];
  const headerV22 = [0x49, 0x44, 0x33, 2, 0, 0, ...buildSynchsafeInt(framesV22.length)];
  const parsedV22 = parseID3Tags(new Uint8Array([...headerV22, ...framesV22]).buffer, 'old.mp3');
  assert.equal(parsedV22.title, 'Retro Echo');
  assert.equal(parsedV22.artist, 'Signal Lab');

  // Unsynchronisation flag (0x80) strips 0x00 inserted after 0xFF
  const unsyncRaw = [...framesV23];
  const unsyncHeader = [0x49, 0x44, 0x33, 3, 0, 0x80, ...buildSynchsafeInt(unsyncRaw.length)];
  const parsedUnsync = parseID3Tags(
    new Uint8Array([...unsyncHeader, ...unsyncRaw]).buffer,
    'unsync.mp3'
  );
  assert.equal(parsedUnsync.title, 'Cosmic Pulse');
  assert.equal(parsedUnsync.artist, 'Привет');
});

test('HSV hue utilities cover full 0-360 spectrum cleanly without saturation collapse', () => {
  assert.equal(normalizeHueDeg(-90), 270);
  assert.equal(normalizeHueDeg(720), 0);

  // Full 60-degree sweep around red primary hits all 6 primary/secondary hues accurately
  const expected = ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'];
  const degs = [0, 60, 120, 180, 240, 300, 360];
  degs.forEach((deg, idx) => {
    assert.equal(shiftHexHue('#ff0000', deg), expected[idx]);
  });

  // Preserve saturation and value on rich pastel/studio colors across full rotation
  const shifted = shiftHexHue('#f59e0b', 180);
  const [h0, s0, v0] = rgbToHsv(245 / 255, 158 / 255, 11 / 255);
  const roundRgb = hsvToRgb(h0 + 180, s0, v0);
  assert.ok(s0 > 0.9 && v0 > 0.9);
  assert.ok(Math.abs(hexToHueDeg(hsvToHex(120, 1, 1)) - 120) <= 1);
  assert.equal(shiftHexHue('#f59e0b', 0), '#f59e0b');
  assert.equal(shiftHexHue('#f59e0b', 360), '#f59e0b');
  assert.notEqual(shifted, '#f59e0b');
  assert.ok(roundRgb[2] > roundRgb[0]);
});

test('manual timeline preserves explicit positions, allows gaps, and never loops or stretches single clips', () => {
  const single = [{ ...makeClip('solo', 4), startSec: 2 }];
  const manualCfg: StudioConfig = { ...DEFAULT_STUDIO_CONFIG, slideshowMode: 'manual' };

  const singleSegs = computeClipTimelineSegments(single, 15, manualCfg, [0]);
  assert.equal(singleSegs.length, 1);
  assert.deepEqual(singleSegs[0], { clipIndex: 0, startSec: 2, endSec: 6, isLoopRepeat: false });
  assert.equal(getTimelineSpanSec(single, manualCfg), 6);

  // Gap before first clip and gap between clips return activeIndex: null with no transition
  const twoClips = [
    { ...makeClip('c1', 3), startSec: 2 },
    { ...makeClip('c2', 4), startSec: 7 },
  ];
  const gapBefore = resolveActiveSlideshowSlice(twoClips, 1.0, 15, manualCfg, [0]);
  assert.equal(gapBefore.activeIndex, null);
  assert.equal(gapBefore.prevIndex, null);

  const gapBetween = resolveActiveSlideshowSlice(twoClips, 5.5, 15, manualCfg, [0]);
  assert.equal(gapBetween.activeIndex, null);
  assert.equal(gapBetween.prevIndex, null);

  // Transition triggers ONLY when clips actually touch (<= 0.08s gap)
  const midC2 = resolveActiveSlideshowSlice(twoClips, 7.2, 15, manualCfg, [0]);
  assert.equal(midC2.activeIndex, 1);
  assert.equal(midC2.prevIndex, null);
  assert.equal(midC2.transitionProgress, 1);

  const touching = [
    { ...makeClip('t1', 3), startSec: 2, transitionDurationSec: 0.6 },
    { ...makeClip('t2', 4), startSec: 5 },
  ];
  const touchTrans = resolveActiveSlideshowSlice(touching, 5.2, 15, manualCfg, [0]);
  assert.equal(touchTrans.activeIndex, 1);
  assert.equal(touchTrans.prevIndex, 0);
  assert.ok(touchTrans.transitionProgress < 1);
});

test('findManualInsertionSlot and clampManualClipMove never shift or overlap neighbor clips', () => {
  const existing = [
    { ...makeClip('a', 3), id: 'a', startSec: 0 },
    { ...makeClip('b', 4), id: 'b', startSec: 8 },
  ];

  // Placing at open gap [3..8] with 4s clip fits cleanly inside the gap at 3s without moving b
  const gapSlot = findManualInsertionSlot(existing, 3, 4, 60);
  assert.equal(gapSlot.startSec, 3);
  assert.equal(gapSlot.durationSec, 4);

  // Placing directly on top of existing clip b (t=9) skips forward to b's end (12s)
  const blockedSlot = findManualInsertionSlot(existing, 9, 4, 60);
  assert.equal(blockedSlot.startSec, 12);

  // Moving clip a (duration 3s) cannot push past b.startSec (8s) -> clamped at 5s
  const movedA = clampManualClipMove(existing, 'a', 7.5, 60, [], false);
  assert.equal(movedA, 5);
});

test('resizeManualClipDuration grows into gaps first, pushes overlapping neighbors, and shrinks without pulling', () => {
  const clips = [
    { ...makeClip('a', 4), id: 'a', startSec: 0 },
    { ...makeClip('b', 4), id: 'b', startSec: 6 },
    { ...makeClip('c', 3), id: 'c', startSec: 11 },
  ];

  // Extending a from 4s to 6s fills the [4..6] gap without moving b or c
  const filledGap = resizeManualClipDuration(clips, 'a', 6, 120);
  assert.equal(filledGap[0].durationSec, 6);
  assert.equal(filledGap[1].startSec, 6);
  assert.equal(filledGap[2].startSec, 11);

  // Extending a from 4s to 8s pushes b to [8..12] and c to [12..15] without overlap
  const pushed = resizeManualClipDuration(clips, 'a', 8, 120);
  assert.equal(pushed[0].durationSec, 8);
  assert.equal(pushed[1].startSec, 8);
  assert.equal(pushed[2].startSec, 12);

  // Shrinking b from 4s to 2s leaves c untouched at 11s
  const shrunk = resizeManualClipDuration(clips, 'b', 2, 120);
  assert.equal(shrunk[1].durationSec, 2);
  assert.equal(shrunk[1].startSec, 6);
  assert.equal(shrunk[2].startSec, 11);
});

test('insertManualClipAtAnchor attaches overlapping clip right of playhead without split/alternation', () => {
  // Clip A occupies full 24s track [0..24], clip B sits downstream? Test 1: single full-track clip A [0..24]
  const fullA = [{ ...makeClip('a', 24), id: 'a', startSec: 0 }];
  const newClipB = makeClip('b', 6);
  // Playhead at t=5s -> A trims cleanly to [0..5], B attaches right of playhead [5..11] (never alternating A->B->A)
  const insertedMid = insertManualClipAtAnchor(fullA, newClipB, 5, 24);
  assert.equal(insertedMid.length, 2);
  assert.equal(insertedMid[0].id, 'a');
  assert.equal(insertedMid[0].startSec, 0);
  assert.equal(insertedMid[0].durationSec, 5);
  assert.equal(insertedMid[1].id, 'b');
  assert.equal(insertedMid[1].startSec, 5);
  assert.equal(insertedMid[1].durationSec, 6);

  // Test 2: playhead at start (t=0s) shifts A and downstream C right cleanly instead of deleting A
  const twoClips = [
    { ...makeClip('a', 4), id: 'a', startSec: 0 },
    { ...makeClip('c', 3), id: 'c', startSec: 5 },
  ];
  const atZero = insertManualClipAtAnchor(twoClips, makeClip('b', 3), 0, 24);
  assert.equal(atZero.length, 3);
  assert.equal(atZero[0].id, 'b');
  assert.equal(atZero[0].startSec, 0);
  assert.equal(atZero[0].durationSec, 3);
  assert.equal(atZero[1].id, 'a');
  assert.equal(atZero[1].startSec, 3);
  assert.equal(atZero[2].id, 'c');
  assert.equal(atZero[2].startSec, 7);

  // Test 3: single clip in custom_durations preserves its real duration on initial segment
  const singleCustomCfg: StudioConfig = {
    ...DEFAULT_STUDIO_CONFIG,
    slideshowMode: 'custom_durations',
  };
  const customSegs = computeClipTimelineSegments([makeClip('solo', 4)], 10, singleCustomCfg, [0]);
  assert.equal(customSegs[0].startSec, 0);
  assert.equal(customSegs[0].endSec, 4);
  assert.equal(customSegs[0].isLoopRepeat, false);
});

test('generateRandomBeatAutoClips creates non-repeating, non-sequential beat slices without overlapping source ranges', () => {
  const binItems: MediaBinItem[] = [
    {
      id: 'vid-1',
      kind: 'video',
      fileName: 'concert.mp4',
      url: 'blob:vid-1',
      width: 1920,
      height: 1080,
      videoDuration: 12.0,
      defaultDurationSec: 12.0,
    },
    {
      id: 'vid-2',
      kind: 'video',
      fileName: 'stage.mp4',
      url: 'blob:vid-2',
      width: 1920,
      height: 1080,
      videoDuration: 10.0,
      defaultDurationSec: 10.0,
    },
    {
      id: 'img-1',
      kind: 'image',
      fileName: 'cover.png',
      url: 'blob:img-1',
      width: 1080,
      height: 1080,
      defaultDurationSec: 4.0,
    },
    {
      id: 'img-2',
      kind: 'image',
      fileName: 'poster.jpg',
      url: 'blob:img-2',
      width: 1080,
      height: 1080,
      defaultDurationSec: 4.0,
    },
  ];

  // Deterministic LCG for repeatable verification
  let seed = 42;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const beats = Array.from({ length: 120 }, (_, i) => Number((i * 0.5).toFixed(2)));
  const beatGrid = { bpm: 120, beatSec: 0.5, beats };

  // Request up to 60s (far more than total footage) -> must stop once unique slices exhaust, never repeat!
  const result = generateRandomBeatAutoClips(binItems, beatGrid, [], 0, 60, {
    rhythm: 'beats_2',
    hasAudio: true,
    rng,
  });

  assert.ok(result.length >= 12);

  // 1. Timeline placements must be strictly contiguous and non-overlapping along beats
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i].startSec >= result[i - 1].startSec + result[i - 1].durationSec - 0.02);
  }

  // 2. Each image appears at most once
  const img1Count = result.filter((r) => r.binItemId === 'img-1').length;
  const img2Count = result.filter((r) => r.binItemId === 'img-2').length;
  assert.ok(img1Count <= 1);
  assert.ok(img2Count <= 1);

  // 3. No two slices from the same video ever overlap in source media timestamps
  for (const vidId of ['vid-1', 'vid-2']) {
    const slices = result
      .filter((r) => r.binItemId === vidId)
      .map((r) => ({
        start: r.sourceStartSec,
        end: r.sourceStartSec + r.durationSec * r.playbackRate,
      }))
      .sort((a, b) => a.start - b.start);

    for (let i = 1; i < slices.length; i++) {
      assert.ok(
        slices[i].start >= slices[i - 1].end - 0.02,
        `Overlapping slices on ${vidId}: ${slices[i - 1].end} > ${slices[i].start}`
      );
    }
  }

  // 4. Slices must be non-sequential (not monotonically increasing timestamps in a single video)
  const vid1RawOrder = result.filter((r) => r.binItemId === 'vid-1').map((r) => r.sourceStartSec);
  if (vid1RawOrder.length >= 3) {
    const isStrictlyAscending = vid1RawOrder.every(
      (val, idx) => idx === 0 || val >= vid1RawOrder[idx - 1]
    );
    assert.equal(isStrictlyAscending, false);
  }
});

test('generateAutoClipPlan supports auto_rhythm energy phrasing, sequential slicing, and smooth random cuts', () => {
  const binItems: MediaBinItem[] = [
    {
      id: 'vid-seq-1',
      kind: 'video',
      fileName: 'intro_shot.mp4',
      url: 'blob:vid-seq-1',
      width: 1920,
      height: 1080,
      videoDuration: 18.0,
      defaultDurationSec: 18.0,
    },
    {
      id: 'vid-seq-2',
      kind: 'video',
      fileName: 'chorus_shot.mp4',
      url: 'blob:vid-seq-2',
      width: 1920,
      height: 1080,
      videoDuration: 18.0,
      defaultDurationSec: 18.0,
    },
    {
      id: 'img-still-1',
      kind: 'image',
      fileName: 'frame.png',
      url: 'blob:img-still-1',
      width: 1920,
      height: 1080,
      defaultDurationSec: 4.0,
    },
  ];

  // Build synthetic 20s mono audio buffer at 8 kHz:
  // quiet ambient intro [0..6s], loud rhythmic drop [6..14s], quiet outro [14..20s]
  const sr = 8000;
  const totalSec = 20;
  const mono = new Float32Array(sr * totalSec);
  for (let i = 0; i < mono.length; i++) {
    const t = i / sr;
    const isDrop = t >= 6 && t < 14;
    const amp = isDrop ? 0.85 * (0.4 + 0.6 * Math.abs(Math.sin(Math.PI * 2 * t))) : 0.04;
    mono[i] = amp * Math.sin(2 * Math.PI * (isDrop ? 110 : 220) * t);
  }

  const beats = Array.from({ length: 42 }, (_, i) => Number((i * 0.5).toFixed(2)));
  const beatGrid = { bpm: 120, beatSec: 0.5, beats };

  // Phrase energy curve should distinguish quiet intro/outro from energetic middle
  const energy = computePhraseEnergyCurve(beats, 0, totalSec, mono, sr);
  assert.ok(energy[2] < 0.35, `Expected calm intro energy < 0.35, got ${energy[2]}`);
  assert.ok(energy[20] > 0.65, `Expected energetic drop energy > 0.65, got ${energy[20]}`);
  assert.ok(energy[36] < 0.35, `Expected calm outro energy < 0.35, got ${energy[36]}`);

  // 1. Auto-Rhythm mode: calm intro has longer crossfade clips; drop has shorter cuts; smooth scaling
  let seed1 = 77;
  const rng1 = () => {
    seed1 = (seed1 * 1664525 + 1013904223) >>> 0;
    return seed1 / 4294967296;
  };
  const autoPlan = generateAutoClipPlan(binItems, beatGrid, [], 0, totalSec, {
    mode: 'auto_rhythm',
    rhythm: 'auto',
    hasAudio: true,
    monoData: mono,
    sampleRate: sr,
    rng: rng1,
  });

  assert.ok(autoPlan.length >= 6);
  const calmClips = autoPlan.filter((p) => p.startSec < 5.0 || p.startSec >= 14.5);
  const dropClips = autoPlan.filter((p) => p.startSec >= 6.0 && p.startSec < 13.0);
  assert.ok(calmClips.length >= 2 && dropClips.length >= 2);
  const avgCalmDur = calmClips.reduce((s, p) => s + p.durationSec, 0) / calmClips.length;
  const avgDropDur = dropClips.reduce((s, p) => s + p.durationSec, 0) / dropClips.length;
  assert.ok(
    avgCalmDur > avgDropDur,
    `Expected calm clips (${avgCalmDur.toFixed(2)}s) > energetic drop clips (${avgDropDur.toFixed(2)}s)`
  );
  assert.ok(calmClips.every((p) => p.transitionOut === 'crossfade'));
  for (const p of autoPlan) {
    assert.equal(p.scaleStart, 1.0);
    assert.ok(p.scaleEnd >= 1.0 && p.scaleEnd <= 1.04);
    assert.ok(['crossfade', 'cut', 'zoom_cross'].includes(p.transitionOut));
  }

  // 2. Sequential mode: strictly preserves Media Library order & monotonically advances sourceStartSec
  const seqPlan = generateAutoClipPlan(binItems, beatGrid, [], 0, totalSec, {
    mode: 'sequential',
    rhythm: 'beats_4',
    hasAudio: true,
  });
  assert.ok(seqPlan.length >= 4);
  assert.equal(seqPlan[0].binItemId, 'vid-seq-1');
  assert.equal(seqPlan[1].binItemId, 'vid-seq-2');
  assert.equal(seqPlan[2].binItemId, 'img-still-1');
  assert.equal(seqPlan[3].binItemId, 'vid-seq-1');
  const seqVid1Starts = seqPlan.filter((p) => p.binItemId === 'vid-seq-1').map((p) => p.sourceStartSec);
  for (let i = 1; i < seqVid1Starts.length; i++) {
    assert.ok(seqVid1Starts[i] > seqVid1Starts[i - 1]);
  }
  assert.equal(seqPlan.filter((p) => p.binItemId === 'img-still-1').length, 1);
});

test('AUTO_CLIP_PRESETS, append startOffsetSec, transition/motion styles, and duration caps behave accurately', () => {
  assert.equal(AUTO_CLIP_PRESETS.length, 6);
  const binItems: MediaBinItem[] = [
    {
      id: 'v1',
      kind: 'video',
      fileName: 'clip1.mp4',
      url: 'blob:v1',
      width: 1920,
      height: 1080,
      videoDuration: 30,
      defaultDurationSec: 30,
    },
    {
      id: 'v2',
      kind: 'video',
      fileName: 'clip2.mp4',
      url: 'blob:v2',
      width: 1920,
      height: 1080,
      videoDuration: 30,
      defaultDurationSec: 30,
    },
    {
      id: 'i1',
      kind: 'image',
      fileName: 'still.jpg',
      url: 'blob:i1',
      width: 1920,
      height: 1080,
      defaultDurationSec: 4,
    },
  ];
  const beats = Array.from({ length: 120 }, (_, i) => Number((i * 0.5).toFixed(2)));
  const beatGrid = { bpm: 120, beatSec: 0.5, beats };

  // 1. All presets generate valid non-overlapping plans
  for (const preset of AUTO_CLIP_PRESETS) {
    const plan = generateAutoClipPlan(binItems, beatGrid, [], 0, 24, {
      ...preset.config,
      hasAudio: true,
    });
    assert.ok(plan.length >= 2, `Preset ${preset.id} produced too few clips`);
    for (let i = 1; i < plan.length; i++) {
      assert.ok(plan[i].startSec >= plan[i - 1].startSec + plan[i - 1].durationSec - 0.02);
    }
    if (preset.config.transitionStyle === 'dissolve') {
      assert.ok(plan.every((p) => p.transitionOut === 'crossfade'));
    }
    if (preset.config.transitionStyle === 'cuts_only') {
      assert.ok(plan.every((p) => p.transitionOut === 'cut'));
    }
    if (preset.config.motionLevel === 'off') {
      assert.ok(plan.every((p) => p.scaleStart === 1.0 && p.scaleEnd === 1.0));
    }
  }

  // 2. Append mode (startOffsetSec = 10, targetDurationSec = 8) places clips cleanly after 10s
  //    and excludes already-used image & video ranges
  const usedImgs = new Set<string>(['blob:i1']);
  const usedVidRanges = new Map<string, Array<[number, number]>>([['blob:v1', [[0, 12]]]]);
  const appended = generateAutoClipPlan(binItems, beatGrid, [], 0, 50, {
    mode: 'random',
    rhythm: 'beats_4',
    startOffsetSec: 10,
    targetDurationSec: 8,
    minClipSec: 1.5,
    maxClipSec: 3.0,
    excludeUsedUrls: usedImgs,
    excludeVideoRangesByUrl: usedVidRanges,
    hasAudio: true,
  });
  assert.ok(appended.length >= 2);
  assert.ok(appended[0].startSec >= 10);
  const lastEnd = appended[appended.length - 1].startSec + appended[appended.length - 1].durationSec;
  assert.ok(lastEnd <= 18.05, `Expected appended end <= 18s, got ${lastEnd}`);
  assert.equal(appended.some((p) => p.binItemId === 'i1'), false);
  for (const p of appended) {
    assert.ok(p.durationSec >= 1.4 && p.durationSec <= 3.1);
    if (p.binItemId === 'v1') {
      assert.ok(p.sourceStartSec >= 11.98, `Expected v1 slice to avoid [0..12], got ${p.sourceStartSec}`);
    }
  }
});

test('STUDIO_CINEMA_PRESETS provide valid film color grading presets', () => {
  assert.ok(STUDIO_CINEMA_PRESETS.length >= 5);
  for (const preset of STUDIO_CINEMA_PRESETS) {
    assert.ok(preset.nameEn.length > 0 && preset.nameRu.length > 0);
    assert.equal(preset.swatch.length, 2);
    assert.ok(preset.patch.lutPreset !== undefined);
    assert.ok(preset.patch.mediaFilter !== undefined);
  }
});

test('generateAutoClipPlan fills full long track when fillToTargetEnd=true and never exceeds music length', () => {
  const shortAssets: MediaBinItem[] = [
    {
      id: 'v-short',
      kind: 'video',
      fileName: 'broll.mp4',
      url: 'blob:v-short',
      width: 1920,
      height: 1080,
      videoDuration: 12,
      defaultDurationSec: 12,
    },
    {
      id: 'i-1',
      kind: 'image',
      fileName: 'photo1.jpg',
      url: 'blob:i-1',
      width: 1920,
      height: 1080,
      defaultDurationSec: 4,
    },
    {
      id: 'i-2',
      kind: 'image',
      fileName: 'photo2.jpg',
      url: 'blob:i-2',
      width: 1920,
      height: 1080,
      defaultDurationSec: 4,
    },
  ];

  // 150s track at 120 BPM (0.5s beats -> >140 fast cuts if 1-2 beats per cut)
  const musicLen = 150;
  const beats = Array.from({ length: 300 }, (_, i) => Number((i * 0.5).toFixed(2)));
  const beatGrid = { bpm: 120, beatSec: 0.5, beats };

  const fullPlan = generateAutoClipPlan(shortAssets, beatGrid, [], 0, musicLen, {
    mode: 'auto_rhythm',
    rhythm: 'beats_2',
    minClipSec: 0.75,
    maxClipSec: 1.5,
    fillToTargetEnd: true,
    hasAudio: true,
  });

  assert.ok(fullPlan.length > 96, `Expected >96 clips on 150s fast track, got ${fullPlan.length}`);
  const firstStart = fullPlan[0].startSec;
  const last = fullPlan[fullPlan.length - 1];
  const lastEnd = last.startSec + last.durationSec;
  assert.equal(firstStart, 0);
  assert.ok(
    lastEnd >= musicLen - 0.1 && lastEnd <= musicLen + 0.02,
    `Expected video to fill cleanly to ${musicLen}s without overflowing, got ${lastEnd}s`
  );

  // Appending near the end must stay strictly <= musicLen
  const nearEnd = generateAutoClipPlan(shortAssets, beatGrid, [], 0, musicLen, {
    mode: 'random',
    startOffsetSec: 146.5,
    targetDurationSec: 20,
    fillToTargetEnd: true,
    hasAudio: true,
  });
  assert.ok(nearEnd.length >= 1);
  const appendedEnd = nearEnd[nearEnd.length - 1].startSec + nearEnd[nearEnd.length - 1].durationSec;
  assert.ok(appendedEnd <= musicLen + 0.02, `Appended overflowed music end: ${appendedEnd}`);
});

test('computeBeatMusicalAccents detects melodic chord/pitch changes and guides auto_rhythm cuts', () => {
  const sr = 8000;
  const dur = 16;
  const mono = new Float32Array(sr * dur);
  // Constant amplitude sine/chord melody shifting pitch every 2s (every 4 beats at 120 BPM) + beat kicks
  const freqs = [220, 293.66, 349.23, 440, 261.63, 392, 329.63, 523.25];
  for (let i = 0; i < mono.length; i++) {
    const t = i / sr;
    const section = Math.min(freqs.length - 1, Math.floor(t / 2.0));
    const beatMod = t % 0.5;
    const kick = beatMod < 0.08 ? Math.sin(2 * Math.PI * 65 * beatMod) * Math.exp(-beatMod * 35) * 0.55 : 0;
    const melody = Math.sin(2 * Math.PI * freqs[section] * t) * 0.35;
    mono[i] = kick + melody;
  }

  const grid = detectTrackBpmAndBeats(mono, sr, 0, dur, 1.2);
  assert.ok(grid.bpm >= 114 && grid.bpm <= 126, `Expected ~120 BPM, got ${grid.bpm}`);

  const beats = Array.from({ length: 32 }, (_, i) => Number((i * 0.5).toFixed(2)));
  const { melodicNovelty } = computeBeatMusicalAccents(beats, 0, mono, sr);
  // Chord change beats (idx 4, 8, 12, 16) should show noticeably higher melodic novelty than steady hold beat idx 2/6
  const changeAvg = (melodicNovelty[4] + melodicNovelty[8] + melodicNovelty[12]) / 3;
  const holdAvg = (melodicNovelty[2] + melodicNovelty[6] + melodicNovelty[10]) / 3;
  assert.ok(
    changeAvg > holdAvg,
    `Expected melodic novelty at chord shifts (${changeAvg.toFixed(3)}) > sustained notes (${holdAvg.toFixed(3)})`
  );
});

test('manual NLE insert and resize enforce maxTimelineSec cap cleanly', () => {
  const clips = [
    { ...makeClip('a', 4), id: 'a', startSec: 0 },
    { ...makeClip('b', 4), id: 'b', startSec: 5 },
  ];
  const resized = resizeManualClipDuration(clips, 'a', 8, 10);
  const maxEndAfterResize = Math.max(...resized.map((c) => (c.startSec ?? 0) + c.durationSec));
  assert.ok(maxEndAfterResize <= 10.02, `Resized timeline exceeded 10s cap: ${maxEndAfterResize}`);

  const inserted = insertManualClipAtAnchor(clips, makeClip('c', 5), 4, 10);
  const maxEndAfterInsert = Math.max(...inserted.map((c) => (c.startSec ?? 0) + c.durationSec));
  assert.ok(maxEndAfterInsert <= 10.02, `Inserted timeline exceeded 10s cap: ${maxEndAfterInsert}`);

  const slot = findManualInsertionSlot(clips, 9, 4, 10);
  assert.ok(slot.startSec + slot.durationSec <= 10.02);
});




