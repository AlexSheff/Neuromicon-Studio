import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Film,
  Image as ImageIcon,
  Layers,
  Move,
  Music,
  Orbit,
  Plus,
  RotateCcw,
  Scissors,
  Sparkles,
  Subtitles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import React, { useRef, useState } from 'react';
import { tFor } from '../i18n';
import {
  AudioTrackState,
  ClipTransform,
  GeneratorEffectId,
  KeyframeEasing,
  Language,
  MediaFramingMode,
  OverlayLayer,
  SlideTransitionType,
  SlideshowMode,
  StudioConfig,
  SubtitleCue,
  TrimPresetId,
  VisualMediaState,
} from '../types/studio';
import { DEFAULT_CLIP_TRANSFORM, GENERATOR_EFFECTS } from '../utils/presets';

interface MediaInputPanelProps {
  lang: Language;
  audio: AudioTrackState | null;
  mediaItems: VisualMediaState[];
  selectedClipId: string | null;
  config: StudioConfig;
  isLoadingAudio: boolean;
  onAudioFile: (file: File) => void;
  onLoadDemoBeat: () => void;
  onVisualFiles: (files: File[]) => void;
  onAddGeneratorScene: (effect: Exclude<GeneratorEffectId, 'none'>) => void;
  onSelectClip: (id: string) => void;
  onUpdateClip: (id: string, patch: Partial<VisualMediaState>) => void;
  onDuplicateClip: (id: string) => void;
  onMoveVisual: (index: number, direction: -1 | 1) => void;
  onRemoveVisual: (id: string) => void;
  onClearVisuals: () => void;
  onFitClipsToAudio: () => void;
  onUseEmbeddedCover: () => void;
  onUpdateConfig: (patch: Partial<StudioConfig>) => void;
  onSelectTrimPreset: (preset: TrimPresetId) => void;
  onPreviewFadeOut: () => void;
  onImportSubtitlesText: (raw: string) => void;
  onExportSrt: () => void;
  onAddCueAtPlayhead: () => void;
  onUpdateSubtitleCue: (id: string, patch: Partial<SubtitleCue>) => void;
  onRemoveSubtitleCue: (id: string) => void;
  onAddTextOverlay: () => void;
  onAddImageOverlay: (file: File) => void;
  onUpdateOverlay: (id: string, patch: Partial<OverlayLayer>) => void;
  onRemoveOverlay: (id: string) => void;
  onResetAutosave: () => void;
}

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MediaInputPanel({
  lang,
  audio,
  mediaItems,
  selectedClipId,
  config,
  isLoadingAudio,
  onAudioFile,
  onLoadDemoBeat,
  onVisualFiles,
  onAddGeneratorScene,
  onSelectClip,
  onUpdateClip,
  onDuplicateClip,
  onMoveVisual,
  onRemoveVisual,
  onClearVisuals,
  onFitClipsToAudio,
  onUseEmbeddedCover,
  onUpdateConfig,
  onSelectTrimPreset,
  onPreviewFadeOut,
  onImportSubtitlesText,
  onExportSrt,
  onAddCueAtPlayhead,
  onUpdateSubtitleCue,
  onRemoveSubtitleCue,
  onAddTextOverlay,
  onAddImageOverlay,
  onUpdateOverlay,
  onRemoveOverlay,
  onResetAutosave,
}: MediaInputPanelProps) {
  const t = tFor(lang);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const visualInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);
  const overlayImgInputRef = useRef<HTMLInputElement>(null);

  const [audioDragOver, setAudioDragOver] = useState(false);
  const [visualDragOver, setVisualDragOver] = useState(false);
  const [transformOpen, setTransformOpen] = useState(false);
  const [subsOpen, setSubsOpen] = useState(false);
  const [overlaysOpen, setOverlaysOpen] = useState(false);
  const [srtDraft, setSrtDraft] = useState('');

  const selectedClip = mediaItems.find((c) => c.id === selectedClipId) || mediaItems[0] || null;
  const clipTransform: ClipTransform = selectedClip?.transform || DEFAULT_CLIP_TRANSFORM;

  const updateSelectedTransform = (patch: Partial<ClipTransform>) => {
    if (!selectedClip) return;
    onUpdateClip(selectedClip.id, {
      transform: { ...clipTransform, ...patch },
    });
  };

  const handleAudioDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setAudioDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onAudioFile(file);
  };

  const handleVisualDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setVisualDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) onVisualFiles(files);
  };

  const trimPresets: { id: TrimPresetId; label: string }[] = [
    { id: 'full', label: t.trimFull },
    { id: 'reels_60', label: t.trimReels },
    { id: 'tiktok_60', label: t.trimTikTok },
    { id: 'shorts_57', label: t.trimShorts },
    { id: 'custom', label: t.trimCustom },
  ];

  const maxDur = audio ? audio.duration : 60;

  return (
    <aside
      id="media-panel"
      className="w-full lg:w-[345px] xl:w-[365px] shrink-0 border-b lg:border-b-0 lg:border-r border-[#262B38] bg-[#10131A] flex flex-col divide-y divide-[#262B38] lg:overflow-y-auto"
    >
      {/* 1. Audio Upload Zone */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
            <Music className="w-4 h-4 text-amber-400" aria-hidden="true" />
            <span>{t.audioSectionTitle}</span>
          </h2>
          {audio && (
            <button
              type="button"
              onClick={() => audioInputRef.current?.click()}
              className="text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap"
            >
              {t.replaceAudio}
            </button>
          )}
        </div>

        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onAudioFile(f);
            e.target.value = '';
          }}
        />

        {!audio ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => audioInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') audioInputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setAudioDragOver(true);
            }}
            onDragLeave={() => setAudioDragOver(false)}
            onDrop={handleAudioDrop}
            className={`rounded-lg border border-dashed p-4 text-center cursor-pointer transition-colors ${
              audioDragOver
                ? 'border-amber-400 bg-amber-500/10'
                : 'border-[#323849] bg-[#141821] hover:border-gray-500'
            }`}
          >
            <Upload className="w-5 h-5 mx-auto mb-2 text-gray-400" aria-hidden="true" />
            <p className="text-xs font-medium text-gray-200">
              {isLoadingAudio ? '...' : t.audioDropTitle}
            </p>
            <p className="text-[11px] text-gray-500 mt-1">{t.audioDropHint}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-[#262B38] bg-[#141821] p-3 space-y-1.5">
            <p className="text-xs font-semibold text-gray-100 truncate" title={audio.fileName}>
              {audio.fileName}
            </p>
            <p className="text-[11px] text-gray-400 font-mono tabular-nums">
              {formatSec(audio.duration)} · {(audio.sampleRate / 1000).toFixed(1)} kHz ·{' '}
              {audio.numberOfChannels}ch
              {audio.isSyntheticDemo ? ` · ${t.audioSyntheticNote}` : ''}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={onLoadDemoBeat}
          disabled={isLoadingAudio}
          className="w-full py-2 px-3 rounded-md border border-[#262B38] bg-[#161A24] hover:bg-[#1D2230] text-xs font-medium text-gray-200 transition-colors flex items-center justify-center gap-2 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
          <span>{t.loadDemoBeat}</span>
        </button>
      </section>

      {/* 2. Clip Sequence & Generative Scenes */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-100 flex items-center gap-2 min-w-0">
            <ImageIcon className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            <span className="truncate">{t.visualSectionTitle}</span>
          </h2>
          {mediaItems.length > 0 && (
            <button
              type="button"
              onClick={onClearVisuals}
              className="text-xs text-gray-400 hover:text-rose-400 transition-colors cursor-pointer whitespace-nowrap"
            >
              {t.clearVisuals}
            </button>
          )}
        </div>

        <input
          ref={visualInputRef}
          type="file"
          multiple
          accept="image/*,video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) onVisualFiles(files);
            e.target.value = '';
          }}
        />

        <div
          role="button"
          tabIndex={0}
          onClick={() => visualInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') visualInputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setVisualDragOver(true);
          }}
          onDragLeave={() => setVisualDragOver(false)}
          onDrop={handleVisualDrop}
          className={`rounded-lg border border-dashed text-center cursor-pointer transition-colors ${
            mediaItems.length > 0 ? 'p-2.5' : 'p-4'
          } ${
            visualDragOver
              ? 'border-amber-400 bg-amber-500/10'
              : 'border-[#323849] bg-[#141821] hover:border-gray-500'
          }`}
        >
          {mediaItems.length === 0 ? (
            <>
              <Upload className="w-5 h-5 mx-auto mb-2 text-gray-400" aria-hidden="true" />
              <p className="text-xs font-medium text-gray-200">{t.visualDropTitle}</p>
              <p className="text-[11px] text-gray-500 mt-1">{t.visualDropHint}</p>
            </>
          ) : (
            <div className="flex items-center justify-center gap-2 text-xs font-medium text-gray-300">
              <Plus className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              <span>
                {t.addMoreVisuals} ({mediaItems.length} {t.mediaCountSuffix})
              </span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onAddGeneratorScene('galaxy_spiral')}
          className="w-full py-2 px-3 rounded-md border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-xs font-medium text-amber-300 transition-colors flex items-center justify-center gap-2 cursor-pointer"
        >
          <Orbit className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t.addGenSceneBtn}</span>
        </button>

        {/* Clip Sequence List */}
        {mediaItems.length > 0 && (
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
            {mediaItems.map((item, idx) => {
              const isSelected = selectedClip?.id === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => onSelectClip(item.id)}
                  className={`rounded-md border p-2 flex items-center gap-2 cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-amber-500/80 bg-amber-500/10'
                      : 'border-[#262B38] bg-[#141821] hover:border-gray-500'
                  }`}
                >
                  <span className="text-[11px] font-mono tabular-nums text-gray-500 w-4 text-center shrink-0">
                    {idx + 1}
                  </span>
                  <div className="w-10 h-10 rounded bg-black/50 overflow-hidden shrink-0 border border-[#262B38] flex items-center justify-center">
                    {item.kind === 'image' ? (
                      <img
                        src={item.url}
                        alt={item.fileName}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : item.kind === 'video' ? (
                      <video src={item.url} muted className="w-full h-full object-cover" />
                    ) : (
                      <Orbit className="w-4 h-4 text-amber-400" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-100 truncate" title={item.fileName}>
                      {item.fileName}
                    </p>
                    <p className="text-[10px] text-gray-400 font-mono tabular-nums flex items-center gap-1.5 mt-0.5">
                      {item.kind === 'video' && <Film className="w-2.5 h-2.5 text-amber-400" />}
                      <span>{item.durationSec.toFixed(1)}s</span>
                      {item.kind !== 'generator' && (
                        <>
                          <span>·</span>
                          <span>
                            {item.width}×{item.height}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <div
                    className="flex items-center gap-0.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => onMoveVisual(idx, -1)}
                      aria-label="Move up"
                      className="p-1 rounded text-gray-400 hover:text-gray-100 disabled:opacity-25 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === mediaItems.length - 1}
                      onClick={() => onMoveVisual(idx, 1)}
                      aria-label="Move down"
                      className="p-1 rounded text-gray-400 hover:text-gray-100 disabled:opacity-25 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicateClip(item.id)}
                      aria-label={t.duplicateClipLabel}
                      title={t.duplicateClipLabel}
                      className="p-1 rounded text-gray-400 hover:text-amber-300 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveVisual(item.id)}
                      aria-label="Remove clip"
                      className="p-1 rounded text-gray-400 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Selected Clip Properties Editor */}
        {selectedClip && (
          <div className="rounded-lg border border-[#262B38] bg-[#141821] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-amber-300 truncate">
                {t.selectedClipTitle}: {selectedClip.fileName}
              </span>
            </div>

            {selectedClip.kind === 'generator' && (
              <div className="space-y-1">
                <span className="text-[11px] text-gray-400 block">
                  {t.clipGeneratorSceneLabel}
                </span>
                <select
                  value={selectedClip.generatorId || 'galaxy_spiral'}
                  onChange={(e) => {
                    const nextEff = e.target.value as Exclude<GeneratorEffectId, 'none'>;
                    const meta = GENERATOR_EFFECTS.find((g) => g.id === nextEff);
                    onUpdateClip(selectedClip.id, {
                      generatorId: nextEff,
                      fileName: meta ? (lang === 'ru' ? meta.nameRu : meta.nameEn) : nextEff,
                    });
                  }}
                  className="w-full rounded-md bg-[#0E1016] border border-[#262B38] px-2.5 py-1.5 text-xs text-gray-100 focus:border-amber-500 focus:outline-none"
                >
                  {GENERATOR_EFFECTS.filter((g) => g.id !== 'none').map((g) => (
                    <option key={g.id} value={g.id}>
                      {lang === 'ru' ? g.nameRu : g.nameEn}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-400">{t.clipDurationLabel}</span>
                <span className="font-mono tabular-nums text-gray-200">
                  {selectedClip.durationSec.toFixed(1)}s
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={30}
                step={0.5}
                value={selectedClip.durationSec}
                onChange={(e) =>
                  onUpdateClip(selectedClip.id, { durationSec: Number(e.target.value) })
                }
                className="w-full studio-slider"
              />
            </div>

            {selectedClip.kind === 'video' && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="space-y-1 block">
                    <span className="text-[10px] text-gray-400 block">{t.clipVideoStartLabel}</span>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, (selectedClip.videoDuration || 10) - 0.5)}
                      step={0.2}
                      value={Number(selectedClip.sourceStartSec.toFixed(1))}
                      onChange={(e) =>
                        onUpdateClip(selectedClip.id, {
                          sourceStartSec: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="w-full rounded bg-[#0E1016] border border-[#262B38] px-2 py-1 text-xs font-mono tabular-nums text-gray-100"
                    />
                  </label>

                  <div className="space-y-1">
                    <span className="text-[10px] text-gray-400 block">{t.clipSpeedLabel}</span>
                    <select
                      value={selectedClip.playbackRate}
                      onChange={(e) =>
                        onUpdateClip(selectedClip.id, { playbackRate: Number(e.target.value) })
                      }
                      className="w-full rounded bg-[#0E1016] border border-[#262B38] px-2 py-1 text-xs font-mono text-gray-100"
                    >
                      {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((spd) => (
                        <option key={spd} value={spd}>
                          {spd}×
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Video Clip Audio & Ducking */}
                <div className="pt-2 border-t border-[#262B38] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-gray-300 flex items-center gap-1.5">
                      {selectedClip.clipAudioMuted ? (
                        <VolumeX className="w-3.5 h-3.5 text-gray-500" aria-hidden="true" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                      )}
                      <span>{t.clipAudioTitle}</span>
                    </span>
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedClip.clipAudioMuted}
                        onChange={(e) =>
                          onUpdateClip(selectedClip.id, {
                            clipAudioMuted: e.target.checked,
                            clipAudioVolume:
                              !e.target.checked && selectedClip.clipAudioVolume === 0
                                ? 0.8
                                : selectedClip.clipAudioVolume,
                          })
                        }
                        className="accent-amber-500 w-3.5 h-3.5 rounded cursor-pointer"
                      />
                      <span>{t.clipMuteLabel}</span>
                    </label>
                  </div>

                  {!selectedClip.clipAudioMuted && (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-gray-400">{t.clipVolumeLabel}</span>
                          <span className="font-mono tabular-nums text-gray-200">
                            {Math.round(selectedClip.clipAudioVolume * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1.5}
                          step={0.05}
                          value={selectedClip.clipAudioVolume}
                          onChange={(e) =>
                            onUpdateClip(selectedClip.id, {
                              clipAudioVolume: Number(e.target.value),
                            })
                          }
                          className="w-full studio-slider"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-gray-400">{t.audioDuckingLabel}</span>
                          <span className="font-mono tabular-nums text-gray-200">
                            {Math.round(config.audioDucking * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={0.9}
                          step={0.05}
                          value={config.audioDucking}
                          onChange={(e) =>
                            onUpdateConfig({ audioDucking: Number(e.target.value) })
                          }
                          className="w-full studio-slider"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Clip Transform & Keyframes */}
            <div className="pt-2 border-t border-[#262B38]">
              <button
                type="button"
                onClick={() => setTransformOpen((v) => !v)}
                className="w-full flex items-center justify-between text-[11px] font-medium text-gray-300 hover:text-white cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Move className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  <span>{t.clipTransformTitle}</span>
                </span>
                {transformOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                )}
              </button>

              {transformOpen && (
                <div className="pt-2.5 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-400">{t.clipScaleStartLabel}</span>
                        <span className="font-mono tabular-nums text-gray-200">
                          {clipTransform.scale.toFixed(2)}×
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.4}
                        max={2.2}
                        step={0.05}
                        value={clipTransform.scale}
                        onChange={(e) => updateSelectedTransform({ scale: Number(e.target.value) })}
                        className="w-full studio-slider"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-400">{t.clipScaleEndLabel}</span>
                        <span className="font-mono tabular-nums text-gray-200">
                          {clipTransform.endScale.toFixed(2)}×
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.4}
                        max={2.2}
                        step={0.05}
                        value={clipTransform.endScale}
                        onChange={(e) =>
                          updateSelectedTransform({ endScale: Number(e.target.value) })
                        }
                        className="w-full studio-slider"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-400">{t.clipOffsetXLabel}</span>
                        <span className="font-mono tabular-nums text-gray-200">
                          {Math.round(clipTransform.offsetX * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-0.45}
                        max={0.45}
                        step={0.02}
                        value={clipTransform.offsetX}
                        onChange={(e) =>
                          updateSelectedTransform({
                            offsetX: Number(e.target.value),
                            endOffsetX: Number(e.target.value),
                          })
                        }
                        className="w-full studio-slider"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-400">{t.clipOffsetYLabel}</span>
                        <span className="font-mono tabular-nums text-gray-200">
                          {Math.round(clipTransform.offsetY * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-0.45}
                        max={0.45}
                        step={0.02}
                        value={clipTransform.offsetY}
                        onChange={(e) =>
                          updateSelectedTransform({
                            offsetY: Number(e.target.value),
                            endOffsetY: Number(e.target.value),
                          })
                        }
                        className="w-full studio-slider"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-400">{t.clipRotationLabel}</span>
                        <span className="font-mono tabular-nums text-gray-200">
                          {clipTransform.rotationDeg}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-45}
                        max={45}
                        step={1}
                        value={clipTransform.rotationDeg}
                        onChange={(e) =>
                          updateSelectedTransform({ rotationDeg: Number(e.target.value) })
                        }
                        className="w-full studio-slider"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-400">{t.clipOpacityLabel}</span>
                        <span className="font-mono tabular-nums text-gray-200">
                          {Math.round(clipTransform.opacity * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={clipTransform.opacity}
                        onChange={(e) =>
                          updateSelectedTransform({ opacity: Number(e.target.value) })
                        }
                        className="w-full studio-slider"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="text-[10px] text-gray-400">{t.clipEasingLabel}</span>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={clipTransform.easing}
                        onChange={(e) =>
                          updateSelectedTransform({ easing: e.target.value as KeyframeEasing })
                        }
                        className="rounded bg-[#0E1016] border border-[#262B38] px-2 py-1 text-[11px] text-gray-100"
                      >
                        <option value="linear">Linear</option>
                        <option value="ease_in_out">Ease In-Out</option>
                        <option value="ease_out">Ease Out</option>
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateClip(selectedClip.id, {
                            transform: { ...DEFAULT_CLIP_TRANSFORM },
                          })
                        }
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#262B38] bg-[#0E1016] hover:border-amber-500/60 text-[11px] text-gray-300 hover:text-amber-300 cursor-pointer transition-colors"
                      >
                        <RotateCcw className="w-2.5 h-2.5" aria-hidden="true" />
                        <span>{t.resetTransformBtn}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {mediaItems.length > 1 && config.slideshowMode === 'custom_durations' && (
              <div className="grid grid-cols-2 gap-2.5 pt-1 border-t border-[#262B38]">
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-400 block">{t.clipTransitionLabel}</span>
                  <select
                    value={selectedClip.transitionOut}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, {
                        transitionOut: e.target.value as SlideTransitionType,
                      })
                    }
                    className="w-full rounded bg-[#0E1016] border border-[#262B38] px-2 py-1 text-[11px] text-gray-100"
                  >
                    <option value="crossfade">{t.transitionCrossfade}</option>
                    <option value="dip_black">{t.transitionDipBlack}</option>
                    <option value="slide">{t.transitionSlide}</option>
                    <option value="cut">{t.transitionCut}</option>
                  </select>
                </div>

                <label className="space-y-1 block">
                  <span className="text-[10px] text-gray-400 block">
                    {t.clipTransDurationLabel}
                  </span>
                  <input
                    type="number"
                    min={0.1}
                    max={2.5}
                    step={0.1}
                    value={Number(selectedClip.transitionDurationSec.toFixed(1))}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, {
                        transitionDurationSec: Math.max(
                          0.1,
                          Math.min(2.5, Number(e.target.value) || 0.6)
                        ),
                      })
                    }
                    className="w-full rounded bg-[#0E1016] border border-[#262B38] px-2 py-1 text-xs font-mono tabular-nums text-gray-100"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {audio?.metadata.embeddedCoverUrl && (
          <button
            type="button"
            onClick={onUseEmbeddedCover}
            className="w-full py-1.5 px-3 rounded-md border border-[#262B38] bg-[#161A24] hover:bg-[#1D2230] text-xs font-medium text-amber-300 transition-colors cursor-pointer"
          >
            {t.useEmbeddedCover}
          </button>
        )}

        {/* Framing & Ken Burns */}
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">{t.framingLabel}</span>
            <div className="inline-flex rounded-md bg-[#141821] p-0.5 border border-[#262B38]">
              {(['cover', 'fit_blur'] as MediaFramingMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onUpdateConfig({ framingMode: mode })}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                    config.framingMode === mode
                      ? 'bg-[#262B38] text-gray-100'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {mode === 'cover' ? t.framingCover : t.framingFitBlur}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer py-0.5">
            <span>{t.kenBurnsLabel}</span>
            <input
              type="checkbox"
              checked={config.kenBurnsMotion}
              onChange={(e) => onUpdateConfig({ kenBurnsMotion: e.target.checked })}
              className="accent-amber-500 w-4 h-4 rounded cursor-pointer"
            />
          </label>
        </div>

        {/* Multi-Clip Timeline Sequencing Mode */}
        {mediaItems.length > 1 && (
          <div className="pt-3 mt-1 border-t border-[#262B38] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span>{t.sequenceSectionTitle}</span>
              </h3>
              {audio && (
                <button
                  type="button"
                  onClick={onFitClipsToAudio}
                  className="text-[11px] font-medium text-amber-400 hover:text-amber-300 cursor-pointer whitespace-nowrap"
                >
                  {t.fitClipsToAudioBtn}
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  { id: 'custom_durations', label: t.slideshowCustom },
                  { id: 'even', label: t.slideshowEven },
                  { id: 'fixed', label: t.slideshowFixed },
                  { id: 'beat_cut', label: t.slideshowBeatCut },
                ] as { id: SlideshowMode; label: string }[]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onUpdateConfig({ slideshowMode: m.id })}
                  className={`py-1.5 px-2 rounded border text-[11px] font-medium cursor-pointer truncate ${
                    config.slideshowMode === m.id
                      ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                      : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {config.slideshowMode === 'fixed' && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-400">{t.slideIntervalLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {config.slideDurationSec.toFixed(1)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={1.5}
                  max={15}
                  step={0.5}
                  value={config.slideDurationSec}
                  onChange={(e) => onUpdateConfig({ slideDurationSec: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>
            )}

            {config.slideshowMode === 'beat_cut' && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-400">{t.minBeatHoldLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {config.minBeatCutSec.toFixed(1)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={0.8}
                  max={6}
                  step={0.2}
                  value={config.minBeatCutSec}
                  onChange={(e) => onUpdateConfig({ minBeatCutSec: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>
            )}

            {config.slideshowMode !== 'custom_durations' && (
              <>
                <div className="space-y-1.5">
                  <span className="text-[11px] text-gray-400 block">{t.transitionTypeLabel}</span>
                  <div className="grid grid-cols-2 gap-1">
                    {(
                      [
                        { id: 'crossfade', label: t.transitionCrossfade },
                        { id: 'dip_black', label: t.transitionDipBlack },
                        { id: 'slide', label: t.transitionSlide },
                        { id: 'cut', label: t.transitionCut },
                      ] as { id: SlideTransitionType; label: string }[]
                    ).map((tr) => (
                      <button
                        key={tr.id}
                        type="button"
                        onClick={() => onUpdateConfig({ transitionType: tr.id })}
                        className={`py-1.5 px-2 rounded border text-[11px] font-medium cursor-pointer truncate ${
                          config.transitionType === tr.id
                            ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                            : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                        }`}
                      >
                        {tr.label}
                      </button>
                    ))}
                  </div>
                </div>

                {config.transitionType !== 'cut' && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-400">{t.transitionDurationLabel}</span>
                      <span className="font-mono tabular-nums text-gray-200">
                        {config.transitionDurationSec.toFixed(2)}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.15}
                      max={2.0}
                      step={0.05}
                      value={config.transitionDurationSec}
                      onChange={(e) =>
                        onUpdateConfig({ transitionDurationSec: Number(e.target.value) })
                      }
                      className="w-full studio-slider"
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* 3. Auto-Trim for Reels / TikTok / Shorts & Fade-Out */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
            <Scissors className="w-4 h-4 text-amber-400" aria-hidden="true" />
            <span>{t.trimSectionTitle}</span>
          </h2>
          <span className="text-[11px] font-mono tabular-nums text-gray-400">
            {formatSec(Math.max(0, config.trimEnd - config.trimStart))}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {trimPresets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectTrimPreset(p.id)}
              className={`px-2 py-1.5 rounded-md text-[11px] font-medium border transition-colors cursor-pointer whitespace-nowrap truncate ${
                config.trimPreset === p.id
                  ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                  : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <label className="block space-y-1">
            <span className="text-[11px] text-gray-400 block">{t.trimStartLabel}</span>
            <input
              type="number"
              min={0}
              max={Math.max(0, config.trimEnd - 1)}
              step={0.5}
              value={Number(config.trimStart.toFixed(1))}
              onChange={(e) => {
                const val = Math.max(0, Math.min(config.trimEnd - 1, Number(e.target.value) || 0));
                onUpdateConfig({ trimStart: val, trimPreset: 'custom' });
              }}
              className="w-full rounded-md bg-[#141821] border border-[#262B38] px-2.5 py-1.5 text-xs font-mono tabular-nums text-gray-100 focus:border-amber-500 focus:outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-gray-400 block">{t.trimEndLabel}</span>
            <input
              type="number"
              min={config.trimStart + 1}
              max={maxDur}
              step={0.5}
              value={Number(config.trimEnd.toFixed(1))}
              onChange={(e) => {
                const raw = Number(e.target.value) || maxDur;
                const val = Math.max(config.trimStart + 1, Math.min(maxDur, raw));
                onUpdateConfig({ trimEnd: val, trimPreset: 'custom' });
              }}
              className="w-full rounded-md bg-[#141821] border border-[#262B38] px-2.5 py-1.5 text-xs font-mono tabular-nums text-gray-100 focus:border-amber-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="space-y-2.5 pt-1">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-gray-400">{t.fadeInLabel}</span>
              <span className="font-mono tabular-nums text-gray-200">{config.fadeInSec.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={0}
              max={4}
              step={0.1}
              value={config.fadeInSec}
              onChange={(e) => onUpdateConfig({ fadeInSec: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-gray-400">{t.fadeOutLabel}</span>
              <span className="font-mono tabular-nums text-gray-200">{config.fadeOutSec.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={0}
              max={6}
              step={0.1}
              value={config.fadeOutSec}
              onChange={(e) => onUpdateConfig({ fadeOutSec: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>
        </div>

        {audio && (
          <button
            type="button"
            onClick={onPreviewFadeOut}
            className="w-full py-2 px-3 rounded-md border border-[#262B38] bg-[#161A24] hover:bg-[#1D2230] text-xs font-medium text-gray-200 transition-colors cursor-pointer"
          >
            {t.testFadeOutBtn}
          </button>
        )}
      </section>

      {/* 4. Subtitles (SRT / VTT) */}
      <section className="p-4 space-y-2.5">
        <button
          type="button"
          onClick={() => setSubsOpen((v) => !v)}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-100 cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Subtitles className="w-4 h-4 text-amber-400" aria-hidden="true" />
            <span>
              {t.subtitlesTitle}
              {config.subtitles.length > 0 ? ` (${config.subtitles.length})` : ''}
            </span>
          </span>
          {subsOpen ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </button>

        {subsOpen && (
          <div className="space-y-2.5 pt-1">
            <input
              ref={srtInputRef}
              type="file"
              accept=".srt,.vtt,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  file.text().then((txt) => {
                    onImportSubtitlesText(txt);
                  });
                }
                e.target.value = '';
              }}
            />

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => srtInputRef.current?.click()}
                className="py-1.5 px-2 rounded border border-[#262B38] bg-[#141821] hover:border-gray-500 text-[11px] font-medium text-gray-200 cursor-pointer truncate"
              >
                {t.importSrtBtn}
              </button>
              <button
                type="button"
                onClick={onAddCueAtPlayhead}
                className="py-1.5 px-2 rounded border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-[11px] font-medium text-amber-300 cursor-pointer truncate"
              >
                {t.addCueAtPlayheadBtn}
              </button>
            </div>

            <textarea
              rows={2}
              value={srtDraft}
              onChange={(e) => setSrtDraft(e.target.value)}
              onBlur={() => {
                if (srtDraft.trim()) {
                  onImportSubtitlesText(srtDraft);
                  setSrtDraft('');
                }
              }}
              placeholder={t.pasteSrtPlaceholder}
              className="w-full rounded bg-[#141821] border border-[#262B38] px-2.5 py-1.5 text-[11px] font-mono text-gray-200 focus:border-amber-500 focus:outline-none"
            />

            <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer">
              <span>{t.showSubtitlesLabel}</span>
              <input
                type="checkbox"
                checked={config.showSubtitles}
                onChange={(e) => onUpdateConfig({ showSubtitles: e.target.checked })}
                className="accent-amber-500 w-4 h-4 rounded cursor-pointer"
              />
            </label>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-400">{t.subtitleSizeLabel}</span>
                <span className="font-mono tabular-nums text-gray-200">
                  {Math.round(config.subtitleSizeScale * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.6}
                max={1.6}
                step={0.05}
                value={config.subtitleSizeScale}
                onChange={(e) => onUpdateConfig({ subtitleSizeScale: Number(e.target.value) })}
                className="w-full studio-slider"
              />
            </div>

            {config.subtitles.length > 0 && (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                {config.subtitles.map((cue) => (
                  <div
                    key={cue.id}
                    className="rounded border border-[#262B38] bg-[#141821] p-1.5 flex items-center gap-1.5"
                  >
                    <span className="text-[10px] font-mono tabular-nums text-amber-400 shrink-0">
                      {cue.startSec.toFixed(1)}s
                    </span>
                    <input
                      type="text"
                      value={cue.text}
                      onChange={(e) => onUpdateSubtitleCue(cue.id, { text: e.target.value })}
                      className="flex-1 min-w-0 bg-transparent text-[11px] text-gray-100 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => onRemoveSubtitleCue(cue.id)}
                      aria-label="Remove subtitle"
                      className="p-0.5 text-gray-500 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onExportSrt}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400 hover:text-amber-300 cursor-pointer"
                  >
                    <Download className="w-3 h-3" aria-hidden="true" />
                    <span>{t.exportSrtBtn}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateConfig({ subtitles: [] })}
                    className="text-[11px] text-rose-400 hover:text-rose-300 cursor-pointer"
                  >
                    {t.clearSubsBtn}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 5. Overlay Layers (Text Badges & PNG Logos) */}
      <section className="p-4 space-y-2.5">
        <button
          type="button"
          onClick={() => setOverlaysOpen((v) => !v)}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-100 cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-400" aria-hidden="true" />
            <span>
              {t.overlaysTitle}
              {config.overlays.length > 0 ? ` (${config.overlays.length})` : ''}
            </span>
          </span>
          {overlaysOpen ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </button>

        {overlaysOpen && (
          <div className="space-y-2.5 pt-1">
            <input
              ref={overlayImgInputRef}
              type="file"
              accept="image/png,image/webp,image/svg+xml,image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onAddImageOverlay(file);
                e.target.value = '';
              }}
            />

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={onAddTextOverlay}
                className="py-1.5 px-2 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[11px] font-medium text-gray-200 cursor-pointer truncate"
              >
                {t.addTextOverlayBtn}
              </button>
              <button
                type="button"
                onClick={() => overlayImgInputRef.current?.click()}
                className="py-1.5 px-2 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[11px] font-medium text-gray-200 cursor-pointer truncate"
              >
                {t.addImageOverlayBtn}
              </button>
            </div>

            {config.overlays.map((ov) => (
              <div
                key={ov.id}
                className="rounded border border-[#262B38] bg-[#141821] p-2 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  {ov.kind === 'text' ? (
                    <input
                      type="text"
                      value={ov.text || ''}
                      onChange={(e) => onUpdateOverlay(ov.id, { text: e.target.value })}
                      className="flex-1 min-w-0 rounded bg-[#0E1016] border border-[#262B38] px-2 py-1 text-xs text-gray-100"
                    />
                  ) : (
                    <span className="text-xs text-gray-200 truncate flex-1">{ov.label}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveOverlay(ov.id)}
                    aria-label="Remove layer"
                    className="p-1 text-gray-400 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-0.5 block">
                    <span className="text-[10px] text-gray-400">X {Math.round(ov.xPct * 100)}%</span>
                    <input
                      type="range"
                      min={0.05}
                      max={0.95}
                      step={0.02}
                      value={ov.xPct}
                      onChange={(e) => onUpdateOverlay(ov.id, { xPct: Number(e.target.value) })}
                      className="w-full studio-slider"
                    />
                  </label>
                  <label className="space-y-0.5 block">
                    <span className="text-[10px] text-gray-400">Y {Math.round(ov.yPct * 100)}%</span>
                    <input
                      type="range"
                      min={0.05}
                      max={0.95}
                      step={0.02}
                      value={ov.yPct}
                      onChange={(e) => onUpdateOverlay(ov.id, { yPct: Number(e.target.value) })}
                      className="w-full studio-slider"
                    />
                  </label>
                  <label className="space-y-0.5 block">
                    <span className="text-[10px] text-gray-400">{ov.scale.toFixed(1)}×</span>
                    <input
                      type="range"
                      min={0.4}
                      max={2.4}
                      step={0.1}
                      value={ov.scale}
                      onChange={(e) => onUpdateOverlay(ov.id, { scale: Number(e.target.value) })}
                      className="w-full studio-slider"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 6. Autosave Maintenance */}
      <section className="p-4">
        <button
          type="button"
          onClick={onResetAutosave}
          className="w-full py-1.5 px-3 rounded-md border border-[#262B38] bg-[#141821] hover:border-rose-500/50 text-[11px] font-medium text-gray-400 hover:text-rose-300 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" aria-hidden="true" />
          <span>{t.resetProjectBtn}</span>
        </button>
      </section>
    </aside>
  );
}
