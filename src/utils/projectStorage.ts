import {
  ClipGeneratorParams,
  ClipTransform,
  SlideTransitionType,
  StudioConfig,
  VisualMediaState,
} from '../types/studio';
import { DEFAULT_CLIP_TRANSFORM } from './presets';

const DB_NAME = 'neuromicon_studio_db';
const DB_VERSION = 1;
const STORE_PROJECT = 'project';
const STORE_BLOBS = 'blobs';
const PROJECT_KEY = 'autosave_v1';

export interface SerializedClip {
  id: string;
  kind: 'image' | 'video' | 'generator';
  fileName: string;
  width: number;
  height: number;
  videoDuration?: number;
  durationSec: number;
  sourceStartSec: number;
  playbackRate: number;
  transitionOut: SlideTransitionType;
  transitionDurationSec: number;
  generatorId?: VisualMediaState['generatorId'];
  generatorParams?: ClipGeneratorParams;
  transform: ClipTransform;
  clipAudioVolume: number;
  clipAudioMuted: boolean;
  blobKey?: string;
}

export interface SerializedProject {
  version: 2;
  savedAt: string;
  config: StudioConfig;
  clips: SerializedClip[];
  audioMeta?: {
    fileName: string;
    fileSize: number;
    isSyntheticDemo: boolean;
    blobKey?: string;
  };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECT)) {
        db.createObjectStore(STORE_PROJECT);
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

async function idbPut(storeName: string, key: string, value: unknown): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  const res = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return res;
}

export async function saveBlobToIDB(key: string, blob: Blob): Promise<void> {
  try {
    await idbPut(STORE_BLOBS, key, blob);
  } catch {
    // Best-effort storage (quota or private browsing)
  }
}

export async function loadBlobFromIDB(key: string): Promise<Blob | undefined> {
  try {
    return await idbGet<Blob>(STORE_BLOBS, key);
  } catch {
    return undefined;
  }
}

export async function saveProjectToIDB(project: SerializedProject): Promise<void> {
  try {
    await idbPut(STORE_PROJECT, PROJECT_KEY, project);
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export async function loadProjectFromIDB(): Promise<SerializedProject | undefined> {
  try {
    return await idbGet<SerializedProject>(STORE_PROJECT, PROJECT_KEY);
  } catch {
    return undefined;
  }
}

export async function clearProjectIDB(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECT, STORE_BLOBS], 'readwrite');
      tx.objectStore(STORE_PROJECT).clear();
      tx.objectStore(STORE_BLOBS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export function serializeStudioState(
  config: StudioConfig,
  mediaItems: VisualMediaState[],
  blobKeyMap: Map<string, string>,
  audioFileName?: string,
  audioFileSize?: number,
  isSyntheticDemo?: boolean,
  audioBlobKey?: string
): SerializedProject {
  const cleanOverlays = config.overlays.map((ov) => ({
    ...ov,
    imageElement: undefined,
  }));

  return {
    version: 2,
    savedAt: new Date().toISOString(),
    config: {
      ...config,
      overlays: cleanOverlays,
    },
    clips: mediaItems.map((m) => ({
      id: m.id,
      kind: m.kind,
      fileName: m.fileName,
      width: m.width,
      height: m.height,
      videoDuration: m.videoDuration,
      durationSec: m.durationSec,
      sourceStartSec: m.sourceStartSec,
      playbackRate: m.playbackRate,
      transitionOut: m.transitionOut,
      transitionDurationSec: m.transitionDurationSec,
      generatorId: m.generatorId,
      generatorParams: m.generatorParams ? { ...m.generatorParams } : undefined,
      transform: m.transform || { ...DEFAULT_CLIP_TRANSFORM },
      clipAudioVolume: m.clipAudioVolume ?? 0,
      clipAudioMuted: m.clipAudioMuted ?? true,
      blobKey: blobKeyMap.get(m.url),
    })),
    audioMeta: audioFileName
      ? {
          fileName: audioFileName,
          fileSize: audioFileSize || 0,
          isSyntheticDemo: Boolean(isSyntheticDemo),
          blobKey: audioBlobKey,
        }
      : undefined,
  };
}
