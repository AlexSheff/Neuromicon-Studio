export type Language = 'ru' | 'en';

export type BeatPresetId =
  | 'spectrum_bars'
  | 'radial_pulse'
  | 'horizon_wave'
  | 'beat_zoom'
  | 'particle_drift'
  | 'editorial_frame';

export type GeneratorEffectId =
  | 'none'
  | 'fractal_julia'
  | 'fractal_kaleido'
  | 'space_nebula'
  | 'galaxy_spiral'
  | 'cosmic_particles';

export type GeneratorBlendMode = 'backdrop' | 'screen' | 'lighter';

export type TextAnimationId =
  | 'fade_rise'
  | 'beat_pop'
  | 'typewriter'
  | 'chromatic_shift'
  | 'kerning_breathe'
  | 'static';

export type FontFamilyId =
  | 'Manrope'
  | 'Montserrat'
  | 'Oswald'
  | 'Cormorant Garamond'
  | 'Playfair Display'
  | 'JetBrains Mono';

export type ColorSchemeId =
  | 'obsidian_amber'
  | 'ivory_crimson'
  | 'cobalt_ice'
  | 'emerald_platinum'
  | 'monochrome_silver'
  | 'warm_copper'
  | 'custom';

export type ExportAspectMode = 'auto' | '16:9' | '9:16' | '4:5' | '1:1';

export type MediaFramingMode = 'cover' | 'fit_blur';

export type SlideshowMode = 'custom_durations' | 'even' | 'fixed' | 'beat_cut';

export type SlideTransitionType = 'crossfade' | 'dip_black' | 'slide' | 'cut';

export type MediaColorFilter = 'none' | 'bw' | 'warm_film' | 'cool_noir' | 'high_contrast';

export type TrimPresetId = 'full' | 'reels_60' | 'tiktok_60' | 'shorts_57' | 'custom';

export type TextPlacement = 'bottom' | 'center' | 'top';

export type TextAlignMode = 'left' | 'center' | 'right';

export type TextBackdropMode = 'none' | 'accent_line' | 'glass_box';

export type VisualizerPlacement = 'bottom' | 'center' | 'top';

export type InspectorTab = 'effects' | 'generator' | 'typography' | 'export';

export interface ColorScheme {
  id: ColorSchemeId;
  nameRu: string;
  nameEn: string;
  textColor: string;
  secondaryTextColor: string;
  accentColor: string;
  visualizerSecondary: string;
  scrimTint: string;
}

export interface AudioTrackState {
  fileName: string;
  fileSize: number;
  buffer: AudioBuffer;
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  waveformPeaks: Float32Array;
  isSyntheticDemo: boolean;
  metadata: {
    title: string;
    artist: string;
    album: string;
    year: string;
    embeddedCoverUrl?: string;
  };
}

export interface VisualMediaState {
  id: string;
  kind: 'image' | 'video' | 'generator';
  fileName: string;
  url: string;
  width: number;
  height: number;
  imageElement?: HTMLImageElement;
  videoElement?: HTMLVideoElement;
  videoDuration?: number;
  // Video Editor clip-level timeline properties
  durationSec: number;
  sourceStartSec: number;
  playbackRate: number;
  transitionOut: SlideTransitionType;
  transitionDurationSec: number;
  generatorId?: GeneratorEffectId;
}

export interface StudioConfig {
  // Beat-synced animation settings
  beatPreset: BeatPresetId;
  beatSensitivity: number;
  visualizerOpacity: number;
  visualizerScale: number;
  visualizerWidth: number;
  visualizerThickness: number;
  visualizerSmoothing: number;
  mirrorVisualizer: boolean;
  visualizerPlacement: VisualizerPlacement;
  backgroundPulse: number;

  // Generative visual effects (Fractals, Deep Space, Galaxies, Particles)
  generatorEffect: GeneratorEffectId;
  generatorBlend: GeneratorBlendMode;
  generatorOpacity: number; // 0.1 - 1.0
  generatorSpeed: number; // 0.2 - 2.5
  generatorScale: number; // 0.5 - 2.0
  generatorBeatReact: number; // 0.0 - 2.0

  // Multi-clip sequence & background styling
  slideshowMode: SlideshowMode;
  slideDurationSec: number;
  minBeatCutSec: number;
  transitionType: SlideTransitionType;
  transitionDurationSec: number;
  kenBurnsMotion: boolean;
  framingMode: MediaFramingMode;
  mediaFilter: MediaColorFilter;
  mediaBrightness: number;
  mediaBlur: number;
  scrimStrength: number;
  vignetteAmount: number;

  // Typography & animated text
  titleText: string;
  artistText: string;
  albumText: string;
  showText: boolean;
  textAnimation: TextAnimationId;
  fontFamily: FontFamilyId;
  fontWeight: 400 | 600 | 700;
  fontSizeScale: number;
  letterSpacingEm: number;
  textPlacement: TextPlacement;
  textAlign: TextAlignMode;
  textUppercase: boolean;
  textBackdrop: TextBackdropMode;
  textShadowStrength: number;

  // Color scheme
  colorSchemeId: ColorSchemeId;
  customTextColor: string;
  customAccentColor: string;

  // Preview helper (never exported)
  showSafeZones: boolean;

  // Export & Auto-trim
  aspectMode: ExportAspectMode;
  fps: 30 | 60;
  bitrateMbps: 8 | 12 | 16;
  audioGain: number;
  trimPreset: TrimPresetId;
  trimStart: number;
  trimEnd: number;
  fadeInSec: number;
  fadeOutSec: number;
}

export interface AudioFrameMetrics {
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  beatPulse: number;
  spectrum: Float32Array;
  waveform: Float32Array;
}

export interface ExportProgressState {
  phase: 'idle' | 'preparing' | 'encoding' | 'muxing' | 'complete' | 'error' | 'cancelled';
  currentFrame: number;
  totalFrames: number;
  elapsedMs: number;
  encoderLabel: string;
  outputFormat: 'mp4' | 'webm';
  outputUrl?: string;
  outputFileName?: string;
  outputSizeBytes?: number;
  errorMessage?: string;
}
