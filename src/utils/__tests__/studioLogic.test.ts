import assert from 'node:assert/strict';
import test from 'node:test';
import { StudioConfig, VisualMediaState } from '../../types/studio';
import {
  computeClipTimelineSegments,
  packTimelineLanes,
  snapTimeToBeat,
} from '../audioAnalyzer';
import { parseID3Tags } from '../id3Parser';
import { DEFAULT_CLIP_TRANSFORM, DEFAULT_STUDIO_CONFIG } from '../presets';
import { parseSubtitles } from '../subtitleParser';

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

test('parseSubtitles parses both SRT and WebVTT formats and sorts cues chronologically', () => {
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

test('parseID3Tags decodes UTF-8 frames and recovers Windows-1251 Cyrillic mojibake', () => {
  const titleUtf8 = Array.from(new TextEncoder().encode('Cosmic Pulse'));
  // Windows-1251 bytes for "Привет" (0xCF 0xF0 0xE8 0xE2 0xE5 0xF2) under encoding=0
  const cyrillic1251 = [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2];

  const frames = [
    ...makeID3FrameV23('TIT2', 3, titleUtf8),
    ...makeID3FrameV23('TPE1', 0, cyrillic1251),
    ...makeID3FrameV23('TYER', 3, Array.from(new TextEncoder().encode('2026'))),
  ];

  const header = [
    0x49,
    0x44,
    0x33, // "ID3"
    3,
    0, // v2.3
    0, // flags
    ...buildSynchsafeInt(frames.length),
  ];

  const buffer = new Uint8Array([...header, ...frames]).buffer;
  const parsed = parseID3Tags(buffer, 'fallback_track.mp3');

  assert.equal(parsed.title, 'Cosmic Pulse');
  assert.equal(parsed.artist, 'Привет');
  assert.equal(parsed.year, '2026');
});
