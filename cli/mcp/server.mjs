import { projectCommand } from "../core/compositionProject.mjs";
import readline from "node:readline";
import path from "node:path";
import { startRecording, stopRecording, markAction } from "../core/capture.mjs";
import { checkDoctor } from "../core/doctor.mjs";
import { renderProject } from "../core/headlessRenderer.mjs";
import { buildProjectFile } from "../core/projectBuilder.mjs";
import { listSources, listWindows } from "../core/sources.mjs";

const TOOLS = [
 ...["inspect", "apply", "validate", "preview"].map(action => ({
 name: `recordly_project_${action}`,
 description: `Composition project ${action}. All timestamps are milliseconds. Uses the same schema as recordly project.`,
 inputSchema: {type:"object",properties:{inputPath:{type:"string"},output:{type:"string"},planData:{type:"object",description:"EditPlan v1: composition, editor, operations"},at:{type:"number"},from:{type:"number"},to:{type:"number"}},required:["inputPath"]}
 })),
	{
		name: "recordly_doctor",
		description: "Check system permissions (screen recording, accessibility) and native runtime health for Recordly.",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "recordly_list_sources",
		description: "List all active displays and application windows available for screen capture.",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "recordly_start_recording",
		description: "Start background screen recording on a display or specific application window.",
		inputSchema: {
			type: "object",
			properties: {
				windowName: {
					type: "string",
					description: "Optional window title or application name to record (e.g. 'Google Chrome', 'Antigravity', 'Terminal').",
				},
				displayId: {
					type: "string",
					description: "Display ID if recording a full monitor (default: primary monitor).",
				},
				fps: {
					type: "number",
					description: "Frame rate (default: 60).",
				},
				mic: {
					type: "boolean",
					description: "Whether to record microphone audio (default: false).",
				},
				systemAudio: {
					type: "boolean",
					description: "Whether to record system sound (default: false).",
				},
				sessionId: {
					type: "string",
					description: "Custom session identifier (e.g. 'task-001').",
				},
			},
		},
	},
	{
		name: "recordly_mark_action",
		description: "Mark an action point during an active recording. The auto-zoom camera will dynamically zoom in on this event in the final video.",
		inputSchema: {
			type: "object",
			properties: {
				sessionId: {
					type: "string",
					description: "Active session ID (optional if only one session is running).",
				},
				action: {
					type: "string",
					description: "Short description of the action (e.g. 'Clicked Submit', 'Changed Config', 'Terminal Build').",
				},
				x: {
					type: "number",
					description: "Normalized horizontal coordinate (0.0 to 1.0) where the action occurred.",
				},
				y: {
					type: "number",
					description: "Normalized vertical coordinate (0.0 to 1.0) where the action occurred.",
				},
			},
			required: ["action"],
		},
	},
	{
		name: "recordly_stop_and_export",
		description: "Stop recording, cut sections, auto-generate camera zooms, add subtitles, apply beautiful styled borders/shadows/wallpaper, and export final MP4.",
		inputSchema: {
			type: "object",
			properties: {
				sessionId: {
					type: "string",
					description: "Session ID to stop (optional if only one session is running).",
				},
				preset: {
					type: "string",
					enum: ["modern-gradient", "minimal-dark", "glass", "raw"],
					description: "Visual style preset for wallpaper, padding, and drop-shadow (default: 'modern-gradient').",
				},
				autoZoom: {
					type: "boolean",
					description: "Automatically zoom in on clicks and marked actions (default: true).",
				},
				trims: {
					type: "array",
					items: { type: "string" },
					description: "Array of time ranges to cut out (e.g. ['0:2500', '8000:12000']).",
				},
				captionsPath: {
					type: "string",
					description: "Path to .srt or .vtt subtitle file.",
				},
				captionStyle: {
					type: "string",
					enum: ["pop", "fade", "rise", "none"],
					description: "Subtitle animation style (default: 'pop').",
				},
				clickEffect: {
					type: "string",
					enum: ["ripple", "bounce", "circle", "none"],
					description: "Cursor click ripple/bounce animation (default: 'ripple').",
				},
				speedRamps: {
					type: "array",
					items: { type: "string" },
					description: "Speed-up regions (e.g. ['4000:9000:2.0'] to 2x speed up waiting times).",
				},
				outputPath: {
					type: "string",
					description: "Destination path for the final MP4 file.",
				},
			},
		},
	},
	{
		name: "recordly_render_video",
		description: "Headlessly edit and render an existing .recordly project or video file into an MP4 video with trims, subtitles, and motion effects.",
		inputSchema: {
			type: "object",
			properties: {
				inputPath: {
					type: "string",
					description: "Path to .recordly project file or raw video file.",
				},
				outputPath: {
					type: "string",
					description: "Target output MP4 file path.",
				},
				preset: {
					type: "string",
					enum: ["modern-gradient", "minimal-dark", "glass", "raw"],
					description: "Visual style preset.",
				},
				trims: {
					type: "array",
					items: { type: "string" },
					description: "Array of time ranges to cut out.",
				},
				captionsPath: {
					type: "string",
					description: "Path to .srt or .vtt subtitle file.",
				},
				captionStyle: {
					type: "string",
					enum: ["pop", "fade", "rise", "none"],
					description: "Subtitle animation style.",
				},
				clickEffect: {
					type: "string",
					enum: ["ripple", "bounce", "circle", "none"],
					description: "Cursor click ripple animation.",
				},
			},
			required: ["inputPath", "outputPath"],
		},
	},
];

