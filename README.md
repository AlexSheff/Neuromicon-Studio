# Neuromicon Studio

**Neuromicon Studio** is a browser-based audio-reactive video editor and music visualizer. Combine audio tracks with multiple images, video clips, and real-time WebGL2 generative scenes (fractals, particle fields, deep-space nebulae, and spiral galaxies), overlay beat-synced animations and animated typography, and export high-resolution videos directly in your browser without uploading media to any server.

## Features

### Multi-Clip Video & Timeline Editor
- **Dual-Track Timeline**: Interactive **Clips** track (proportional clip blocks, thumbnails, playhead tracking, click-to-jump) stacked above a scrubbable **Audio** waveform track showing trim bounds and fade-out curves.
- **Per-Clip Controls**: Edit individual clip duration (`0.5s – 30s`), video trim-in start time, playback speed (`0.5× – 2.0×`), reorder clips, duplicate clips, or click **Fit Clips to Audio** to distribute clips evenly across the selected audio region.
- **Sequencing & Transitions**: Choose between **Per-Clip**, **Even Split**, **Interval**, or **Beat Cut** (automatic cuts synced to low-frequency energy peaks) with **Crossfade**, **Dip Black**, **Slide**, or **Hard Cut** transitions.
- **Framing & Optics**: Switch between **Zoom to Fill** and **Fit + Blur Backdrop**, toggle **Slow Ken Burns Drift**, and adjust color filters (`Natural`, `Mono B&W`, `Warm Film`, `Cool Noir`, `Punch`), brightness, blur, vignette, and contrast scrim.

### Procedural Visual Generators (WebGL2 + 2D Fallback)
Add generative scenes directly onto the timeline as clips or layer them globally as a **Backdrop**, **Screen**, or **Additive Glow** overlay:
- **Julia Fractal** — Morphing complex-plane fractal driven by bass energy
- **Fractal Kaleidoscope** — Symmetric IFS geometry with beat-reactive reflections
- **Deep Space Nebula** — Volumetric cosmic dust clouds and multi-layer starfield
- **Spiral Galaxy** — Rotating logarithmic spiral arms with a glowing core
- **Cosmic Particle Warp** — 3D star and particle tunnel accelerated by kick impacts

Includes controls for opacity/intensity, motion speed, scale/detail, and beat reactivity.

### Beat-Synced Visualizers
6 real-time FFT spectrum and waveform presets powered by a local Radix-2 FFT analyzer:
- **Spectrum Bars**
- **Radial Pulse**
- **Horizon Wave**
- **Beat Pulse Zoom**
- **Reactive Particles**
- **Editorial Frame**

Customize visualizer width, bar/line thickness, height/scale, smoothing, opacity, mirror symmetry, vertical placement (`Bottom`, `Center`, `Top`), sensitivity, and background beat pulse.

### Real-Time Animated Typography
- **6 Bundled Cyrillic + Latin Fonts** (offline via `@fontsource`, zero CDN requests): *Manrope*, *Montserrat*, *Oswald*, *Cormorant Garamond*, *Playfair Display*, and *JetBrains Mono*.
- **6 Text Animations**: *Smooth Fade & Rise*, *Beat Kinetic Pulse*, *Typewriter Reveal*, *Chromatic Shift*, *Kerning Breathe*, and *Static Crisp*.
- **Full Styling**: Live editing of track title (with automatic ID3v2 tag & embedded cover extraction for MP3 files), artist, subtitle, font weight (`400`/`600`/`700`), size, letter spacing, alignment, backdrop (`None`, `Rule Line`, `Soft Box`), shadow strength, 6 curated palettes, and custom color pickers.

