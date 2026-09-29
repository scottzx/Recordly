// Synthetic media only; exercises the new v5 review output through the real renderer.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { emptyEditingProject, insertLibraryRecording } from "../shared/mediaLibrary.ts";
import { compileReview, projectRevision } from "../shared/review.ts";
import { projectTranscript } from "../shared/transcript.ts";
import { renderProject } from "../cli/core/headlessRenderer.mjs";
import { probeMedia, projectCommand } from "../cli/core/compositionProject.mjs";
import { getFfmpegPath } from "../cli/core/paths.mjs";
const run = promisify(execFile),
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-oralcut-export-"));
const file = (n) => path.join(dir, n);
try {
	await run(getFfmpegPath(), [
		"-y",
		"-f",
		"lavfi",
		"-i",
		"color=blue:s=320x180:r=30",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:sample_rate=48000",
		"-t",
		"4",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		file("talk.mp4"),
	]);
	const media = {
		id: "talk",
		name: "Talk",
		videoPath: file("talk.mp4"),
		status: "ready",
		createdAt: 0,
		durationMs: 4000,
		width: 320,
		height: 180,
		hasAudio: true,
	};
	let base = insertLibraryRecording(emptyEditingProject(), media, 0, "one");
	base = insertLibraryRecording(base, media, 4000, "two");
	base.composition.width = 320;
	base.composition.height = 180;
	base.editor = { clipRegions: [], padding: 0, borderRadius: 0, shadowIntensity: 0 };
	const state = {
		documents: [
			{
				schemaVersion: 1,
				id: "t",
				revision: "r",
				assetId: "talk:audio:asset",
				sourceId: "talk:audio",
				fingerprint: "fixture",
				durationMs: 4000,
				engine: "fixture",
				model: "fixture",
				language: "en",
				optionsHash: "x",
				segments: [
					{
						id: "first",
						sourceStartMs: 1000,
						sourceEndMs: 3000,
						text: "Cut only the second occurrence.",
					},
				],
				silenceIntervals: [],
			},
		],
		sourceSelections: { one: "talk:audio", two: "talk:audio" },
		corrections: {},
	};
	base.composition.transcript = state;
	const target = projectTranscript(base).find((r) => r.instanceId === "two");
	const plan = {
		schemaVersion: 1,
		id: "test-review",
		baseRevision: await projectRevision(base),
		producer: { kind: "manual", name: "export-test" },
		suggestions: [
			{
				id: "cut",
				kind: "manual",
				action: "remove-range",
				reason: "Synthetic fixture",
				target,
			},
		],
	};
	const result = await compileReview(base, state, plan, ["cut"]);
	assert.equal(result.removedMs, 2000);
	await fs.writeFile(file("roughcut.recordly"), JSON.stringify(result.project));
	await renderProject({
		projectPath: file("roughcut.recordly"),
		outputPath: file("output.mp4"),
		fps: 30,
		timeoutMs: 180000,
	});
	const meta = await probeMedia(file("output.mp4"));
	assert.ok(meta.hasAudio && meta.hasVideo);
	assert.ok(Math.abs(meta.durationMs - 6000) < 80);
	const { stdout } = await run(
		getFfmpegPath(),
		[
			"-v",
			"error",
			"-ss",
			"5.5",
			"-i",
			file("output.mp4"),
			"-vf",
			"format=rgb24,crop=1:1:160:90",
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-",
		],
		{ encoding: "buffer" },
	);
	assert.ok(
		stdout[2] > 180 && stdout[0] < 40,
		"Second occurrence retains its blue video after the cut",
	);
	await run(getFfmpegPath(), [
		"-v",
		"error",
		"-y",
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
	let sum = 0;
	for (let i = 240000; i < 264000; i++) sum += pcm.readFloatLE(i * 4) ** 2;
	assert.ok(Math.sqrt(sum / 24000) > 0.03, "Narration remains audible after the cut");
	await projectCommand("preview", file("roughcut.recordly"), {
		from: 4500,
		to: 5500,
		output: file("preview.mp4"),
	});
	const excerpt = await probeMedia(file("preview.mp4"));
	assert.ok(excerpt.hasAudio && Math.abs(excerpt.durationMs - 1000) < 80);
	console.log(
		JSON.stringify(
			{
				success: true,
				output: file("output.mp4"),
				durationMs: meta.durationMs,
				checks: [
					"v5 round trip",
					"selective repeated-instance cut",
					"real blue video frames",
					"440 Hz narration after cut",
					"1 second CLI preview",
				],
			},
			null,
			2,
		),
	);
} finally {
	if (process.env.RECORDLY_KEEP_TEST_MEDIA !== "1")
		await fs.rm(dir, { recursive: true, force: true });
}
