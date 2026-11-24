# Neuromicon Studio — Engineering Improvements & Roadmap

This document summarizes the stability, audio/beat synchronization, timeline ergonomics, error classification, storage hardening, and developer experience improvements implemented in **Neuromicon Studio**, along with the prioritized multi-iteration engineering roadmap.

---

## Implemented Improvements

### 1. Beat Pulse Control, Motion Stabilization & Video Slow-Mo
- **Disable Beat Image Pulsing (`disableBeatPulse`)**: Added an explicit toggle in **Inspector → Effects** (`src/components/InspectorPanel.tsx`) and `resolveBeatPulseScale` (`src/utils/canvasRenderer.ts`) that locks beat-reactive frame scaling (`1.0×`) and edge beat flash off—including when the `beat_zoom` visualizer preset is selected or `backgroundPulse` is non-zero.
- **Video Motion Stabilization (`stabilizeMotion`)**: Added a stabilization toggle in **Inspector** and **Media & Timing** that freezes subtle Ken Burns pan/zoom drift, beat zoom pulse, and beat-driven frame glitches for steady footage playback.
- **Extended Slow-Mo Presets (`0.25×` / `0.35×` / `0.5×`)**: Expanded playback speed selectors across **Inspector**, **Media Bin**, and **Media Preview Modal**, plus one-click `0.25× Slow-Mo`, `0.5× Slow-Mo`, and `1.0× Normal` preset pills in `InspectorPanel.tsx`.

### 2. Timeline Overflow Fix, Music-Bounded Clips & Bottom Audio Track Controls
- **Strict Horizontal Containment**: Added `w-full max-w-full min-w-0 overflow-x-hidden` on the root timeline dock (`src/components/TimelineDock.tsx`) and reset timeline auto-zoom (`targetZoom: 1`) after **Auto-Clip** and **Auto Beat-Sync** generation so the `Clips` track stays framed cleanly inside the viewport without compressing or pushing off-screen.
- **Video Clips Strictly Bounded by Master Music**: `clampManualClipsToSpan` and `computeAutoBeatAlignedClips` / `generateAutoClipPlan` ensure manual trims, presets, beat-sync adjustments, and auto-generated edits never exceed `trimEnd - trimStart` when an audio track is loaded.
- **Bottom Audio Track Visibility & Clip Audio Mute Controls**:
  - Added a **`×` hide button** directly on the bottom `Audio` track label in `TimelineDock.tsx` and a corresponding **Show / Hide Audio Track** entry in the timeline **More (`···`)** menu (`config.showBottomAudioTrack`).
  - Added **Mute All Clip Audio / Unmute All Clip Audio** (`onMuteAllClipAudio`) directly on the bottom track header, timeline `More` menu, and Inspector video audio panel—plus automatic muting of existing video clip audio when loading a master music track so embedded camera audio never clashes with the soundtrack.

### 3. Music, Melody & Beat-Aligned Auto-Generators
- **Drift-Free Fractional BPM Tracking**: `detectTrackBpmAndBeats` (`src/utils/audioAnalyzer.ts`) retains high-precision unrounded `beatSec = 60 / clampedRawBpm` (`toFixed(5)`) instead of snapping beat spacing to integer BPMs, preventing cumulative phase drift across multi-minute tracks.
- **4/4 Bar Downbeat Phase Alignment**: Scores modulo-4 bar phases (`downbeatOffset`) across detected kick onsets so auto-cuts and transitions land naturally on musical downbeats—preserving aligned bar phase even when appending clips from `startOffsetSec`.
- **2048-FFT Pitch-Class Chroma + Harmonic Novelty**: Upgraded `computeBeatMusicalAccents` to a 2048-sample FFT combining 12-semitone Pitch-Class Chroma cosine distance (`55%`) with log-band harmonic spectral shift (`45%`), alongside mid/harmonic spectral delta (`specDelta`) in `computeBeatCutTimestamps`.
- **Phrase-Aware Beat Sync & Auto-Rhythm**: `computeAutoBeatAlignedClips` incorporates `monoData` + `sampleRate` to align clip boundaries with strong musical phrasing and harmonic changes while strictly capping total duration `<= clipDuration`.

