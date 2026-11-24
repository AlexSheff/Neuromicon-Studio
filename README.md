# Neuromicon Studio

**Neuromicon Studio** is a 100% client-side, audio-reactive video editor and music visualizer built with React, TypeScript (`strict`), WebGL2, and WebCodecs. Combine audio tracks with multiple photos, video clips, and real-time procedural generators, layer beat-synced visualizers, kinetic typography, SRT/VTT subtitles, and timed overlays, and render up to 4K MP4/WebM videos or PNG frames directly in your browser without uploading media to any server.

## Features

### Multi-Track NLE & Synchronized Timeline Dock
- **Collapsible & Height-Resizable Timeline (`148px – 360px`)**: Drag the top grip handle or collapse the dock (`localStorage`-persisted) to reclaim extra canvas viewport height on smaller screens.
- **Synchronized Multi-Lane Tracks (`1× – 16×` Anchored Zoom & Auto-Follow)**:
  - **Time Ruler + Clips Track**: Edge-trim clip starts/ends directly on the timeline, drag clips freely or drop directly from the **Media Bin**, click boundary pills (`CF` / `ZM` / `WP` / `DIP` / `SLD` / `CUT`), and stay strictly bounded within the master audio duration without horizontal overflow.
  - **Multi-Lane FX Overlays Track**: Layer overlapping procedural generator effects over clips; non-overlapping lanes auto-pack cleanly with edge trim/resize handles.
  - **Timed Overlays Track**: Drag text badges and PNG/logo layers horizontally (`Start (s)`) or resize their duration directly on the timeline.
  - **Hi-DPI Canvas Audio Track & Clip Audio Mute Controls**: Master trim overview with keyboard-navigable Trim In/Out sliders paired with a zoomed waveform slice displaying BPM grid, auto-cuts, and manual beat markers—plus a one-click **Hide/Show Audio Track** toggle (`×` / `More` menu) and **Mute/Unmute All Video Clip Audio** button.
  - **Subtitles Lane**: Jump directly to SRT/VTT cues aligned with playback.
- **Anchored Zoom & Follow Playhead**: Zoom around your cursor (`Ctrl/Cmd + Wheel`) or playhead (`1× Fit` / `Locate Playhead`), with optional **Follow Playhead** auto-scrolling.
- **Loop Segment Separation**: Repeat segments automatically shown when clips loop shorter than audio can be turned into independent editable clips with one click (**Make Independent**).
- **Collapsible & Resizable Side Panels**: Toggle or drag the width of **Media Bin** and **Inspector** panels (`localStorage`-persisted) plus a **New Project** confirmation modal to clear media and IndexedDB cleanly.

### Music, Melody & Beat-Aligned Auto-Generators
- **Split at Playhead (`S`)**, **Duplicate Clip/FX (`Ctrl+D`)**, & **Ripple Delete (`Del`)** with an inline **Undo Toast**.
- **Fractional BPM Grid & 4/4 Downbeat Alignment**: High-precision BPM tracking prevents long-track drift and locks cuts/transitions onto musical bar downbeats.
- **2048-FFT Pitch-Class Chroma & Phrase Energy**: Detects harmonic chord changes, melodic novelty, and quiet/drop energy transitions to generate smooth **Auto-Rhythm**, non-repeating **Random Beat**, or **Sequential** video edits that stay strictly within the music length.
- **Non-Overlapping Manual Placement**: Dropped or inserted clips attach cleanly at the playhead or open gaps without splitting unrelated clips into alternating fragments.
- **Undo / Redo (`Ctrl+Z` / `Ctrl+Y`)** across 30 history steps with interactive element keyboard-focus protection.

