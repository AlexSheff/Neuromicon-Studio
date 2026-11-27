# Neuromicon Studio

**Neuromicon Studio** is a 100% client-side, audio-reactive video editor and music visualizer built with React 19, TypeScript (`strict`), WebGL2, and WebCodecs. Combine music tracks with videos, photos, and real-time procedural shaders, align edits to detected musical structure and calibrated beat grids, layer kinetic typography, SRT/VTT subtitles, and timed overlays, and render up to 4K MP4/WebM videos directly in your browser without uploading media to any server.

## Features

### Multi-Track NLE, Media Bin & Synchronized Timeline Dock
- **Reorderable Media Bin**: Drag-and-drop or step-move (`↑` / `↓`) media assets directly inside the Media Bin, inspect source previews, configure default source trim ranges (`In` / `Out`), playback speed presets, and transitions, or drop directly onto timeline gaps and the playhead.
- **Collapsible & Height-Resizable Timeline (`148px – 360px`)**: Drag the top grip handle or collapse the dock (`localStorage`-persisted) to maximize canvas viewport height.
- **Synchronized Multi-Lane Tracks (`1× – 16×` Anchored Zoom & Auto-Follow)**:
  - **Time Ruler + Clips Track**: Edge-trim clip starts/ends directly on the timeline (push or overlap), drag clips freely, click boundary pills (`CF` / `ZM` / `WP` / `DIP` / `SLD` / `CUT`) to adjust transitions, and stay strictly bounded within the master audio duration.
  - **Multi-Lane FX Overlays Track**: Layer overlapping procedural generator effects over clips with automatic lane packing and edge trim/resize handles.
  - **Timed Overlays Track**: Drag text badges and PNG/logo layers horizontally (`Start (s)`) or resize their duration directly on the timeline.
  - **Hi-DPI Canvas Audio Track & Clip Audio Controls**: Master trim overview with keyboard-navigable Trim In/Out sliders paired with a zoomed waveform view displaying the BPM grid, auto-cuts, musical sections, and manual beat markers—plus a one-click **Hide/Show Audio Track** toggle and **Mute/Unmute All Video Clip Audio** button.
  - **Subtitles Lane**: Jump directly to SRT/VTT cues aligned with playback.
- **Anchored Zoom & Loop Segment Separation**: Zoom around cursor (`Ctrl/Cmd + Wheel`) or playhead (`1× Fit` / `Locate Playhead`) with optional **Follow Playhead**. Repeating loop segments can be converted into independent editable clips in one click (**Make Independent**).
- **Undo / Redo (`Ctrl+Z` / `Ctrl+Y`)** across 30 history steps with interactive input focus protection, plus **Split at Playhead (`S`)**, **Duplicate (`Ctrl+D`)**, and **Ripple Delete (`Del`)**.

### Musical Structure Analysis, Beat Calibration & Auto-Clip Engine
- **Automatic Musical Structure Detection**: Analyzes uploaded audio via 2048-FFT pitch-class chroma, phrase energy envelopes, onset accents, and melodic novelty to classify **Intro**, **Beatless / Breakdown**, **Buildup (Crescendo)**, **Drop** (+ drop impact downbeats), **Verse**, and **Outro** sections.
- **Audio Beat Grid & Manual Calibration**:
  - **Auto / Strict BPM / Custom BPM** modes with live **Tap Tempo**, **Set Beat 1 at Playhead**, **Phase Offset (`ms`)**, **Downbeat Shift (`1..4`)**, **Re-extract Beats**, and an audible **Metronome** toggle.
  - **Beat-Centered Transitions (`beatCenteredTransitions`)**: Centers transition dissolves/wipes directly across beat boundaries (`progress = 0.5` right on the beat cut) for tight rhythmic phrasing.
- **12 Editorial Auto-Clip Presets**:
  1. **Music Story** (`story_arc`) · 2. **Cinema Flow** (`cinema_flow`) · 3. **Dynamic Drop** (`edm_drop`) · 4. **Cinema Trailer** (`trailer`) · 5. **Crescendo Arc** (`crescendo`) · 6. **Hip-Hop Groove** (`groove`) · 7. **Acoustic Breath** (`acoustic`) · 8. **Shorts / Viral Hook** (`viral_hook`) · 9. **Story Order** (`sequential`) · 10. **Remix Shuffle** (`remix`) · 11. **Slow Dream** (`dream`) · 12. **Beat Flash** (`beat_flash`)
- **Anti-Repeat & Mixed-Media Phrasing**:
  - Content-based asset tracking deduplicates identical files uploaded to the Media Bin so clips never appear back-to-back or share overlapping source timestamps across copies.
  - Multi-bucket golden-ratio slice dispersion prevents `A → B → A → B` frame loops even across multi-pass timelines with few source videos.
  - Mixed photo + video timelines prioritize video footage for longer phrase shots and reserve still images for short beat punches without photo zoom bounce, while optional `±5s` source edge trimming skips intro/outro slates.

