# Neuromicon Studio

**Neuromicon Studio** is a 100% client-side, audio-reactive video editor and music visualizer built with React, TypeScript, WebGL2, and WebCodecs. Combine audio tracks with multiple photos, video clips, and real-time procedural generators, layer beat-synced visualizers, kinetic typography, SRT/VTT subtitles, and overlays, and render up to 4K MP4/WebM videos or PNG frames directly in your browser without uploading media to any server.

## Features

### Multi-Clip NLE & Synchronized Multi-Track Timeline
- **Master Overview & Zoomable Sequence (`1×–8×`)**: Full-track waveform overview with draggable **Trim In (`[`)** / **Trim Out (`]`)** handles paired with a synchronized timeline featuring a clickable **Time Ruler**, **Clips** track, **Zoomed Audio Slice + Beat Markers**, **Subtitles Lane**, and a continuous vertical playhead.
- **Direct Timeline Manipulation**:
  - **Inline Clip & Duration Bar**: Select any clip (`<` / dropdown / `>`), edit exact duration (`-0.5s` / numeric input / `+0.5s` or `2s / 4s / 6s / 10s` chips), and jump to its **Clip** inspector directly from the bottom timeline dock
  - **Edge-Trim Resize**: Drag the right handle of any clip directly on the timeline to adjust its duration (`0.5s – 30s`)
  - **Inline Transition Pills**: Click boundary tags (`CF` Crossfade / `DIP` Dip Black / `SLD` Slide / `CUT` Hard Cut) between clips to cycle transitions directly on the track
  - **Drag-and-Drop Reorder** & **Reverse Order** button, plus **Fit Clips to Audio** and **Fit Trim to Clips**
  - **Silent Timeline Playback**: Preview and sequence clips or multi-generator shows even before loading an audio file
- **Non-Linear Editing Tools**:
  - **Split at Playhead (`S`)**, **Duplicate Clip (`Ctrl+D`)**, & **Ripple Delete (`Del` / `Backspace`)**
  - **Set Trim In (`I`) / Out (`O`)** at playhead, **Step Frame (`-1f` / `+1f` via `,` / `.`)**, & **Jump Prev/Next Cut**
  - **Tap-Tempo Beat Markers (`M`)** & **Snap-to-Beats** scrubbing
  - **Undo / Redo (`Ctrl+Z` / `Ctrl+Y`)** with 30-step history and a quick **`Keys`** shortcuts popover
  - **Transport Loop**: Toggle **Loop Trim Region** for seamless section previewing, plus **PNG Snapshot** to capture a clean full-resolution frame (excluding preview safe-zone guides)
- **Per-Clip Keyframes, Audio & Transitions**:
  - Edit clip duration (`0.5s – 30s`), video trim-in offset, playback speed (`0.5× – 2.0×`), **Clip Audio Volume / Mute**, and **Music Auto-Ducking**
  - **Transform & Keyframes**: Animate start/end scale, X/Y offset, rotation (`-45° .. +45°`), opacity, and motion easing (`Linear`, `Ease In-Out`, `Ease Out`) with one-click reset
  - **Sequencing & Transitions**: **Per-Clip**, **Even Split**, **Interval**, or **Beat Cut** with **Crossfade**, **Dip Black**, **Slide**, or **Hard Cut**
- **Framing, Color LUTs & Optics**: Switch between **Zoom to Fill** and **Fit + Blur Backdrop**, toggle **Slow Ken Burns Drift**, apply **Color LUTs** (*Teal & Orange*, *Cyber Magenta*, *Vintage Gold*, *Deep Ocean*), filters (*Mono B&W*, *Warm Film*, *Cool Noir*, *Punch*), **Beat RGB Glitch**, blur, vignette, and contrast scrim.

