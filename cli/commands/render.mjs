import path from "node:path";
import { renderProject } from "../core/headlessRenderer.mjs";
import { buildProjectFile } from "../core/projectBuilder.mjs";

export async function runRender(targetPath, args = {}) {
	if (!targetPath) {
		console.error("Error: Please provide a project (.recordly) or video file to render.");
		process.exit(1);
	}

	const ext = path.extname(targetPath).toLowerCase();
	let projectFile = targetPath;
	const outputPath = args.output || args.o || `${targetPath.replace(/\.[^.]+$/, "")}.rendered.mp4`;

	if (ext !== ".recordly") {
		// Wrap video into an automated .recordly project
		const telemetryPath = `${targetPath}.cursor.json`;
		const markersPath = `${targetPath}.markers.json`;

		const trims = args.trim ? (Array.isArray(args.trim) ? args.trim : [args.trim]) : [];
		const speedRamps = args.speed ? (Array.isArray(args.speed) ? args.speed : [args.speed]) : [];

		const { projectPath, trimRegionsCount, speedRegionsCount, captionsCount } = await buildProjectFile({
			videoPath: path.resolve(targetPath),
			telemetryPath,
			markersPath,
			presetName: args.preset || "modern-gradient",
			autoZoom: args["auto-zoom"] !== false && args.autoZoom !== false,
			trims,
			speedRamps,
			captionFile: args.captions || args.subtitles,
			captionStyle: args["caption-style"] || "pop",
			captionFontSize: args["caption-size"] ? Number.parseInt(args["caption-size"], 10) : 30,
			clickEffect: args["click-effect"] || "ripple",
			clickColor: args["click-color"] || "#3b82f6",
			zoomEasing: args["zoom-easing"] || "ease-out",
			motionBlur: args["motion-blur"] ? Number.parseFloat(args["motion-blur"]) : 0.5,
		});
		projectFile = projectPath;

		if (!args.json) {
			console.log(`[Recordly] Applied:`);
			if (trimRegionsCount > 0) console.log(`  ✂️  Trims: ${trimRegionsCount} cut regions`);
			if (speedRegionsCount > 0) console.log(`  ⚡ Speed Ramps: ${speedRegionsCount} regions`);
			if (captionsCount > 0) console.log(`  💬 Captions: ${captionsCount} subtitle cues`);
		}
	}

	if (!args.json) {
		console.log(`[Recordly] Starting headless render:`);
		console.log(`  Project: ${projectFile}`);
		console.log(`  Output:  ${outputPath}`);
	}

	try {
		const result = await renderProject({
			projectPath: projectFile,
			outputPath: path.resolve(outputPath),
			quality: args.quality || "good",
			fps: args.fps ? Number.parseInt(args.fps, 10) : 60,
			encodingMode: args.mode || "balanced",
			onProgress: args.json
				? undefined
				: (p) => {
						if (p.text.includes("[smoke-export]")) {
							process.stdout.write(p.text);
						}
					},
		});

		if (args.json) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			console.log(`\n✅ Render complete: ${result.outputPath}\n`);
		}
	} catch (err) {
		if (args.json) {
			console.log(JSON.stringify({ status: "error", error: err.message }));
		} else {
			console.error(`\n❌ Render failed: ${err.message}\n`);
		}
		process.exit(1);
	}
}
