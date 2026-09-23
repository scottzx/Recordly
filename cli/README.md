# Recordly CLI & Agent MCP Toolkit

A powerful, headless, non-interactive Command-Line Interface and Model Context Protocol (MCP) Server for [Recordly](https://github.com/scottzx/Recordly).

**New in this fork:** v3 projects with A-roll, B-roll, and packaging tracks, per-clip layouts, and up to 16× composition speed. Use `project inspect/apply/validate/preview` and `render` with Node.js 22.18+. See the [composition workflow and JSON plan reference](../docs/composition.md); the new project commands use milliseconds and share editing rules with the original GUI.

Built for **AI Agents, CI/CD pipelines, and automated developer walkthroughs**:
- 🎬 **Native ScreenCaptureKit Recording**: Background daemon recording with ScreenCaptureKit on macOS.
- ✂️ **Material Trimming & Cutting**: Cut out dead time, errors, or long waits via CLI parameters.
- 💬 **Animated Subtitles & Captions**: Import SRT/VTT/JSON subtitles with pop, fade, or rise entry animations.
- 🎯 **Smart Auto-Zooms**: Automatically identifies mouse clicks, dwell regions, and Agent Action Markers to generate camera zooms.
- ⚡ **Motion Effects & Speed Ramps**: Cursor ripples, spring physics zoom transitions, motion blur, and 2x speed ramps.
- 🎨 **Headless Video Polishing**: Wraps recordings in beautiful wallpapers, rounded corners, and soft drop shadows using hardware-accelerated WebCodecs rendering.
- 🤖 **Agent-First MCP Server**: Exposes standard tools over stdio JSON-RPC for Claude Desktop, Antigravity, Cursor, and Cline.

---

## 🚀 Quick Start

### Installed macOS app (no Node.js or Xcode required)

Move `Recordly.app` to `/Applications` before installing the terminal command.
In the app menu, choose **Recordly → Install ‘recordly’ Command…**, or run:

```bash
/Applications/Recordly.app/Contents/Resources/cli/recordly --install
```

This creates `~/.local/bin/recordly` without administrator privileges and refuses
to replace an unrelated existing command. If `~/.local/bin` is not on your PATH,
add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc` and reopen the terminal.
You can always use the full app CLI path without installing the command.

```bash
recordly --help
recordly doctor --json
recordly project inspect input.recordly
recordly render input.recordly -o output.mp4 --json
recordly mcp
```

Installed builds include the CLI runtime, recording daemon, native helpers,
FFmpeg and FFprobe. Exports use temporary profiles so the desktop app can remain
open. Recording still requires macOS Screen Recording permission; microphone
and accessibility permissions apply to the corresponding recording features.
`doctor --json` reports `recordingReady` and `exportReady` separately: an exit
code of 1 due to recording permission does not prevent exporting existing media.

For an MCP client, use the full path (GUI clients may not inherit shell PATH):

```json
{
  "mcpServers": {
    "recordly": {
      "command": "/Applications/Recordly.app/Contents/Resources/cli/recordly",
      "args": ["mcp"]
    }
  }
}
```

The source-checkout commands below still require Node.js 22.18+ and built dependencies.

### 1. Preflight Check
```bash
./cli/bin/recordly.mjs doctor
# Or structured JSON:
./cli/bin/recordly.mjs doctor --json
```

### 2. Inspect Open Windows & Displays
```bash
./cli/bin/recordly.mjs sources list
```

### 3. Record, Cut, Subtitle & Auto-Polish
```bash
# 1. Start background recording (by window name or full display)
./cli/bin/recordly.mjs record start --window "Google Chrome" --session-id "task-01"

# 2. (Optional) Inject action markers during agent execution for camera focus
./cli/bin/recordly.mjs mark --session-id "task-01" --action "Clicked Deploy Button" --x 0.5 --y 0.3

# 3. Stop recording, trim head/tail, add subtitles, ripple animations, and export MP4
./cli/bin/recordly.mjs record stop --session-id "task-01" \
  --trim "0:2000" \
  --captions ./subtitles.srt \
  --caption-style pop \
  --click-effect ripple \
  --preset modern-gradient \
  -o walkthrough.mp4
```

### 4. Direct Headless Rendering / Batch Processing
You can edit and render any existing `.mp4` or `.recordly` project directly via CLI:
```bash
./cli/bin/recordly.mjs render input.mp4 \
  --trim "0:1500" \
  --speed "4000:9000:2.0" \
  --captions intro.srt \
  --caption-style pop \
  --click-effect ripple \
  --preset modern-gradient \
  -o output.mp4
```

---

## 🛠 Features & Parameters

### ✂️ Material Trimming (`--trim`)
Cut out unwanted frames from both video and audio tracks simultaneously:
- `--trim "0:2500"` (cut from 0ms to 2500ms)
- `--trim "0s:2.5s"` (seconds notation supported)
- Multiple cuts allowed: `--trim "0:2000" --trim "8000:11000"`

### 💬 Subtitles & Captions (`--captions`, `--caption-style`)
- `--captions <file>`: Load from `.srt`, `.vtt`, or `.json`
- `--caption-style <pop | fade | rise | none>`: Entry animation style
- `--caption-size <number>`: Font size (default: 30)

### ⚡ Motion Effects & Animations
- **Click Effects**: `--click-effect <ripple | bounce | circle | none>`, `--click-color "#3b82f6"`
- **Speed Ramps**: `--speed "3000:8000:2.0"` (speed up waiting/loading sections at 2x)
- **Camera Transitions**: `--zoom-easing <ease-out | spring | linear>`, `--motion-blur 0.5`
- **Presets**: `--preset <modern-gradient | minimal-dark | glass | raw>`

---

## 🤖 Model Context Protocol (MCP) Server

Add to your `claude_desktop_config.json` or Antigravity MCP settings:

```json
{
  "mcpServers": {
    "recordly": {
      "command": "node",
      "args": ["/Users/scott/Documents/01-开发项目/mac_app/mac录制/Recordly/cli/bin/recordly.mjs", "mcp"]
    }
  }
}
```
