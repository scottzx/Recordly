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

## 文稿粗剪与审阅（v2.1 开发版）

`library list/import`、`project create`、`transcript generate/export`、`review create/inspect/apply` 与对应的八个 MCP 工具已实现。新增命令返回单个 `{ok,data,error,warnings}` JSON 对象，进度写 stderr；旧命令保持原协议。运行 `recordly --help` 查看参数。

完整操作见 [recordly-oralcut Skill](../skills/recordly-oralcut/SKILL.md)。将仓库的 `skills/recordly-oralcut` 目录复制到所用 Agent 的技能目录（例如 `~/.codex/skills/recordly-oralcut`），然后调用 `$recordly-oralcut`。不需要修改全局 Agent 配置。开发构建可运行 `npm run build:cli` 后使用 `node dist-cli/bin/recordly.mjs`；安装版使用原有 `recordly` 启动器，无需另装 Node。

- 多音轨工程通过 `--sources sources.json` 指定实例到讲解来源的映射；唯一音轨自动选择。
- 引擎可用性见 `doctor --json` 的 `transcription`。配置 `--engine whisper --model /path/model.bin` 或使用已安装 TranscribeKit。支持 `--executable`、`--language`、`--force`；取消返回 130，完整缓存保留。
- CLI 默认使用安装版 Recordly 数据目录。连接开发版素材库时设置 `RECORDLY_USER_DATA` 为该开发实例的用户数据目录（macOS 通常为 `~/Library/Application Support/Recordly-dev`）。
- Review apply 要求明确 selection；dry-run 不写文件。`STALE_BASE`、`MEDIA_CHANGED`、`INVALID_REFERENCE` 和 `CONFLICTING_SUGGESTIONS` 不会部分应用。已有输出返回 `OUTPUT_EXISTS`。
- 含文稿的工程保存为 v5。旧工程在 GUI 首次迁移时要求另存；原工程保留。旧版 Recordly 不支持新文稿工作区，不应打开并重存 v5 工程。
- 文稿编辑以句子／引擎分段为单位，不伪造字级音频边界。字幕校对和声画删除分别操作。建议需要在真实口播素材上试听，不能仅凭识别文本判定口误。
