import {
  Film,
  Image as ImageIcon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { tFor } from '../i18n';
import { Language, MediaBinItem, SlideTransitionType } from '../types/studio';

interface MediaPreviewModalProps {
  lang: Language;
  asset: MediaBinItem;
  placedCount: number;
  hasMasterAudio: boolean;
  onClose: () => void;
  onSaveDefaults: (
    binItemId: string,
    patch: Partial<MediaBinItem>,
    syncPlacedClips: boolean
  ) => void;
  onPlaceOnTimeline: (binItemId: string, mode: 'playhead' | 'end') => void;
}

function formatSecShort(sec: number): string {
  const safe = Math.max(0, sec);
  const m = Math.floor(safe / 60);
  const s = (safe % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

export function MediaPreviewModal({
  lang,
  asset,
  placedCount,
  hasMasterAudio,
  onClose,
  onSaveDefaults,
  onPlaceOnTimeline,
}: MediaPreviewModalProps) {
  const t = tFor(lang);
  const videoRef = useRef<HTMLVideoElement>(null);

  const maxVideoDur = Math.max(0.5, asset.videoDuration || asset.defaultDurationSec || 10);
  const [dur, setDur] = useState<number>(asset.defaultDurationSec);
  const [sourceStart, setSourceStart] = useState<number>(asset.defaultSourceStartSec ?? 0);
  const [rate, setRate] = useState<number>(asset.defaultPlaybackRate ?? 1.0);
  const [muted, setMuted] = useState<boolean>(
    asset.defaultClipAudioMuted ?? hasMasterAudio
  );
  const [trans, setTrans] = useState<SlideTransitionType>(
    asset.defaultTransitionOut ?? 'crossfade'
  );
  const [syncPlaced, setSyncPlaced] = useState<boolean>(placedCount > 0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [previewTime, setPreviewTime] = useState<number>(asset.defaultSourceStartSec ?? 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || asset.kind !== 'video') return;
    v.playbackRate = rate;
  }, [rate, asset.kind]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || asset.kind !== 'video') return;
    v.muted = muted;
  }, [muted, asset.kind]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || asset.kind !== 'video') return;
    if (Number.isFinite(sourceStart)) {
      try {
        v.currentTime = Math.max(0, Math.min(maxVideoDur - 0.1, sourceStart));
        setPreviewTime(v.currentTime);
      } catch {
        // ignore seek before metadata
      }
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const buildPatch = (): Partial<MediaBinItem> => ({
    defaultDurationSec: Number(Math.max(0.4, Math.min(600, dur)).toFixed(1)),
    defaultSourceStartSec:
      asset.kind === 'video'
        ? Number(Math.max(0, Math.min(Math.max(0, maxVideoDur - 0.4), sourceStart)).toFixed(2))
        : 0,
    defaultPlaybackRate: asset.kind === 'video' ? rate : 1.0,
    defaultTransitionOut: trans,
    defaultClipAudioMuted: asset.kind === 'video' ? muted : true,
  });

  const handleSave = () => {
    onSaveDefaults(asset.id, buildPatch(), syncPlaced);
    onClose();
  };

  const handleInsert = (mode: 'playhead' | 'end') => {
    onSaveDefaults(asset.id, buildPatch(), syncPlaced);
    onPlaceOnTimeline(asset.id, mode);
    onClose();
  };

  const sliderMax =
    asset.kind === 'video' ? Math.max(10, Math.ceil(maxVideoDur)) : 60;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t.previewModalTitle}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-[#262B38] bg-[#10131A] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#262B38] bg-[#0E1016] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {asset.kind === 'video' ? (
              <Film className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            ) : (
              <ImageIcon className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-gray-100 truncate">
                {asset.fileName}
              </h3>
              <p className="text-[10px] font-mono text-gray-400">
                {t.previewModalTitle} · {asset.width}×{asset.height}
                {asset.kind === 'video' && ` · ${maxVideoDur.toFixed(1)}s`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.closeLabel}
            className="p-1.5 rounded-md border border-[#262B38] bg-[#141821] text-gray-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Media Stage + Quick Edit Controls */}
        <div className="overflow-y-auto p-4 space-y-4">
          <div className="rounded-lg border border-[#262B38] bg-black overflow-hidden flex flex-col items-center justify-center">
            {asset.kind === 'image' ? (
              <img
                src={asset.url}
                alt={asset.fileName}
                referrerPolicy="no-referrer"
                className="max-h-64 w-auto object-contain"
              />
            ) : (
              <>
                <video
                  ref={videoRef}
                  src={asset.url}
                  playsInline
                  muted={muted}
                  onTimeUpdate={() => {
                    if (videoRef.current) setPreviewTime(videoRef.current.currentTime);
                  }}
                  onEnded={() => setIsPlaying(false)}
                  onClick={togglePlay}
                  className="max-h-64 w-auto object-contain cursor-pointer"
                />
                <div className="w-full px-3 py-2 bg-[#0E1016] border-t border-[#262B38] space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="p-1.5 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-amber-300 cursor-pointer shrink-0"
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={maxVideoDur}
                      step={0.05}
                      value={previewTime}
                      onChange={(e) => {
                        const sec = Number(e.target.value);
                        setPreviewTime(sec);
                        if (videoRef.current) videoRef.current.currentTime = sec;
                      }}
                      className="flex-1 studio-slider"
                    />
                    <span className="text-[11px] font-mono tabular-nums text-gray-300 shrink-0">
                      {formatSecShort(previewTime)} / {formatSecShort(maxVideoDur)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setMuted((m) => !m)}
                      title={t.clipMuteLabel}
                      className="p-1.5 rounded border border-[#262B38] bg-[#141821] text-gray-300 hover:text-amber-300 cursor-pointer shrink-0"
                    >
                      {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-amber-400" />}
                    </button>
                  </div>

                  {/* In/Out Quick Trim Controls */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const nextIn = Number(
                          Math.max(0, Math.min(maxVideoDur - 0.5, previewTime)).toFixed(2)
                        );
                        setSourceStart(nextIn);
                        setDur((prev) =>
                          Number(Math.max(0.5, Math.min(maxVideoDur - nextIn, prev)).toFixed(1))
                        );
                      }}
                      className="px-2 py-1 rounded border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-[11px] font-medium text-amber-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Scissors className="w-3 h-3" />
                      <span>{t.previewSetInBtn} ({previewTime.toFixed(1)}s)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const computedLen = Number(
                          Math.max(0.5, Math.min(600, previewTime - sourceStart)).toFixed(1)
                        );
                        if (previewTime > sourceStart + 0.4) {
                          setDur(computedLen);
                        }
                      }}
                      className="px-2 py-1 rounded border border-cyan-500/50 bg-cyan-500/10 hover:bg-cyan-500/20 text-[11px] font-medium text-cyan-200 cursor-pointer"
                    >
                      {t.previewSetOutBtn}
                    </button>
                    {sourceStart > 0.05 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSourceStart(0);
                          if (videoRef.current) videoRef.current.currentTime = 0;
                          setPreviewTime(0);
                        }}
                        className="px-2 py-1 rounded border border-[#262B38] bg-[#141821] text-[11px] text-gray-300 hover:text-white flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{t.previewResetInBtn}</span>
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Quick File Defaults Grid */}
          <div className="rounded-lg border border-[#262B38] bg-[#141821] p-3 space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-200 font-medium">{t.clipDurationLabel}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0.5}
                    max={600}
                    step={0.5}
                    value={Number(dur.toFixed(1))}
                    onChange={(e) =>
                      setDur(Math.max(0.5, Math.min(600, Number(e.target.value) || 0.5)))
                    }
                    className="w-16 rounded bg-[#0E1016] border border-[#262B38] px-1.5 py-0.5 text-right text-xs font-mono tabular-nums text-amber-300"
                  />
                  <span className="text-[11px] font-mono text-gray-500">s</span>
                </div>
              </div>
              <input
                type="range"
                min={0.5}
                max={sliderMax}
                step={0.5}
                value={Math.min(sliderMax, dur)}
                onChange={(e) => setDur(Number(e.target.value))}
                className="w-full studio-slider"
              />
              <div className="flex flex-wrap gap-1">
                {[1, 2, 4, 8, 12].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => setDur(sec)}
                    className={`px-2 py-0.5 rounded border text-[10px] font-mono cursor-pointer ${
                      Math.abs(dur - sec) < 0.05
                        ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                        : 'border-[#262B38] bg-[#0E1016] text-gray-300'
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
                {asset.kind === 'video' && (
                  <button
                    type="button"
                    onClick={() =>
                      setDur(Number(Math.max(0.5, Math.min(600, maxVideoDur - sourceStart)).toFixed(1)))
                    }
                    className="px-2 py-0.5 rounded border border-[#262B38] bg-[#0E1016] hover:border-amber-500/50 text-[10px] font-mono text-amber-200 cursor-pointer"
                  >
                    Full ({Math.max(0.5, maxVideoDur - sourceStart).toFixed(1)}s)
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {asset.kind === 'video' && (
                <label className="space-y-1 block">
                  <span className="text-[10px] text-gray-400 block">{t.clipVideoStartLabel}</span>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, maxVideoDur - 0.4)}
                    step={0.1}
                    value={Number(sourceStart.toFixed(2))}
                    onChange={(e) =>
                      setSourceStart(
                        Math.max(0, Math.min(Math.max(0, maxVideoDur - 0.4), Number(e.target.value) || 0))
                      )
                    }
                    className="w-full rounded bg-[#0E1016] border border-[#262B38] px-2 py-1 text-xs font-mono text-gray-100"
                  />
                </label>
              )}

              {asset.kind === 'video' && (
                <label className="space-y-1 block">
                  <span className="text-[10px] text-gray-400 block">{t.clipSpeedLabel}</span>
                  <select
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    className="w-full rounded bg-[#0E1016] border border-[#262B38] px-2 py-1 text-xs font-mono text-gray-100"
                  >
                    {[0.25, 0.35, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((spd) => (
                      <option key={spd} value={spd}>
                        {spd}×
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="space-y-1 block">
                <span className="text-[10px] text-gray-400 block">{t.clipTransitionLabel}</span>
                <select
                  value={trans}
                  onChange={(e) => setTrans(e.target.value as SlideTransitionType)}
                  className="w-full rounded bg-[#0E1016] border border-[#262B38] px-2 py-1 text-xs text-gray-100"
                >
                  <option value="crossfade">{t.transitionCrossfade}</option>
                  <option value="zoom_cross">{t.transitionZoomCross}</option>
                  <option value="wipe_right">{t.transitionWipeRight}</option>
                  <option value="dip_black">{t.transitionDipBlack}</option>
                  <option value="slide">{t.transitionSlide}</option>
                  <option value="cut">{t.transitionCut}</option>
                </select>
              </label>
            </div>

            {placedCount > 0 && (
              <label className="flex items-center gap-2 text-xs text-amber-200 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={syncPlaced}
                  onChange={(e) => setSyncPlaced(e.target.checked)}
                  className="accent-amber-500 w-3.5 h-3.5 rounded cursor-pointer"
                />
                <span>
                  {t.previewApplyToPlacedLabel} ({placedCount})
                </span>
              </label>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-[#262B38] bg-[#0E1016] flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleSave}
            className="px-3 py-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-xs font-medium text-gray-200 cursor-pointer"
          >
            {t.previewSaveBtn}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleInsert('playhead')}
              className="px-3 py-1.5 rounded-md border border-amber-500/60 bg-amber-500/15 hover:bg-amber-500/25 text-xs font-medium text-amber-300 flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.binPlaceAtPlayhead}</span>
            </button>
            <button
              type="button"
              onClick={() => handleInsert('end')}
              className="px-3 py-1.5 rounded-md border border-cyan-500/60 bg-cyan-500/15 hover:bg-cyan-500/25 text-xs font-medium text-cyan-200 cursor-pointer"
            >
              {t.binPlaceAtEnd}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
