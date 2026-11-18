import {
  Copy,
  Download,
  FileText,
  Layers,
  Move,
  Orbit,
  Palette,
  Play,
  RotateCcw,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { tFor } from '../i18n';
import {
  AudioTrackState,
  BeatPresetId,
  ClipGeneratorParams,
  ClipTransform,
  ExportAspectMode,
  GeneratorBlendMode,
  GeneratorEffectId,
  InspectorTab,
  KeyframeEasing,
  Language,
  LutPresetId,
  MediaColorFilter,
  SlideTransitionType,
  StudioConfig,
  TextAlignMode,
  TextAnimationId,
  TextBackdropMode,
  TextPlacement,
  VisualMediaState,
  VisualizerPlacement,
} from '../types/studio';
import {
  COLOR_SCHEMES,
  DEFAULT_CLIP_TRANSFORM,
  FONT_OPTIONS,
  GENERATOR_EFFECTS,
  STUDIO_MOOD_PRESETS,
} from '../utils/presets';
import { resolveExportDimensions } from '../utils/videoExporter';

interface InspectorPanelProps {
  lang: Language;
  activeTab: InspectorTab;
  audio: AudioTrackState | null;
  mediaItems: VisualMediaState[];
  selectedClipId: string | null;
  config: StudioConfig;
  glslError: string | null;
  onChangeTab: (tab: InspectorTab) => void;
  onSelectClip: (id: string) => void;
  onUpdateClip: (id: string, patch: Partial<VisualMediaState>) => void;
  onDuplicateClip: (id: string) => void;
  onRemoveVisual: (id: string) => void;
  onUpdateConfig: (patch: Partial<StudioConfig>) => void;
  onApplyMoodPreset: (patch: Partial<StudioConfig>) => void;
  onResetGenerator: () => void;
  onCompileCustomGlsl: () => void;
  onStartExport: () => void;
  onStartBatchExport: () => void;
  onDownloadMetadataTxt: () => void;
}

const BEAT_PRESETS: BeatPresetId[] = [
  'spectrum_bars',
  'radial_pulse',
  'horizon_wave',
  'beat_zoom',
  'particle_drift',
  'editorial_frame',
];

const TEXT_ANIMS: TextAnimationId[] = [
  'fade_rise',
  'beat_pop',
  'typewriter',
  'chromatic_shift',
  'kerning_breathe',
  'static',
];

export function InspectorPanel({
  lang,
  activeTab,
  audio,
  mediaItems,
  selectedClipId,
  config,
  glslError,
  onChangeTab,
  onSelectClip,
  onUpdateClip,
  onDuplicateClip,
  onRemoveVisual,
  onUpdateConfig,
  onApplyMoodPreset,
  onResetGenerator,
  onCompileCustomGlsl,
  onStartExport,
  onStartBatchExport,
  onDownloadMetadataTxt,
}: InspectorPanelProps) {
  const t = tFor(lang);
  const dims = resolveExportDimensions(
    config.aspectMode,
    mediaItems,
    config.customWidth,
    config.customHeight
  );
  const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);

  const selectedClip = mediaItems.find((c) => c.id === selectedClipId) || mediaItems[0] || null;
  const clipTransform: ClipTransform = selectedClip?.transform || DEFAULT_CLIP_TRANSFORM;
  const clipGenParams: ClipGeneratorParams = selectedClip?.generatorParams || {};

  const updateSelectedTransform = (patch: Partial<ClipTransform>) => {
    if (!selectedClip) return;
    onUpdateClip(selectedClip.id, {
      transform: { ...clipTransform, ...patch },
    });
  };

  const updateSelectedGenParams = (patch: Partial<ClipGeneratorParams>) => {
    if (!selectedClip) return;
    onUpdateClip(selectedClip.id, {
      generatorParams: { ...clipGenParams, ...patch },
    });
  };

  const colorFilters: { id: MediaColorFilter; label: string }[] = [
    { id: 'none', label: t.filterNone },
    { id: 'bw', label: t.filterBw },
    { id: 'warm_film', label: t.filterWarm },
    { id: 'cool_noir', label: t.filterCool },
    { id: 'high_contrast', label: t.filterContrast },
  ];

  const lutPresets: { id: LutPresetId; label: string }[] = [
    { id: 'none', label: t.lutNone },
    { id: 'teal_orange', label: t.lutTealOrange },
    { id: 'cyber_magenta', label: t.lutCyberMagenta },
    { id: 'vintage_gold', label: t.lutVintageGold },
    { id: 'deep_ocean', label: t.lutDeepOcean },
  ];

  return (
    <aside
      id="inspector-panel"
      className="w-full lg:w-[325px] xl:w-[360px] shrink-0 border-t lg:border-t-0 lg:border-l border-[#262B38] bg-[#10131A] flex flex-col lg:overflow-hidden"
    >
      {/* 5-Tab Bar */}
      <div className="p-1.5 border-b border-[#262B38] bg-[#0E1016] grid grid-cols-5 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onChangeTab('clip')}
          className={`flex flex-col xl:flex-row items-center justify-center gap-1 py-1.5 px-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'clip'
              ? 'bg-[#1D2230] text-amber-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.tabClip}</span>
        </button>
        <button
          type="button"
          onClick={() => onChangeTab('effects')}
          className={`flex flex-col xl:flex-row items-center justify-center gap-1 py-1.5 px-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'effects'
              ? 'bg-[#1D2230] text-amber-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.tabEffects}</span>
        </button>
        <button
          type="button"
          onClick={() => onChangeTab('generator')}
          className={`flex flex-col xl:flex-row items-center justify-center gap-1 py-1.5 px-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'generator'
              ? 'bg-[#1D2230] text-amber-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Orbit className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.tabGenerator}</span>
        </button>
        <button
          type="button"
          onClick={() => onChangeTab('typography')}
          className={`flex flex-col xl:flex-row items-center justify-center gap-1 py-1.5 px-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'typography'
              ? 'bg-[#1D2230] text-amber-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Type className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.tabTypography}</span>
        </button>
        <button
          type="button"
          onClick={() => onChangeTab('export')}
          className={`flex flex-col xl:flex-row items-center justify-center gap-1 py-1.5 px-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'export'
              ? 'bg-[#1D2230] text-amber-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.tabExport}</span>
        </button>
      </div>

      {/* Scrollable Inspector Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {activeTab === 'clip' && (
          <>
            {mediaItems.length > 0 && selectedClip ? (
              <div className="space-y-4">
                {/* Clip Switcher + Quick Actions */}
                <div className="space-y-2 pb-3 border-b border-[#262B38]">
                  <span className="text-[11px] font-semibold text-amber-300 block">
                    {t.selectedClipTitle}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={selectedClip.id}
                      onChange={(e) => onSelectClip(e.target.value)}
                      className="flex-1 min-w-0 rounded-md bg-[#141821] border border-[#262B38] px-2.5 py-1.5 text-xs text-gray-100 focus:border-amber-500 focus:outline-none"
                    >
                      {mediaItems.map((m, idx) => (
                        <option key={m.id} value={m.id}>
                          #{idx + 1} {m.fileName} ({m.durationSec.toFixed(1)}s)
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => onDuplicateClip(selectedClip.id)}
                      title={t.duplicateClipLabel}
                      aria-label={t.duplicateClipLabel}
                      className="p-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-gray-300 hover:text-amber-300 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveVisual(selectedClip.id)}
                      title={t.rippleDeleteBtn}
                      aria-label={t.rippleDeleteBtn}
                      className="p-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-rose-500/60 text-gray-300 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Clip Duration */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-200 font-medium">{t.clipDurationLabel}</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0.5}
                        max={30}
                        step={0.5}
                        value={Number(selectedClip.durationSec.toFixed(1))}
                        onChange={(e) => {
                          const v = Math.max(0.5, Math.min(30, Number(e.target.value) || 0.5));
                          onUpdateClip(selectedClip.id, { durationSec: Number(v.toFixed(1)) });
                        }}
                        className="w-14 rounded bg-[#141821] border border-[#262B38] px-1.5 py-0.5 text-right text-xs font-mono tabular-nums text-amber-300"
                      />
                      <span className="text-[11px] font-mono text-gray-500">s</span>
                    </div>
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
                  <div className="grid grid-cols-5 gap-1">
                    {[2, 4, 5, 8, 12].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => onUpdateClip(selectedClip.id, { durationSec: sec })}
                        className={`py-1 rounded border text-[11px] font-mono tabular-nums cursor-pointer ${
                          Math.abs(selectedClip.durationSec - sec) < 0.05
                            ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                            : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>

                {/* Generator Scene & Per-Clip Shader Overrides */}
                {selectedClip.kind === 'generator' && (
                  <div className="space-y-3 pt-3 border-t border-[#262B38]">
                    <div className="space-y-1">
                      <span className="text-xs font-semibold text-gray-200 block">
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
                        className="w-full rounded-md bg-[#141821] border border-[#262B38] px-2.5 py-1.5 text-xs text-gray-100 focus:border-amber-500 focus:outline-none"
                      >
                        {GENERATOR_EFFECTS.filter((g) => g.id !== 'none').map((g) => (
                          <option key={g.id} value={g.id}>
                            {lang === 'ru' ? g.nameRu : g.nameEn}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2 rounded-lg border border-[#262B38] bg-[#141821] p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-gray-200 flex items-center gap-1.5">
                          <Orbit className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                          <span>{t.clipGenParamsTitle}</span>
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateClip(selectedClip.id, {
                              generatorParams: {
                                speed: config.generatorSpeed,
                                scale: config.generatorScale,
                                beatReact: config.generatorBeatReact,
                                complexity: config.generatorComplexity,
                                warp: config.generatorWarp,
                                symmetry: config.generatorSymmetry,
                                rotationSpeed: config.generatorRotationSpeed,
                                hueShift: config.generatorHueShift,
                                glow: config.generatorGlow,
                              },
                            })
                          }
                          className="py-1 px-2 rounded border border-[#262B38] bg-[#0E1016] hover:border-amber-500/60 text-[10px] font-medium text-amber-300 cursor-pointer truncate"
                        >
                          {t.clipGenCopyGlobal}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateClip(selectedClip.id, { generatorParams: undefined })
                          }
                          className="py-1 px-2 rounded border border-[#262B38] bg-[#0E1016] hover:border-gray-500 text-[10px] font-medium text-gray-400 hover:text-gray-200 cursor-pointer truncate"
                        >
                          {t.clipGenUseGlobal}
                        </button>
                      </div>

                      <div className="grid grid-cols-5 gap-1">
                        {([1, 2, 4, 6, 8] as const).map((sym) => {
                          const curSym = clipGenParams.symmetry ?? config.generatorSymmetry;
                          return (
                            <button
                              key={sym}
                              type="button"
                              onClick={() => updateSelectedGenParams({ symmetry: sym })}
                              className={`py-1 rounded border text-[10px] font-mono tabular-nums cursor-pointer ${
                                curSym === sym
                                  ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                                  : 'border-[#262B38] bg-[#0E1016] text-gray-300'
                              }`}
                            >
                              {sym}×
                            </button>
                          );
                        })}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5 block">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-gray-400">{t.generatorSpeedLabel}</span>
                            <span className="font-mono text-gray-200">
                              {(clipGenParams.speed ?? config.generatorSpeed).toFixed(2)}×
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.2}
                            max={2.5}
                            step={0.05}
                            value={clipGenParams.speed ?? config.generatorSpeed}
                            onChange={(e) =>
                              updateSelectedGenParams({ speed: Number(e.target.value) })
                            }
                            className="w-full studio-slider"
                          />
                        </label>
                        <label className="space-y-0.5 block">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-gray-400">{t.generatorScaleLabel}</span>
                            <span className="font-mono text-gray-200">
                              {(clipGenParams.scale ?? config.generatorScale).toFixed(2)}×
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.5}
                            max={2.0}
                            step={0.05}
                            value={clipGenParams.scale ?? config.generatorScale}
                            onChange={(e) =>
                              updateSelectedGenParams({ scale: Number(e.target.value) })
                            }
                            className="w-full studio-slider"
                          />
                        </label>
                        <label className="space-y-0.5 block">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-gray-400">{t.generatorComplexityLabel}</span>
                            <span className="font-mono text-gray-200">
                              {(clipGenParams.complexity ?? config.generatorComplexity).toFixed(2)}×
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.4}
                            max={2.0}
                            step={0.05}
                            value={clipGenParams.complexity ?? config.generatorComplexity}
                            onChange={(e) =>
                              updateSelectedGenParams({ complexity: Number(e.target.value) })
                            }
                            className="w-full studio-slider"
                          />
                        </label>
                        <label className="space-y-0.5 block">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-gray-400">{t.generatorWarpLabel}</span>
                            <span className="font-mono text-gray-200">
                              {Math.round((clipGenParams.warp ?? config.generatorWarp) * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={1.5}
                            step={0.05}
                            value={clipGenParams.warp ?? config.generatorWarp}
                            onChange={(e) =>
                              updateSelectedGenParams({ warp: Number(e.target.value) })
                            }
                            className="w-full studio-slider"
                          />
                        </label>
                        <label className="space-y-0.5 block">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-gray-400">{t.generatorHueShiftLabel}</span>
                            <span className="font-mono text-gray-200">
                              {clipGenParams.hueShift ?? config.generatorHueShift}°
                            </span>
                          </div>
                          <input
                            type="range"
                            min={-180}
                            max={180}
                            step={5}
                            value={clipGenParams.hueShift ?? config.generatorHueShift}
                            onChange={(e) =>
                              updateSelectedGenParams({ hueShift: Number(e.target.value) })
                            }
                            className="w-full studio-slider"
                          />
                        </label>
                        <label className="space-y-0.5 block">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-gray-400">{t.generatorGlowLabel}</span>
                            <span className="font-mono text-gray-200">
                              {(clipGenParams.glow ?? config.generatorGlow).toFixed(2)}×
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.4}
                            max={2.2}
                            step={0.05}
                            value={clipGenParams.glow ?? config.generatorGlow}
                            onChange={(e) =>
                              updateSelectedGenParams({ glow: Number(e.target.value) })
                            }
                            className="w-full studio-slider"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {/* Video Source Trim & Audio */}
                {selectedClip.kind === 'video' && (
                  <div className="space-y-2.5 pt-3 border-t border-[#262B38]">
                    <div className="grid grid-cols-2 gap-2.5">
                      <label className="space-y-1 block">
                        <span className="text-[10px] text-gray-400 block">
                          {t.clipVideoStartLabel}
                        </span>
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
                          className="w-full rounded bg-[#141821] border border-[#262B38] px-2 py-1 text-xs font-mono tabular-nums text-gray-100"
                        />
                      </label>

                      <div className="space-y-1">
                        <span className="text-[10px] text-gray-400 block">{t.clipSpeedLabel}</span>
                        <select
                          value={selectedClip.playbackRate}
                          onChange={(e) =>
                            onUpdateClip(selectedClip.id, { playbackRate: Number(e.target.value) })
                          }
                          className="w-full rounded bg-[#141821] border border-[#262B38] px-2 py-1 text-xs font-mono text-gray-100"
                        >
                          {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((spd) => (
                            <option key={spd} value={spd}>
                              {spd}×
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="rounded-lg border border-[#262B38] bg-[#141821] p-2.5 space-y-2">
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

                {/* Transform & Keyframes */}
                <div className="pt-3 border-t border-[#262B38] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                      <Move className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                      <span>{t.clipTransformTitle}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateClip(selectedClip.id, {
                          transform: { ...DEFAULT_CLIP_TRANSFORM },
                        })
                      }
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-[10px] text-gray-300 hover:text-amber-300 cursor-pointer transition-colors"
                    >
                      <RotateCcw className="w-2.5 h-2.5" aria-hidden="true" />
                      <span>{t.resetTransformBtn}</span>
                    </button>
                  </div>

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

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-gray-400">{t.clipEasingLabel}</span>
                    <select
                      value={clipTransform.easing}
                      onChange={(e) =>
                        updateSelectedTransform({ easing: e.target.value as KeyframeEasing })
                      }
                      className="rounded bg-[#141821] border border-[#262B38] px-2 py-1 text-[11px] text-gray-100"
                    >
                      <option value="linear">Linear</option>
                      <option value="ease_in_out">Ease In-Out</option>
                      <option value="ease_out">Ease Out</option>
                    </select>
                  </div>
                </div>

                {/* Outgoing Transition */}
                {mediaItems.length > 1 && (
                  <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-[#262B38]">
                    <div className="space-y-1">
                      <span className="text-[10px] text-gray-400 block">
                        {t.clipTransitionLabel}
                      </span>
                      <select
                        value={selectedClip.transitionOut}
                        onChange={(e) =>
                          onUpdateClip(selectedClip.id, {
                            transitionOut: e.target.value as SlideTransitionType,
                          })
                        }
                        className="w-full rounded bg-[#141821] border border-[#262B38] px-2 py-1 text-[11px] text-gray-100"
                      >
                        <option value="crossfade">{t.transitionCrossfade}</option>
                        <option value="zoom_cross">{t.transitionZoomCross}</option>
                        <option value="wipe_right">{t.transitionWipeRight}</option>
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
                        className="w-full rounded bg-[#141821] border border-[#262B38] px-2 py-1 text-xs font-mono tabular-nums text-gray-100"
                      />
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#262B38] bg-[#141821]/60 p-6 text-center space-y-2">
                <SlidersHorizontal className="w-6 h-6 text-amber-400/70 mx-auto" aria-hidden="true" />
                <p className="text-xs text-gray-400 leading-relaxed">{t.noClipSelectedHint}</p>
              </div>
            )}
          </>
        )}

        {activeTab === 'effects' && (
          <>
            <div className="space-y-2 pb-3 border-b border-[#262B38]">
              <label className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span>{t.moodPresetsLabel}</span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {STUDIO_MOOD_PRESETS.map((mood) => (
                  <button
                    key={mood.id}
                    type="button"
                    onClick={() => onApplyMoodPreset(mood.patch)}
                    className="px-2.5 py-2 rounded-md border border-[#262B38] bg-[#141821] hover:border-amber-500/70 hover:bg-amber-500/10 text-left text-[11px] font-medium text-gray-200 transition-colors cursor-pointer truncate"
                  >
                    {lang === 'ru' ? mood.nameRu : mood.nameEn}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-200 block">{t.beatPresetLabel}</label>
              <div className="grid grid-cols-2 gap-2">
                {BEAT_PRESETS.map((id) => {
                  const info = t.presets[id];
                  const active = config.beatPreset === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onUpdateConfig({ beatPreset: id })}
                      className={`p-2.5 rounded-md border text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-amber-500 bg-amber-500/12'
                          : 'border-[#262B38] bg-[#141821] hover:border-gray-500'
                      }`}
                    >
                      <div className="text-xs font-semibold text-gray-100 truncate">{info.name}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5 line-clamp-2 leading-tight">
                        {info.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2.5">
              <span className="text-xs font-semibold text-gray-200 block">
                {t.visualizerPosLabel}
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {(['bottom', 'center', 'top'] as VisualizerPlacement[]).map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => onUpdateConfig({ visualizerPlacement: pos })}
                    className={`py-1.5 px-2 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
                      config.visualizerPlacement === pos
                        ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                        : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                    }`}
                  >
                    {pos === 'bottom' ? t.posBottom : pos === 'center' ? t.posCenter : t.posTop}
                  </button>
                ))}
              </div>

              <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer pt-1">
                <span>{t.mirrorVisualizerLabel}</span>
                <input
                  type="checkbox"
                  checked={config.mirrorVisualizer}
                  onChange={(e) => onUpdateConfig({ mirrorVisualizer: e.target.checked })}
                  className="accent-amber-500 w-4 h-4 rounded cursor-pointer"
                />
              </label>
            </div>

            <div className="space-y-3 pt-1">
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.visualizerWidthLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {Math.round(config.visualizerWidth * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.25}
                  max={1.0}
                  step={0.02}
                  value={config.visualizerWidth}
                  onChange={(e) => onUpdateConfig({ visualizerWidth: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.visualizerThicknessLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {config.visualizerThickness.toFixed(2)}×
                  </span>
                </div>
                <input
                  type="range"
                  min={0.4}
                  max={2.5}
                  step={0.05}
                  value={config.visualizerThickness}
                  onChange={(e) => onUpdateConfig({ visualizerThickness: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.scaleLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {config.visualizerScale.toFixed(2)}×
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.6}
                  step={0.05}
                  value={config.visualizerScale}
                  onChange={(e) => onUpdateConfig({ visualizerScale: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.sensitivityLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {config.beatSensitivity.toFixed(2)}×
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.05}
                  value={config.beatSensitivity}
                  onChange={(e) => onUpdateConfig({ beatSensitivity: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.visualizerSmoothingLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {Math.round(config.visualizerSmoothing * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.15}
                  max={0.85}
                  step={0.05}
                  value={config.visualizerSmoothing}
                  onChange={(e) => onUpdateConfig({ visualizerSmoothing: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.opacityLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {Math.round(config.visualizerOpacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={1.0}
                  step={0.02}
                  value={config.visualizerOpacity}
                  onChange={(e) => onUpdateConfig({ visualizerOpacity: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.bgPulseLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {Math.round(config.backgroundPulse * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.backgroundPulse}
                  onChange={(e) => onUpdateConfig({ backgroundPulse: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>
            </div>

            <div className="space-y-3 pt-3 border-t border-[#262B38]">
              <h3 className="text-xs font-semibold text-gray-200">{t.bgGradingTitle}</h3>

              <div className="space-y-1.5">
                <span className="text-[11px] text-gray-400 block">{t.mediaFilterLabel}</span>
                <div className="grid grid-cols-3 gap-1">
                  {colorFilters.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => onUpdateConfig({ mediaFilter: f.id })}
                      className={`py-1.5 px-1.5 rounded border text-[11px] font-medium cursor-pointer truncate ${
                        config.mediaFilter === f.id
                          ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                          : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.mediaBrightnessLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {Math.round(config.mediaBrightness * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.4}
                  max={1.3}
                  step={0.05}
                  value={config.mediaBrightness}
                  onChange={(e) => onUpdateConfig({ mediaBrightness: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.mediaBlurLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">{config.mediaBlur} px</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={18}
                  step={1}
                  value={config.mediaBlur}
                  onChange={(e) => onUpdateConfig({ mediaBlur: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.vignetteLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {Math.round(config.vignetteAmount * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.vignetteAmount}
                  onChange={(e) => onUpdateConfig({ vignetteAmount: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.scrimLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {Math.round(config.scrimStrength * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={0.9}
                  step={0.05}
                  value={config.scrimStrength}
                  onChange={(e) => onUpdateConfig({ scrimStrength: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] text-gray-400 block">{t.lutPresetLabel}</span>
                <div className="grid grid-cols-3 gap-1">
                  {lutPresets.map((lut) => (
                    <button
                      key={lut.id}
                      type="button"
                      onClick={() => onUpdateConfig({ lutPreset: lut.id })}
                      className={`py-1.5 px-1.5 rounded border text-[11px] font-medium cursor-pointer truncate ${
                        config.lutPreset === lut.id
                          ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                          : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                      }`}
                    >
                      {lut.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.glitchStrengthLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {Math.round(config.glitchStrength * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.glitchStrength}
                  onChange={(e) => onUpdateConfig({ glitchStrength: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>
            </div>
          </>
        )}

        {activeTab === 'generator' && (
          <>
            <div>
              <h3 className="text-xs font-semibold text-gray-100">{t.generatorTitle}</h3>
              <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                {t.generatorSubtitle}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {GENERATOR_EFFECTS.map((eff) => {
                const active = config.generatorEffect === eff.id;
                return (
                  <button
                    key={eff.id}
                    type="button"
                    onClick={() => onUpdateConfig({ generatorEffect: eff.id })}
                    className={`p-2.5 rounded-md border text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-amber-500 bg-amber-500/12'
                        : 'border-[#262B38] bg-[#141821] hover:border-gray-500'
                    }`}
                  >
                    <div className="text-[11px] font-semibold text-gray-100 truncate">
                      {lang === 'ru' ? eff.nameRu : eff.nameEn}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5 line-clamp-2 leading-tight">
                      {lang === 'ru' ? eff.descRu : eff.descEn}
                    </div>
                  </button>
                );
              })}
            </div>

            {config.generatorEffect !== 'none' && (
              <div className="space-y-3.5 pt-2 border-t border-[#262B38]">
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-gray-200 block">
                    {t.generatorModeLabel}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'backdrop', label: t.blendBackdrop },
                        { id: 'screen', label: t.blendScreen },
                        { id: 'lighter', label: t.blendLighter },
                      ] as { id: GeneratorBlendMode; label: string }[]
                    ).map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onUpdateConfig({ generatorBlend: b.id })}
                        className={`py-1.5 px-1.5 rounded-md border text-[11px] font-medium cursor-pointer truncate ${
                          config.generatorBlend === b.id
                            ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                            : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                        }`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-gray-200 block">
                    {t.generatorSymmetryLabel}
                  </span>
                  <div className="grid grid-cols-5 gap-1">
                    {([1, 2, 4, 6, 8] as const).map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => onUpdateConfig({ generatorSymmetry: sym })}
                        className={`py-1.5 rounded border text-[11px] font-mono tabular-nums cursor-pointer ${
                          config.generatorSymmetry === sym
                            ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                            : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                        }`}
                      >
                        {sym}×
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-300">{t.generatorOpacityLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {Math.round(config.generatorOpacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={config.generatorOpacity}
                    onChange={(e) => onUpdateConfig({ generatorOpacity: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-300">{t.generatorSpeedLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {config.generatorSpeed.toFixed(2)}×
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={2.5}
                    step={0.05}
                    value={config.generatorSpeed}
                    onChange={(e) => onUpdateConfig({ generatorSpeed: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-300">{t.generatorScaleLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {config.generatorScale.toFixed(2)}×
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    value={config.generatorScale}
                    onChange={(e) => onUpdateConfig({ generatorScale: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-300">{t.generatorBeatReactLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {config.generatorBeatReact.toFixed(2)}×
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={2.0}
                    step={0.05}
                    value={config.generatorBeatReact}
                    onChange={(e) => onUpdateConfig({ generatorBeatReact: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-300">{t.generatorComplexityLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {config.generatorComplexity.toFixed(2)}×
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.4}
                    max={2.0}
                    step={0.05}
                    value={config.generatorComplexity}
                    onChange={(e) => onUpdateConfig({ generatorComplexity: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-300">{t.generatorWarpLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {Math.round(config.generatorWarp * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={config.generatorWarp}
                    onChange={(e) => onUpdateConfig({ generatorWarp: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-300">{t.generatorRotSpeedLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {config.generatorRotationSpeed >= 0 ? '+' : ''}
                      {config.generatorRotationSpeed.toFixed(2)}×
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-1.5}
                    max={1.5}
                    step={0.05}
                    value={config.generatorRotationSpeed}
                    onChange={(e) =>
                      onUpdateConfig({ generatorRotationSpeed: Number(e.target.value) })
                    }
                    className="w-full studio-slider"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-300">{t.generatorHueShiftLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {config.generatorHueShift > 0 ? '+' : ''}
                      {config.generatorHueShift}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={5}
                    value={config.generatorHueShift}
                    onChange={(e) => onUpdateConfig({ generatorHueShift: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-300">{t.generatorGlowLabel}</span>
                    <span className="font-mono tabular-nums text-gray-200">
                      {config.generatorGlow.toFixed(2)}×
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.4}
                    max={2.2}
                    step={0.05}
                    value={config.generatorGlow}
                    onChange={(e) => onUpdateConfig({ generatorGlow: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>

                <button
                  type="button"
                  onClick={onResetGenerator}
                  className="w-full py-1.5 px-3 rounded-md border border-[#262B38] bg-[#141821] hover:border-amber-500/50 text-[11px] font-medium text-gray-300 hover:text-amber-300 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                  <span>{t.resetGeneratorBtn}</span>
                </button>

                {config.generatorEffect === 'custom_glsl' && (
                  <div className="space-y-2 pt-2 border-t border-[#262B38]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-200">{t.customGlslTitle}</span>
                      <button
                        type="button"
                        onClick={onCompileCustomGlsl}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-[11px] font-semibold text-zinc-950 cursor-pointer transition-colors"
                      >
                        <Play className="w-3 h-3" aria-hidden="true" />
                        <span>{t.compileGlslBtn}</span>
                      </button>
                    </div>
                    <textarea
                      rows={9}
                      spellCheck={false}
                      value={config.customGlslCode}
                      onChange={(e) => onUpdateConfig({ customGlslCode: e.target.value })}
                      className="w-full rounded-md bg-[#0B0D11] border border-[#262B38] p-2.5 text-[11px] leading-relaxed font-mono text-gray-100 focus:border-amber-500 focus:outline-none resize-y"
                    />
                    {glslError ? (
                      <div className="rounded border border-rose-500/50 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-mono text-rose-300 break-words">
                        {glslError}
                      </div>
                    ) : (
                      <div className="text-[11px] text-emerald-400">{t.glslOkNote}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'typography' && (
          <>
            <label className="flex items-center justify-between text-xs font-semibold text-gray-100 cursor-pointer pb-1 border-b border-[#262B38]">
              <span>{t.showTextToggle}</span>
              <input
                type="checkbox"
                checked={config.showText}
                onChange={(e) => onUpdateConfig({ showText: e.target.checked })}
                className="accent-amber-500 w-4 h-4 rounded cursor-pointer"
              />
            </label>

            <div className="space-y-2.5">
              <label className="block space-y-1">
                <span className="text-[11px] text-gray-400 block">{t.trackTitleLabel}</span>
                <input
                  type="text"
                  value={config.titleText}
                  onChange={(e) => onUpdateConfig({ titleText: e.target.value })}
                  className="w-full rounded-md bg-[#141821] border border-[#262B38] px-3 py-1.5 text-xs text-gray-100 focus:border-amber-500 focus:outline-none"
                />
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <label className="block space-y-1">
                  <span className="text-[11px] text-gray-400 block">{t.artistLabel}</span>
                  <input
                    type="text"
                    value={config.artistText}
                    onChange={(e) => onUpdateConfig({ artistText: e.target.value })}
                    className="w-full rounded-md bg-[#141821] border border-[#262B38] px-3 py-1.5 text-xs text-gray-100 focus:border-amber-500 focus:outline-none"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] text-gray-400 block">{t.albumLabel}</span>
                  <input
                    type="text"
                    value={config.albumText}
                    onChange={(e) => onUpdateConfig({ albumText: e.target.value })}
                    className="w-full rounded-md bg-[#141821] border border-[#262B38] px-3 py-1.5 text-xs text-gray-100 focus:border-amber-500 focus:outline-none"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-semibold text-gray-200 block">{t.textAnimLabel}</span>
              <div className="grid grid-cols-2 gap-1.5">
                {TEXT_ANIMS.map((animId) => (
                  <button
                    key={animId}
                    type="button"
                    onClick={() => onUpdateConfig({ textAnimation: animId })}
                    className={`py-1.5 px-2.5 rounded-md border text-left text-[11px] font-medium transition-colors cursor-pointer truncate ${
                      config.textAnimation === animId
                        ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                        : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                    }`}
                  >
                    {t.textAnims[animId]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-semibold text-gray-200 block">{t.fontFamilyLabel}</span>
              <div className="grid grid-cols-2 gap-1.5">
                {FONT_OPTIONS.map((font) => (
                  <button
                    key={font.id}
                    type="button"
                    onClick={() => onUpdateConfig({ fontFamily: font.id })}
                    style={{ fontFamily: `"${font.id}", sans-serif` }}
                    className={`p-2 rounded-md border text-left transition-colors cursor-pointer ${
                      config.fontFamily === font.id
                        ? 'border-amber-500/70 bg-amber-500/15 text-amber-200'
                        : 'border-[#262B38] bg-[#141821] text-gray-200 hover:border-gray-500'
                    }`}
                  >
                    <div className="text-xs font-semibold truncate">{font.label}</div>
                    <div className="text-[10px] text-gray-400 font-sans">
                      {lang === 'ru' ? font.categoryRu : font.categoryEn}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <span className="text-[11px] text-gray-400 block">{t.fontWeightLabel}</span>
                <div className="grid grid-cols-3 gap-1">
                  {([400, 600, 700] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => onUpdateConfig({ fontWeight: w })}
                      className={`py-1 rounded border text-[11px] font-mono tabular-nums cursor-pointer ${
                        config.fontWeight === w
                          ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                          : 'border-[#262B38] bg-[#141821] text-gray-300'
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] text-gray-400 block">{t.textPlacementLabel}</span>
                <div className="grid grid-cols-3 gap-1">
                  {(['bottom', 'center', 'top'] as TextPlacement[]).map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => onUpdateConfig({ textPlacement: pos })}
                      className={`py-1 rounded border text-[11px] cursor-pointer truncate px-1 ${
                        config.textPlacement === pos
                          ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                          : 'border-[#262B38] bg-[#141821] text-gray-300'
                      }`}
                    >
                      {pos === 'bottom' ? t.posBottom : pos === 'center' ? t.posCenter : t.posTop}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <span className="text-[11px] text-gray-400 block">{t.textAlignLabel}</span>
                <div className="grid grid-cols-3 gap-1">
                  {(['left', 'center', 'right'] as TextAlignMode[]).map((al) => (
                    <button
                      key={al}
                      type="button"
                      onClick={() => onUpdateConfig({ textAlign: al })}
                      className={`py-1 rounded border text-[11px] cursor-pointer truncate px-1 ${
                        config.textAlign === al
                          ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                          : 'border-[#262B38] bg-[#141821] text-gray-300'
                      }`}
                    >
                      {al === 'left' ? t.alignLeft : al === 'center' ? t.alignCenter : t.alignRight}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] text-gray-400 block">{t.textBackdropLabel}</span>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      { id: 'none', label: t.backdropNone },
                      { id: 'accent_line', label: t.backdropLine },
                      { id: 'glass_box', label: t.backdropBox },
                    ] as { id: TextBackdropMode; label: string }[]
                  ).map((bd) => (
                    <button
                      key={bd.id}
                      type="button"
                      onClick={() => onUpdateConfig({ textBackdrop: bd.id })}
                      className={`py-1 rounded border text-[11px] cursor-pointer truncate px-1 ${
                        config.textBackdrop === bd.id
                          ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                          : 'border-[#262B38] bg-[#141821] text-gray-300'
                      }`}
                    >
                      {bd.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer">
              <span>{t.textUppercaseLabel}</span>
              <input
                type="checkbox"
                checked={config.textUppercase}
                onChange={(e) => onUpdateConfig({ textUppercase: e.target.checked })}
                className="accent-amber-500 w-4 h-4 rounded cursor-pointer"
              />
            </label>

            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.fontSizeLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {Math.round(config.fontSizeScale * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.65}
                  max={1.45}
                  step={0.05}
                  value={config.fontSizeScale}
                  onChange={(e) => onUpdateConfig({ fontSizeScale: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.letterSpacingLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {config.letterSpacingEm.toFixed(2)}em
                  </span>
                </div>
                <input
                  type="range"
                  min={-0.02}
                  max={0.16}
                  step={0.01}
                  value={config.letterSpacingEm}
                  onChange={(e) => onUpdateConfig({ letterSpacingEm: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">{t.textShadowLabel}</span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {Math.round(config.textShadowStrength * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.textShadowStrength}
                  onChange={(e) => onUpdateConfig({ textShadowStrength: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>
            </div>

            <div className="space-y-2 pt-1 border-t border-[#262B38]">
              <span className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span>{t.colorSchemeLabel}</span>
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {COLOR_SCHEMES.map((scheme) => {
                  const active = config.colorSchemeId === scheme.id;
                  return (
                    <button
                      key={scheme.id}
                      type="button"
                      onClick={() => onUpdateConfig({ colorSchemeId: scheme.id })}
                      className={`p-2 rounded-md border flex items-center gap-2 text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-amber-500/70 bg-amber-500/12'
                          : 'border-[#262B38] bg-[#141821] hover:border-gray-500'
                      }`}
                    >
                      <span
                        className="w-4 h-4 rounded-sm shrink-0 border border-white/15"
                        style={{
                          background: `linear-gradient(135deg, ${scheme.textColor} 45%, ${scheme.accentColor} 55%)`,
                        }}
                      />
                      <span className="text-[11px] font-medium text-gray-200 truncate">
                        {lang === 'ru' ? scheme.nameRu : scheme.nameEn}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <label className="flex items-center justify-between rounded-md border border-[#262B38] bg-[#141821] px-2.5 py-1.5 cursor-pointer">
                  <span className="text-[11px] text-gray-300">{t.customTextColorLabel}</span>
                  <input
                    type="color"
                    value={config.customTextColor}
                    onChange={(e) =>
                      onUpdateConfig({
                        colorSchemeId: 'custom',
                        customTextColor: e.target.value,
                      })
                    }
                    className="w-6 h-5 bg-transparent border-0 cursor-pointer"
                  />
                </label>
                <label className="flex items-center justify-between rounded-md border border-[#262B38] bg-[#141821] px-2.5 py-1.5 cursor-pointer">
                  <span className="text-[11px] text-gray-300">{t.customAccentColorLabel}</span>
                  <input
                    type="color"
                    value={config.customAccentColor}
                    onChange={(e) =>
                      onUpdateConfig({
                        colorSchemeId: 'custom',
                        customAccentColor: e.target.value,
                      })
                    }
                    className="w-6 h-5 bg-transparent border-0 cursor-pointer"
                  />
                </label>
              </div>
            </div>
          </>
        )}

        {activeTab === 'export' && (
          <>
            <div className="space-y-2">
              <span className="text-xs font-semibold text-gray-200 block">{t.aspectModeLabel}</span>
              <div className="space-y-1.5">
                {(
                  [
                    { id: 'auto', tag: dims.aspectLabel, label: `${t.aspectAuto} → ${dims.width}×${dims.height}` },
                    { id: '16:9', tag: '16:9', label: t.aspect169 },
                    { id: '9:16', tag: '9:16', label: t.aspect916 },
                    { id: '4:5', tag: '4:5', label: t.aspect45 },
                    { id: '1:1', tag: '1:1', label: t.aspect11 },
                    { id: '4k_16:9', tag: '4K', label: t.aspect4k169 },
                    { id: '4k_9:16', tag: '4K', label: t.aspect4k916 },
                    { id: 'custom', tag: 'Custom', label: t.aspectCustom },
                  ] as { id: ExportAspectMode; tag: string; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onUpdateConfig({ aspectMode: opt.id })}
                    className={`w-full text-left px-3 py-2 rounded-md border text-xs font-medium transition-colors cursor-pointer flex items-center justify-between ${
                      config.aspectMode === opt.id
                        ? 'border-amber-500 bg-amber-500/12 text-amber-300'
                        : 'border-[#262B38] bg-[#141821] text-gray-300 hover:border-gray-500'
                    }`}
                  >
                    <span className="truncate">{opt.label}</span>
                    <span className="font-mono text-[11px] text-gray-400 shrink-0 ml-2">
                      {opt.tag}
                    </span>
                  </button>
                ))}
              </div>

              {config.aspectMode === 'custom' && (
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <label className="space-y-1 block">
                    <span className="text-[11px] text-gray-400 block">{t.customWidthLabel}</span>
                    <input
                      type="number"
                      min={320}
                      max={4096}
                      step={2}
                      value={config.customWidth}
                      onChange={(e) =>
                        onUpdateConfig({ customWidth: Math.max(320, Number(e.target.value) || 1920) })
                      }
                      className="w-full rounded-md bg-[#141821] border border-[#262B38] px-2.5 py-1.5 text-xs font-mono tabular-nums text-gray-100"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-[11px] text-gray-400 block">{t.customHeightLabel}</span>
                    <input
                      type="number"
                      min={320}
                      max={4096}
                      step={2}
                      value={config.customHeight}
                      onChange={(e) =>
                        onUpdateConfig({ customHeight: Math.max(320, Number(e.target.value) || 1080) })
                      }
                      className="w-full rounded-md bg-[#141821] border border-[#262B38] px-2.5 py-1.5 text-xs font-mono tabular-nums text-gray-100"
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-gray-200 block">{t.fpsLabel}</span>
              <div className="grid grid-cols-2 gap-1.5">
                {([30, 60] as const).map((fps) => (
                  <button
                    key={fps}
                    type="button"
                    onClick={() => onUpdateConfig({ fps })}
                    className={`py-2 rounded-md border text-xs font-mono tabular-nums cursor-pointer ${
                      config.fps === fps
                        ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                        : 'border-[#262B38] bg-[#141821] text-gray-300'
                    }`}
                  >
                    {fps} fps
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-300">{t.bitrateLabel}</span>
                <span className="font-mono tabular-nums text-gray-200">{config.bitrateMbps} Mbps</span>
              </div>
              <input
                type="range"
                min={4}
                max={40}
                step={2}
                value={config.bitrateMbps}
                onChange={(e) => onUpdateConfig({ bitrateMbps: Number(e.target.value) })}
                className="w-full studio-slider"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-300">{t.audioGainLabel}</span>
                <span className="font-mono tabular-nums text-gray-200">
                  {Math.round(config.audioGain * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={config.audioGain}
                onChange={(e) => onUpdateConfig({ audioGain: Number(e.target.value) })}
                className="w-full studio-slider"
              />
            </div>

            <div className="rounded-lg border border-[#262B38] bg-[#141821] divide-y divide-[#262B38] text-xs">
              <div className="px-3 py-2 font-semibold text-gray-200">{t.exportSummaryTitle}</div>
              <div className="px-3 py-2 flex justify-between">
                <span className="text-gray-400">{t.aspectModeLabel}</span>
                <span className="font-mono tabular-nums text-gray-100">
                  {dims.width}×{dims.height} ({dims.aspectLabel})
                </span>
              </div>
              <div className="px-3 py-2 flex justify-between">
                <span className="text-gray-400">{t.trimSectionTitle}</span>
                <span className="font-mono tabular-nums text-gray-100">
                  {clipDuration.toFixed(1)}s ({config.fadeOutSec.toFixed(1)}s fade)
                </span>
              </div>
              <div className="px-3 py-2 flex justify-between">
                <span className="text-gray-400">{t.fpsLabel}</span>
                <span className="font-mono tabular-nums text-gray-100">
                  {config.fps} fps · {config.bitrateMbps} Mbps
                </span>
              </div>
            </div>

            {!audio && <p className="text-xs text-amber-400/90">{t.needAudioAlert}</p>}

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={onStartExport}
                disabled={!audio}
                className="w-full py-2.5 px-4 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-zinc-950 transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>{t.exportVideoBtn}</span>
              </button>

              <button
                type="button"
                onClick={onStartBatchExport}
                disabled={!audio}
                className="w-full py-2 px-4 rounded-md border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-amber-300 transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.batchExportBtn}</span>
              </button>

              <button
                type="button"
                onClick={onDownloadMetadataTxt}
                disabled={!audio}
                className="w-full py-2 px-4 rounded-md border border-[#262B38] bg-[#141821] hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-gray-200 transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
                <span>{t.exportMetaTxtBtn}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
