import { describe, it, expect } from "vitest";
import {
	applyOperation,
	applyPlan,
	migrateProject,
	sceneAt,
	timeline,
	durationMs,
	validateComposition,
	audioSegments,
	type CompositionProject,
} from "../../../../shared/composition";
function fixture(): CompositionProject {
	return {
		version: 3,
		videoPath: "main.mp4",
		editor: { webcam: { sourcePath: "face.mp4" } as never },
		composition: {
			width: 1280,
			height: 720,
			fps: 30,
			assets: [{ id: "asset", path: "b.mp4", kind: "video", durationMs: 30000 }],
			shots: [
				{
					id: "a",
					kind: "main",
					sourceStartMs: 10000,
					sourceEndMs: 20000,
					speed: 1,
					layout: { mode: "screen" },
				},
				{
					id: "b",
					kind: "main",
					sourceStartMs: 0,
					sourceEndMs: 5000,
					speed: 1,
					layout: { mode: "pip" },
				},
			],
			broll: [
				{
					id: "roll",
					clipId: "a",
					assetId: "asset",
					offsetMs: 2000,
					durationMs: 6000,
					sourceStartMs: 1000,
					speed: 1,
					muted: true,
					volume: 1,
					mode: "fullscreen",
					x: 0,
					y: 0,
					width: 1,
					height: 1,
				},
			],
		},
	};
}
describe("composition timeline", () => {
	it("splits linked B-roll at a card insertion and pauses source time", () => {
		const p = fixture();
		p.composition = applyOperation(p.composition, {
			type: "insert-card",
			atMs: 5000,
			card: { id: "card", kind: "card", template: "quote", durationMs: 3000 },
		});
		expect(durationMs(p.composition)).toBe(18000);
		expect(sceneAt(p, 6000)?.sourceMs).toBeNull();
		expect(sceneAt(p, 8000)?.sourceMs).toBe(15000);
		expect(p.composition.broll.map((b) => [b.offsetMs, b.durationMs, b.sourceStartMs])).toEqual(
			[
				[2000, 3000, 1000],
				[0, 3000, 4000],
			],
		);
		expect(validateComposition(p)).toEqual([]);
	});
	it("moves main clips with B-roll while music stays on output time", () => {
		const p = fixture();
		p.editor.audioRegions = [
			{ id: "music", startMs: 2000, endMs: 25000, audioPath: "music.wav", volume: 0.2 },
		];
		p.composition = applyOperation(p.composition, { type: "move", id: "a", index: 1 });
		expect(sceneAt(p, 7500)?.broll?.id).toBe("roll");
		expect(audioSegments(p).at(-1)).toMatchObject({ startMs: 2000, durationMs: 13000 });
	});
	it("retimes auxiliary media when speeding up its main clip", () => {
		const p = fixture();
		p.composition = applyOperation(p.composition, { type: "speed", clipId: "a", speed: 2 });
		expect(p.composition.broll[0]).toMatchObject({
			offsetMs: 1000,
			durationMs: 3000,
			speed: 2,
		});
		expect(sceneAt(p, 1500)?.brollSourceMs).toBe(2000);
	});
	it("trims B-roll and removes it with its parent", () => {
		const p = fixture();
		p.composition = applyOperation(p.composition, {
			type: "trim",
			clipId: "a",
			sourceStartMs: 14000,
			sourceEndMs: 17000,
		});
		expect(p.composition.broll[0]).toMatchObject({
			offsetMs: 0,
			durationMs: 3000,
			sourceStartMs: 3000,
		});
		expect(applyOperation(p.composition, { type: "remove", id: "a" }).broll).toEqual([]);
	});
	it("keeps half-open boundaries deterministic", () => {
		const p = fixture();
		expect(sceneAt(p, 10000)?.shot.id).toBe("b");
		expect(sceneAt(p, 15000)).toBeNull();
		expect(timeline(p.composition)[1].startMs).toBe(10000);
	});
	it("migrates without mutating legacy settings", () => {
		const legacy = {
			version: 2,
			videoPath: "main.mp4",
			editor: {
				clipRegions: [
					{ id: "old", startMs: 0, endMs: 4000, sourceStartMs: 1000, speed: 2 },
				],
				autoCaptions: [{ id: "c", startMs: 2000, endMs: 2500, text: "test" }],
			},
		};
		const p = migrateProject(legacy, 10000);
		expect(p.version).toBe(3);
		expect(p.composition.shots[0]).toMatchObject({ sourceStartMs: 1000, sourceEndMs: 9000 });
		expect(p.editor).toEqual(legacy.editor);
		expect(legacy.version).toBe(2);
	});
	it("applies plans deterministically and preserves the input", () => {
		const p = fixture(),
			before = structuredClone(p);
		const plan = {
			version: 1 as const,
			operations: [{ type: "split" as const, clipId: "a", offsetMs: 4000 }],
		};
		expect(applyPlan(p, plan)).toEqual(applyPlan(p, plan));
		expect(p).toEqual(before);
	});
	it("rejects overlap, missing presenter, invalid media ranges and NaN", () => {
		const p = fixture();
		p.composition.broll.push({ ...p.composition.broll[0], id: "overlap" });
		expect(validateComposition(p)).toContain("B-roll regions overlap");
		p.editor.webcam = undefined;
		expect(validateComposition(p).some((e) => e.includes("Presenter"))).toBe(true);
		p.composition.broll[0].sourceStartMs = 30000;
		expect(validateComposition(p).some((e) => e.includes("source"))).toBe(true);
		p.composition.broll[0].speed = NaN;
		expect(validateComposition(p).some((e) => e.includes("Invalid"))).toBe(true);
	});
	it("does not schedule main audio or subtitles during a card", () => {
		const p = fixture();
		p.composition = applyOperation(p.composition, {
			type: "insert-card",
			atMs: 0,
			card: { id: "intro", kind: "card", template: "intro", durationMs: 3000 },
		});
		expect(audioSegments(p)[0].startMs).toBe(3000);
		expect(sceneAt(p, 1000)?.sourceMs).toBeNull();
	});
	it("supports 16x main and linked B-roll with matching source positions", () => {
		const p = fixture();
		const before = sceneAt(p, 3000);
		p.composition = applyOperation(p.composition, { type: "speed", clipId: "a", speed: 16 });
		expect(validateComposition(p)).toEqual([]);
		expect(sceneAt(p, 3000 / 16)?.sourceMs).toBe(before?.sourceMs);
		expect(p.composition.broll[0].speed).toBe(16);
		expect(audioSegments(p)[0].speed).toBe(16);
		expect(() => applyOperation(p.composition, { type: "speed", clipId: "a", speed: 17 })).toThrow();
	});

});
