export interface ParsedID3Metadata {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  coverBlobUrl?: string;
}

const MAX_APIC_BYTES = 15 * 1024 * 1024; // 15 MB guard against malformed APIC frames

function readSynchsafeInt(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function readUint24BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  );
}

/**
 * Reverses ID3v2 unsynchronisation scheme (0xFF 0x00 -> 0xFF).
 */
function undoUnsync(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let writeIdx = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[writeIdx++] = bytes[i];
    if (bytes[i] === 0xff && i + 1 < bytes.length && bytes[i + 1] === 0x00) {
      i++; // skip inserted 0x00
    }
  }
  return out.subarray(0, writeIdx);
}

/**
 * Detects whether raw single-byte encoding=0 bytes are actually Windows-1251 Cyrillic
 * (common in older Russian MP3 tags labeled as ISO-8859-1).
 */
function looksLikeWindows1251Cyrillic(content: Uint8Array): boolean {
  let cyrillicRange = 0;
  let highBytes = 0;
  for (let i = 0; i < content.length; i++) {
    const b = content[i];
    if (b === 0) continue;
    if (b >= 0x80) {
      highBytes++;
      if ((b >= 0xc0 && b <= 0xff) || b === 0xa8 || b === 0xb8) {
        cyrillicRange++;
      }
    }
  }
  return highBytes >= 2 && cyrillicRange / highBytes >= 0.75;
}