export async function runMcpServer() {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false,
	});

	const send = (msg) => {
		process.stdout.write(JSON.stringify(msg) + "\n");
	};

	rl.on("line", async (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;

		let req;
		try {
			req = JSON.parse(trimmed);
		} catch (e) {
			send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
			return;
		}

		const { id, method, params } = req;

		if (method === "initialize") {
			send({
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion: "2024-11-05",
					capabilities: { tools: {} },
					serverInfo: { name: "recordly-mcp", version: "1.0.0" },
				},
			});
		} else if (method === "notifications/initialized") {
			// No response needed
		} else if (method === "tools/list") {
			send({
				jsonrpc: "2.0",
				id,
				result: { tools: TOOLS },
			});
		} else if (method === "tools/call") {
			const { name, arguments: args = {} } = params || {};
			try {
				let resultData = null;

				if (name.startsWith("recordly_project_")) {
 resultData = await projectCommand(name.slice("recordly_project_".length), args.inputPath, args);
 } else if (name === "recordly_doctor") {
					resultData = checkDoctor();
				} else if (name === "recordly_list_sources") {
					resultData = await listSources();
				} else if (name === "recordly_start_recording") {
					let target = null;
					if (args.windowName) {
						const windows = await listWindows();
						const q = args.windowName.toLowerCase();
						target = windows.find((w) => w.name?.toLowerCase().includes(q) || w.appName?.toLowerCase().includes(q));
						if (!target) {
							throw new Error(`Window matching "${args.windowName}" not found.`);
						}
					} else if (args.displayId) {
						target = { type: "display", display_id: args.displayId };
					}

					resultData = await startRecording({
						sessionId: args.sessionId,
						target,
						fps: args.fps || 60,
						mic: Boolean(args.mic),
						systemAudio: Boolean(args.systemAudio),
					});
				} else if (name === "recordly_mark_action") {
					resultData = await markAction(args.sessionId, {
						action: args.action,
						x: args.x,
						y: args.y,
					});
				} else if (name === "recordly_stop_and_export") {
					const session = await stopRecording(args.sessionId);
					const { projectPath, zoomRegionsCount, trimRegionsCount, captionsCount } = await buildProjectFile({
						videoPath: session.videoPath,
						telemetryPath: session.telemetryPath,
						markersPath: session.markersPath,
						presetName: args.preset || "modern-gradient",
						autoZoom: args.autoZoom !== false,
						durationMs: session.durationMs,
						trims: args.trims || [],
						speedRamps: args.speedRamps || [],
						captionFile: args.captionsPath || null,
						captionStyle: args.captionStyle || "pop",
						clickEffect: args.clickEffect || "ripple",
					});

					const finalOutputPath =
						args.outputPath ||
						path.join(
							path.dirname(session.videoPath),
							`${path.basename(session.videoPath, path.extname(session.videoPath))}-polished.mp4`,
						);

					await renderProject({
						projectPath,
						outputPath: finalOutputPath,
					});

					resultData = {
						status: "completed",
						sessionId: session.sessionId,
						durationSeconds: (session.durationMs / 1000).toFixed(1),
						videoPath: finalOutputPath,
						projectPath,
						zoomRegionsCount,
						trimRegionsCount,
						captionsCount,
					};
				} else if (name === "recordly_render_video") {
					const ext = path.extname(args.inputPath).toLowerCase();
					let proj = args.inputPath;
					if (ext !== ".recordly") {
						const res = await buildProjectFile({
							videoPath: path.resolve(args.inputPath),
							telemetryPath: `${args.inputPath}.cursor.json`,
							presetName: args.preset || "modern-gradient",
							trims: args.trims || [],
							captionFile: args.captionsPath || null,
							captionStyle: args.captionStyle || "pop",
							clickEffect: args.clickEffect || "ripple",
						});
						proj = res.projectPath;
					}

					await renderProject({
						projectPath: proj,
						outputPath: path.resolve(args.outputPath),
					});

					resultData = {
						status: "completed",
						outputPath: path.resolve(args.outputPath),
					};
				} else {
					throw new Error(`Tool "${name}" not recognized.`);
				}

				send({
					jsonrpc: "2.0",
					id,
					result: {
						content: [
							{
								type: "text",
								text: JSON.stringify(resultData, null, 2),
							},
						],
					},
				});
			} catch (err) {
				send({
					jsonrpc: "2.0",
					id,
					result: {
						isError: true,
						content: [
							{
								type: "text",
								text: `Error: ${err.message}`,
							},
						],
					},
				});
			}
		} else {
			send({
				jsonrpc: "2.0",
				id,
				error: { code: -32601, message: `Method not found: ${method}` },
			});
		}
	});
}
