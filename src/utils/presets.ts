import {
  ClipTransform,
  ColorScheme,
  ColorSchemeId,
  FontFamilyId,
  GeneratorEffectId,
  StudioConfig,
} from '../types/studio';

export const DEFAULT_CLIP_TRANSFORM: ClipTransform = {
  offsetX: 0,
  offsetY: 0,
  scale: 1.0,
  rotationDeg: 0,
  opacity: 1.0,
  endScale: 1.0,
  endOffsetX: 0,
  endOffsetY: 0,
  easing: 'ease_in_out',
};

export const DEFAULT_CUSTOM_GLSL = `// Custom GLSL fragment helper — use uv, uTime, uBass, uMid, uTreble, uBeat, uScale, uAccent, uSecondary
vec3 renderCustom(vec2 uv) {
  float r = length(uv * uScale);
  float a = atan(uv.y, uv.x);
  float wave = sin(r * 10.0 - uTime * 2.5 + sin(a * 4.0 + uTime) * (1.2 + uBass * 2.0));
  float ring = smoothstep(0.35, 0.0, abs(wave));
  vec3 bg = vec3(0.015, 0.02, 0.035);
  vec3 col = mix(bg, uAccent, ring * (0.65 + uBeat * 0.6));
  col += uSecondary * exp(-r * 2.2) * (0.35 + uTreble * 0.65);
  return col;
}`;

export const COLOR_SCHEMES: ColorScheme[] = [
  {
    id: 'obsidian_amber',
    nameRu: 'Графит и янтарь',
    nameEn: 'Obsidian & Amber',
    textColor: '#F9FAFB',
    secondaryTextColor: '#D1D5DB',
    accentColor: '#F59E0B',
    visualizerSecondary: '#FDE68A',
    scrimTint: '#090B10',
  },
  {
    id: 'ivory_crimson',
    nameRu: 'Слоновая кость и кармин',
    nameEn: 'Ivory & Crimson',
    textColor: '#FAF8F5',
    secondaryTextColor: '#E5E0D8',
    accentColor: '#E11D48',
    visualizerSecondary: '#FDA4AF',
    scrimTint: '#0D080A',
  },
  {
    id: 'cobalt_ice',
    nameRu: 'Кобальт и лёд',
    nameEn: 'Cobalt & Ice',
    textColor: '#F8FAFC',
    secondaryTextColor: '#CBD5E1',
    accentColor: '#38BDF8',
    visualizerSecondary: '#BAE6FD',
    scrimTint: '#070B12',
  },
  {
    id: 'emerald_platinum',
    nameRu: 'Изумруд и платина',
    nameEn: 'Emerald & Platinum',
    textColor: '#F3F4F6',
    secondaryTextColor: '#CBD5E1',
    accentColor: '#10B981',
    visualizerSecondary: '#A7F3D0',
    scrimTint: '#060D0B',
  },
  {
    id: 'monochrome_silver',
    nameRu: 'Монохромное серебро',
    nameEn: 'Monochrome Silver',
    textColor: '#FFFFFF',
    secondaryTextColor: '#D4D4D8',
    accentColor: '#E4E4E7',
    visualizerSecondary: '#A1A1AA',
    scrimTint: '#09090B',
  },
  {
    id: 'warm_copper',
    nameRu: 'Тёплая медь',
    nameEn: 'Warm Copper',
    textColor: '#FFFBEB',
    secondaryTextColor: '#E7E5E4',
    accentColor: '#EA580C',
    visualizerSecondary: '#FDBA74',
    scrimTint: '#110A07',
  },
];

export const FONT_OPTIONS: {
  id: FontFamilyId;
  label: string;
  categoryRu: string;
  categoryEn: string;
}[] = [
  { id: 'Manrope', label: 'Manrope', categoryRu: 'Нео-гротеск', categoryEn: 'Neo-Grotesk' },
  { id: 'Montserrat', label: 'Montserrat', categoryRu: 'Геометрический', categoryEn: 'Geometric' },
  { id: 'Oswald', label: 'Oswald', categoryRu: 'Узкий акцентный', categoryEn: 'Condensed' },
  {
    id: 'Cormorant Garamond',
    label: 'Cormorant Garamond',
    categoryRu: 'Антиква',
    categoryEn: 'Editorial Serif',
  },
  {
    id: 'Playfair Display',
    label: 'Playfair Display',
    categoryRu: 'Контрастный сериф',
    categoryEn: 'Display Serif',
  },
  { id: 'JetBrains Mono', label: 'JetBrains Mono', categoryRu: 'Моноширинный', categoryEn: 'Monospace' },
];