### Social Media Auto-Trim & High-Res Export
- **One-Click Social Presets**: **Full**, **Instagram Reels (60s)**, **TikTok (60s)**, **YouTube Shorts (57s)**, and **Custom** ranges with smooth cosine **Fade In** and **Fade Out** plus a **Reels/TikTok Safe Area** overlay toggle.
- **Aspect Ratios**: `Auto` (detects landscape or vertical from primary media), `16:9` (`1920×1080`), `9:16` (`1080×1920`), `4:5` (`1080×1350`), and `1:1` (`1080×1080`) at `30` or `60 fps` (`8 / 12 / 16 Mbps`).
- **Local Export Pipeline**: Uses deterministic offline **WebCodecs** (`VideoEncoder` + `AudioEncoder`) muxed via `mp4-muxer` (H.264/AAC `.mp4`) or `webm-muxer` (VP9/VP8 + Opus `.webm`), with automatic fallback to `MediaRecorder`. Also exports a formatted track description `.txt` for social captions.
- **Bilingual Interface**: Instant **RU / EN** language toggle and built-in Web Audio synth demo track (`Midnight Resonance`, 122 BPM) for testing without external files.

## Architecture & Privacy

- **100% Client-Side**: All audio decoding, FFT analysis, WebGL2 shaders, canvas compositing, and video encoding run locally in your browser. No files are uploaded to any backend.
- **Self-Contained Assets**: All fonts and codecs/muxers are bundled locally—no runtime CDN requests, telemetry, or analytics.

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (LTS recommended) and `npm`
- A modern Chromium-based browser (Chrome, Edge, Brave) for hardware/software WebCodecs MP4 export (other browsers fall back to `MediaRecorder`)

### Windows Quick Launch
Double-click the included batch scripts:
1. Run `install.bat` to install dependencies (`npm install --legacy-peer-deps`).
2. Run `start.bat` to launch the local server on `http://localhost:3000` and open it in your default browser.

### Command Line (Windows / macOS / Linux)

```bash
# Install dependencies
npm install --legacy-peer-deps

# Start development server at http://localhost:3000
npm run dev

# Type-check with TypeScript
npm run lint

# Build production static bundle into dist/
npm run build

# Preview production build locally
npm run preview
```

> **Note:** `--legacy-peer-deps` is recommended on npm 10+/11+ due to an optional `esbuild` peer dependency range in `vite@8`.

## Project Structure

```text
.
├── index.html                  # HTML entry point & OpenGraph metadata
├── install.bat                 # Windows dependency installer
├── start.bat                   # Windows one-click launcher
├── package.json                # Dependencies & npm scripts
├── tsconfig.json               # TypeScript configuration
├── vite.config.ts              # Vite + Tailwind v4 configuration
└── src/
    ├── App.tsx                 # Main studio state, playback clock & clip CRUD
    ├── i18n.ts                 # Russian & English UI localization
    ├── main.tsx                # React mount & bundled @fontsource fonts
    ├── index.css               # Tailwind CSS import & custom range sliders
    ├── types/
    │   └── studio.ts           # Core domain & configuration types
    ├── components/
    │   ├── TopBar.tsx          # Studio navigation & export trigger
    │   ├── MediaInputPanel.tsx # Audio, multi-clip sequence, trim & fades
    │   ├── PreviewStage.tsx    # Live canvas stage & dual-track timeline
    │   ├── InspectorPanel.tsx  # Beat FX, Space & FX, Typography, Export tabs
    │   └── ExportModal.tsx     # Render progress & file download modal
    └── utils/
        ├── audioAnalyzer.ts    # FFT analysis, beat-cut & timeline segmenter
        ├── canvasRenderer.ts   # Multi-layer 2D frame & transition renderer
        ├── fft.ts              # Radix-2 Cooley-Tukey FFT implementation
        ├── id3Parser.ts        # MP3 ID3v2 tag & embedded cover extractor
        ├── presets.ts          # Color schemes, fonts & generator presets
        ├── proceduralShaders.ts# WebGL2 GLSL fractal/space shader engine
        └── videoExporter.ts    # WebCodecs MP4/WebM + MediaRecorder exporter
```

## License

This project is licensed under the [MIT License](LICENSE).