### 4. Fault Tolerance & Error Handling
- **React Error Boundary (`src/components/common/ErrorBoundary.tsx`)**: Wraps `<App />` in `src/main.tsx` alongside an explicit `#root` element mount guard. A single render exception no longer crashes the entire workspace UI; users receive **Reload Page** and **Try Continue** recovery actions while error details stay cleanly scoped to the browser console.
- **Media & Codec Error Classification (`src/utils/mediaErrors.ts`)**: Categorizes import and decode failures into typed codes (`empty_file`, `file_too_large`, `unsupported_container`, `unsupported_codec`, `decode_failed`) with localized EN/RU actionable guidance (e.g., re-encoding HEVC/ProRes/MKV into standard H.264 MP4 or WebM), wired into `ingestVisualAssetFromUrl`, `handleAudioFile`, and `handleVisualFiles` in `src/App.tsx`.

### 5. Hardened IndexedDB Project Storage (`src/utils/projectStorage.ts`)
- Bumped explicit schema constant to `PROJECT_SCHEMA_VERSION = 5`.
- Wrapped all IndexedDB transactions with `safeCloseDB(db)` inside `try/finally` blocks and attached `db.onversionchange` auto-close hooks to eliminate leaked or blocked connections.
- Added `isSupportedProjectRecord()` validation to reject corrupt payloads or legacy `< 2` schemas cleanly without crashing startup.
- Added `deleteStudioDatabase()` emergency database reset helper with timeout protection.

### 6. Developer Experience & Automated Tests
- Updated `package.json`: set `name` to `"neuromicon-studio"`, added `description`, `keywords`, `license: "MIT"`, and added standardized scripts:
  - `npm run typecheck` (`tsc --noEmit`)
  - `npm run lint` (`tsc --noEmit`)
  - `npm test` (`node --import tsx --test src/utils/__tests__/studioLogic.test.ts` — 27 passing tests covering beat analysis, melodic novelty, NLE clip insertion/trimming, `mediaErrors`, `projectStorage` v5 schema guards, `resolveBeatPulseScale`, ID3v2, SRT/VTT, and HSV math).

---

## Roadmap (Next Iterations)

### A. Architecture (High ROI)
- **Decompose `src/App.tsx` (< ~1500 lines composition target)**: Extract self-contained hooks for `useStudioHistory`, `usePlaybackClock`, `useProjectAutosave`, `useMediaImport`, and `useExportJob`.
- **Modularize `TimelineDock`**: Split into focused track sub-components (`RulerTrack`, `ClipsTrack`, `FxOverlaysTrack`, `TimedOverlaysTrack`, `AudioWaveformTrack`, `SubtitlesTrack`) backed by a shared timeline zoom/viewport context.
- **Split `InspectorPanel` by Tab**: Extract dedicated `ClipTab`, `EffectsTab`, `TextTab`, `GeneratorTab`, and `ExportTab` components.

### B. UX & Accessibility (a11y)
- **Guided Empty-State Onboarding Checklist**: Refine first-launch checklist flow from asset drop through auto-clip generation and export readiness.
- **Larger Trim Handles & Keyboard Resize**: Increase hit-target area on clip left/right edge trim handles and support precision keyboard nudging when a clip edge or clip bar is focused.
- **Portal Popover Audit**: Verify every dropdown/popover across sidebars and dock renders via React Portal so none are clipped by `overflow-hidden` or scrollable containers.
- **Follow-Playhead Stress Test at High Zoom**: Profile and refine smooth scroll clamping when **Follow Playhead** is active at `8×–16×` zoom during fast scrubbing and beat cuts.

### C. Quality & Performance
- **Continuous Integration (CI)**: Enforce `npm run typecheck && npm test && npm run build` automatically on pull requests.
- **Playwright End-to-End Smoke Suite**: Automate end-to-end verification (`demo-beat` → auto-clip generator → WebM export).
- **Large Timeline & Background Efficiency**:
  - Virtualize timeline DOM rendering when projects exceed `> 80` clips.
  - Throttle Hi-DPI waveform canvas redraws during live zoom/drag gestures.
  - Pause WebGL2 procedural shader rendering automatically on `document.visibilitychange` when tab is hidden.
