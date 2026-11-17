import { Download, FileText, Orbit, Palette, Sliders, Type } from 'lucide-react';
import { tFor } from '../i18n';
import {
  AudioTrackState,
  BeatPresetId,
  ExportAspectMode,
  GeneratorBlendMode,
  InspectorTab,
  Language,
  MediaColorFilter,
  StudioConfig,
  TextAlignMode,
  TextAnimationId,
  TextBackdropMode,
  TextPlacement,
  VisualMediaState,
  VisualizerPlacement,
} from '../types/studio';
import { COLOR_SCHEMES, FONT_OPTIONS, GENERATOR_EFFECTS } from '../utils/presets';
import { resolveExportDimensions } from '../utils/videoExporter';

interface InspectorPanelProps {
  lang: Language;
  activeTab: InspectorTab;
  audio: AudioTrackState | null;
  mediaItems: VisualMediaState[];
  config: StudioConfig;
  onChangeTab: (tab: InspectorTab) => void;
  onUpdateConfig: (patch: Partial<StudioConfig>) => void;
  onStartExport: () => void;
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
  config,
  onChangeTab,
  onUpdateConfig,
  onStartExport,
  onDownloadMetadataTxt,
}: InspectorPanelProps) {
  const t = tFor(lang);
  const dims = resolveExportDimensions(config.aspectMode, mediaItems);
  const clipDuration = Math.max(0.5, config.trimEnd - config.trimStart);

  const colorFilters: { id: MediaColorFilter; label: string }[] = [
    { id: 'none', label: t.filterNone },
    { id: 'bw', label: t.filterBw },
    { id: 'warm_film', label: t.filterWarm },
    { id: 'cool_noir', label: t.filterCool },
    { id: 'high_contrast', label: t.filterContrast },
  ];

  return (
    <aside
      id="inspector-panel"
      className="w-full lg:w-[350px] xl:w-[385px] shrink-0 border-t lg:border-t-0 lg:border-l border-[#262B38] bg-[#10131A] flex flex-col lg:overflow-hidden"
    >
      {/* 4-Tab Bar */}
      <div className="p-2 border-b border-[#262B38] bg-[#0E1016] grid grid-cols-4 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onChangeTab('effects')}
          className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
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
          className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
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
          className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
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
          className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
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
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {activeTab === 'effects' && (
          <>
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

            <div className="grid grid-cols-1 gap-2">
              {GENERATOR_EFFECTS.map((eff) => {
                const active = config.generatorEffect === eff.id;
                return (
                  <button
                    key={eff.id}
                    type="button"
                    onClick={() => onUpdateConfig({ generatorEffect: eff.id })}
                    className={`p-3 rounded-md border text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-amber-500 bg-amber-500/12'
                        : 'border-[#262B38] bg-[#141821] hover:border-gray-500'
                    }`}
                  >
                    <div className="text-xs font-semibold text-gray-100">
                      {lang === 'ru' ? eff.nameRu : eff.nameEn}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
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
                    { id: 'auto', label: `${t.aspectAuto} → ${dims.width}×${dims.height}` },
                    { id: '16:9', label: t.aspect169 },
                    { id: '9:16', label: t.aspect916 },
                    { id: '4:5', label: t.aspect45 },
                    { id: '1:1', label: t.aspect11 },
                  ] as { id: ExportAspectMode; label: string }[]
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
                      {opt.id === 'auto' ? dims.aspectLabel : opt.id}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
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

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-200 block">{t.bitrateLabel}</span>
                <div className="grid grid-cols-3 gap-1">
                  {([8, 12, 16] as const).map((mbps) => (
                    <button
                      key={mbps}
                      type="button"
                      onClick={() => onUpdateConfig({ bitrateMbps: mbps })}
                      className={`py-2 rounded-md border text-[11px] font-mono tabular-nums cursor-pointer ${
                        config.bitrateMbps === mbps
                          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                          : 'border-[#262B38] bg-[#141821] text-gray-300'
                      }`}
                    >
                      {mbps}M
                    </button>
                  ))}
                </div>
              </div>
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
