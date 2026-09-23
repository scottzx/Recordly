import path from "node:path";
import { startRecording, stopRecording } from "../core/capture.mjs";
import { renderProject } from "../core/headlessRenderer.mjs";
import { buildProjectFile } from "../core/projectBuilder.mjs";
import { getLatestActiveSession, getSession } from "../core/session.mjs";
import { listWindows } from "../core/sources.mjs";

export async function runRecord(subcommand, args = {}) {
	if (subcommand === "start") {
		let target = null;
		if (args.window) {
			const windows = await listWindows();
			const query = String(args.window).toLowerCase();
			const matched = windows.find(
				(w) =>
					w.id === args.window ||
					(w.name && w.name.toLowerCase().includes(query)) ||
					(w.appName && w.appName.toLowerCase().includes(query)),
			);
			if (!matched) {
				const err = `Window matching "${args.window}" not found. Run 'recordly sources list' to inspect available windows.`;
				if (args.json) {
					console.log(JSON.stringify({ status: "error", error: err }));
				} else {
					console.error(err);
				}
				process.exit(1);
			}
			target = matched;
		} else if (args.display) {
			target = { type: "display", display_id: String(args.display) };
		}

		try {
			const res = await startRecording({
				sessionId: args.session || args["session-id"],
				outputPath: args.output || args.o,
				target,
				fps: args.fps ? Number.parseInt(args.fps, 10) : 60,
				mic: Boolean(args.mic),
				systemAudio: Boolean(args["system-audio"] || args.systemAudio),
			});

			if (args.json) {
				console.log(JSON.stringify(res, null, 2));
			} else {
				console.log("\n[Recordly] 🎬 Recording started!");
				console.log(`  Session ID: ${res.sessionId}`);
				console.log(`  Target:     ${target ? target.name || target.id : "Main Display"}`);
				console.log(`  Video Path: ${res.videoPath}`);
				console.log(`  Telemetry:  ${res.telemetryPath}`);
				console.log("\nRun 'recordly record stop' to complete recording.\n");
			}
		} catch (err) {
			if (args.json) {
				console.log(JSON.stringify({ status: "error", error: err.message }));
			} else {
				console.error(`\n❌ Failed to start recording: ${err.message}\n`);
			}
			process.exit(1);
		}
	} else if (subcommand === "stop") {
		const sessionId = args.session || args["session-id"];
		try {
			const session = await stopRecording(sessionId);
			let finalVideoPath = session.videoPath;
			let projectPath = null;
			let zoomCount = 0;
			let trimCount = 0;
			let captionCount = 0;

			const shouldAutoZoom = args["auto-zoom"] !== false && args.autoZoom !== false;
			const shouldRender =
				args.render ||
				args["auto-zoom"] ||
				args.preset ||
				args.trim ||
				args.captions ||
				args.speed;

			if (shouldRender) {
				if (!args.json) {
					console.log("\n[Recordly] 🛠  Generating project with zooms, trims, and effects...");
				}

				const trims = args.trim ? (Array.isArray(args.trim) ? args.trim : [args.trim]) : [];
				const speedRamps = args.speed ? (Array.isArray(args.speed) ? args.speed : [args.speed]) : [];

				const buildRes = await buildProjectFile({
					videoPath: session.videoPath,
					telemetryPath: session.telemetryPath,
					markersPath: session.markersPath,
					presetName: args.preset || "modern-gradient",
					autoZoom: shouldAutoZoom,
					durationMs: session.durationMs,
					trims,
					speedRamps,
					captionFile: args.captions || args.subtitles,
					captionStyle: args["caption-style"] || "pop",
					clickEffect: args["click-effect"] || "ripple",
					clickColor: args["click-color"] || "#3b82f6",
					zoomEasing: args["zoom-easing"] || "ease-out",
					motionBlur: args["motion-blur"] ? Number.parseFloat(args["motion-blur"]) : 0.5,
				});

				projectPath = buildRes.projectPath;
				zoomCount = buildRes.zoomRegionsCount;
				trimCount = buildRes.trimRegionsCount;
				captionCount = buildRes.captionsCount;

				const renderedOutput =
					args.output ||
					path.join(
						path.dirname(session.videoPath),
						`${path.basename(session.videoPath, path.extname(session.videoPath))}-polished.mp4`,
					);

				if (!args.json) {
					console.log(`[Recordly] 🎨 Rendering polished video:`);
					if (zoomCount > 0) console.log(`  🔍 Camera Zooms: ${zoomCount}`);
					if (trimCount > 0) console.log(`  ✂️  Cuts/Trims:   ${trimCount}`);
					if (captionCount > 0) console.log(`  💬 Subtitles:    ${captionCount}`);
				}

				await renderProject({
					projectPath,
					outputPath: renderedOutput,
					fps: args.fps ? Number.parseInt(args.fps, 10) : 60,
					quality: args.quality || "good",
				});

				finalVideoPath = renderedOutput;
			}

			if (args.json) {
				console.log(
					JSON.stringify(
						{
							status: "stopped",
							sessionId: session.sessionId,
							durationMs: session.durationMs,
							rawVideoPath: session.videoPath,
							videoPath: finalVideoPath,
							projectPath,
							zoomCount,
							trimCount,
							captionCount,
						},
						null,
						2,
					),
				);
			} else {
				console.log("\n✅ Recording stopped and finalized!");
				console.log(`  Duration: ${(session.durationMs / 1000).toFixed(1)}s`);
				console.log(`  Output:   ${finalVideoPath}`);
				if (projectPath) {
					console.log(`  Project:  ${projectPath}`);
				}
				console.log("");
			}
		} catch (err) {
			if (args.json) {
				console.log(JSON.stringify({ status: "error", error: err.message }));
			} else {
				console.error(`\n❌ Failed to stop recording: ${err.message}\n`);
			}
			process.exit(1);
		}
	} else if (subcommand === "status") {
		const sessionId = args.session || args["session-id"];
		const session = sessionId ? await getSession(sessionId) : await getLatestActiveSession();

		if (args.json) {
			console.log(JSON.stringify(session || { status: "idle" }, null, 2));
		} else {
			if (!session) {
				console.log("No active recording session.");
			} else {
				console.log(`\nSession: ${session.sessionId}`);
				console.log(`Status:  ${session.status}`);
				console.log(`Started: ${session.startedAt}`);
				console.log(`Path:    ${session.videoPath}\n`);
			}
		}
	} else {
		console.error(`Unknown record command: "${subcommand}". Use start, stop, or status.`);
		process.exit(1);
	}
}
