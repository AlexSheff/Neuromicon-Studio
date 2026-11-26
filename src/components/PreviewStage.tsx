import {
  AlertTriangle,
  AudioWaveform,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Frame,
  Keyboard,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tFor } from '../i18n';
import {
  AudioTrackState,
  BeatPresetId,
  ExportAspectMode,
  Language,
  StudioConfig,
  VisualMediaState,
} from '../types/studio';
import { isCanvasFilterSupported } from '../utils/canvasRenderer';
import { resolveExportDimensions } from '../utils/videoExporter';

interface PreviewStageProps {
  lang: Language;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  audio: AudioTrackState | null;
  mediaItems: VisualMediaState[];
  config: StudioConfig;
  isPlaying: boolean;
  isLooping: boolean;
  currentTime: number;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onResetToTrimStart: () => void;
  onSnapshotPng: () => void;
  onStepFrame: (deltaFrames: -1 | 1) => void;
  onJumpCut: (direction: -1 | 1) => void;
  onSelectBeatPreset: (preset: BeatPresetId) => void;
  onSelectAspectMode: (mode: ExportAspectMode) => void;
  onToggleSafeZones: () => void;
  onLoadDemoBeat: () => void;
}

const BEAT_PRESET_IDS: BeatPresetId[] = [
  'none',
  'spectrum_bars',
  'radial_pulse',
  'horizon_wave',
  'beat_zoom',
  'particle_drift',
  'editorial_frame',
];

const QUICK_ASPECTS: { id: ExportAspectMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '4:5', label: '4:5' },
  { id: '1:1', label: '1:1' },
];

function formatTimecode(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
}

