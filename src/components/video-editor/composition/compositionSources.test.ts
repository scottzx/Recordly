import { describe, expect, it } from "vitest";
import {
	applyOperation,
	audioSegments,
	validateComposition,
	type CompositionProject,
	type MainShot,
} from "../../../../shared/composition";
import {
	createSourceClip,
	enableSourceEditing,
	findSourceItem,
	resizeView,
	sourceSceneAt,
	updateSourceOffset,
} from "../../../../shared/compositionSources";
import { sourceTimelineRegions } from "./timelineProjection";
import { buildTimelineItems, resolveDropRowId } from "../timeline/model/timelineModel";

function fixture() {
	return enableSourceEditing({
		version: 3,
		videoPath: "screen.mp4",
		editor: {
			webcam: {
				sourcePath: "camera.mp4",
				timeOffsetMs: 200,
				mirror: true,
				cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			},
		},
		composition: {
			width: 1280,
			height: 720,
			fps: 30,
			assets: [],
			broll: [],
			shots: [
				{
					id: "talk",
					kind: "main",
					sourceStartMs: 1000,
					sourceEndMs: 11000,
					speed: 1,
					layout: { mode: "pip" },
				},
			],
		},
	} as CompositionProject);
}
const shot = (p: CompositionProject) => p.composition.shots[0] as MainShot;

