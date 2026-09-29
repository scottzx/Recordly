import { describe, it, expect } from "vitest";
import { emptyEditingProject, insertLibraryRecording } from "./mediaLibrary";
import { applyOperation, migrateProject } from "./composition";
import { prepareTranscriptProject, projectTranscript, type TranscriptState } from "./transcript";
import { compileReview, pausePlan, projectRevision, type ReviewPlan } from "./review";
function fixture() {
	let project = emptyEditingProject();
	const media = {
		id: "media",
		name: "Talk",
		videoPath: "/talk.mp4",
		createdAt: 0,
		status: "ready" as const,
		durationMs: 10000,
		width: 1920,
		height: 1080,
		hasAudio: true,
	};
	project = insertLibraryRecording(project, media, 0, "first");
	project = insertLibraryRecording(project, media, 10000, "second");
	const state: TranscriptState = {
		documents: [
			{
				schemaVersion: 1,
				id: "doc",
				revision: "rev",
				assetId: "media:audio:asset",
				sourceId: "media:audio",
				fingerprint: "fp",
				durationMs: 10000,
				engine: "fixture",
				model: "fixture",
				language: "zh",
				optionsHash: "x",
				segments: [
					{ id: "s1", sourceStartMs: 1000, sourceEndMs: 3000, text: "Hello" },
					{ id: "s2", sourceStartMs: 7000, sourceEndMs: 8000, text: "Keep" },
				],
				silenceIntervals: [{ startMs: 3000, endMs: 6000 }],
			},
		],
		sourceSelections: { first: "media:audio", second: "media:audio" },
		corrections: {},
	};
	project.composition.transcript = state;
	return { project, state };
}
async function planForSecond() {
	const { project, state } = fixture();
	const row = projectTranscript(project)[2];
	const plan: ReviewPlan = {
		schemaVersion: 1,
		id: "review",
		baseRevision: await projectRevision(project),
		producer: { kind: "manual", name: "test" },
		suggestions: [
			{
				id: "cut",
				kind: "manual",
				action: "remove-range",
				reason: "cut sentence",
				target: row,
			},
		],
	};
	return { project, state, plan };
}
describe("transcript review transactions", () => {
	it("projects repeated instances independently and clips only the selected instance", async () => {
		const { project, state, plan } = await planForSecond();
		project.editor.autoCaptions = [
			{ id: "caption", text: "Hello", startMs: 11000, endMs: 13000 },
		];
		plan.baseRevision = await projectRevision(project);
		const result = await compileReview(project, state, plan, ["cut"]);
		expect(result.removedMs).toBe(2000);
		expect(result.project.composition.shots[0]).toEqual(project.composition.shots[0]);
		expect(result.project.editor.autoCaptions).toEqual([]);
		expect(project.composition.shots).toHaveLength(2);
		expect(
			projectTranscript(result.project)
				.filter((r) => r.instanceId === "second")
				.map((r) => r.text),
		).toEqual(["Keep"]);
		expect(await compileReview(project, state, plan, ["cut"])).toEqual(result);
	});
	it("uses independent source offsets and speed", () => {
		const { project } = fixture();
		project.composition = applyOperation(project.composition, {
			type: "speed",
			clipId: "second",
			speed: 1.25,
		});
		const shot = project.composition.shots[1];
		if (shot.kind !== "main") throw Error();
		shot.sourceClips!.find((c) => c.sourceId === "media:audio")!.sourceStartMs = 500;
		const row = projectTranscript(project).find((r) => r.instanceId === "second")!;
		expect(row.startMs).toBe(10400);
		expect(row.endMs).toBe(12000);
	});
	it("rejects stale bases, unknown IDs and conflicts atomically", async () => {
		const { project, state, plan } = await planForSecond();
		await expect(compileReview(project, state, plan, ["missing"])).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		plan.suggestions.push({ ...plan.suggestions[0], id: "other" });
		await expect(compileReview(project, state, plan, ["cut", "other"])).rejects.toMatchObject({
			code: "CONFLICTING_SUGGESTIONS",
		});
		project.editor.padding = 10;
		await expect(compileReview(project, state, plan, ["cut"])).rejects.toMatchObject({
			code: "STALE_BASE",
		});
		expect(project.composition.shots).toHaveLength(2);
	});
	it("keeps packaging and BGM and retimes B-roll with the source", async () => {
		const { project, state, plan } = await planForSecond();
		project.composition.shots.push({
			id: "card",
			kind: "card",
			template: "outro",
			durationMs: 2000,
		});
		project.composition.assets.push({
			id: "b",
			path: "/b.mp4",
			kind: "video",
			durationMs: 10000,
		});
		project.composition.broll = [
			{
				id: "broll",
				clipId: "second",
				assetId: "b",
				offsetMs: 0,
				durationMs: 5000,
				sourceStartMs: 0,
				speed: 1,
				muted: true,
				volume: 1,
				mode: "fullscreen",
				x: 0,
				y: 0,
				width: 1,
				height: 1,
			},
		];
		plan.baseRevision = await projectRevision(project);
		const result = await compileReview(project, state, plan, ["cut"]);
		expect(result.project.composition.shots.at(-1)).toEqual(project.composition.shots.at(-1));
		expect(result.project.composition.broll.map((b) => b.durationMs)).toEqual([1000, 2000]);
	});
	it("only proposes detected long silences and respects confirmed clips", async () => {
		const { project, state } = fixture();
		const shot = project.composition.shots[0];
		if (shot.kind === "main") shot.locked = true;
		const plan = await pausePlan(project, state);
		expect(plan.suggestions).toHaveLength(1);
		expect(plan.suggestions[0].target.sourceStartMs).toBe(3250);
		expect(
			(await compileReview(project, state, plan, [plan.suggestions[0].id])).removedMs,
		).toBe(2500);
	});
	it("empty selection makes no change and round trips metadata", async () => {
		const { project, state, plan } = await planForSecond();
		expect((await compileReview(project, state, plan, [])).project).toEqual(project);
		expect(projectTranscript(JSON.parse(JSON.stringify(project)))).toEqual(
			projectTranscript(project),
		);
	});
});

// The original file is never mutated when enabling the transcript workspace.
describe("legacy transcript workspace", () => {
	it.each([1, 2, 3, 4])("preserves v%s clip timing and effects through migration", (version) => {
		const original = {
			version,
			videoPath: "/legacy.mp4",
			editor: {
				clipRegions: [
					{ id: "clip", startMs: 0, endMs: 2000, sourceStartMs: 1000, speed: 1.25 },
				],
				zoomRegions: [{ id: "zoom", startMs: 400, endMs: 1200, depth: 2 }],
				autoCaptions: [{ id: "caption", startMs: 1500, endMs: 2500, text: "Words" }],
			},
		};
		const unchanged = structuredClone(original);
		const migrated = prepareTranscriptProject(migrateProject(original as never, 5000));
		expect(original).toEqual(unchanged);
		expect(migrated.composition.effectsTime).toBe("timeline");
		expect(migrated.editor.zoomRegions?.[0]).toMatchObject({ startMs: 400, endMs: 1200 });
		expect(migrated.editor.autoCaptions?.[0]).toMatchObject({ startMs: 400, endMs: 1200 });
		expect(migrated.composition.shots[0]).toMatchObject({
			sourceStartMs: 1000,
			sourceEndMs: 3500,
			speed: 1.25,
			instanceId: "clip",
		});
		expect(prepareTranscriptProject(migrated)).toEqual(migrated);
	});
});