export function PreviewStage({
  lang,
  canvasRef,
  audio,
  mediaItems,
  config,
  isPlaying,
  isLooping,
  currentTime,
  onTogglePlay,
  onToggleLoop,
  onResetToTrimStart,
  onSnapshotPng,
  onStepFrame,
  onJumpCut,
  onSelectBeatPreset,
  onSelectAspectMode,
  onToggleSafeZones,
  onLoadDemoBeat,
}: PreviewStageProps) {
  const t = tFor(lang);
  const [presetDrawerOpen, setPresetDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [presetAnchorRect, setPresetAnchorRect] = useState<DOMRect | null>(null);
  const [shortcutsAnchorRect, setShortcutsAnchorRect] = useState<DOMRect | null>(null);
  const presetBtnRef = useRef<HTMLButtonElement>(null);
  const shortcutsBtnRef = useRef<HTMLButtonElement>(null);

  const stageContainerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 640, h: 360 });
  const filterSupported = useMemo(() => isCanvasFilterSupported(), []);

  const dims = resolveExportDimensions(
    config.aspectMode,
    mediaItems,
    config.customWidth,
    config.customHeight
  );

  // Measure available stage container to fit exact project aspect ratio without any CSS distortion
  useEffect(() => {
    const el = stageContainerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageSize({ w: rect.width, h: rect.height });
      }
    };
    update();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setStageSize({ w: width, h: height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fittedBox = useMemo(() => {
    const padX = 24;
    const padY = 20;
    const availW = Math.max(160, stageSize.w - padX);
    const availH = Math.max(140, stageSize.h - padY);
    const targetAspect = dims.width / Math.max(1, dims.height);

    let boxW = availW;
    let boxH = boxW / targetAspect;
    if (boxH > availH) {
      boxH = availH;
      boxW = boxH * targetAspect;
    }
    return {
      width: Math.max(120, Math.floor(boxW)),
      height: Math.max(120, Math.floor(boxH)),
    };
  }, [dims.height, dims.width, stageSize.h, stageSize.w]);

  const rawClipsTotal = useMemo(
    () => mediaItems.reduce((acc, m) => acc + Math.max(0.5, m.durationSec || 4), 0),
    [mediaItems]
  );

  const clipDuration = audio
    ? Math.max(0.5, config.trimEnd - config.trimStart)
    : mediaItems.length > 0
      ? Math.max(0.5, rawClipsTotal)
      : 12;

  const trimBase = audio ? config.trimStart : 0;
  const localTime = Math.max(0, Math.min(clipDuration, currentTime - trimBase));

  const activePresetMeta = t.presets[config.beatPreset];
  const hasAnythingLoaded =
    Boolean(audio) || mediaItems.length > 0 || config.generatorEffect !== 'none';
  const showOnboarding = !audio && mediaItems.length === 0 && !onboardingDismissed;
  const canPlay = hasAnythingLoaded;

  return (
    <main className="flex-1 min-w-0 lg:min-w-[440px] xl:min-w-[520px] flex flex-col bg-[#090B10] relative overflow-hidden">
      {/* Compact Stage Sub-Toolbar */}
      <div className="px-3 py-2 border-b border-[#262B38] bg-[#0E1016] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <button
            ref={presetBtnRef}
            type="button"
            onClick={() => {
              if (!presetDrawerOpen && presetBtnRef.current) {
                setPresetAnchorRect(presetBtnRef.current.getBoundingClientRect());
              }
              setPresetDrawerOpen((v) => !v);
              setShortcutsOpen(false);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              config.beatPreset === 'none' || config.showVisualizer === false
                ? 'border-[#262B38] bg-[#141821] hover:border-gray-500 text-gray-300'
                : 'border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300'
            }`}
          >
            <AudioWaveform className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{t.beatPresetButton}:</span>
            <span className="text-gray-100">{activePresetMeta.name}</span>
          </button>

          {/* Quick Aspect Switcher */}
          <div className="inline-flex rounded-md bg-[#141821] p-0.5 border border-[#262B38]">
            {QUICK_ASPECTS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelectAspectMode(a.id)}
                className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer ${
                  config.aspectMode === a.id
                    ? 'bg-amber-500/20 text-amber-300 font-semibold'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onToggleSafeZones}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              config.showSafeZones
                ? 'border-amber-500/60 bg-amber-500/12 text-amber-300'
                : 'border-[#262B38] bg-[#141821] hover:border-gray-500 text-gray-300'
            }`}
          >
            <Frame className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden xl:inline">{t.safeZonesButton}</span>
          </button>

          <button
            type="button"
            onClick={onSnapshotPng}
            title={t.snapshotPngBtn}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#262B38] bg-[#141821] hover:border-amber-500/60 text-xs font-medium text-gray-300 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Camera className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden md:inline">{t.snapshotPngBtn}</span>
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0 relative">
          <div className="hidden 2xl:flex items-center gap-1.5 text-[11px] text-gray-400 font-mono tabular-nums">
            <span>
              {dims.width}×{dims.height}
            </span>
            <span>·</span>
            <span>{config.fps}fps</span>
          </div>

          <button
            ref={shortcutsBtnRef}
            type="button"
            onClick={() => {
              if (!shortcutsOpen && shortcutsBtnRef.current) {
                setShortcutsAnchorRect(shortcutsBtnRef.current.getBoundingClientRect());
              }
              setShortcutsOpen((v) => !v);
              setPresetDrawerOpen(false);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              shortcutsOpen
                ? 'border-amber-500/60 bg-amber-500/12 text-amber-300'
                : 'border-[#262B38] bg-[#141821] hover:border-gray-500 text-gray-300'
            }`}
          >
            <Keyboard className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
            <span>{t.shortcutsBtnLabel}</span>
          </button>

          {shortcutsOpen &&
            shortcutsAnchorRect &&
            createPortal(
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShortcutsOpen(false)}
                />
                <div
                  style={{
                    top: Math.min(window.innerHeight - 280, shortcutsAnchorRect.bottom + 8),
                    right: Math.max(12, window.innerWidth - shortcutsAnchorRect.right),
                  }}
                  className="fixed z-50 w-72 rounded-lg border border-[#323849] bg-[#141822] shadow-2xl p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between border-b border-[#262B38] pb-1.5">
                    <span className="text-xs font-semibold text-gray-100">{t.shortcutsTitle}</span>
                    <button
                      type="button"
                      onClick={() => setShortcutsOpen(false)}
                      aria-label={t.closeLabel}
                      className="text-gray-400 hover:text-gray-100 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1 text-[11px] text-gray-300">
                    {[
                      ['Space', lang === 'ru' ? 'Старт / Пауза' : 'Play / Pause'],
                      ['S', lang === 'ru' ? 'Разрезать клип' : 'Split clip at playhead'],
                      ['M', lang === 'ru' ? 'Метка бита' : 'Add beat marker'],
                      ['I / O', lang === 'ru' ? 'Границы обрезки In/Out' : 'Set Trim In / Out'],
                      ['Ctrl+D', lang === 'ru' ? 'Дублировать клип' : 'Duplicate selected clip'],
                      ['Del', lang === 'ru' ? 'Удалить клип' : 'Ripple delete clip'],
                      [', / .', lang === 'ru' ? 'Шаг -1 / +1 кадр' : 'Step -1 / +1 frame'],
                      ['← / →', lang === 'ru' ? 'Перемотка ±0.5с' : 'Seek ±0.5s'],
                      ['Ctrl+Z / Y', lang === 'ru' ? 'Отмена / Повтор' : 'Undo / Redo'],
                    ].map(([keyLabel, desc]) => (
                      <div key={keyLabel} className="flex items-center justify-between gap-2">
                        <span className="text-gray-400">{desc}</span>
                        <kbd className="px-1.5 py-0.5 rounded bg-[#0B0D11] border border-[#262B38] font-mono text-[10px] text-amber-300">
                          {keyLabel}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              </>,
              document.body
            )}
        </div>
      </div>

      {/* Beat Preset Quick Selector Popover (Portal) */}
      {presetDrawerOpen &&
        presetAnchorRect &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPresetDrawerOpen(false)} />
            <div
              style={{
                top: Math.min(window.innerHeight - 280, presetAnchorRect.bottom + 8),
                left: Math.max(12, Math.min(window.innerWidth - 580, presetAnchorRect.left)),
              }}
              className="fixed z-50 w-[min(640px,calc(100vw-24px))] rounded-lg border border-[#323849] bg-[#141822] shadow-2xl p-4"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-100">{t.beatPresetDrawerTitle}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{t.beatPresetDrawerSubtitle}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {config.beatPreset !== 'none' && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectBeatPreset('none');
                        setPresetDrawerOpen(false);
                      }}
                      className="px-2 py-1 rounded-md border border-[#262B38] bg-[#10131A] hover:border-gray-500 text-[11px] font-medium text-gray-300 hover:text-gray-100 cursor-pointer"
                    >
                      {t.disableVisualPresetBtn}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPresetDrawerOpen(false)}
                    className="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-[#1E2330] cursor-pointer"
                    aria-label={t.closeLabel}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                {BEAT_PRESET_IDS.map((id) => {
                  const info = t.presets[id];
                  const isSelected = config.beatPreset === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        onSelectBeatPreset(id);
                        setPresetDrawerOpen(false);
                      }}
                      className={`text-left p-3 rounded-md border transition-colors cursor-pointer ${
                        isSelected
                          ? id === 'none'
                            ? 'border-slate-400 bg-slate-500/15'
                            : 'border-amber-500 bg-amber-500/12'
                          : 'border-[#262B38] bg-[#10131A] hover:border-gray-500'
                      }`}
                    >
                      <div className="text-xs font-semibold text-gray-100">{info.name}</div>
                      <div className="text-[11px] text-gray-400 mt-1 leading-snug">{info.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </>,
          document.body
        )}

      {/* Safari Canvas Filter Warning */}
      {!filterSupported && (
        <div className="px-3 py-1 bg-amber-500/10 border-b border-amber-500/30 text-[11px] text-amber-200 flex items-center gap-2 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.safariFilterWarning}</span>
        </div>
      )}

      {/* Distortion-Free Measured Canvas Stage */}
      <div
        ref={stageContainerRef}
        className="flex-1 min-h-[220px] flex items-center justify-center relative overflow-hidden p-2"
      >
        <div
          className="relative rounded-lg border border-[#262B38] bg-[#050608] overflow-hidden shadow-2xl shrink-0"
          style={{
            width: `${fittedBox.width}px`,
            height: `${fittedBox.height}px`,
          }}
        >
          <canvas ref={canvasRef} className="w-full h-full block" />

          {(!hasAnythingLoaded || showOnboarding) && (
            <div className="absolute inset-0 bg-[#090B10]/82 backdrop-blur-xs flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto">
              <div className="w-full max-w-md rounded-lg border border-[#262B38] bg-[#11151E]/95 p-4 space-y-3 shadow-2xl">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-gray-100">{t.onboardingTitle}</h3>
                  </div>
                  {hasAnythingLoaded && (
                    <button
                      type="button"
                      onClick={() => setOnboardingDismissed(true)}
                      className="text-[11px] text-gray-400 hover:text-gray-200 cursor-pointer"
                    >
                      {t.dismissOnboarding}
                    </button>
                  )}
                </div>

                <ul className="space-y-1.5 text-xs text-gray-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-3.5 h-3.5 shrink-0 ${audio ? 'text-emerald-400' : 'text-gray-600'}`}
                      aria-hidden="true"
                    />
                    <span>{t.onboardingStep1}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-3.5 h-3.5 shrink-0 ${
                        mediaItems.length > 0 || config.generatorEffect !== 'none'
                          ? 'text-emerald-400'
                          : 'text-gray-600'
                      }`}
                      aria-hidden="true"
                    />
                    <span>{t.onboardingStep2}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-amber-400/80" aria-hidden="true" />
                    <span>{t.onboardingStep3}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-gray-600" aria-hidden="true" />
                    <span>{t.onboardingStep4}</span>
                  </li>
                </ul>

                {!audio && (
                  <p className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded px-2.5 py-1.5">
                    {t.onboardingMissingAudio}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onLoadDemoBeat}
                    className="px-3.5 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-xs font-semibold text-zinc-950 transition-colors cursor-pointer"
                  >
                    {t.loadDemoBeat}
                  </button>
                  <div className="inline-flex rounded border border-[#262B38] bg-[#0B0D11] p-0.5">
                    {(['16:9', '9:16', '1:1'] as ExportAspectMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => onSelectAspectMode(mode)}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer ${
                          config.aspectMode === mode
                            ? 'bg-amber-500/20 text-amber-300 font-semibold'
                            : 'text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stage Transport Bar */}
      <div className="px-3 py-2 border-t border-[#262B38] bg-[#0E1016] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!canPlay}
            aria-label={isPlaying ? t.pauseLabel : t.playLabel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1B202C] hover:bg-[#252B3B] disabled:opacity-40 text-xs font-semibold text-gray-100 transition-colors cursor-pointer"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span>{t.pauseLabel}</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span>{t.playLabel}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onResetToTrimStart}
            disabled={!canPlay}
            title={t.stopLabel}
            aria-label={t.stopLabel}
            className="p-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-gray-500 disabled:opacity-40 text-gray-300 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>

          <div className="inline-flex items-center rounded-md border border-[#262B38] bg-[#141821] divide-x divide-[#262B38]">
            <button
              type="button"
              onClick={() => onJumpCut(-1)}
              disabled={!canPlay}
              title={t.prevCutBtn}
              aria-label={t.prevCutBtn}
              className="p-1.5 text-gray-300 hover:text-amber-300 disabled:opacity-35 cursor-pointer"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onStepFrame(-1)}
              disabled={!canPlay}
              title={`${t.stepBackFrameBtn} (,)`}
              aria-label={t.stepBackFrameBtn}
              className="px-1.5 py-1 text-[10px] font-mono text-gray-300 hover:text-amber-300 disabled:opacity-35 cursor-pointer flex items-center"
            >
              <ChevronLeft className="w-3 h-3" />
              <span>1f</span>
            </button>
            <button
              type="button"
              onClick={() => onStepFrame(1)}
              disabled={!canPlay}
              title={`${t.stepFwdFrameBtn} (.)`}
              aria-label={t.stepFwdFrameBtn}
              className="px-1.5 py-1 text-[10px] font-mono text-gray-300 hover:text-amber-300 disabled:opacity-35 cursor-pointer flex items-center"
            >
              <span>1f</span>
              <ChevronRight className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => onJumpCut(1)}
              disabled={!canPlay}
              title={t.nextCutBtn}
              aria-label={t.nextCutBtn}
              className="p-1.5 text-gray-300 hover:text-amber-300 disabled:opacity-35 cursor-pointer"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={onToggleLoop}
            disabled={!canPlay}
            title={t.loopPlaybackLabel}
            aria-label={t.loopPlaybackLabel}
            aria-pressed={isLooping}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-[11px] font-medium disabled:opacity-40 transition-colors cursor-pointer ${
              isLooping
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-[#262B38] bg-[#141821] hover:border-gray-500 text-gray-300'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden xl:inline">{t.loopPlaybackLabel}</span>
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono tabular-nums text-gray-300">
          {mediaItems.length > 0 && (
            <span className="hidden sm:inline text-[11px] text-gray-500">
              {t.seqDurationBadge}: {rawClipsTotal.toFixed(1)}s
            </span>
          )}
          <span>
            <span className="text-amber-300">{formatTimecode(localTime)}</span>
            <span className="text-gray-500 mx-1">/</span>
            <span className="text-gray-400">{formatTimecode(clipDuration)}</span>
          </span>
        </div>
      </div>
    </main>
  );
}