### Motion Stabilization, Slow-Mo & Procedural Visuals
- **Beat Pulse Disable & Motion Stabilization**: Independently turn off beat-reactive frame pulsing (`disableBeatPulse`, bypassing `backgroundPulse` and `beat_zoom`) or enable **Stabilize Motion** (`stabilizeMotion`) to freeze Ken Burns drift and reactive camera jitter.
- **Video Slow-Mo Presets (`0.25×` – `2.0×`)**: Built-in `0.25×`, `0.35×`, and `0.5×` slow-motion controls in Inspector, Media Bin, and Media Preview Modal.
- **11 Real-Time WebGL2 Procedural Generators + Custom GLSL Sandbox**: Add **any** generator onto clips, the FX overlay lane, or as standalone scenes from the portal **`+ Generator`** menu, customize **per-clip shader overrides** with HDR-safe **0°–360° full-spectrum HSV Hue** sliders, and render cleanly with automatic 2D Canvas fallback on WebGL context loss:
  1. **Julia Fractal** · 2. **Fractal Kaleidoscope** · 3. **Mandelbrot Orbit** · 4. **Deep Space Nebula** · 5. **Spiral Galaxy** · 6. **Solar Aurora** · 7. **Event Horizon** · 8. **Cosmic Particle Warp** · 9. **Synthwave Cyber Grid** · 10. **Voronoi Bio-Plasma** · 11. **Custom GLSL Sandbox**

### MP4 Video, Visualizers & Color Grading
- **Full `.mp4` / `.mov` / `.webm` Support**: Automatically mutes embedded video audio when a master music track is loaded (with one-click unmute/mute all), extracts audio from `.mp4` directly into the Audio Track (`Use Clip Audio as Master Track`), or loads `.mp4` straight into the audio slot.
- **Media Error Classification**: Typed client-side diagnostics (`empty_file`, `file_too_large`, `unsupported_container`, `unsupported_codec`, `decode_failed`) with localized EN/RU conversion advice (e.g., H.264 MP4 / WebM).
- **6 Real-Time FFT Presets**: *Spectrum Bars*, *Radial Pulse*, *Horizon Wave*, *Beat Pulse Zoom*, *Reactive Particles*, and *Editorial Frame* (with **Show/Hide Visualizer** toggle and full **360° Hue Spectrum** + hex color controls).
- **Cinema LUTs & Studio Moods**: Film-inspired grading presets (*Kodak 2383*, *Teal & Orange*, *Fuji Eterna*, *Bleach Bypass*, *Cyber Noir*) plus *Deep Cosmos*, *Neon Synthwave*, *Fractal Mandala*, and *Editorial Noir*.

### Animated Typography, Subtitles & Direct-to-Disk 4K Export
- **6 Bundled Cyrillic + Latin Fonts** (`@fontsource` offline bundles): *Manrope*, *Montserrat*, *Oswald*, *Cormorant Garamond*, *Playfair Display*, and *JetBrains Mono*, paired with a full **0°–360° Accent Hue** slider.
- **ID3v2 Metadata & Subtitles (SRT / VTT)**: Automatic title, artist, album, year, Windows-1251 Cyrillic heuristic decoding, cover art extraction, and timed overlay badges/watermarks.
- **Fault-Tolerant Persistence (`Schema v5`)**: React `ErrorBoundary` recovery UI, IndexedDB project schema v5 validation (`isSupportedProjectRecord`), safe connection cleanup, orphan blob pruning, and emergency database reset (`deleteStudioDatabase`).
- **WebCodecs Pre-Flight Check & Direct-to-Disk Streaming**: Hardware/software H.264/VP9/AAC/Opus codec probing, RAM budget guard, `showSaveFilePicker` streaming export, `MediaRecorder` fallback, Batch Export (`16:9 + 9:16 + 1:1`), `.srt`, `.json`, and `.txt` export.

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for the detailed change log and multi-iteration engineering roadmap.

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

### Command Line

```bash
# Install dependencies
npm install --legacy-peer-deps

# Start development server at http://localhost:3000
npm run dev

# Run unit tests (node:test + tsx)
npm test

# Type-check with strict TypeScript
npm run typecheck
npm run lint

# Build production static bundle into dist/
npm run build

# Preview production build locally
npm run preview
```

## License

This project is licensed under the [MIT License](LICENSE).