### Motion Framing, Slow-Mo & Procedural WebGL2 Shaders
- **Framing & Motion Controls**: Supports `cover` and `fit_blur` (blurred backdrop with clipped foreground Ken Burns & Beat Zoom inside the framed card), independent **Beat Pulse Disable** (`disableBeatPulse`), and **Stabilize Motion** (`stabilizeMotion`) to freeze drift and camera jitter.
- **Video Slow-Mo Presets (`0.25×` – `2.0×`)**: Built-in `0.25×`, `0.35×`, and `0.5×` slow-motion controls in Inspector, Media Bin, and Media Preview Modal.
- **11 Real-Time WebGL2 Procedural Generators + Custom GLSL Sandbox**: Add generators onto clips, the FX overlay lane, or standalone scenes from the **`+ Generator`** menu, customize **per-clip shader overrides** (`speed`, `scale`, `complexity`, `warp`, `symmetry`, `hueShift` 0°–360°, `glow`, `beatReact`, `rotationSpeed`), and fall back cleanly to 2D Canvas if WebGL context is lost:
  1. **Julia Fractal** · 2. **Fractal Kaleidoscope** · 3. **Mandelbrot Orbit** · 4. **Deep Space Nebula** · 5. **Spiral Galaxy** · 6. **Solar Aurora** · 7. **Event Horizon** · 8. **Cosmic Particle Warp** · 9. **Synthwave Cyber Grid** · 10. **Voronoi Bio-Plasma** · 11. **Custom GLSL Sandbox**

### MP4/WebM Video, Visualizers & Color Grading
- **Full `.mp4` / `.mov` / `.webm` Support**: Automatically mutes embedded video audio when a master music track is loaded (with one-click unmute/mute all), extracts audio from `.mp4` directly into the master Audio Track (`Use Clip Audio as Master Track`), or loads `.mp4` straight into the audio slot.
- **Typed Media Error Diagnostics**: Client-side classification (`empty_file`, `file_too_large`, `unsupported_container`, `unsupported_codec`, `decode_failed`) with localized EN/RU guidance.
- **Reactive Visualizers (with Off Mode)**: Choose **Off (`none`)** to disable overlay visualizers completely, or pick from 6 FFT presets (*Spectrum Bars*, *Radial Pulse*, *Horizon Wave*, *Beat Pulse Zoom*, *Reactive Particles*, *Editorial Frame*) with **Show/Hide** toggle, **360° Hue Spectrum**, and custom hex controls.
- **10 Cinema LUTs & 6 Studio Moods**: Film-inspired grading (*Clean Cinema*, *Kodak 2383 (35mm)*, *Teal & Orange*, *Noir Silver*, *Anamorphic Night*, *Blade Neon*, *Bleach Bypass*, *Velvet Crimson*, *Indie Golden Hour*, *Nordic Ice*) plus *Deep Cosmos*, *Neon Synthwave*, *Fractal Mandala*, *Editorial Noir*, *Indie Film Stage*, and *Pure Cinema Frame*.

### Animated Typography, Subtitles & Direct-to-Disk 4K Export
- **6 Bundled Cyrillic + Latin Fonts** (`@fontsource` offline bundles): *Manrope*, *Montserrat*, *Oswald*, *Cormorant Garamond*, *Playfair Display*, and *JetBrains Mono*, paired with a **0°–360° Accent Hue** slider.
- **ID3v2 Metadata & Subtitles (SRT / VTT)**: Automatic title, artist, album, year, Windows-1251 Cyrillic decoding, cover art extraction, and timed overlay badges/watermarks.
- **Fault-Tolerant Persistence (`Schema v5`)**: React `ErrorBoundary` recovery UI, IndexedDB project persistence (`isSupportedProjectRecord`), orphan blob pruning, and emergency database reset.
- **WebCodecs Pre-Flight Check & Direct-to-Disk Streaming**: Hardware/software H.264/VP9/AAC/Opus codec probing, RAM budget guard, `showSaveFilePicker` streaming export, `MediaRecorder` fallback, Batch Export (`16:9 + 9:16 + 1:1`), `.srt`, `.json`, and `.txt` export.

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for detailed architecture and iteration notes.

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Space` | Play / Pause |
| `S` | Split clip at playhead |
| `Ctrl+D` | Duplicate selected clip or FX layer |
| `I` / `O` | Set Trim In (`[`) / Trim Out (`]`) at playhead |
| `M` | Drop manual beat marker at playhead |
| `,` / `.` | Step `-1` / `+1` frame |
| `Delete` / `Backspace` | Ripple delete selected item (undoable) |
| `←` / `→` | Seek `-0.5s` / `+0.5s` (`Shift` for `±2.0s`; arrows nudge trim sliders when focused) |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Undo / Redo |

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v22+ (LTS recommended) and `npm`
- A modern Chromium-based browser (Chrome, Edge, Brave) for hardware/software WebCodecs MP4 export & File System Access streaming (Safari/Firefox use software soft-blur and WebM/`MediaRecorder` fallbacks as needed)

### Optional Environment Variables
- `VITE_GITHUB_URL` — Custom GitHub repository URL for the top-bar GitHub link (defaults automatically on `*.github.io` hosts).
- `VITE_DONATE_URL` — Optional custom donation link overriding the default TopBar support URL.

### Command Line

```bash
# Install dependencies
npm install --legacy-peer-deps

# Start development server at http://localhost:3000
npm run dev

# Run unit tests (node:test + tsx)
npm test

# Type-check and lint with strict TypeScript
npm run typecheck
npm run lint

# Build production static bundle into dist/
npm run build

# Preview production build locally
npm run preview
```

## License

This project is licensed under the [MIT License](LICENSE).
