// Generates synthetic recordings only; requires `npx vite build`.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const root = path.resolve(import.meta.dirname, "..");
const { emptyEditingProject, insertLibraryRecording } = await import(
	`${root}/shared/mediaLibrary.ts`
);
const { applyOperation, validateComposition } = await import(`${root}/shared/composition.ts`);
const { renderProject } = await import(`${root}/cli/core/headlessRenderer.mjs`);
const { projectCommand, probeMedia } = await import(`${root}/cli/core/compositionProject.mjs`);
const { getFfmpegPath } = await import(`${root}/cli/core/paths.mjs`);
const run = promisify(execFile),
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-library-export-"));
const file = (n) => path.join(dir, n);
const ffmpeg = async (args) =>
	run(getFfmpegPath(), ["-v", "error", "-y", ...args], { maxBuffer: 8 * 1024 * 1024 });
try {
	const recordings = [];
	for (const [id, color, tone, duration] of [
		["A", "red", 440, 2],
		["B", "blue", 660, 3],
		["C", "green", 880, 1],
	]) {
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			`color=${color}:size=640x360:rate=30`,
			"-f",
			"lavfi",
			"-i",
			`sine=frequency=${tone}:sample_rate=48000`,
			"-t",
			String(duration),
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			file(`${id}.mp4`),
		]);
		recordings.push({
			id,
			name: id,
			videoPath: file(`${id}.mp4`),
			createdAt: 1,
			status: "ready",
			durationMs: duration * 1000,
			width: 640,
			height: 360,
			hasAudio: true,
		});
	}
	let p = emptyEditingProject();
	p.composition.width = 640;
	p.composition.height = 360;
	p.editor = { clipRegions: [], padding: 0, borderRadius: 0, shadowIntensity: 0 };
	for (const media of recordings) p = insertLibraryRecording(p, media, Infinity, media.id);
	p = insertLibraryRecording(p, recordings[0], 3000, "A-again");
	p.composition = applyOperation(p.composition, {
		type: "trim",
		clipId: "A-again",
		sourceStartMs: 500,
		sourceEndMs: 1500,
	});
	p.composition = applyOperation(p.composition, { type: "move", id: "C", index: 0 });
	assert.deepEqual(validateComposition(p), []);
	await fs.writeFile(file("sequence.recordly"), JSON.stringify(p));
	const checked = await projectCommand("validate", file("sequence.recordly"));
	assert.equal(checked.valid, true, checked.errors?.join("\n"));

	await renderProject({
		projectPath: file("sequence.recordly"),
		outputPath: file("output.mp4"),
		fps: 30,
		timeoutMs: 180000,
	});
	const meta = await probeMedia(file("output.mp4"));
	assert.ok(meta.hasAudio && meta.hasVideo);
	assert.ok(Math.abs(meta.durationMs - 7000) < 80);
	const pixel = async (t) => {
		const { stdout } = await run(
			getFfmpegPath(),
			[
				"-v",
				"error",
				"-ss",
				String(t),
				"-i",
				file("output.mp4"),
				"-vf",
				"format=rgb24,crop=1:1:320:180",
				"-frames:v",
				"1",
				"-f",
				"rawvideo",
				"-",
			],
			{ encoding: "buffer" },
		);
		return [...stdout.subarray(0, 3)];
	};
	for (const [t, color] of [
		[0.5, "green"],
		[1.5, "red"],
		[3.5, "blue"],
		[4.5, "red"],
		[5.5, "blue"],
	]) {
		const [r, g, b] = await pixel(t);
		assert.ok(
			color === "red"
				? r > 180 && b < 40
				: color === "green"
					? g > 90 && r < 40
					: b > 180 && r < 40,
			`${t}: ${color} expected, got ${[r, g, b]}`,
		);
	}
	await ffmpeg([
		"-i",
		file("output.mp4"),
		"-vn",
		"-ac",
		"1",
		"-ar",
		"48000",
		"-f",
		"f32le",
		file("audio.raw"),
	]);
	const pcm = await fs.readFile(file("audio.raw"));
	const amplitude = (t, hz) => {
		let x = 0,
			y = 0,
			n = 12000;
		for (let i = 0; i < n; i++) {
			const s = pcm.readFloatLE((Math.floor(t * 48000) + i) * 4);
			x += s * Math.cos((2 * Math.PI * hz * i) / 48000);
			y += s * Math.sin((2 * Math.PI * hz * i) / 48000);
		}
		return (2 * Math.hypot(x, y)) / n;
	};
	for (const [t, hz] of [
		[0.3, 880],
		[1.3, 440],
		[3.3, 660],
		[4.3, 440],
		[5.3, 660],
	])
		assert.ok(amplitude(t, hz) > 0.05, `Missing source sound ${hz} at ${t}`);
	console.log(
		JSON.stringify(
			{
				success: true,
				output: file("output.mp4"),
				durationMs: meta.durationMs,
				checks: [
					"source-free project reload",
					"A/B/C actual pixel colors",
					"inserting inside B",
					"independent repeated A trim",
					"C reorder",
					"each segment audio frequency",
					"7 second MP4 export",
				],
			},
			null,
			2,
		),
	);
} finally {
	await fs.rm(dir, { recursive: true, force: true });
}
