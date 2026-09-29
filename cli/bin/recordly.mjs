#!/usr/bin/env node

import { oralcutCommand, oralcutResult } from "../core/oralcut.mjs";
import { parseArgs } from "node:util";
import { runDoctor } from "../commands/doctor.mjs";
import { runSources } from "../commands/sources.mjs";
import { runRecord } from "../commands/record.mjs";
import { runMark } from "../commands/mark.mjs";
import { runRender } from "../commands/render.mjs";
import { projectCommand } from "../core/compositionProject.mjs";
import { runMcpServer } from "../mcp/server.mjs";
import { getCliVersion } from "../core/paths.mjs";

const argv = process.argv.slice(2);

function printHelp() {
	console.log(`
Recordly CLI - Agent-Friendly Screen Recorder, Trimmer, Captions & Video Polisher

USAGE:
  recordly <command> [subcommand] [options]

COMMANDS:
  library <list|import>       Browse/import media (--query, --json)
  project create             Create project (--media ID repeated, -o new.recordly)
  transcript <generate|export> <file>  --sources mapping.json --engine whisper|transcribe-kit --model path --executable path --language auto --format markdown -o file
  review <create|inspect|apply> <file>  --transcript file --suggestions file|--pauses --project base --selection file --dry-run -o new-file
  project <inspect|apply|validate|preview> <file>  Inspect/edit composition projects
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
		console.log(`recordly-cli v${getCliVersion()}`);
		process.exit(0);
	}

	const command = argv[0];

	// Parse flags
	const { values, positionals } = parseArgs({
		args: argv.slice(1),
		options: {
			json: { type: "boolean", default: false },
			media: { type: "string", multiple: true },
			sources: { type: "string" },
			engine: { type: "string" },
			model: { type: "string" },
			executable: { type: "string" },
			language: { type: "string" },
			format: { type: "string" },
			transcript: { type: "string" },
			suggestions: { type: "string" },
			pauses: { type: "boolean" },
			project: { type: "string" },
			selection: { type: "string" },
			"dry-run": { type: "boolean" },
			query: { type: "string" },
			force: { type: "boolean" },
			plan: { type: "string" },
			at: { type: "string" },
			from: { type: "string" },
			to: { type: "string" },
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
		strict:
			["library", "transcript", "review"].includes(command) ||
			(command === "project" && argv[1] === "create"),
		allowPositionals: true,
	});

	if (
		["library", "transcript", "review"].includes(command) ||
		(command === "project" && positionals[0] === "create")
	) {
		try {
			const data = await oralcutCommand(command, positionals[0], positionals[1], values);
			console.log(JSON.stringify({ ok: true, data, error: null, warnings: [] }, null, 2));
		} catch (error) {
			console.log(JSON.stringify(oralcutResult(error)));
			process.exitCode =
				error.code === "CANCELLED"
					? 130
					: ["INVALID_INPUT", "INVALID_REFERENCE", "CONFLICTING_SUGGESTIONS"].includes(
								error.code,
							)
						? 2
						: 1;
		}
		return;
	}
	switch (command) {
		case "project": {
			const result = await projectCommand(positionals[0], positionals[1], values);
			console.log(JSON.stringify(result, null, 2));
			if (result.valid === false) process.exitCode = 1;
			break;
		}
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
	if (
		["library", "transcript", "review"].includes(argv[0]) ||
		(argv[0] === "project" && argv[1] === "create")
	) {
		console.log(JSON.stringify(oralcutResult({ code: "INVALID_INPUT", message: err.message })));
		process.exitCode = 2;
		return;
	}
	console.error(`Unexpected error: ${err.message}`);
	process.exit(1);
});
