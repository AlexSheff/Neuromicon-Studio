# Neuromicon Studio

**Neuromicon Studio** is a 100% client-side, audio-reactive video editor and music visualizer built with React, TypeScript (`strict`), WebGL2, and WebCodecs. Combine audio tracks with multiple photos, video clips, and real-time procedural generators, layer beat-synced visualizers, kinetic typography, SRT/VTT subtitles, and timed overlays, and render up to 4K MP4/WebM videos or PNG frames directly in your browser without uploading media to any server.

## Features

### Multi-Track NLE & Synchronized Timeline Dock
- **Collapsible & Height-Resizable Timeline (`148px – 360px`)**: Drag the top grip handle or collapse the dock (`localStorage`-persisted) to reclaim extra canvas viewport height on smaller screens.
- **Synchronized Multi-Lane Tracks (`1× – 8×` Anchored Zoom & Auto-Follow)**:
  - **Time Ruler + Clips Track**: Click boundary pills (`CF` / `ZM` / `WP` / `DIP` / `SLD` / `CUT`) or use the inline **Outgoing Transition** selector right in the clip bar.
  - **Multi-Lane FX Overlays Track**: Layer overlapping procedural generator effects over clips; non-overlapping lanes auto-pack cleanly with edge trim/resize handles.
  - **Timed Overlays Track**: Drag text badges and PNG/logo layers horizontally (`Start (s)`) or resize their duration directly on the timeline.
  - **Hi-DPI Canvas Audio Waveforms & Beat Markers**: Master trim overview with large accessible keyboard-navigable Trim In/Out sliders paired with a zoomed slice displaying BPM grid, auto-cuts, and manual beat markers.
  - **Subtitles Lane**: Jump directly to SRT/VTT cues aligned with playback.
- **Anchored Zoom & Follow Playhead**: Zoom around your cursor (`Ctrl/Cmd + Wheel`) or playhead (`1× Fit` / `Locate Playhead`), with optional **Follow Playhead** auto-scrolling.
- **Loop Segment Separation**: Repeat segments automatically shown when clips loop shorter than audio can be turned into independent editable clips with one click (**Make Independent**).
- **Collapsible & Resizable Side Panels**: Toggle or drag the width of **Media Bin** and **Inspector** panels (`localStorage`-persisted) plus a **New Project** confirmation modal to clear media and IndexedDB cleanly.

### Non-Linear Editing Tools & Beat Sync
- **Split at Playhead (`S`)**, **Duplicate Clip/FX (`Ctrl+D`)**, & **Ripple Delete (`Del`)** with an inline **Undo Toast**.
- **Auto Beat-Sync & BPM Grid**: Estimate track BPM via onset autocorrelation and align all clip durations, transitions, and motion easing to musical beats.
- **Insert at Selection**: Newly added media or generator scenes insert immediately after the selected clip.
- **Undo / Redo (`Ctrl+Z` / `Ctrl+Y`)** across 30 history steps with interactive element keyboard-focus protection.

### Procedural Visual Generators (10 WebGL2 Shaders + Custom GLSL Sandbox)
Add **any** of the 11 procedural generators onto clips, the FX overlay lane, or as standalone scenes from the portal **`+ Generator`** menu, customize **per-clip shader overrides**, and render cleanly with automatic 2D Canvas fallback on WebGL context loss:
1. **Julia Fractal** · 2. **Fractal Kaleidoscope** · 3. **Mandelbrot Orbit** · 4. **Deep Space Nebula** · 5. **Spiral Galaxy** · 6. **Solar Aurora** · 7. **Event Horizon** · 8. **Cosmic Particle Warp** · 9. **Synthwave Cyber Grid** · 10. **Voronoi Bio-Plasma** · 11. **Custom GLSL Sandbox**

### Beat-Synced Visualizers & Optics
- **6 Real-Time FFT Presets**: *Spectrum Bars*, *Radial Pulse*, *Horizon Wave*, *Beat Pulse Zoom*, *Reactive Particles*, and *Editorial Frame* (with **Show/Hide Visualizer** toggle and custom **Visualizer Color** picker).
- **One-Click Studio Moods**: *Deep Cosmos*, *Neon Synthwave*, *Fractal Mandala*, and *Editorial Noir*.
- **Framing, Color LUTs & Safari Compatibility**: Automatic software downscaled blur fallback when `CanvasRenderingContext2D.filter` is unavailable (e.g. Safari), with an inline non-blocking compatibility indicator.

### Animated Typography, Subtitles & Timed Overlays
- **6 Bundled Cyrillic + Latin Fonts** (`@fontsource` offline bundles): *Manrope*, *Montserrat*, *Oswald*, *Cormorant Garamond*, *Playfair Display*, and *JetBrains Mono*.
- **ID3v2 Metadata**: Automatic title, artist, album, year, Windows-1251 Cyrillic heuristic decoding, and cover art extraction from MP3 files.
- **Subtitles (SRT / VTT)** & **Timed Overlays (`Start (s)` / `Dur (s)`)**: Place text badges and PNG/SVG watermarks over specific timeline spans or the whole video.
- **Guided 4-Step Onboarding Checklist**: Appears on empty projects with instant `16:9` / `9:16` / `1:1` aspect buttons and demo synth beat loader.

### Social Auto-Trim, Persistence & Direct-to-Disk 4K Export
- **IndexedDB Autosave Status & Quota Guard**: Real-time `Saved / Saving / Error` indicator in the top bar plus automatic orphan blob pruning.
- **WebCodecs Pre-Flight Check & Direct-to-Disk Streaming**: Probes hardware/software H.264/VP9/AAC/Opus codec support before export, warns when large 4K/long renders exceed safe RAM budgets, and streams MP4/WebM straight to disk via `FileSystemWritableFileStreamTarget` (`showSaveFilePicker`) when supported, with automatic `MediaRecorder` fallback.
- **Batch Export (`16:9 + 9:16 + 1:1`)**, `.srt` export, `.json` project portability, and `.txt` social description export.

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

# Type-check with strict TypeScript
npm run lint

# Build production static bundle into dist/
npm run build

# Preview production build locally
npm run preview
```

## License

This project is licensed under the [MIT License](LICENSE).
