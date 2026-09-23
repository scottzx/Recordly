import { beforeAll, afterAll, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getFfmpegPath } from "./paths.mjs";
import { projectCommand } from "./compositionProject.mjs";
let dir, input;
beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-composition-test-"));
	const video = path.join(dir, "main.mp4");
	input = path.join(dir, "input.recordly");
	execFileSync(getFfmpegPath(), [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=blue:s=64x64:r=30",
		"-t",
		"1",
		"-c:v",
		"libx264",
		video,
	]);
	await fs.writeFile(
		input,
		JSON.stringify({
			version: 2,
			videoPath: video,
			editor: {
				clipRegions: [{ id: "main", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 }],
			},
		}),
	);
});
afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});
it("inspects source and output positions with stable IDs", async () => {
	const value = await projectCommand("inspect", input);
	expect(value.timeline[0]).toMatchObject({ startMs: 0, endMs: 1000, shot: { id: "main" } });
});
it("writes a new, deterministic v3 project and leaves the original intact", async () => {
	const output = path.join(dir, "out.recordly");
	const planData = {
		version: 1,
		operations: [
			{
				type: "insert-card",
				atMs: 0,
				card: { id: "intro", kind: "card", template: "intro", durationMs: 3000 },
			},
		],
	};
	await projectCommand("apply", input, { planData, output });
	const first = await fs.readFile(output, "utf8");
	await projectCommand("apply", input, { planData, output });
	expect(await fs.readFile(output, "utf8")).toBe(first);
	expect(JSON.parse(await fs.readFile(input, "utf8")).version).toBe(2);
	expect((await projectCommand("validate", output)).valid).toBe(true);
});
it("rejects invalid ranges before writing any project", async () => {
	const output = path.join(dir, "invalid.recordly");
	await expect(
		projectCommand("apply", input, {
			output,
			planData: {
				version: 1,
				composition: {
					shots: [
						{
							id: "too-long",
							kind: "main",
							sourceStartMs: 0,
							sourceEndMs: 999999,
							speed: 1,
							layout: { mode: "screen" },
						},
					],
				},
			},
		}),
	).rejects.toThrow(/exceeds/);
	await expect(fs.stat(output)).rejects.toThrow();
});
it("reports missing external assets and refuses replacing the input", async () => {
	await expect(
		projectCommand("apply", input, { output: input, planData: { version: 1 } }),
	).rejects.toThrow(/overwrites/);
	await expect(
		projectCommand("apply", input, {
			output: path.join(dir, "missing.recordly"),
			planData: {
				version: 1,
				composition: {
					assets: [{ id: "missing", kind: "video", path: path.join(dir, "none.mp4") }],
				},
			},
		}),
	).rejects.toThrow(/Missing/);
});