function normalizeMultiValueText(raw: string): string {
  // Strip trailing NULs, then join internal NUL-separated values cleanly
  const trimmed = raw.replace(/\0+$/, '');
  if (!trimmed) return '';
  return trimmed
    .split(/\0+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

function decodeTextFrame(frameData: Uint8Array): string {
  if (frameData.length <= 1) return '';
  const encoding = frameData[0];
  const content = frameData.subarray(1);

  try {
    if (encoding === 0) {
      const charset = looksLikeWindows1251Cyrillic(content) ? 'windows-1251' : 'iso-8859-1';
      return normalizeMultiValueText(new TextDecoder(charset).decode(content));
    }
    if (encoding === 1) {
      return normalizeMultiValueText(new TextDecoder('utf-16').decode(content));
    }
    if (encoding === 2) {
      return normalizeMultiValueText(new TextDecoder('utf-16be').decode(content));
    }
    return normalizeMultiValueText(new TextDecoder('utf-8').decode(content));
  } catch {
    return normalizeMultiValueText(new TextDecoder('utf-8', { fatal: false }).decode(content));
  }
}

function decodeAPICFrame(frameData: Uint8Array, isV22: boolean): string | undefined {
  if (frameData.length < 4 || frameData.length > MAX_APIC_BYTES) return undefined;
  const encoding = frameData[0];
  let idx = 1;
  let mime = '';

  if (isV22) {
    if (idx + 3 > frameData.length) return undefined;
    const fmt = String.fromCharCode(frameData[idx], frameData[idx + 1], frameData[idx + 2])
      .toUpperCase()
      .trim();
    idx += 3;
    mime = fmt === 'PNG' ? 'image/png' : fmt === 'GIF' ? 'image/gif' : 'image/jpeg';
  } else {
    while (idx < frameData.length && frameData[idx] !== 0) {
      mime += String.fromCharCode(frameData[idx]);
      idx++;
    }
    idx++; // skip null terminator for mime
  }

  if (idx >= frameData.length) return undefined;
  idx++; // skip picture type byte

  // Skip description string based on encoding
  if (encoding === 1 || encoding === 2) {
    while (idx + 1 < frameData.length) {
      if (frameData[idx] === 0 && frameData[idx + 1] === 0) {
        idx += 2;
        break;
      }
      idx += 2;
    }
  } else {
    while (idx < frameData.length && frameData[idx] !== 0) {
      idx++;
    }
    idx++;
  }

  if (idx >= frameData.length) return undefined;
  const imgBytes = frameData.subarray(idx);
  if (imgBytes.length < 16 || imgBytes.length > MAX_APIC_BYTES) return undefined;

  const safeMime = mime && mime.includes('/') ? mime : 'image/jpeg';
  const blob = new Blob([new Uint8Array(imgBytes)], { type: safeMime });
  return URL.createObjectURL(blob);
}

/**
 * Extracts ID3v2.2 / v2.3 / v2.4 tags (Title, Artist, Album, Year, embedded APIC/PIC cover art)
 * with unsynchronisation, UTF-16/UTF-8/Windows-1251 heuristics, and buffer bounds safety.
 */
export function parseID3Tags(buffer: ArrayBuffer, fallbackFilename: string): ParsedID3Metadata {
  const cleanName = fallbackFilename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const result: ParsedID3Metadata = {
    title: cleanName,
  };

  if (buffer.byteLength < 10) return result;
  const rawBytes = new Uint8Array(buffer);

  // Check "ID3" header
  if (rawBytes[0] !== 0x49 || rawBytes[1] !== 0x44 || rawBytes[2] !== 0x33) {
    const dashSplit = fallbackFilename.replace(/\.[^.]+$/, '').split(' - ');
    if (dashSplit.length >= 2) {
      result.artist = dashSplit[0].trim();
      result.title = dashSplit.slice(1).join(' - ').trim();
    }
    return result;
  }

  const majorVersion = rawBytes[3];
  const flags = rawBytes[5];
  const tagSize = readSynchsafeInt(rawBytes, 6);
  const tagEnd = Math.min(rawBytes.length, 10 + tagSize);
  if (tagEnd <= 10 || majorVersion < 2 || majorVersion > 4) return result;

  const tagUnsync = (flags & 0x80) !== 0;
  let body: Uint8Array = rawBytes.subarray(10, tagEnd);
  if (tagUnsync && majorVersion <= 3) {
    body = undoUnsync(body);
  }

  let offset = 0;

  // Skip extended header if present (v2.3 / v2.4)
  if ((flags & 0x40) !== 0 && majorVersion >= 3 && offset + 4 <= body.length) {
    const extSize =
      majorVersion === 4 ? readSynchsafeInt(body, offset) : readUint32BE(body, offset);
    const step = majorVersion === 4 ? extSize : extSize + 4;
    if (step > 0 && offset + step <= body.length) {
      offset += step;
    }
  }

  if (majorVersion === 2) {
    // ID3v2.2: 3-char frame ID + 3-byte BE size
    while (offset + 6 <= body.length) {
      const frameId = String.fromCharCode(body[offset], body[offset + 1], body[offset + 2]);
      if (frameId === '\0\0\0' || !/^[A-Z0-9]{3}$/.test(frameId)) break;
      const frameSize = readUint24BE(body, offset + 3);
      offset += 6;
      if (frameSize <= 0 || offset + frameSize > body.length) break;

      const frameData = body.subarray(offset, offset + frameSize);
      if (frameId === 'TT2') {
        const val = decodeTextFrame(frameData);
        if (val) result.title = val;
      } else if (frameId === 'TP1') {
        const val = decodeTextFrame(frameData);
        if (val) result.artist = val;
      } else if (frameId === 'TAL') {
        const val = decodeTextFrame(frameData);
        if (val) result.album = val;
      } else if (frameId === 'TYE') {
        const val = decodeTextFrame(frameData);
        if (val) result.year = val.slice(0, 4);
      } else if (frameId === 'PIC' && !result.coverBlobUrl) {
        result.coverBlobUrl = decodeAPICFrame(frameData, true);
      }
      offset += frameSize;
    }
    return result;
  }

  // ID3v2.3 / ID3v2.4
  while (offset + 10 <= body.length) {
    const frameId = String.fromCharCode(
      body[offset],
      body[offset + 1],
      body[offset + 2],
      body[offset + 3]
    );
    if (frameId === '\0\0\0\0' || !/^[A-Z0-9]{4}$/.test(frameId)) {
      break;
    }

    const frameSize =
      majorVersion === 4 ? readSynchsafeInt(body, offset + 4) : readUint32BE(body, offset + 4);
    const frameFlagsLow = body[offset + 9];
    offset += 10;

    if (frameSize <= 0 || offset + frameSize > body.length) {
      break;
    }

    let frameData: Uint8Array = body.subarray(offset, offset + frameSize);
    offset += frameSize;

    // v2.4 per-frame unsynchronisation flag (bit 1) or tag-level unsync
    const hasDataLengthIndicator = majorVersion === 4 && (frameFlagsLow & 0x01) !== 0;
    const isFrameUnsync = majorVersion === 4 && ((frameFlagsLow & 0x02) !== 0 || tagUnsync);

    if (hasDataLengthIndicator) {
      if (frameData.length <= 4) continue;
      frameData = frameData.subarray(4);
    }
    if (isFrameUnsync) {
      frameData = undoUnsync(frameData);
    }

    if (frameId === 'TIT2') {
      const val = decodeTextFrame(frameData);
      if (val) result.title = val;
    } else if (frameId === 'TPE1') {
      const val = decodeTextFrame(frameData);
      if (val) result.artist = val;
    } else if (frameId === 'TALB') {
      const val = decodeTextFrame(frameData);
      if (val) result.album = val;
    } else if (frameId === 'TYER' || frameId === 'TDRC') {
      const val = decodeTextFrame(frameData);
      if (val) result.year = val.slice(0, 4);
    } else if (frameId === 'APIC' && !result.coverBlobUrl) {
      result.coverBlobUrl = decodeAPICFrame(frameData, false);
    }
  }

  return result;
}
