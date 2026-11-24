import { Language } from '../types/studio';

export type MediaErrorCode =
  | 'empty_file'
  | 'file_too_large'
  | 'unsupported_container'
  | 'unsupported_codec'
  | 'decode_failed';

export interface ClassifiedMediaError {
  code: MediaErrorCode;
  title: string;
  message: string;
  advice: string;
  formatted: string;
}

export interface ClassifyMediaErrorParams {
  lang: Language;
  kind: 'audio' | 'visual' | 'image' | 'video';
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  maxBytes?: number;
  mediaErrorCode?: number | null;
  error?: unknown;
}

const SUPPORTED_AUDIO_EXT_RE = /\.(mp3|wav|flac|ogg|m4a|aac|mp4|mov|webm)$/i;
const SUPPORTED_IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp|gif|avif|bmp)$/i;
const SUPPORTED_VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)$/i;
const LEGACY_CONTAINER_EXT_RE = /\.(avi|mkv|wmv|flv|ts|mts|m2ts|vob|3gp|wma|aiff|alac|heic|heif|tiff?)$/i;

function extractRawErrorText(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }
  return '';
}

function detectCode(params: ClassifyMediaErrorParams): MediaErrorCode {
  const { kind, fileName = '', mimeType = '', fileSize, maxBytes, mediaErrorCode, error } = params;

  if (typeof fileSize === 'number' && fileSize <= 0) {
    return 'empty_file';
  }
  if (typeof fileSize === 'number' && typeof maxBytes === 'number' && maxBytes > 0 && fileSize > maxBytes) {
    return 'file_too_large';
  }

  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();

  if (LEGACY_CONTAINER_EXT_RE.test(lowerName)) {
    return 'unsupported_container';
  }

  if (kind === 'audio') {
    const mimeOk = !lowerMime || lowerMime.startsWith('audio/') || lowerMime.startsWith('video/');
    const extOk = !lowerName || SUPPORTED_AUDIO_EXT_RE.test(lowerName);
    if (!mimeOk || (lowerName.includes('.') && !extOk)) {
      return 'unsupported_container';
    }
  } else if (kind === 'visual' || kind === 'video' || kind === 'image') {
    const isVidHint = lowerMime.startsWith('video/') || SUPPORTED_VIDEO_EXT_RE.test(lowerName);
    const isImgHint = lowerMime.startsWith('image/') || SUPPORTED_IMAGE_EXT_RE.test(lowerName);
    if ((fileName || mimeType) && !isVidHint && !isImgHint) {
      return 'unsupported_container';
    }
  }

  // Browser HTMLMediaElement error codes: 3 = MEDIA_ERR_DECODE, 4 = MEDIA_ERR_SRC_NOT_SUPPORTED
  if (mediaErrorCode === 4) {
    return 'unsupported_codec';
  }
  if (mediaErrorCode === 3) {
    return 'decode_failed';
  }

  const raw = extractRawErrorText(error).toLowerCase();
  if (
    raw.includes('notsupportederror') ||
    raw.includes('not supported') ||
    raw.includes('encodingerror') ||
    raw.includes('unable to decode audio data') ||
    raw.includes('codec') ||
    raw.includes('hevc') ||
    raw.includes('h265')
  ) {
    return 'unsupported_codec';
  }

  return 'decode_failed';
}

export function classifyMediaError(params: ClassifyMediaErrorParams): ClassifiedMediaError {
  const code = detectCode(params);
  const ru = params.lang === 'ru';
  const nameTag = params.fileName ? ` «${params.fileName}»` : '';
  const maxMb = params.maxBytes ? Math.round(params.maxBytes / (1024 * 1024)) : 1536;

  switch (code) {
    case 'empty_file': {
      const title = ru ? 'Пустой файл' : 'Empty file';
      const message = ru
        ? `Файл${nameTag} имеет нулевой размер и не содержит данных.`
        : `File${nameTag} is 0 bytes and contains no media data.`;
      const advice = ru
        ? 'Проверьте исходный файл или выберите другой ролик / аудио.'
        : 'Verify the source file on disk or pick another media asset.';
      return { code, title, message, advice, formatted: `${title}: ${message} ${advice}` };
    }
    case 'file_too_large': {
      const title = ru ? 'Файл слишком большой' : 'File too large';
      const message = ru
        ? `Размер${nameTag} превышает допустимый предел браузера (${maxMb} МБ).`
        : `File${nameTag} exceeds the browser memory limit (${maxMb} MB).`;
      const advice = ru
        ? 'Сожмите видео (H.264 MP4 / WebM) или обрежьте клип перед импортом.'
        : 'Compress or trim the video to H.264 MP4 / WebM before importing.';
      return { code, title, message, advice, formatted: `${title}: ${message} ${advice}` };
    }
    case 'unsupported_container': {
      const title = ru ? 'Неподдерживаемый формат контейнера' : 'Unsupported container format';
      const message = ru
        ? `Формат файла${nameTag} не поддерживается браузером напрямую.`
        : `The container format of${nameTag} is not natively supported by the browser.`;
      const advice =
        params.kind === 'audio'
          ? ru
            ? 'Конвертируйте аудио в MP3, WAV, M4A (AAC) или OGG.'
            : 'Convert the audio track to MP3, WAV, M4A (AAC), or OGG.'
          : ru
            ? 'Конвертируйте файл в H.264 MP4, WebM или JPEG/PNG.'
            : 'Convert the file to H.264 MP4, WebM, or JPEG/PNG.';
      return { code, title, message, advice, formatted: `${title}: ${message} ${advice}` };
    }
    case 'unsupported_codec': {
      const title = ru ? 'Кодек не поддерживается браузером' : 'Unsupported media codec';
      const message = ru
        ? `Не удалось воспроизвести кодек внутри${nameTag} (например HEVC/H.265, ProRes или 10-bit).`
        : `Browser cannot decode the codec inside${nameTag} (for example HEVC/H.265, ProRes, or 10-bit).`;
      const advice =
        params.kind === 'audio'
          ? ru
            ? 'Перекодируйте в MP3, WAV или AAC (.m4a).'
            : 'Re-encode audio to MP3, WAV, or AAC (.m4a).'
          : ru
            ? 'Перекодируйте видео в стандартный H.264 MP4 (8-bit, AAC) или WebM (VP9).'
            : 'Convert the video to standard 8-bit H.264 MP4 or WebM (VP9).';
      return { code, title, message, advice, formatted: `${title}: ${message} ${advice}` };
    }
    case 'decode_failed': {
      const title = ru ? 'Ошибка декодирования медиа' : 'Media decode failed';
      const message = ru
        ? `Не удалось декодировать файл${nameTag} — поток повреждён или оборван.`
        : `Could not decode${nameTag} — the media stream may be corrupted or truncated.`;
      const advice =
        params.kind === 'audio'
          ? ru
            ? 'Попробуйте пересохранить дорожку в WAV или MP3.'
            : 'Try re-exporting the track as WAV or MP3.'
          : ru
            ? 'Попробуйте переконвертировать в H.264 MP4 / WebM или PNG/JPEG.'
            : 'Try re-encoding to H.264 MP4 / WebM or PNG/JPEG.';
      return { code, title, message, advice, formatted: `${title}: ${message} ${advice}` };
    }
  }
}
