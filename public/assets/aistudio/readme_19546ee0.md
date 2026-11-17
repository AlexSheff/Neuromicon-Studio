# Neuromicon Media Converter

A powerful, PyQt6-based batch media converter and tag editor designed to transform audio files (MP3/WAV) into visually engaging, YouTube-ready MP4 videos (both standard 16:9 and 9:16 Shorts) complete with audio visualizers, text overlays, and metadata management.

## ✨ Features

### 🎵 Audio Tag Management & Batch Editing
- **ID3 Tag Editing**: Read, write, and modify metadata (Title, Artist, Album, Year, Genre, Comment, Lyrics) using `mutagen`.
- **Batch Processing**: Apply changes to multiple files simultaneously to maintain project consistency.
- **Cover Art Extraction**: Automatically extracts the embedded `APIC` cover image from MP3s to use as the background for generated videos.

### 🎬 Advanced Video Generation
- **Standard Video (1080p)**: Converts audio into 1920x1080 (16:9) MP4 videos. Uses a "zoom-to-fill" scaling method for the cover art to avoid black bars.
- **YouTube Shorts (9:16)**: Automatically crops and formats videos for Shorts/TikTok (1080x1920). Trims audio to 57 seconds with a smooth 3-second fade-out at the end.
- **Audio Visualizers**: Includes an animated audio waveform overlaid on the video. Highly customizable via settings (Style, Color, Opacity, and Height).
- **Text Overlays**: Dynamically renders Artist, Title, and Album text onto the video using system fonts, fully escaped and safely passed to FFmpeg.
- **Outro Overlay**: Supports an optional outro image that flashes on screen periodically (every 11 seconds) using FFmpeg complex filters.

### 🗂️ Smart File Routing
To keep your workspace clean, the application strictly processes files in the root of the selected directory (ignoring subdirectories) and automatically routes outputs into dedicated folders:
- `mp3/` -> Standardized 320kbps 44100 MP3 outputs.
- `mp4/` -> Full-length 1080p MP4 videos.
- `mp4 shorts/` -> Vertical short-form videos, automatically appending the `(Shorts)` suffix to the filename.

### 📝 Automated Metadata Export
Generates a `.txt` file alongside every `.mp4` video containing a ready-to-copy YouTube description, including project details, lyrics, and relevant tags.

---

## 🛠️ Prerequisites & Installation

### 1. System Requirements
- **OS**: Windows, macOS, or Linux
- **Python**: 3.8 or higher
- **FFmpeg**: Must be installed on your system. You can configure the path to the FFmpeg executable in the application settings.
  - *Windows*: Download from [ffmpeg.org](https://ffmpeg.org/download.html)

### 2. Python Dependencies
Install the required Python packages:
```bash
pip install PyQt6 mutagen
```

---

## 🚀 Usage

### Graphical User Interface (GUI)
Launch the main application to access the UI:
1. Click **Open Folder** to load `.mp3` and `.wav` files from a specific directory.
2. Select files from the list to view and edit their ID3 tags in the right panel.
3. Use the **Batch Edit Bar** to apply a specific artist, album, or genre to multiple files at once.
4. Click **Convert All**, **Convert Selected**, or **Convert Selected to Shorts** to start the FFmpeg conversion queue.
5. Access **Settings** to adjust FFmpeg paths, visualizer aesthetics, CRF (quality), and output folder templates.

### Command Line Interface (CLI)
For quick, automated conversions without the UI, you can use the standalone CLI script:
```bash
python mp3_to_mp4.py ./music/ -o ./videos --artist "Neuromicon" --year 2025 --album "PH-onk"
```
*Note: The CLI script will also automatically process all `.mp3` files in the specified directory without scanning subfolders recursively.*

---

## 🏗️ Project Structure

- `core/` - Core business logic, FFmpeg command generation (`converter.py`), path building (`path_builder.py`), and tag reading/writing using Mutagen.
- `ui/` - PyQt6 interface components (Main Window, Settings Dialog, Tag Editor, File List).
- `models/` - Data structures (e.g., `MediaFile` class) holding state and metadata.
- `workers/` - `QRunnable` threads to handle asynchronous FFmpeg processing without freezing the UI.
- `mp3_to_mp4.py` - Standalone CLI tool for headless operations.
- `settings.py` - Persistent settings management saving to JSON.

## ⚙️ Technical Details
- **FFmpeg Complex Filters**: Uses advanced `filter_complex` chains for audio splitting, waveform generation (`showwaves`), video scaling, and text rendering (`drawtext`).
- **Threaded Processing**: Utilizes `QThreadPool` for conversion tasks, ensuring the application remains responsive while invoking heavy FFmpeg subprocesses.
