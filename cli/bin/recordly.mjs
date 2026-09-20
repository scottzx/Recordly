#!/usr/bin/env node

import { parseArgs } from "node:util";
import { runDoctor } from "../commands/doctor.mjs";
import { runSources } from "../commands/sources.mjs";
import { runRecord } from "../commands/record.mjs";
import { runMark } from "../commands/mark.mjs";
import { runRender } from "../commands/render.mjs";
import { runMcpServer } from "../mcp/server.mjs";

const argv = process.argv.slice(2);

function printHelp() {
	console.log(`
Recordly CLI - Agent-Friendly Screen Recorder, Trimmer, Captions & Video Polisher

USAGE:
  recordly <command> [subcommand] [options]

COMMANDS:
  doctor                     Run system permission and runtime diagnostics
  sources [list]             List available displays and open application windows
  record start [options]     Start background screen/window recording session
  record stop [options]      Stop recording session and optionally export polished video
  record status              Check active recording session status
  mark [options]             Inject an action marker for smart camera auto-zoom
  render <file> [options]    Headlessly render a .recordly project or video to MP4
  mcp                        Start the Model Context Protocol (MCP) stdio server

CORE OPTIONS:
  --window <name|id>         Target window name or ID (e.g. "Safari", "Terminal")
  --display <id>             Target display ID (default: 1)
  --mic                      Capture microphone audio
  --system-audio             Capture macOS system sound
  --session-id <id>          Custom session identifier
  --output, -o <path>        Output file path
  --fps <number>             Target frame rate (default: 60)
  --json                     Output structured JSON (ideal for AI Agents & scripts)

EDITING, TRIMMING & CAPTIONS:
  --trim <range>             Cut unwanted sections (e.g. "0:2500", "0s:2.5s", "5000-8000")
  --captions <file>          Import subtitles from .srt, .vtt, or .json file
  --caption-style <style>    Subtitle animation style: pop, fade, rise, none (default: pop)
  --caption-size <number>    Subtitle font size (default: 30)

MOTION EFFECTS & ANIMATIONS:
  --auto-zoom                Automatically generate camera zooms on clicks and dwell areas
  --click-effect <effect>    Cursor click animation: ripple, bounce, circle, none (default: ripple)
  --click-color <hex>        Cursor ripple color (default: #3b82f6)
  --speed <range:multiplier> Speed up sections (e.g. "3000:8000:2.0" for 2x fast-forward)
  --zoom-easing <easing>     Zoom transition easing: ease-out, spring, linear (default: ease-out)
  --motion-blur <0.0~1.0>    Motion blur intensity during camera movements (default: 0.5)
  --preset <name>            Visual preset: modern-gradient, minimal-dark, glass, raw

EXAMPLES:
  # 1. Record an app window
  recordly record start --window "Antigravity" --session-id "task-01"

  # 2. Stop and cut out first 2 seconds, add pop subtitles, and render with ripples
  recordly record stop --session-id "task-01" \\
    --trim "0:2000" \\
    --captions subtitles.srt \\
    --caption-style pop \\
    --click-effect ripple \\
    --preset modern-gradient \\
    -o demo.mp4

  # 3. Direct render on an existing video with cuts and 2x speed ramp
  recordly render input.mp4 \\
    --trim "0:1500" \\
    --speed "4000:9000:2" \\
    --captions intro.srt \\
    -o output.mp4
`);
}

async function main() {
	if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
		printHelp();
		process.exit(0);
	}

	if (argv.includes("-v") || argv.includes("--version")) {
		console.log("recordly-cli v1.5.0-beta.1");
		process.exit(0);
	}

	const command = argv[0];

	// Parse flags
	const { values, positionals } = parseArgs({
		args: argv.slice(1),
		options: {
			json: { type: "boolean", default: false },
			window: { type: "string" },
			display: { type: "string" },
			mic: { type: "boolean", default: false },
			"system-audio": { type: "boolean", default: false },
			"session-id": { type: "string" },
			session: { type: "string" },
			"auto-zoom": { type: "boolean" },
			preset: { type: "string" },
			output: { type: "string", short: "o" },
			fps: { type: "string" },
			quality: { type: "string" },
			action: { type: "string" },
			target: { type: "string" },
			x: { type: "string" },
			y: { type: "string" },
			trim: { type: "string", multiple: true },
			captions: { type: "string" },
			subtitles: { type: "string" },
			"caption-style": { type: "string" },
			"caption-size": { type: "string" },
			speed: { type: "string", multiple: true },
			"click-effect": { type: "string" },
			"click-color": { type: "string" },
			"zoom-easing": { type: "string" },
			"motion-blur": { type: "string" },
		},
		strict: false,
		allowPositionals: true,
	});

	switch (command) {
		case "doctor":
			await runDoctor(values);
			break;

		case "sources":
			await runSources(values);
			break;

		case "record": {
			const subcommand = positionals[0] || "status";
			await runRecord(subcommand, values);
			break;
		}

		case "mark":
			await runMark(values);
			break;

		case "render": {
			const targetFile = positionals[0];
			await runRender(targetFile, values);
			break;
		}

		case "mcp":
			await runMcpServer();
			break;

		default:
			console.error(`Unknown command: "${command}". Run 'recordly --help' for usage.`);
			process.exit(1);
	}
}

main().catch((err) => {
	console.error(`Unexpected error: ${err.message}`);
	process.exit(1);
});
