import assert from 'node:assert/strict';
import test from 'node:test';
import { StudioConfig, VisualMediaState } from '../../types/studio';
import {
  computeAutoBeatAlignedClips,
  computeClipTimelineSegments,
  computeFadeEnvelope,
  detectTrackBpmAndBeats,
  packTimelineLanes,
  resolveActiveSlideshowSlice,
  resolveOverlayWindow,
  snapTimeToBeat,
} from '../audioAnalyzer';
import { parseID3Tags } from '../id3Parser';
import { DEFAULT_CLIP_TRANSFORM, DEFAULT_STUDIO_CONFIG } from '../presets';
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
