import {
  ClipGeneratorParams,
  ClipOverlayGenerator,
  ClipTransform,
  MediaBinItem,
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

export interface SerializedBinItem {
  id: string;
  kind: 'image' | 'video';
  fileName: string;
  width: number;
  height: number;
  videoDuration?: number;
  defaultDurationSec: number;
  defaultSourceStartSec?: number;
  defaultPlaybackRate?: number;
  defaultTransitionOut?: SlideTransitionType;
  defaultClipAudioMuted?: boolean;
  blobKey?: string;
}

export interface SerializedClip {
  id: string;
  kind: 'image' | 'video' | 'generator';
  fileName: string;
  width: number;
  height: number;
  videoDuration?: number;
  startSec?: number;
  durationSec: number;
  sourceStartSec: number;
  playbackRate: number;
  transitionOut: SlideTransitionType;
  transitionDurationSec: number;
  generatorId?: VisualMediaState['generatorId'];
  generatorParams?: ClipGeneratorParams;
  overlayEffect?: ClipOverlayGenerator;
  transform: ClipTransform;
  clipAudioVolume: number;
  clipAudioMuted: boolean;
  blobKey?: string;
}

export interface SerializedProject {
  version: 2 | 3 | 4 | 5;
  savedAt: string;
  config: StudioConfig;
  mediaBin?: SerializedBinItem[];
  clips: SerializedClip[];
  audioMeta?: {
    fileName: string;
    fileSize: number;
    isSyntheticDemo: boolean;
    blobKey?: string;
  };
}

export interface StorageWriteResult {
  ok: boolean;
  error?: string;
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
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
    });
  } finally {
    db.close();
  }
}

async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    });
  } finally {
    db.close();
  }
}

export async function saveBlobToIDB(key: string, blob: Blob): Promise<StorageWriteResult> {
  try {
    await idbPut(STORE_BLOBS, key, blob);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Blob save failed' };
  }
}

export async function loadBlobFromIDB(key: string): Promise<Blob | undefined> {
  try {
    return await idbGet<Blob>(STORE_BLOBS, key);
  } catch {
    return undefined;
  }
}

export async function saveProjectToIDB(project: SerializedProject): Promise<StorageWriteResult> {
  try {
    await idbPut(STORE_PROJECT, PROJECT_KEY, project);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Project save failed' };
  }
}

export async function loadProjectFromIDB(): Promise<SerializedProject | undefined> {
  try {
    return await idbGet<SerializedProject>(STORE_PROJECT, PROJECT_KEY);
  } catch {
    return undefined;
  }
}

export async function pruneOrphanedBlobs(activeKeys: Set<string>): Promise<void> {
  try {
    const db = await openDB();
    try {
      const allKeys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const tx = db.transaction(STORE_BLOBS, 'readonly');
        const req = tx.objectStore(STORE_BLOBS).getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      const toDelete = allKeys.filter((k) => typeof k === 'string' && !activeKeys.has(k));
      if (toDelete.length === 0) return;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_BLOBS, 'readwrite');
        const store = tx.objectStore(STORE_BLOBS);
        for (const k of toDelete) {
          store.delete(k);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Best-effort orphan cleanup
  }
}

export async function clearProjectIDB(): Promise<void> {
  try {
    const db = await openDB();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_PROJECT, STORE_BLOBS], 'readwrite');
        tx.objectStore(STORE_PROJECT).clear();
        tx.objectStore(STORE_BLOBS).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
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
  audioBlobKey?: string,
  mediaBin: MediaBinItem[] = []
): SerializedProject {
  const cleanOverlays = config.overlays.map((ov) => ({
    ...ov,
    imageElement: undefined,
  }));

  return {
    version: 5,
    savedAt: new Date().toISOString(),
    config: {
      ...config,
      overlays: cleanOverlays,
    },
    mediaBin: mediaBin.map((b) => ({
      id: b.id,
      kind: b.kind,
      fileName: b.fileName,
      width: b.width,
      height: b.height,
      videoDuration: b.videoDuration,
      defaultDurationSec: b.defaultDurationSec,
      defaultSourceStartSec: b.defaultSourceStartSec,
      defaultPlaybackRate: b.defaultPlaybackRate,
      defaultTransitionOut: b.defaultTransitionOut,
      defaultClipAudioMuted: b.defaultClipAudioMuted,
      blobKey: b.url ? blobKeyMap.get(b.url) : undefined,
    })),
    clips: mediaItems.map((m) => ({
      id: m.id,
      kind: m.kind,
      fileName: m.fileName,
      width: m.width,
      height: m.height,
      videoDuration: m.videoDuration,
      startSec: m.startSec,
      durationSec: m.durationSec,
      sourceStartSec: m.sourceStartSec,
      playbackRate: m.playbackRate,
      transitionOut: m.transitionOut,
      transitionDurationSec: m.transitionDurationSec,
      generatorId: m.generatorId,
      generatorParams: m.generatorParams ? { ...m.generatorParams } : undefined,
      overlayEffect: m.overlayEffect
        ? {
            ...m.overlayEffect,
            params: m.overlayEffect.params ? { ...m.overlayEffect.params } : undefined,
          }
        : undefined,
      transform: m.transform || { ...DEFAULT_CLIP_TRANSFORM },
      clipAudioVolume: m.clipAudioVolume ?? 0,
      clipAudioMuted: m.clipAudioMuted ?? true,
      blobKey: m.url ? blobKeyMap.get(m.url) : undefined,
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