### Procedural Visual Generators (10 WebGL2 Shaders + Custom GLSL Sandbox)
Add **any** of the 11 procedural generators onto the timeline from the **`+ Generator`** menu (or snapshot your active **Space & FX** scene onto the timeline), customize **per-clip shader overrides** (Symmetry, Speed, Scale, Complexity, Warp, Hue Shift, Glow) so each generator clip has its own look, or composite globally using **Backdrop**, **Screen**, or **Additive Glow** blending (with automatic 2D Canvas fallback on WebGL context loss):
1. **Julia Fractal** — Morphing complex-plane fractal driven by bass energy
2. **Fractal Kaleidoscope** — Symmetric IFS geometry with beat-reactive reflections
3. **Mandelbrot Orbit** — Continuous logarithmic fractal zoom with harmonic color bands
4. **Deep Space Nebula** — Volumetric cosmic dust clouds and multi-layer starfield
5. **Spiral Galaxy** — Rotating logarithmic spiral arms with a glowing core
6. **Solar Aurora** — Flowing volumetric magnetic plasma ribbons and starlight
7. **Event Horizon** — Gravitational lensing ring and swirling black-hole accretion disk
8. **Cosmic Particle Warp** — 3D star and energy particle tunnel accelerated by kick impacts
9. **Synthwave Cyber Grid** — Infinite perspective neon horizon and geometric tunnel
10. **Voronoi Bio-Plasma** — Liquid crystalline cellular energy rippling on beats
11. **Custom GLSL Sandbox** — Editable live fragment shader (`renderCustom(vec2 uv)`) with inline compile diagnostics

#### Deep Generator Controls
- **Kaleido Symmetry (`1× / 2× / 4× / 6× / 8×`)**
- **Complexity / Detail (`0.4× – 2.0×`)**
- **Warp / Turbulence (`0% – 150%`)**
- **Rotation Speed (`-1.5× .. +1.5×`)**
- **Hue Shift (`-180° .. +180°`)**
- **Glow / Bloom (`0.4× – 2.2×`)**
- Opacity, Motion Speed, Scale, Beat Reactivity, and one-click **Reset Generator Defaults**

### Beat-Synced Visualizers & Quick Studio Moods
- **One-Click Studio Moods**: *Deep Cosmos*, *Neon Synthwave*, *Fractal Mandala*, and *Editorial Noir* combine matching generators, visualizers, color LUTs, palettes, and typography animations in a single click.
- **6 Real-Time FFT Presets** (Radix-2 FFT with adaptive beat threshold & frame-rate-independent smoothing): *Spectrum Bars*, *Radial Pulse*, *Horizon Wave*, *Beat Pulse Zoom*, *Reactive Particles*, and *Editorial Frame*.
- Customize width, bar/line thickness, height/scale, smoothing, opacity, mirror symmetry, vertical placement (`Bottom`, `Center`, `Top`), sensitivity, and background beat pulse.

### Animated Typography, Subtitles & Overlays
- **6 Bundled Cyrillic + Latin Fonts** (offline via `@fontsource`, zero CDN requests): *Manrope*, *Montserrat*, *Oswald*, *Cormorant Garamond*, *Playfair Display*, and *JetBrains Mono*.
- **6 Text Animations**: *Smooth Fade & Rise*, *Beat Kinetic Pulse*, *Typewriter Reveal*, *Chromatic Shift*, *Kerning Breathe*, and *Static Crisp*.
- **ID3v2 Metadata**: Automatic title, artist, album, year, CP1251 heuristic decoding, and embedded album artwork extraction from MP3 files.
- **Subtitles (SRT / VTT)**: Import `.srt`/`.vtt` files or paste text, insert cues at the playhead, edit inline, toggle visibility/size, and **Export `.srt`**.
- **Overlay Layers**: Add draggable/scalable text badges and custom PNG/SVG watermarks or logos.

