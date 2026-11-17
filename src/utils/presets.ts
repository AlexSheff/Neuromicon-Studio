import { ColorScheme, ColorSchemeId, FontFamilyId, GeneratorEffectId, StudioConfig } from '../types/studio';

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

export const FONT_OPTIONS: { id: FontFamilyId; label: string; categoryRu: string; categoryEn: string }[] = [
  { id: 'Manrope', label: 'Manrope', categoryRu: 'Нео-гротеск', categoryEn: 'Neo-Grotesk' },
  { id: 'Montserrat', label: 'Montserrat', categoryRu: 'Геометрический', categoryEn: 'Geometric' },
  { id: 'Oswald', label: 'Oswald', categoryRu: 'Узкий акцентный', categoryEn: 'Condensed' },
  { id: 'Cormorant Garamond', label: 'Cormorant Garamond', categoryRu: 'Антиква', categoryEn: 'Editorial Serif' },
  { id: 'Playfair Display', label: 'Playfair Display', categoryRu: 'Контрастный сериф', categoryEn: 'Display Serif' },
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
    nameRu: 'Фрактал-калейдоскоп',
    nameEn: 'Fractal Kaleidoscope',
    descRu: 'Симметричная геометрия и лучевые отражения',
    descEn: 'Symmetric IFS mandala with beat reflections',
  },
  {
    id: 'space_nebula',
    nameRu: 'Космическая туманность',
    nameEn: 'Deep Space Nebula',
    descRu: 'Объёмные облака туманности и звёздная глубина',
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
    id: 'cosmic_particles',
    nameRu: 'Гиперпоток частиц',
    nameEn: 'Cosmic Particle Warp',
    descRu: '3D-туннель звёзд и частиц с ускорением под бит',
    descEn: '3D star & energy particle warp synced to kick',
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

  slideshowMode: 'custom_durations',
  slideDurationSec: 4.0,
  minBeatCutSec: 2.0,
  transitionType: 'crossfade',
  transitionDurationSec: 0.65,
  kenBurnsMotion: true,
  framingMode: 'cover',
  mediaFilter: 'none',
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

  colorSchemeId: 'obsidian_amber',
  customTextColor: '#F9FAFB',
  customAccentColor: '#F59E0B',

  showSafeZones: false,

  aspectMode: 'auto',
  fps: 30,
  bitrateMbps: 12,
  audioGain: 1.0,
  trimPreset: 'full',
  trimStart: 0,
  trimEnd: 24,
  fadeInSec: 0.8,
  fadeOutSec: 3.0,
};
