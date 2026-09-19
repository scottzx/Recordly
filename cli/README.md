# Recordly CLI & Agent MCP Toolkit

A powerful, headless, non-interactive Command-Line Interface and Model Context Protocol (MCP) Server for [Recordly](https://github.com/webadderallorg/Recordly).

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
