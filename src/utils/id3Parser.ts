export interface ParsedID3Metadata {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  coverBlobUrl?: string;
}

function readSynchsafeInt(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  );
}

function decodeTextFrame(frameData: Uint8Array): string {
  if (frameData.length <= 1) return '';
  const encoding = frameData[0];
  const content = frameData.subarray(1);
  try {
    if (encoding === 0) {
      return new TextDecoder('iso-8859-1').decode(content).replace(/\0+$/, '').trim();
    }
    if (encoding === 1) {
      return new TextDecoder('utf-16').decode(content).replace(/\0+$/, '').trim();
    }
    if (encoding === 2) {
      return new TextDecoder('utf-16be').decode(content).replace(/\0+$/, '').trim();
    }
    return new TextDecoder('utf-8').decode(content).replace(/\0+$/, '').trim();
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(content).replace(/\0+$/, '').trim();
  }
}

function decodeAPICFrame(frameData: Uint8Array): string | undefined {
  if (frameData.length < 4) return undefined;
  const encoding = frameData[0];
  let idx = 1;
  let mime = '';
  while (idx < frameData.length && frameData[idx] !== 0) {
    mime += String.fromCharCode(frameData[idx]);
    idx++;
  }
  idx++; // skip null terminator for mime
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
  if (imgBytes.length < 16) return undefined;

  const safeMime = mime && mime.includes('/') ? mime : 'image/jpeg';
  const blob = new Blob([new Uint8Array(imgBytes)], { type: safeMime });
  return URL.createObjectURL(blob);
}

/**
 * Extracts basic ID3v2 tags (Title, Artist, Album, Year, embedded APIC cover art)
 * directly from an audio ArrayBuffer with zero external dependencies.
 */
export function parseID3Tags(buffer: ArrayBuffer, fallbackFilename: string): ParsedID3Metadata {
  const cleanName = fallbackFilename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const result: ParsedID3Metadata = {
    title: cleanName,
  };

  if (buffer.byteLength < 10) return result;
  const bytes = new Uint8Array(buffer);

  // Check "ID3" header
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    // Try "Artist - Title" split from filename
    const dashSplit = fallbackFilename.replace(/\.[^.]+$/, '').split(' - ');
    if (dashSplit.length >= 2) {
      result.artist = dashSplit[0].trim();
      result.title = dashSplit.slice(1).join(' - ').trim();
    }
    return result;
  }

  const majorVersion = bytes[3];
  const flags = bytes[5];
  const tagSize = readSynchsafeInt(bytes, 6);
  const tagEnd = Math.min(bytes.length, 10 + tagSize);

  let offset = 10;
  // Skip extended header if present
  if ((flags & 0x40) !== 0 && majorVersion >= 3 && offset + 4 <= tagEnd) {
    const extSize = majorVersion === 4 ? readSynchsafeInt(bytes, offset) : readUint32BE(bytes, offset);
    offset += majorVersion === 4 ? extSize : extSize + 4;
  }

  if (majorVersion < 3) {
    return result;
  }

  while (offset + 10 <= tagEnd) {
    const frameId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    if (frameId === '\0\0\0\0' || !/^[A-Z0-9]{4}$/.test(frameId)) {
      break;
    }

    const frameSize =
      majorVersion === 4 ? readSynchsafeInt(bytes, offset + 4) : readUint32BE(bytes, offset + 4);
    offset += 10;

    if (frameSize <= 0 || offset + frameSize > tagEnd) {
      break;
    }

    const frameData = bytes.subarray(offset, offset + frameSize);
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
      result.coverBlobUrl = decodeAPICFrame(frameData);
    }

    offset += frameSize;
  }

  return result;
}