export const GENERATOR_EFFECTS: {
  id: GeneratorEffectId;
  nameRu: string;
  nameEn: string;
  descRu: string;
  descEn: string;
}[] = [
  {
    id: 'none',
    nameRu: 'Выключено',
    nameEn: 'Disabled',
    descRu: 'Только загруженные медиа и визуализатор',
    descEn: 'Use uploaded media and visualizer only',
  },
  {
    id: 'fractal_julia',
    nameRu: 'Фрактал Жюлиа',
    nameEn: 'Julia Fractal',
    descRu: 'Живая комплексная орбита, дышащая под бас',
    descEn: 'Morphing complex-plane fractal driven by bass',
  },
  {
    id: 'fractal_kaleido',
    nameRu: 'Калейдоскоп IFS',
    nameEn: 'Fractal Kaleidoscope',
    descRu: 'Симметричная геометрия и лучевые отражения',
    descEn: 'Symmetric IFS mandala with beat reflections',
  },
  {
    id: 'mandelbrot_zoom',
    nameRu: 'Зум Мандельброта',
    nameEn: 'Mandelbrot Orbit',
    descRu: 'Бесконечное погружение в градиентные спирали',
    descEn: 'Continuous logarithmic fractal zoom with harmonic bands',
  },
  {
    id: 'space_nebula',
    nameRu: 'Туманность космоса',
    nameEn: 'Deep Space Nebula',
    descRu: 'Объёмные облака пыли и звёздная глубина',
    descEn: 'Volumetric cosmic dust clouds & deep starfield',
  },
  {
    id: 'galaxy_spiral',
    nameRu: 'Спиральная галактика',
    nameEn: 'Spiral Galaxy',
    descRu: 'Вращающиеся рукава галактики и яркое ядро',
    descEn: 'Rotating logarithmic spiral arms & glowing core',
  },
  {
    id: 'aurora_ribbons',
    nameRu: 'Северное сияние',
    nameEn: 'Solar Aurora',
    descRu: 'Переливающиеся ленты магнитной плазмы',
    descEn: 'Flowing volumetric solar plasma ribbons & stars',
  },
  {
    id: 'blackhole_accretion',
    nameRu: 'Чёрная дыра',
    nameEn: 'Event Horizon',
    descRu: 'Гравитационное линзирование и аккреционный диск',
    descEn: 'Gravitational lensing ring & swirling accretion disk',
  },
  {
    id: 'cosmic_particles',
    nameRu: 'Гиперпоток частиц',
    nameEn: 'Cosmic Particle Warp',
    descRu: '3D-туннель звёзд и частиц с ускорением под бит',
    descEn: '3D star & energy particle warp synced to kick',
  },
  {
    id: 'cyber_grid_tunnel',
    nameRu: 'Кибер-сетка неон',
    nameEn: 'Synthwave Cyber Grid',
    descRu: 'Бесконечный ретро-туннель и неоновый горизонт',
    descEn: 'Infinite perspective neon horizon & geometric tunnel',
  },
  {
    id: 'voronoi_plasma',
    nameRu: 'Плазма Вороного',
    nameEn: 'Voronoi Bio-Plasma',
    descRu: 'Кристаллическая клеточная мембрана под ритм',
    descEn: 'Liquid crystalline cellular energy rippling on beats',
  },
  {
    id: 'custom_glsl',
    nameRu: 'Свой GLSL-шейдер',
    nameEn: 'Custom GLSL Sandbox',
    descRu: 'Редактируемый фрагментный шейдер с компиляцией',
    descEn: 'Live fragment shader sandbox with diagnostics',
  },
];

export interface StudioMoodPreset {
  id: string;
  nameRu: string;
  nameEn: string;
  patch: Partial<StudioConfig>;
}

