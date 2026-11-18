import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Copy,
  Download,
  Film,
  Image as ImageIcon,
  Layers,
  Music,
  Orbit,
  Plus,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Subtitles,
  Trash2,
  Upload,
} from 'lucide-react';
import React, { useRef, useState } from 'react';
import { tFor } from '../i18n';
import {
  AudioTrackState,
  BeatSyncMode,
  GeneratorEffectId,
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
import { GENERATOR_EFFECTS } from '../utils/presets';

type MediaPanelTab = 'media' | 'layers' | 'timing';

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
  onAddGeneratorScene: (
    effect: Exclude<GeneratorEffectId, 'none'>,
    snapshotGlobalParams?: boolean
  ) => void;
  onSelectClip: (id: string) => void;
  onInspectClip: (id: string) => void;
  onDuplicateClip: (id: string) => void;
  onMoveVisual: (index: number, direction: -1 | 1) => void;
  onReverseClips: () => void;
  onRemoveVisual: (id: string) => void;
  onClearVisuals: () => void;
  onFitClipsToAudio: () => void;
  onFitTrimToClips: () => void;
  onAutoBeatSyncClips: (mode?: BeatSyncMode, applyMotionAndTrans?: boolean) => void;
  trackBpm: number;
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
  onInspectClip,
  onDuplicateClip,
  onMoveVisual,
  onReverseClips,
  onRemoveVisual,
  onClearVisuals,
  onFitClipsToAudio,
  onFitTrimToClips,
  onAutoBeatSyncClips,
  trackBpm,
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

  const [panelTab, setPanelTab] = useState<MediaPanelTab>('media');
  const [audioDragOver, setAudioDragOver] = useState(false);
  const [visualDragOver, setVisualDragOver] = useState(false);
  const [genToAdd, setGenToAdd] = useState<Exclude<GeneratorEffectId, 'none'>>('galaxy_spiral');
  const [syncWithMotion, setSyncWithMotion] = useState(true);
  const [srtDraft, setSrtDraft] = useState('');

  const selectedClip = mediaItems.find((c) => c.id === selectedClipId) || mediaItems[0] || null;

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
      className="w-full lg:w-[300px] xl:w-[325px] shrink-0 border-b lg:border-b-0 lg:border-r border-[#262B38] bg-[#10131A] flex flex-col lg:overflow-hidden"
    >
      {/* Left Panel 3-Tab Header */}
      <div className="p-2 border-b border-[#262B38] bg-[#0E1016] grid grid-cols-3 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setPanelTab('media')}
          className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
            panelTab === 'media'
              ? 'bg-[#1D2230] text-amber-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.mediaTabSources}</span>
        </button>
        <button
          type="button"
          onClick={() => setPanelTab('layers')}
          className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
            panelTab === 'layers'
              ? 'bg-[#1D2230] text-amber-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Subtitles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.mediaTabLayers}</span>
        </button>
        <button
          type="button"
          onClick={() => setPanelTab('timing')}
          className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
            panelTab === 'timing'
              ? 'bg-[#1D2230] text-amber-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Scissors className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.mediaTabTiming}</span>
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#262B38]">
        {panelTab === 'media' && (
          <>
            {/* Audio Track */}
            <section className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-gray-100 flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  <span>{t.audioSectionTitle}</span>
                </h2>
                {audio && (
                  <button
                    type="button"
                    onClick={() => audioInputRef.current?.click()}
                    className="text-[11px] font-medium text-amber-400 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap"
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
                  className={`rounded-lg border border-dashed p-3.5 text-center cursor-pointer transition-colors ${
                    audioDragOver
                      ? 'border-amber-400 bg-amber-500/10'
                      : 'border-[#323849] bg-[#141821] hover:border-gray-500'
                  }`}
                >
                  <Upload className="w-4 h-4 mx-auto mb-1.5 text-gray-400" aria-hidden="true" />
                  <p className="text-xs font-medium text-gray-200">
                    {isLoadingAudio ? '...' : t.audioDropTitle}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{t.audioDropHint}</p>
                </div>
              ) : (
                <div className="rounded-lg border border-[#262B38] bg-[#141821] p-2.5 space-y-1">
                  <p className="text-xs font-semibold text-gray-100 truncate" title={audio.fileName}>
                    {audio.fileName}
                  </p>
                  <p className="text-[10px] text-gray-400 font-mono tabular-nums">
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
                className="w-full py-1.5 px-3 rounded-md border border-[#262B38] bg-[#161A24] hover:bg-[#1D2230] text-xs font-medium text-gray-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span>{t.loadDemoBeat}</span>
              </button>
            </section>

            {/* Clip Bin & Generative Scenes */}
            <section className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold text-gray-100 flex items-center gap-1.5 min-w-0">
                  <ImageIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t.visualSectionTitle}</span>
                </h2>
                {mediaItems.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearVisuals}
                    className="text-[11px] text-gray-400 hover:text-rose-400 transition-colors cursor-pointer whitespace-nowrap"
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
                  mediaItems.length > 0 ? 'p-2' : 'p-3.5'
                } ${
                  visualDragOver
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-[#323849] bg-[#141821] hover:border-gray-500'
                }`}
              >
                {mediaItems.length === 0 ? (
                  <>
                    <Upload className="w-4 h-4 mx-auto mb-1.5 text-gray-400" aria-hidden="true" />
                    <p className="text-xs font-medium text-gray-200">{t.visualDropTitle}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{t.visualDropHint}</p>
                  </>
                ) : (
                  <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-gray-300">
                    <Plus className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                    <span>
                      {t.addMoreVisuals} ({mediaItems.length} {t.mediaCountSuffix})
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <select
                    value={genToAdd}
                    onChange={(e) =>
                      setGenToAdd(e.target.value as Exclude<GeneratorEffectId, 'none'>)
                    }
                    aria-label={t.clipGeneratorSceneLabel}
                    className="flex-1 min-w-0 rounded-md bg-[#141821] border border-[#262B38] px-2 py-1.5 text-xs text-gray-100 focus:border-amber-500 focus:outline-none"
                  >
                    {GENERATOR_EFFECTS.filter((g) => g.id !== 'none').map((g) => (
                      <option key={g.id} value={g.id}>
                        {lang === 'ru' ? g.nameRu : g.nameEn}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onAddGeneratorScene(genToAdd)}
                    className="py-1.5 px-2.5 rounded-md border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-xs font-medium text-amber-300 transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Orbit className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{t.addSelectedGenBtn}</span>
                  </button>
                </div>

                {config.generatorEffect !== 'none' && (
                  <button
                    type="button"
                    onClick={() =>
                      onAddGeneratorScene(
                        config.generatorEffect as Exclude<GeneratorEffectId, 'none'>,
                        true
                      )
                    }
                    className="w-full py-1.5 px-2.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-amber-500/50 text-[11px] font-medium text-gray-300 hover:text-amber-300 transition-colors cursor-pointer truncate"
                  >
                    {t.addActiveFxSceneBtn}
                  </button>
                )}

                {audio?.metadata.embeddedCoverUrl && (
                  <button
                    type="button"
                    onClick={onUseEmbeddedCover}
                    className="w-full py-1.5 px-2.5 rounded-md border border-[#262B38] bg-[#161A24] hover:bg-[#1D2230] text-[11px] font-medium text-amber-300 transition-colors cursor-pointer"
                  >
                    {t.useEmbeddedCover}
                  </button>
                )}
              </div>

              {mediaItems.length > 0 && (
                <div className="space-y-1.5 pt-1">
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
                        <span className="text-[10px] font-mono tabular-nums text-gray-500 w-4 text-center shrink-0">
                          {idx + 1}
                        </span>
                        <div className="w-9 h-9 rounded bg-black/50 overflow-hidden shrink-0 border border-[#262B38] flex items-center justify-center">
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
                          <p className="text-[10px] text-gray-400 font-mono tabular-nums flex items-center gap-1 mt-0.5">
                            {item.kind === 'video' && <Film className="w-2.5 h-2.5 text-amber-400" />}
                            <span className="text-amber-300">{item.durationSec.toFixed(1)}s</span>
                            {item.overlayEffect && (
                              <span className="px-1 rounded bg-cyan-500/20 border border-cyan-500/40 text-[9px] text-cyan-200">
                                FX
                              </span>
                            )}
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
                            onClick={() => onInspectClip(item.id)}
                            title={t.inspectClipBtn}
                            aria-label={t.inspectClipBtn}
                            className="p-1 rounded text-gray-400 hover:text-amber-300 cursor-pointer"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                          </button>
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
            </section>
          </>
        )}

        {panelTab === 'layers' && (
          <>
            {/* Subtitles (SRT / VTT) */}
            <section className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-gray-100 flex items-center gap-1.5">
                  <Subtitles className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  <span>
                    {t.subtitlesTitle}
                    {config.subtitles.length > 0 ? ` (${config.subtitles.length})` : ''}
                  </span>
                </h2>
              </div>

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
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
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
            </section>

            {/* Overlay Layers */}
            <section className="p-3.5 space-y-2.5">
              <h2 className="text-xs font-semibold text-gray-100 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span>
                  {t.overlaysTitle}
                  {config.overlays.length > 0 ? ` (${config.overlays.length})` : ''}
                </span>
              </h2>

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
            </section>
          </>
        )}

        {panelTab === 'timing' && (
          <>
            {/* Framing & Motion */}
            <section className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 font-medium">{t.framingLabel}</span>
                <div className="inline-flex rounded-md bg-[#141821] p-0.5 border border-[#262B38]">
                  {(['cover', 'fit_blur'] as MediaFramingMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onUpdateConfig({ framingMode: mode })}
                      className={`px-2 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
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
            </section>

            {/* Timeline Sequencing */}
            <section className="p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  <span>{t.sequenceSectionTitle}</span>
                </h3>
                {mediaItems.length > 0 && (
                  <span className="text-[11px] font-mono tabular-nums text-gray-400">
                    {t.seqDurationBadge}:{' '}
                    {mediaItems.reduce((acc, m) => acc + (m.durationSec || 0), 0).toFixed(1)}s
                  </span>
                )}
              </div>

              {mediaItems.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {audio && (
                    <>
                      <button
                        type="button"
                        onClick={() => onAutoBeatSyncClips('fit_track', syncWithMotion)}
                        title={t.autoBeatSyncHint}
                        className="w-full py-1.5 px-2.5 rounded border border-amber-500/60 bg-amber-500/15 hover:bg-amber-500/25 text-[11px] font-semibold text-amber-300 cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t.autoBeatSyncBtn}</span>
                        {trackBpm > 0 && (
                          <span className="font-mono text-[10px] px-1 py-0.2 rounded bg-[#0B0D11]/80 text-amber-200">
                            {trackBpm} {t.detectedBpmLabel}
                          </span>
                        )}
                      </button>
                      <div className="w-full grid grid-cols-3 gap-1">
                        {(
                          [
                            { id: 'beats_2', label: t.beatSync2Beats },
                            { id: 'beats_4', label: t.beatSync4Beats },
                            { id: 'beats_8', label: t.beatSync8Beats },
                          ] as { id: BeatSyncMode; label: string }[]
                        ).map((bm) => (
                          <button
                            key={bm.id}
                            type="button"
                            onClick={() => onAutoBeatSyncClips(bm.id, syncWithMotion)}
                            className="py-1 px-1.5 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[10px] font-medium text-gray-300 hover:text-amber-300 cursor-pointer truncate"
                          >
                            {bm.label}
                          </button>
                        ))}
                      </div>
                      <label className="w-full flex items-center justify-between text-[11px] text-gray-300 cursor-pointer py-0.5">
                        <span>{t.beatSyncAutoMotion}</span>
                        <input
                          type="checkbox"
                          checked={syncWithMotion}
                          onChange={(e) => setSyncWithMotion(e.target.checked)}
                          className="accent-amber-500 w-3.5 h-3.5 rounded cursor-pointer"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={onFitClipsToAudio}
                        className="flex-1 py-1 px-2 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[11px] font-medium text-amber-400 cursor-pointer whitespace-nowrap"
                      >
                        {t.fitClipsToAudioBtn}
                      </button>
                      <button
                        type="button"
                        onClick={onFitTrimToClips}
                        className="flex-1 py-1 px-2 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[11px] font-medium text-gray-300 hover:text-amber-300 cursor-pointer whitespace-nowrap"
                      >
                        {t.fitTrimToClipsBtn}
                      </button>
                    </>
                  )}
                  {mediaItems.length > 1 && (
                    <button
                      type="button"
                      onClick={onReverseClips}
                      className="inline-flex items-center gap-1 py-1 px-2.5 rounded border border-[#262B38] bg-[#141821] hover:border-gray-500 text-[11px] font-medium text-gray-300 cursor-pointer whitespace-nowrap"
                    >
                      <ArrowLeftRight className="w-3 h-3" aria-hidden="true" />
                      <span>{t.reverseClipsBtn}</span>
                    </button>
                  )}
                </div>
              )}

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
                          { id: 'zoom_cross', label: t.transitionZoomCross },
                          { id: 'wipe_right', label: t.transitionWipeRight },
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
            </section>

            {/* Auto-Trim & Fade Out */}
            <section className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-gray-100 flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  <span>{t.trimSectionTitle}</span>
                </h2>
                <span className="text-[11px] font-mono tabular-nums text-gray-400">
                  {formatSec(Math.max(0, config.trimEnd - config.trimStart))}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1">
                {trimPresets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectTrimPreset(p.id)}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer whitespace-nowrap truncate ${
                      config.trimPreset === p.id
                        ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                        : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <label className="block space-y-1">
                  <span className="text-[11px] text-gray-400 block">{t.trimStartLabel}</span>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, config.trimEnd - 1)}
                    step={0.5}
                    value={Number(config.trimStart.toFixed(1))}
                    onChange={(e) => {
                      const val = Math.max(
                        0,
                        Math.min(config.trimEnd - 1, Number(e.target.value) || 0)
                      );
                      onUpdateConfig({ trimStart: val, trimPreset: 'custom' });
                    }}
                    className="w-full rounded-md bg-[#141821] border border-[#262B38] px-2 py-1 text-xs font-mono tabular-nums text-gray-100 focus:border-amber-500 focus:outline-none"
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
                    className="w-full rounded-md bg-[#141821] border border-[#262B38] px-2 py-1 text-xs font-mono tabular-nums text-gray-100 focus:border-amber-500 focus:outline-none"
                  />
                </label>
              </div>

              <div className="space-y-2">
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-400">{t.fadeInLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {config.fadeInSec.toFixed(1)}s
                    </span>
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
                    <span className="font-mono tabular-nums text-gray-200">
                      {config.fadeOutSec.toFixed(1)}s
                    </span>
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
                  className="w-full py-1.5 px-3 rounded-md border border-[#262B38] bg-[#161A24] hover:bg-[#1D2230] text-xs font-medium text-gray-200 transition-colors cursor-pointer"
                >
                  {t.testFadeOutBtn}
                </button>
              )}
            </section>

            {/* Autosave Maintenance */}
            <section className="p-3.5">
              <button
                type="button"
                onClick={onResetAutosave}
                className="w-full py-1.5 px-3 rounded-md border border-[#262B38] bg-[#141821] hover:border-rose-500/50 text-[11px] font-medium text-gray-400 hover:text-rose-300 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" aria-hidden="true" />
                <span>{t.resetProjectBtn}</span>
              </button>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
