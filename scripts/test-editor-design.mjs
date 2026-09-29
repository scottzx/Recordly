// Build first, then: node scripts/test-editor-design.mjs
// Runs against generated media in an isolated profile, never a user's project.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { emptyEditingProject, insertLibraryRecording } from "../shared/mediaLibrary.ts";
import { fingerprint } from "../shared/node/media.ts";
import { getFfmpegPath } from "../cli/core/paths.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-design-"));
const videoPath = path.join(dir, "talk.mp4");
execFileSync(
	getFfmpegPath(),
	[
		"-y",
		"-f",
		"lavfi",
		"-i",
		"color=blue:s=640x360:d=5",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:sample_rate=48000",
		"-shortest",
		"-c:v",
		"libx264",
		"-c:a",
		"aac",
		videoPath,
	],
	{ stdio: "ignore" },
);
const media = {
	id: "sample",
	name: "合成口播",
	videoPath,
	createdAt: 0,
	status: "ready",
	durationMs: 5000,
	width: 640,
	height: 360,
	hasAudio: true,
};
let project = insertLibraryRecording(emptyEditingProject(), media, 0, "first");
project = insertLibraryRecording(project, media, 5000, "second");
project.version = 5;
project.editor = { clipRegions: [], padding: 0 };
project.composition.transcript = {
	documents: [
		{
			schemaVersion: 1,
			id: "t",
			revision: "r",
			assetId: "sample:audio:asset",
			sourceId: "sample:audio",
			fingerprint: await fingerprint(videoPath),
			durationMs: 5000,
			engine: "fixture",
			model: "fixture",
			language: "zh",
			optionsHash: "x",
			segments: [
				{ id: "s1", sourceStartMs: 0, sourceEndMs: 2000, text: "这是第一句话。" },
				{
					id: "s2",
					sourceStartMs: 3000,
					sourceEndMs: 5000,
					text: "这是需要保留的第二句话。",
				},
			],
			silenceIntervals: [],
		},
	],
	sourceSelections: { first: "sample:audio", second: "sample:audio" },
	corrections: {},
};
await fs.writeFile(path.join(dir, "talk.recordly"), JSON.stringify(project));
const env = { ...process.env, RECORDLY_TEST_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
execFileSync(createRequire(import.meta.url)("electron"), ["scripts/fixtures/editor-design.cjs"], {
	cwd: process.cwd(),
	env,
	stdio: "inherit",
	timeout: 90000,
});
console.log(`Design evidence: ${dir}`);