### Social Media Auto-Trim, Persistence & 4K Export
- **Project Persistence**: Automatic **IndexedDB** session autosave (including local media blobs) plus **Save / Load `.json`** project files.
- **Auto-Trim & Fades**: One-click **Full**, **Instagram Reels (60s)**, **TikTok (60s)**, **YouTube Shorts (57s)**, and **Custom** bounds with cosine **Fade In / Fade Out** and **Reels/TikTok Safe Area** overlay guides.
- **Resolutions & Formats**: `Auto`, `16:9` (`1920×1080`), `9:16` (`1080×1920`), `4:5` (`1080×1350`), `1:1` (`1080×1080`), **4K UHD (`3840×2160`)**, **4K Vertical (`2160×3840`)**, and **Custom** dimensions at `30` or `60 fps` (`4 – 40 Mbps`).
- **Offline Render & Batch Export**: Deterministic **WebCodecs** (`VideoEncoder` + `AudioEncoder` with backpressure queueing) muxed via `mp4-muxer` (`.mp4`) or `webm-muxer` (`.webm`), live ETA indicator, `MediaRecorder` fallback, **Batch Export (`16:9 + 9:16 + 1:1`)**, and `.txt` social caption export.
- **Bilingual UI**: Instant **EN / RU** toggle and built-in Web Audio synth demo track (`Midnight Resonance`, 122 BPM).

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Space` | Play / Pause |
| `S` | Split clip at playhead |
| `Ctrl+D` | Duplicate selected clip |
| `I` / `O` | Set Trim In (`[`) / Trim Out (`]`) at playhead |
| `M` | Drop manual beat marker at playhead |
| `,` / `.` | Step `-1` / `+1` frame |
| `Delete` / `Backspace` | Ripple delete selected clip |
| `←` / `→` | Seek `-0.5s` / `+0.5s` (`Shift` for `±2.0s`) |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Undo / Redo |

## Architecture & Privacy

- **100% Client-Side**: All audio decoding, FFT analysis, WebGL2 shaders, canvas compositing, IndexedDB storage, and video encoding run locally in your browser.
- **Zero External Runtime Requests**: Fonts (`@fontsource`), muxers, and icons are bundled locally—no CDNs, backends, API keys, or telemetry.

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
├── index.html                    # HTML entry point & OpenGraph metadata
├── install.bat                   # Windows dependency installer
├── start.bat                     # Windows one-click launcher
├── LICENSE                       # MIT License
├── package.json                  # Dependencies & npm scripts
├── tsconfig.json                 # TypeScript configuration
├── vite.config.ts                # Vite + Tailwind v4 configuration
└── src/
    ├── App.tsx                   # Main studio state, undo/redo, IDB sync & export orchestration
    ├── i18n.ts                   # English & Russian UI localization
    ├── main.tsx                  # React mount & bundled @fontsource fonts
    ├── index.css                 # Tailwind CSS import & custom range sliders
    ├── types/
    │   └── studio.ts             # Core domain & configuration types
    ├── components/
    │   ├── TopBar.tsx            # Studio navigation, undo/redo, JSON save/load & export CTA
    │   ├── MediaInputPanel.tsx   # Tabbed Media Bin (Media, Layers & Timing)
    │   ├── PreviewStage.tsx      # Distortion-free measured canvas stage, quick aspect switcher & transport
    │   ├── InspectorPanel.tsx    # Clip, Beat FX, Space & FX, Text & Export tabs
    │   ├── TimelineDock.tsx      # Full-width multi-track timeline dock with clip/duration bar
    │   └── ExportModal.tsx       # Render progress, ETA & file download modal
    └── utils/
        ├── audioAnalyzer.ts      # FFT analysis, adaptive beat-cut & timeline segmenter
        ├── canvasRenderer.ts     # Multi-layer 2D renderer, LUTs, glitch, keyframes & transitions
        ├── fft.ts                # Radix-2 Cooley-Tukey FFT implementation
        ├── id3Parser.ts          # MP3 ID3v2 tag, CP1251 & embedded cover extractor
        ├── presets.ts            # Color schemes, mood presets, fonts & generator presets
        ├── proceduralShaders.ts  # WebGL2 GLSL fractal/space shader engine & 2D fallback
        ├── projectStorage.ts     # IndexedDB autosave & JSON project serialization
        ├── subtitleParser.ts     # SRT / WebVTT parser and formatter
        └── videoExporter.ts      # WebCodecs MP4/WebM + MediaRecorder & audio ducking mixer
```

## License

This project is licensed under the [MIT License](LICENSE).