describe("independent synced sources and view cuts", () => {
	it("expands legacy screen/camera/audio without changing their timing or PiP placement", () => {
		const p = fixture(),
			s = shot(p);
		expect(validateComposition(p)).toEqual([]);
		expect(enableSourceEditing(p)).toEqual(p);
		expect(s.sourceClips).toHaveLength(3);
		const scene = sourceSceneAt(p, s, 500);
		expect(scene.map((x) => [x.source.kind, x.timeMs])).toEqual([
			["screen", 1500],
			["camera", 1300],
		]);
		expect(scene[1].layer).toMatchObject({ x: 0.77 * 0.98, width: 0.23, mirror: true });
		expect(audioSegments(p)).toEqual([
			{
				path: "screen.mp4",
				startMs: 0,
				sourceStartMs: 1000,
				durationMs: 10000,
				speed: 1,
				volume: 1,
			},
		]);
	});
	it("switches to a second camera and rolls cut boundaries without splitting or altering audio", () => {
		const p = fixture(),
			s = shot(p);
		p.composition.assets.push({ id: "camera2-asset", path: "camera2.mp4", kind: "video" });
		const source = {
			id: "camera2",
			assetId: "camera2-asset",
			name: "第二机位",
			kind: "camera" as const,
			timeOffsetMs: -300,
		};
		p.composition.sources!.push(source);
		s.sourceClips!.push(createSourceClip(s, source));
		const before = audioSegments(p),
			clips = structuredClone(s.sourceClips);
		p.composition = applyOperation(p.composition, {
			type: "split-view",
			clipId: s.id,
			id: s.views![0].id,
			offsetMs: 4000,
		});
		let edited = shot(p);
		edited.views![1].layers = [{ sourceId: source.id, x: 0, y: 0, width: 1, height: 1 }];
		edited = resizeView(edited, edited.views![1].id, 3500, 10000);
		p.composition.shots[0] = edited;
		expect(edited.views!.map((v) => [v.offsetMs, v.durationMs])).toEqual([
			[0, 3500],
			[3500, 6500],
		]);
		expect(edited.sourceClips).toEqual(clips);
		expect(audioSegments(p)).toEqual(before);
		expect(sourceSceneAt(p, edited, 3500)[0]).toMatchObject({
			source: { id: "camera2" },
			timeMs: 4800,
		});
		expect(validateComposition(p)).toEqual([]);
	});
	it("splits and retimes all nested tracks during group edits and packaging insertion", () => {
		const p = fixture();
		p.composition = applyOperation(p.composition, {
			type: "insert-card",
			atMs: 3000,
			card: { id: "card", kind: "card", template: "chapter", durationMs: 1000 },
		});
		const right = p.composition.shots[2] as MainShot;
		expect(right.sourceClips!.find((c) => c.sourceId === "source-camera")!.sourceStartMs).toBe(
			3800,
		);
		expect(right.views![0]).toMatchObject({ offsetMs: 0, durationMs: 7000 });
		expect(audioSegments(p).map((s) => [s.startMs, s.sourceStartMs, s.durationMs])).toEqual([
			[0, 1000, 3000],
			[4000, 4000, 7000],
		]);
		p.composition = applyOperation(p.composition, {
			type: "trim",
			clipId: right.id,
			sourceStartMs: 5000,
			sourceEndMs: 10000,
		});
		p.composition = applyOperation(p.composition, {
			type: "speed",
			clipId: right.id,
			speed: 2,
		});
		const edited = p.composition.shots[2] as MainShot;
		expect(edited.sourceClips![0]).toMatchObject({
			sourceStartMs: 5000,
			durationMs: 2500,
			speed: 2,
		});
		expect(edited.views![0]).toMatchObject({ offsetMs: 0, durationMs: 2500 });
		expect(validateComposition(p)).toEqual([]);
		p.composition = applyOperation(p.composition, { type: "remove", id: right.id });
		expect(p.composition.shots).toHaveLength(2);
		expect(audioSegments(p)).toHaveLength(1);
	});
	it("edits one source independently, relinks explicitly, and only shifts linked clips on sync correction", () => {
		let p = fixture(),
			s = shot(p);
		const camera = s.sourceClips!.find((c) => c.sourceId === "source-camera")!;
		p.composition = applyOperation(p.composition, {
			type: "split-source",
			clipId: s.id,
			id: camera.id,
			offsetMs: 4000,
		});
		s = shot(p);
		const independent = s.sourceClips!.find(
			(c) => c.sourceId === "source-camera" && c.offsetMs === 4000,
		)!;
		independent.linked = false;
		independent.sourceStartMs = 2000;
		const views = structuredClone(s.views),
			sound = audioSegments(p);
		p = updateSourceOffset(p, "source-camera", 500);
		expect(
			shot(p)
				.sourceClips!.filter((c) => c.sourceId === "source-camera")
				.map((c) => c.sourceStartMs),
		).toEqual([500, 2000]);
		expect(shot(p).views).toEqual(views);
		expect(audioSegments(p)).toEqual(sound);
		expect(validateComposition(p)).toEqual([]);
	});
	it("keeps multiple audio sources independent of visible cameras and trims delayed audio to real media", () => {
		const p = fixture(),
			s = shot(p);
		p.composition.assets.push({ id: "mic", path: "mic.wav", kind: "audio", durationMs: 2000 });
		const mic = {
			id: "mic-source",
			assetId: "mic",
			name: "独立麦克风",
			kind: "audio" as const,
			timeOffsetMs: 1500,
		};
		p.composition.sources!.push(mic);
		s.sourceClips!.push(createSourceClip(s, mic));
		s.views![0].layers = [];
		expect(audioSegments(p)[1]).toMatchObject({
			path: "mic.wav",
			startMs: 500,
			sourceStartMs: 0,
			durationMs: 2000,
		});
		expect(sourceSceneAt(p, s, 2000)).toEqual([]);
		expect(validateComposition(p)).toEqual([]);
	});
	it("projects selectable lanes, collapses only source lanes, and prevents cross-lane drops", () => {
		const p = fixture();
		const regions = sourceTimelineRegions(p.composition);
		expect(regions).toHaveLength(4);
		expect(sourceTimelineRegions(p.composition, false)).toHaveLength(1);
		const items = buildTimelineItems({
			annotationRegions: regions,
			clipRegions: [],
			audioRegions: [],
			zoomRegions: [],
		});
		expect(new Set(items.map((i) => i.rowId)).size).toBe(4);
		expect(items.filter((i) => i.variant === "clip")).toHaveLength(2);
		expect(items.filter((i) => i.variant === "audio")).toHaveLength(1);
		expect(resolveDropRowId(items[1].id, "row-broll", items)).toBe(items[1].rowId);
		expect(findSourceItem(p, items[1].id)?.clip?.sourceId).toBe("source-screen");
	});
	it("rejects broken source references, overlaps, invalid crops and NaN values", () => {
		const p = fixture(),
			s = shot(p);
		s.views![0].layers[0].sourceId = "missing";
		s.views![0].layers[0].crop = { x: NaN, y: 0, width: 1, height: 1 };
		s.sourceClips!.push({ ...s.sourceClips![0], id: "overlap" });
		s.sourceClips![0].sourceStartMs = NaN;
		const errors = validateComposition(p).join("\n");
		expect(errors).toContain("Invalid view source");
		expect(errors).toContain("Invalid view crop");
		expect(errors).toContain("overlap");
		expect(errors).toContain("Invalid source clip");
	});
	it("preserves the complete model through project serialization", () => {
		const p = fixture();
		const restored = JSON.parse(JSON.stringify(p));
		expect(validateComposition(restored)).toEqual([]);
		expect(audioSegments(restored)).toEqual(audioSegments(p));
		expect(sourceSceneAt(restored, shot(restored), 2000)).toEqual(
			sourceSceneAt(p, shot(p), 2000),
		);
	});
});
