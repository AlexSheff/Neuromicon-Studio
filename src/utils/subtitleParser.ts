import { SubtitleCue } from '../types/studio';

function parseTimestampSec(raw: string): number {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return m * 60 + s;
  }
  return parseFloat(clean) || 0;
}

/**
 * Parses SRT and WebVTT subtitle text into sorted SubtitleCue records.
 */
export function parseSubtitles(input: string): SubtitleCue[] {
  const normalized = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^WEBVTT[^\n]*\n+/i, '')
    .trim();

  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i]
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;

    const timingLine = lines[timingIdx];
    const [startRaw, endAndSettings] = timingLine.split('-->');
    if (!startRaw || !endAndSettings) continue;

    const endRaw = endAndSettings.trim().split(/\s+/)[0];
    const startSec = parseTimestampSec(startRaw);
    const endSec = Math.max(startSec + 0.2, parseTimestampSec(endRaw));

    const text = lines
      .slice(timingIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!text) continue;

    cues.push({
      id: `sub-${i}-${Math.round(startSec * 100)}`,
      startSec: Number(startSec.toFixed(2)),
      endSec: Number(endSec.toFixed(2)),
      text,
    });
  }

  return cues.sort((a, b) => a.startSec - b.startSec);
}

export function formatSrtTime(sec: number): string {
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs
    .toString()
    .padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}