export const STUDIO_MOOD_PRESETS: StudioMoodPreset[] = [
  {
    id: 'deep_cosmos',
    nameRu: 'Глубокий космос',
    nameEn: 'Deep Cosmos',
    patch: {
      beatPreset: 'radial_pulse',
      generatorEffect: 'blackhole_accretion',
      generatorBlend: 'backdrop',
      generatorOpacity: 0.92,
      generatorSymmetry: 1,
      generatorHueShift: 0,
      colorSchemeId: 'obsidian_amber',
      lutPreset: 'deep_ocean',
      glitchStrength: 0.1,
      textAnimation: 'fade_rise',
    },
  },
  {
    id: 'neon_synth',
    nameRu: 'Кибер-синтвейв',
    nameEn: 'Neon Synthwave',
    patch: {
      beatPreset: 'spectrum_bars',
      generatorEffect: 'cyber_grid_tunnel',
      generatorBlend: 'screen',
      generatorOpacity: 0.85,
      generatorSymmetry: 1,
      generatorHueShift: 25,
      colorSchemeId: 'cobalt_ice',
      lutPreset: 'cyber_magenta',
      glitchStrength: 0.45,
      textAnimation: 'chromatic_shift',
    },
  },
  {
    id: 'mandala_trance',
    nameRu: 'Фрактал-мандала',
    nameEn: 'Fractal Mandala',
    patch: {
      beatPreset: 'particle_drift',
      generatorEffect: 'fractal_kaleido',
      generatorBlend: 'lighter',
      generatorOpacity: 0.88,
      generatorSymmetry: 6,
      generatorRotationSpeed: 0.35,
      colorSchemeId: 'emerald_platinum',
      lutPreset: 'teal_orange',
      glitchStrength: 0.15,
      textAnimation: 'beat_pop',
    },
  },
  {
    id: 'editorial_noir',
    nameRu: 'Минимал Нуар',
    nameEn: 'Editorial Noir',
    patch: {
      beatPreset: 'editorial_frame',
      generatorEffect: 'aurora_ribbons',
      generatorBlend: 'backdrop',
      generatorOpacity: 0.65,
      generatorSymmetry: 1,
      colorSchemeId: 'monochrome_silver',
      lutPreset: 'vintage_gold',
      glitchStrength: 0,
      textAnimation: 'kerning_breathe',
    },
  },
];

export function resolveColorScheme(
  id: ColorSchemeId,
  customTextColor: string,
  customAccentColor: string
): ColorScheme {
  if (id === 'custom') {
    return {
      id: 'custom',
      nameRu: 'Своя палитра',
      nameEn: 'Custom Palette',
      textColor: customTextColor,
      secondaryTextColor: customTextColor,
      accentColor: customAccentColor,
      visualizerSecondary: customTextColor,
      scrimTint: '#090B10',
    };
  }
  return COLOR_SCHEMES.find((s) => s.id === id) || COLOR_SCHEMES[0];
}

export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  beatPreset: 'spectrum_bars',
  beatSensitivity: 1.15,
  visualizerOpacity: 0.88,
  visualizerScale: 1.0,
  visualizerWidth: 0.8,
  visualizerThickness: 1.0,
  visualizerSmoothing: 0.45,
  mirrorVisualizer: false,
  visualizerPlacement: 'bottom',
  backgroundPulse: 0.45,

  generatorEffect: 'space_nebula',
  generatorBlend: 'screen',
  generatorOpacity: 0.72,
  generatorSpeed: 1.0,
  generatorScale: 1.0,
  generatorBeatReact: 1.0,
  generatorComplexity: 1.0,
  generatorWarp: 0.35,
  generatorSymmetry: 1,
  generatorRotationSpeed: 0.15,
  generatorHueShift: 0,
  generatorGlow: 1.1,
  customGlslCode: DEFAULT_CUSTOM_GLSL,

  slideshowMode: 'custom_durations',
  slideDurationSec: 4.0,
  minBeatCutSec: 2.0,
  transitionType: 'crossfade',
  transitionDurationSec: 0.65,
  kenBurnsMotion: true,
  framingMode: 'cover',
  mediaFilter: 'none',
  lutPreset: 'none',
  glitchStrength: 0,
  mediaBrightness: 1.0,
  mediaBlur: 0,
  scrimStrength: 0.52,
  vignetteAmount: 0.35,

  titleText: 'Midnight Resonance',
  artistText: 'Neuromicon',
  albumText: 'Studio Master · 2026',
  showText: true,
  textAnimation: 'fade_rise',
  fontFamily: 'Manrope',
  fontWeight: 700,
  fontSizeScale: 1.0,
  letterSpacingEm: 0.02,
  textPlacement: 'bottom',
  textAlign: 'center',
  textUppercase: false,
  textBackdrop: 'none',
  textShadowStrength: 0.75,

  showSubtitles: true,
  subtitleSizeScale: 1.0,
  subtitles: [],
  overlays: [],

  manualBeatMarkers: [],
  snapToBeats: true,

  colorSchemeId: 'obsidian_amber',
  customTextColor: '#F9FAFB',
  customAccentColor: '#F59E0B',

  showSafeZones: false,

  aspectMode: 'auto',
  customWidth: 1920,
  customHeight: 1080,
  fps: 30,
  bitrateMbps: 12,
  audioGain: 1.0,
  audioDucking: 0.45,
  trimPreset: 'full',
  trimStart: 0,
  trimEnd: 24,
  fadeInSec: 0.8,
  fadeOutSec: 3.0,
};
