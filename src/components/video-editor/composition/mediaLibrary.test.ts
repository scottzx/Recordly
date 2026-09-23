import { describe, expect, it } from "vitest";
import {
	emptyEditingProject,
	insertLibraryRecording,
	type LibraryRecording,
} from "../../../../shared/mediaLibrary";
import {
	applyOperation,
	audioSegments,
	durationMs,
	timeline,
	validateComposition,
	type MainShot,
} from "../../../../shared/composition";
import { sourceSceneAt } from "../../../../shared/compositionSources";
import { retimeEditingRegions } from "../../../../shared/compositionEffects";
import { validateProjectData } from "../projectPersistence";

const media = (id: string, duration = 3000): LibraryRecording => ({
	id,
	name: id,
	videoPath: `/media/${id}.mp4`,
	createdAt: 1,
	status: "ready",
	durationMs: duration,
	width: 640,
	height: 360,
	hasAudio: true,
});
const abc = () =>
	["A", "B", "C"].reduce(
		(p, id) => insertLibraryRecording(p, media(id), Infinity, `clip-${id}`),
		emptyEditingProject(),
	);
describe("library-backed editing projects", () => {
	it("saves and reloads an empty project without a placeholder video", () => {
		const project = JSON.parse(JSON.stringify(emptyEditingProject()));
		expect(validateProjectData(project)).toBe(true);
		expect(validateComposition(project)).toEqual([]);
		expect(durationMs(project.composition)).toBe(0);
	});
	it("combines A/B/C with independent picture and sound sources", () => {
		const project = abc();
		expect(validateComposition(project)).toEqual([]);
		expect(durationMs(project.composition)).toBe(9000);
		expect(audioSegments(project).map((s) => [s.path, s.startMs])).toEqual([
			["/media/A.mp4", 0],
			["/media/B.mp4", 3000],
			["/media/C.mp4", 6000],
		]);
		for (const [i, id] of ["A", "B", "C"].entries())
			expect(
				sourceSceneAt(project, project.composition.shots[i] as MainShot, 500)[0],
			).toMatchObject({ asset: { path: `/media/${id}.mp4` }, timeMs: 500 });
	});
	it("inserts into a clip, splitting it and keeping A's continuation after B", () => {
		const a = insertLibraryRecording(emptyEditingProject(), media("A"), 0, "first");
		const p = insertLibraryRecording(a, media("B"), 1000, "second");
		expect(timeline(p.composition).map((e) => [e.startMs, e.endMs])).toEqual([
			[0, 1000],
			[1000, 4000],
			[4000, 6000],
		]);
		expect(sourceSceneAt(p, p.composition.shots[2] as MainShot, 0)[0].timeMs).toBe(1000);
		expect(validateComposition(p)).toEqual([]);
		expect(a.composition.shots).toHaveLength(1);
	});
	it("reuses media without sharing trim state between instances or projects", () => {
		const original = media("A");
		let p = insertLibraryRecording(emptyEditingProject(), original, 0, "first");
		p = insertLibraryRecording(p, original, Infinity, "second");
		const other = insertLibraryRecording(emptyEditingProject(), original, 0, "other");
		p.composition = applyOperation(p.composition, {
			type: "trim",
			clipId: "first",
			sourceStartMs: 1000,
			sourceEndMs: 2000,
		});
		expect((p.composition.shots[1] as MainShot).sourceEndMs).toBe(3000);
		expect(durationMs(other.composition)).toBe(3000);
		expect(original.durationMs).toBe(3000);
		expect(p.composition.sources).toHaveLength(2);
	});
	it("preserves camera and microphone synchronization and avoids duplicate embedded audio", () => {
		const p = insertLibraryRecording(
			emptyEditingProject(),
			{
				...media("A"),
				webcamPath: "/media/camera.mp4",
				timeOffsetMs: 200,
				audio: [{ path: "/media/mic.wav", timeOffsetMs: 300, name: "Mic" }],
			},
			0,
			"clip",
		);
		expect(validateComposition(p)).toEqual([]);
		expect(
			sourceSceneAt(p, p.composition.shots[0] as MainShot, 1000).map((s) => s.timeMs),
		).toEqual([1000, 800]);
		expect(audioSegments(p)).toEqual([
			{
				path: "/media/mic.wav",
				startMs: 300,
				sourceStartMs: 0,
				durationMs: 2700,
				speed: 1,
				volume: 1,
			},
		]);
	});
	it("allows deleting every clip and reusing the original recording afterward", () => {
		let p = insertLibraryRecording(emptyEditingProject(), media("A"), 0, "first");
		p.composition = applyOperation(p.composition, { type: "remove", id: "first" });
		expect(validateComposition(p)).toEqual([]);
		p = insertLibraryRecording(p, media("A"), 0, "second");
		expect(durationMs(p.composition)).toBe(3000);
	});
	it("retimes captions and zooms with content through insertion, reorder, speed and trim", () => {
		const before = abc();
		const regions = [
			{
				id: "caption",
				startMs: 3500,
				endMs: 4500,
				words: [{ text: "B", startMs: 3600, endMs: 4000 }],
			},
		];
		const after = insertLibraryRecording(before, media("D"), 1000, "D");
		expect(
			retimeEditingRegions(regions, before.composition, after.composition)[0],
		).toMatchObject({ startMs: 6500, endMs: 7500, words: [{ startMs: 6600, endMs: 7000 }] });
		const moved = applyOperation(before.composition, { type: "move", id: "clip-B", index: 0 });
		const faster = applyOperation(moved, { type: "speed", clipId: "clip-B", speed: 2 });
		expect(retimeEditingRegions(regions, before.composition, faster)[0]).toMatchObject({
			startMs: 250,
			endMs: 750,
		});
		const trimmed = applyOperation(before.composition, {
			type: "trim",
			clipId: "clip-B",
			sourceStartMs: 2000,
			sourceEndMs: 3000,
		});
		expect(retimeEditingRegions(regions, before.composition, trimmed)).toEqual([]);
	});
	it("does not insert unfinished recordings", () => {
		expect(() =>
			insertLibraryRecording(
				emptyEditingProject(),
				{ ...media("A"), status: "processing" },
				0,
				"x",
			),
		).toThrow();
	});
});
