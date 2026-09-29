// Real desktop smoke: uses only synthetic media and an isolated app profile. Build first.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
const root = process.cwd();
const { emptyEditingProject, insertLibraryRecording } = await import(
	`${root}/shared/mediaLibrary.ts`
);
const { fingerprint } = await import(`${root}/shared/node/media.ts`);
const { getFfmpegPath } = await import(`${root}/cli/core/paths.mjs`);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-gui-"));
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
let p = insertLibraryRecording(emptyEditingProject(), media, 0, "first");
p = insertLibraryRecording(p, media, 5000, "second");
p.version = 5;
p.editor = { clipRegions: [], padding: 0 };
p.composition.transcript = {
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
p.composition.assets.push(
	...["candidate-a", "candidate-b"].map((id) => ({
		id,
		kind: "video",
		path: videoPath,
		durationMs: 5000,
		width: 640,
		height: 360,
		hasAudio: true,
	})),
);
await fs.writeFile(path.join(dir, "talk.recordly"), JSON.stringify(p));
process.env.RECORDLY_USER_DATA = path.join(dir, "userdata");
const { oralcutCommand } = await import("../cli/core/oralcut.mjs");
await oralcutCommand("library", "import", videoPath);
const { createRequire } = await import("node:module");
const electron = createRequire(import.meta.url)("electron");
const env = { ...process.env, RECORDLY_TEST_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
for (const mode of ["edit", "reopen"]) {
	execFileSync(electron, [path.join(root, "scripts/fixtures/oralcut-desktop.cjs")], {
		cwd: root,
		env: { ...env, RECORDLY_TEST_MODE: mode },
		stdio: "inherit",
		timeout: 100000,
	});
	if (mode === "edit") {
		const cliOutput = path.join(dir, "parity.cli.recordly");
		await oralcutCommand("review", "apply", path.join(dir, "parity.review.json"), {
			project: path.join(dir, "parity.base.recordly"),
			acceptedIds: ["manual-0"],
			output: cliOutput,
		});
		const { projectRevision } = await import("../shared/review.ts");
		const gui = JSON.parse(await fs.readFile(path.join(dir, "parity.gui.recordly"), "utf8"));
		const cli = JSON.parse(await fs.readFile(cliOutput, "utf8"));
		if ((await projectRevision(gui)) !== (await projectRevision(cli)))
			throw Error("GUI/CLI persisted editing state differs");
		console.log("GUI_CLI_PARITY_SUCCESS");
	}
}
console.log(`Desktop evidence: ${dir}`);
