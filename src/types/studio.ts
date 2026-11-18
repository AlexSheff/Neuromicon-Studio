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
  | 'mandelbrot_zoom'
  | 'space_nebula'
  | 'galaxy_spiral'
  | 'aurora_ribbons'
  | 'blackhole_accretion'
  | 'cosmic_particles'
  | 'cyber_grid_tunnel'
  | 'voronoi_plasma'
  | 'custom_glsl';

export type GeneratorBlendMode = 'backdrop' | 'screen' | 'lighter';

export type OverlayBlendMode = 'screen' | 'lighter' | 'soft-light';

export type BeatSyncMode = 'fit_track' | 'beats_1' | 'beats_2' | 'beats_4' | 'beats_8';

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

export type ExportAspectMode =
  | 'auto'
  | '16:9'
  | '9:16'
  | '4:5'
  | '1:1'
  | '4k_16:9'
  | '4k_9:16'
  | 'custom';

export type MediaFramingMode = 'cover' | 'fit_blur';

export type SlideshowMode = 'custom_durations' | 'even' | 'fixed' | 'beat_cut';

export type SlideTransitionType =
  | 'crossfade'
  | 'zoom_cross'
  | 'wipe_right'
  | 'dip_black'
  | 'slide'
  | 'cut';

export type MediaColorFilter = 'none' | 'bw' | 'warm_film' | 'cool_noir' | 'high_contrast';

export type LutPresetId = 'none' | 'teal_orange' | 'cyber_magenta' | 'vintage_gold' | 'deep_ocean';

export type TrimPresetId = 'full' | 'reels_60' | 'tiktok_60' | 'shorts_57' | 'custom';

export type TextPlacement = 'bottom' | 'center' | 'top';

export type TextAlignMode = 'left' | 'center' | 'right';

export type TextBackdropMode = 'none' | 'accent_line' | 'glass_box';

export type VisualizerPlacement = 'bottom' | 'center' | 'top';

export type InspectorTab = 'clip' | 'effects' | 'generator' | 'typography' | 'export';

export type KeyframeEasing = 'linear' | 'ease_in_out' | 'ease_out';

export interface ClipTransform {
  offsetX: number; // -0.5 .. 0.5 of frame width
  offsetY: number; // -0.5 .. 0.5 of frame height
  scale: number; // 0.3 .. 2.5
  rotationDeg: number; // -180 .. 180
  opacity: number; // 0.1 .. 1.0
  endScale: number; // 0.3 .. 2.5 (keyframe target at end of clip)
  endOffsetX: number; // -0.5 .. 0.5
  endOffsetY: number; // -0.5 .. 0.5
  easing: KeyframeEasing;
}

export interface ClipGeneratorParams {
  speed?: number;
  scale?: number;
  beatReact?: number;
  complexity?: number;
  warp?: number;
  symmetry?: 1 | 2 | 4 | 6 | 8;
  rotationSpeed?: number;
  hueShift?: number;
  glow?: number;
}

export interface ClipOverlayGenerator {
  effect: Exclude<GeneratorEffectId, 'none'>;
  blend: OverlayBlendMode;
  opacity: number; // 0.1 .. 1.0
  params?: ClipGeneratorParams;
}

export interface TimelineGeneratorOverlay {
  id: string;
  generatorId: Exclude<GeneratorEffectId, 'none'>;
  name: string;
  startSec: number; // relative to trimStart (0 .. clipDuration)
  durationSec: number; // >= 0.4
  blend: OverlayBlendMode;
  opacity: number; // 0.1 .. 1.0
  fadeSec: number; // 0 .. 1.5
  params?: ClipGeneratorParams;
}

export interface SubtitleCue {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

export interface OverlayLayer {
  id: string;
  kind: 'text' | 'image';
  label: string;
  text?: string;
  imageUrl?: string;
  imageElement?: HTMLImageElement;
  xPct: number; // 0.05 .. 0.95
  yPct: number; // 0.05 .. 0.95
  scale: number; // 0.4 .. 2.5
  opacity: number; // 0.1 .. 1.0
  color?: string;
  startSec?: number; // undefined => whole video
  durationSec?: number; // undefined => whole video
}

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
  decodedAudioBuffer?: AudioBuffer;
  // Video Editor clip-level timeline properties
  durationSec: number;
  sourceStartSec: number;
  playbackRate: number;
  transitionOut: SlideTransitionType;
  transitionDurationSec: number;
  generatorId?: GeneratorEffectId;
  generatorParams?: ClipGeneratorParams;
  overlayEffect?: ClipOverlayGenerator;
  // Stage 2: Transforms, keyframes & per-clip audio
  transform: ClipTransform;
  clipAudioVolume: number; // 0 .. 1.5
  clipAudioMuted: boolean;
}

export interface StudioConfig {
  // Beat-synced animation settings
  showVisualizer: boolean;
  visualizerColor: string; // 'auto' or hex color
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

  // Generative visual effects (Fractals, Deep Space, Galaxies, Particles, Aurora, Black Hole, Cyber Grid, Voronoi, Custom GLSL)
  generatorEffect: GeneratorEffectId;
  generatorBlend: GeneratorBlendMode;
  generatorOpacity: number;
  generatorSpeed: number;
  generatorScale: number;
  generatorBeatReact: number;
  generatorComplexity: number; // 0.4 .. 2.0
  generatorWarp: number; // 0.0 .. 1.5
  generatorSymmetry: 1 | 2 | 4 | 6 | 8;
  generatorRotationSpeed: number; // -1.5 .. 1.5
  generatorHueShift: number; // -180 .. 180 degrees
  generatorGlow: number; // 0.4 .. 2.2
  customGlslCode: string;
  fxOverlays: TimelineGeneratorOverlay[];

  // Multi-clip sequence & background styling
  slideshowMode: SlideshowMode;
  slideDurationSec: number;
  minBeatCutSec: number;
  transitionType: SlideTransitionType;
  transitionDurationSec: number;
  kenBurnsMotion: boolean;
  framingMode: MediaFramingMode;
  mediaFilter: MediaColorFilter;
  lutPreset: LutPresetId;
  glitchStrength: number; // 0 .. 1.0
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

  // Subtitles & Multi-layer Overlays
  showSubtitles: boolean;
  subtitleSizeScale: number;
  subtitles: SubtitleCue[];
  overlays: OverlayLayer[];

  // Manual Beat Markers & Snapping
  manualBeatMarkers: number[];
  snapToBeats: boolean;

  // Color scheme
  colorSchemeId: ColorSchemeId;
  customTextColor: string;
  customAccentColor: string;

  // Preview helper (never exported)
  showSafeZones: boolean;

  // Export, Audio Mixing & Auto-trim
  aspectMode: ExportAspectMode;
  customWidth: number;
  customHeight: number;
  fps: 30 | 60;
  bitrateMbps: number;
  audioGain: number;
  audioDucking: number; // 0 .. 0.9 reduction on main audio when clip audio plays
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
  etaMs?: number;
  encoderLabel: string;
  outputFormat: 'mp4' | 'webm';
  isNonDeterministicFallback?: boolean;
  batchIndex?: number;
  batchTotal?: number;
  batchLabel?: string;
  outputUrl?: string;
  outputFileName?: string;
  outputSizeBytes?: number;
  streamedToDisk?: boolean;
  errorMessage?: string;
}
