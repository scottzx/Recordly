import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { oralcutCommand } from "./oralcut.mjs";
import { getFfmpegPath } from "./paths.mjs";
import { projectRevision } from "../../shared/review.ts";
import { fingerprint, updateLibraryEntry } from "../../shared/node/media.ts";
import { callOralcutTool, oralcutTools } from "../mcp/oralcutTools.mjs";
let dir, base, file, transcript, oldUserData;
beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-oralcut-"));
	oldUserData = process.env.RECORDLY_USER_DATA;
	process.env.RECORDLY_USER_DATA = dir;
	const media = path.join(dir, "talk.mp4");
	execFileSync(
		getFfmpegPath(),
		[
			"-y",
			"-f",
			"lavfi",
			"-i",
			"color=blue:s=160x90:d=4",
			"-f",
			"lavfi",
			"-i",
			"anullsrc=r=16000:cl=mono",
			"-shortest",
			"-c:v",
			"libx264",
			"-c:a",
			"aac",
			media,
		],
		{ stdio: "ignore" },
	);
	const imported = await oralcutCommand("library", "import", media);
	file = path.join(dir, "base.recordly");
	const result = await oralcutCommand("project", "create", undefined, {
		media: [imported.id, imported.id],
		output: file,
	});
	base = result.project;
	const source = base.composition.sources.find((s) => s.kind === "audio");
	transcript = {
		schemaVersion: 1,
		baseRevision: await projectRevision(base),
		complete: true,
		errors: [],
		documents: [
			{
				schemaVersion: 1,
				id: "t",
				revision: "r",
				sourceId: source.id,
				assetId: source.assetId,
				fingerprint: await fingerprint(media),
				durationMs: 4000,
				engine: "fixture",
				model: "",
				language: "auto",
				optionsHash: "x",
				segments: [{ id: "s", sourceStartMs: 0, sourceEndMs: 1000, text: "Hello" }],
				silenceIntervals: [{ startMs: 1000, endMs: 4000 }],
			},
		],
		sourceSelections: Object.fromEntries(
			base.composition.shots.map((s) => [s.instanceId, source.id]),
		),
		corrections: {},
	};
	await fs.writeFile(path.join(dir, "transcript.json"), JSON.stringify(transcript));
});
afterAll(async () => {
	if (oldUserData === undefined) delete process.env.RECORDLY_USER_DATA;
	else process.env.RECORDLY_USER_DATA = oldUserData;
	await fs.rm(dir, { recursive: true, force: true });
});
describe("oralcut CLI / MCP integration with real media", () => {
	it("creates independent instances and real thumbnails", async () => {
		expect(base.composition.shots[0].instanceId).not.toBe(base.composition.shots[1].instanceId);
		const entries = await oralcutCommand("library", "list");
		expect(entries[0].durationMs).toBeGreaterThan(3900);
		expect((await fs.stat(entries[0].thumbnailPath)).size).toBeGreaterThan(100);
	});
	it("applies exact selections through the same core and rejects an existing output", async () => {
		const reviewPath = path.join(dir, "review.json");
		await oralcutCommand("review", "create", file, {
			transcript: path.join(dir, "transcript.json"),
			pauses: true,
			output: reviewPath,
		});
		const inspection = await callOralcutTool("recordly_review_inspect", {
			inputPath: reviewPath,
		});
		expect(inspection.plan.suggestions).toHaveLength(2);
		const ids = [inspection.plan.suggestions[1].id];
		const dry = await callOralcutTool("recordly_review_apply", {
			inputPath: reviewPath,
			projectPath: file,
			acceptedIds: ids,
			dryRun: true,
		});
		expect(dry.removedMs).toBe(2500);
		const output = path.join(dir, "roughcut.recordly");
		const result = await oralcutCommand("review", "apply", reviewPath, {
			project: file,
			acceptedIds: ids,
			output,
		});
		expect(result.removedMs).toBe(dry.removedMs);
		const saved = JSON.parse(await fs.readFile(output, "utf8"));
		expect(saved.version).toBe(5);
		expect(saved.composition.shots[0]).toEqual(base.composition.shots[0]);
		await expect(
			oralcutCommand("review", "apply", reviewPath, {
				project: file,
				acceptedIds: ids,
				output,
			}),
		).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
		expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual(base);
	});
	it("preserves independent metadata updates while analysis completes", async () => {
		const entries = await oralcutCommand("library", "list");
		const directory = path.join(dir, "recordings", "Library"),
			id = entries[0].id;
		await Promise.all([
			updateLibraryEntry(directory, id, { favorite: true }),
			updateLibraryEntry(directory, id, { tags: ["talk"] }),
			updateLibraryEntry(directory, id, { analysisStatus: "ready" }),
		]);
		const saved = JSON.parse(await fs.readFile(path.join(directory, `${id}.json`), "utf8"));
		expect(saved).toMatchObject({ favorite: true, tags: ["talk"], analysisStatus: "ready" });
	});

	it("rejects partial transcripts and unknown MCP arguments", async () => {
		const partial = path.join(dir, "partial.json");
		await fs.writeFile(partial, JSON.stringify({ ...transcript, complete: false }));
		await expect(
			oralcutCommand("review", "create", file, {
				transcript: partial,
				pauses: true,
				output: path.join(dir, "invalid.json"),
			}),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		await expect(
			callOralcutTool("recordly_library_list", { unrecognized: true }),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		expect(oralcutTools).toHaveLength(8);
		expect(oralcutTools.every((t) => t.inputSchema.additionalProperties === false)).toBe(true);
	});
	it("rejects media identity changes before output publication", async () => {
		const reviewPath = path.join(dir, "changed-review.json");
		await oralcutCommand("review", "create", file, {
			transcript: path.join(dir, "transcript.json"),
			pauses: true,
			output: reviewPath,
		});
		const media = base.composition.assets[0].path;
		const stat = await fs.stat(media);
		await fs.utimes(media, new Date(), new Date(stat.mtimeMs + 10000));
		await expect(
			oralcutCommand("review", "apply", reviewPath, {
				project: file,
				acceptedIds: [],
				output: path.join(dir, "changed.recordly"),
			}),
		).rejects.toMatchObject({ code: "MEDIA_CHANGED" });
	});
});
