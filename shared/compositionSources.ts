import type { CompositionProject, MainShot, Layout } from "./composition.ts";
import type { CropRegion } from "../src/components/video-editor/types.ts";

export interface SyncedSource {
	id: string;
	assetId: string;
	name: string;
	kind: "screen" | "camera" | "audio";
	/** Recording time at which this source starts. */
	timeOffsetMs: number;
}
export interface SourceClip {
	id: string;
	sourceId: string;
	offsetMs: number;
	durationMs: number;
	sourceStartMs: number;
	speed: number;
	linked: boolean;
	muted: boolean;
	volume: number;
}
export interface ViewLayer {
	sourceId: string;
	x: number;
	y: number;
	width: number;
	height: number;
	crop?: CropRegion;
	mirror?: boolean;
	roundness?: number;
	/** Preserve the whole screen, including its existing background/effects. */
	fit?: "contain" | "cover";
}
export interface ViewClip {
	id: string;
	offsetMs: number;
	durationMs: number;
	/** Back to front. Audio is deliberately independent of these layers. */
	layers: ViewLayer[];
}
const length = (shot: MainShot) => (shot.sourceEndMs - shot.sourceStartMs) / shot.speed;
export function layoutLayers(layout: Layout, screen: string, camera?: string): ViewLayer[] {
	const full = (sourceId: string): ViewLayer => ({ sourceId, x: 0, y: 0, width: 1, height: 1 });
	if (!camera || layout.mode === "screen") return [{ ...full(screen), fit: "contain" }];
	if (layout.mode === "presenter") return [full(camera)];
	if (layout.mode === "split") {
		const ratio = layout.presenterRatio ?? 0.35;
		return [
			{ ...full(screen), x: ratio, width: 1 - ratio, fit: "contain" },
			{ ...full(camera), width: ratio },
		];
	}
	const width = layout.width ?? 0.23,
		height = layout.height ?? 0.23;
	return [
		{ ...full(screen), fit: "contain" },
		{
			...full(camera),
			width,
			height,
			x: (1 - width) * (layout.x ?? 0.98),
			y: (1 - height) * (layout.y ?? 0.98),
			roundness: layout.roundness ?? 100,
		},
	];
}
export function createSourceClip(shot: MainShot, source: SyncedSource): SourceClip {
	return {
		id: `${shot.id}:source:${source.id}`,
		sourceId: source.id,
		offsetMs: 0,
		durationMs: length(shot),
		sourceStartMs: shot.sourceStartMs - source.timeOffsetMs,
		speed: shot.speed,
		linked: true,
		muted: source.kind !== "audio",
		volume: 1,
	};
}
/** Explicit conversion; existing v3 projects retain their legacy rendering until requested. */
export function enableSourceEditing(project: CompositionProject): CompositionProject {
	const result = structuredClone(project),
		c = result.composition;
	if (c.sources) return result;
	const ids = new Set([...c.assets, ...c.shots, ...c.broll].map((item) => item.id));
	const unique = (base: string) => {
		let id = base;
		while (ids.has(id)) id += "-1";
		ids.add(id);
		return id;
	};
	const screenAsset = unique("recording-screen");
	c.assets.push({ id: screenAsset, path: project.videoPath, kind: "video" });
	const screen = unique("source-screen"),
		audio = unique("source-audio");
	c.sources = [
		{ id: screen, assetId: screenAsset, name: "屏幕录制", kind: "screen", timeOffsetMs: 0 },
		{ id: audio, assetId: screenAsset, name: "主讲声音", kind: "audio", timeOffsetMs: 0 },
	];
	const webcam = project.editor.webcam;
	let camera: string | undefined;
	if (webcam?.sourcePath) {
		const assetId = unique("recording-camera");
		camera = unique("source-camera");
		c.assets.push({ id: assetId, path: webcam.sourcePath, kind: "video" });
		c.sources.splice(1, 0, {
			id: camera,
			assetId,
			name: "摄像头 1",
			kind: "camera",
			timeOffsetMs: webcam.timeOffsetMs ?? 0,
		});
	}
	for (const shot of c.shots)
		if (shot.kind === "main") {
			shot.sourceClips = c.sources.map((source) => createSourceClip(shot, source));
			shot.views = [
				{
					id: unique(`${shot.id}:view`),
					offsetMs: 0,
					durationMs: length(shot),
					layers: layoutLayers(shot.layout, screen, camera).map((layer) =>
						layer.sourceId === camera
							? { ...layer, crop: webcam?.cropRegion, mirror: webcam?.mirror }
							: layer,
					),
				},
			];
		}
	return result;
}

export function sliceSourceClips(
	clips: SourceClip[],
	from: number,
	to: number,
	suffix = "",
): SourceClip[] {
	return clips.flatMap((clip) => {
		const start = Math.max(from, clip.offsetMs),
			end = Math.min(to, clip.offsetMs + clip.durationMs);
		return end <= start
			? []
			: [
					{
						...clip,
						id: clip.id + suffix,
						offsetMs: start - from,
						durationMs: end - start,
						sourceStartMs: clip.sourceStartMs + (start - clip.offsetMs) * clip.speed,
					},
				];
	});
}
export function sliceViews(views: ViewClip[], from: number, to: number, suffix = ""): ViewClip[] {
	return views.flatMap((view) => {
		const start = Math.max(from, view.offsetMs),
			end = Math.min(to, view.offsetMs + view.durationMs);
		return end <= start
			? []
			: [{ ...view, id: view.id + suffix, offsetMs: start - from, durationMs: end - start }];
	});
}
export function sourceSceneAt(project: CompositionProject, shot: MainShot, localMs: number) {
	const view = shot.views?.find(
		(v) => localMs >= v.offsetMs && localMs < v.offsetMs + v.durationMs,
	);
	return (view?.layers ?? []).flatMap((layer) => {
		const source = project.composition.sources?.find((s) => s.id === layer.sourceId);
		const asset = project.composition.assets.find((a) => a.id === source?.assetId);
		const clip = shot.sourceClips?.find(
			(c) =>
				c.sourceId === layer.sourceId &&
				localMs >= c.offsetMs &&
				localMs < c.offsetMs + c.durationMs,
		);
		return source && asset && clip
			? [
					{
						layer,
						source,
						asset,
						clip,
						timeMs: clip.sourceStartMs + (localMs - clip.offsetMs) * clip.speed,
					},
				]
			: [];
	});
}
export function updateSourceOffset(
	project: CompositionProject,
	sourceId: string,
	timeOffsetMs: number,
) {
	const next = structuredClone(project),
		source = next.composition.sources?.find((s) => s.id === sourceId);
	if (!source || !Number.isFinite(timeOffsetMs)) throw new Error("Invalid source offset");
	const delta = timeOffsetMs - source.timeOffsetMs;
	source.timeOffsetMs = timeOffsetMs;
	for (const shot of next.composition.shots)
		if (shot.kind === "main")
			for (const clip of shot.sourceClips ?? [])
				if (clip.sourceId === sourceId && clip.linked) clip.sourceStartMs -= delta;
	return next;
}
export function validateSourceEditing(project: CompositionProject): string[] {
	const c = project.composition,
		errors: string[] = [];
	if (c.sources === undefined) {
		if (c.shots.some((s) => s.kind === "main" && (s.sourceClips || s.views)))
			errors.push("Source tracks require synced sources");
		return errors;
	}
	if (!Array.isArray(c.sources)) return ["Invalid synced sources"];
	const ids = new Set([...c.assets, ...c.shots, ...c.broll].map((x) => x.id));
	const checkId = (id: string) => {
		if (!id || ids.has(id)) errors.push(`Duplicate or missing source/view ID: ${id}`);
		ids.add(id);
	};
	for (const s of c.sources) {
		if (!s) {
			errors.push("Invalid synced source");
			continue;
		}
		checkId(s.id);
		const asset = c.assets.find((a) => a.id === s.assetId);
		if (
			!asset ||
			!["screen", "camera", "audio"].includes(s.kind) ||
			!Number.isFinite(s.timeOffsetMs) ||
			(s.kind !== "audio" && asset.kind !== "video") ||
			(s.kind === "audio" && asset.kind === "image")
		)
			errors.push(`Invalid synced source: ${s.id}`);
	}
	for (const shot of c.shots)
		if (shot.kind === "main") {
			if (!Array.isArray(shot.sourceClips) || !Array.isArray(shot.views)) {
				errors.push(`Missing source tracks/views: ${shot.id}`);
				continue;
			}
			const checkSpan = (item: SourceClip | ViewClip) => {
				checkId(item.id);
				if (
					![item.offsetMs, item.durationMs].every(Number.isFinite) ||
					item.offsetMs < 0 ||
					item.durationMs <= 0 ||
					item.offsetMs + item.durationMs > length(shot) + 0.01
				)
					errors.push(`Invalid source/view range: ${item.id}`);
			};
			for (const clip of shot.sourceClips) {
				if (!clip) {
					errors.push("Invalid source clip");
					continue;
				}
				checkSpan(clip);
				if (
					!c.sources.some((s) => s?.id === clip.sourceId) ||
					![clip.sourceStartMs, clip.speed, clip.volume].every(Number.isFinite) ||
					clip.speed < 0.125 ||
					clip.speed > 16 ||
					clip.volume < 0 ||
					clip.volume > 4 ||
					typeof clip.linked !== "boolean" ||
					typeof clip.muted !== "boolean"
				)
					errors.push(`Invalid source clip: ${clip.id}`);
			}
			for (const view of shot.views) {
				if (!view) {
					errors.push("Invalid view clip");
					continue;
				}
				checkSpan(view);
				if (!Array.isArray(view.layers)) {
					errors.push(`Invalid view layers: ${view.id}`);
					continue;
				}
				const seen = new Set<string>();
				for (const layer of view.layers) {
					if (!layer) {
						errors.push("Invalid view layer");
						continue;
					}
					if (
						seen.has(layer.sourceId) ||
						!c.sources.some((s) => s?.id === layer.sourceId && s.kind !== "audio")
					)
						errors.push(`Invalid view source: ${view.id}`);
					seen.add(layer.sourceId);
					if (
						![layer.x, layer.y, layer.width, layer.height].every(Number.isFinite) ||
						layer.x < 0 ||
						layer.y < 0 ||
						layer.width <= 0 ||
						layer.height <= 0 ||
						layer.x + layer.width > 1.001 ||
						layer.y + layer.height > 1.001 ||
						(layer.roundness !== undefined &&
							(!Number.isFinite(layer.roundness) ||
								layer.roundness < 0 ||
								layer.roundness > 100)) ||
						(layer.fit !== undefined && !["contain", "cover"].includes(layer.fit))
					)
						errors.push(`Invalid view placement: ${view.id}`);
					const crop = layer.crop;
					if (
						crop &&
						(![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
							crop.x < 0 ||
							crop.y < 0 ||
							crop.width <= 0 ||
							crop.height <= 0 ||
							crop.x + crop.width > 1.001 ||
							crop.y + crop.height > 1.001)
					)
						errors.push(`Invalid view crop: ${view.id}`);
				}
			}
			const checkOverlap = (items: { offsetMs: number; durationMs: number }[]) => {
				const sorted = [...items].sort((a, b) => a.offsetMs - b.offsetMs);
				for (let i = 1; i < sorted.length; i++)
					if (
						sorted[i].offsetMs <
						sorted[i - 1].offsetMs + sorted[i - 1].durationMs - 0.01
					)
						errors.push(`Source/view clips overlap: ${shot.id}`);
			};
			checkOverlap(shot.views.filter(Boolean));
			for (const source of c.sources.filter(Boolean))
				checkOverlap(shot.sourceClips.filter((clip) => clip?.sourceId === source.id));
		}
	return errors;
}

export function findSourceItem(project: CompositionProject, id: string | null) {
	for (const shot of project.composition.shots)
		if (shot.kind === "main") {
			const clip = shot.sourceClips?.find((c) => c.id === id);
			const view = shot.views?.find((v) => v.id === id);
			if (clip || view) return { shot, clip, view };
		}
	return null;
}
/** Roll adjacent view boundaries without modifying source clips or sound. */
export function resizeView(shot: MainShot, id: string, start: number, end: number): MainShot {
	const next = structuredClone(shot),
		views = next.views;
	const current = views?.find((v) => v.id === id);
	if (
		!views ||
		!current ||
		!Number.isFinite(start) ||
		!Number.isFinite(end) ||
		start < 0 ||
		end > length(shot) ||
		end <= start
	)
		throw new Error("Invalid view range");
	const previous = views.find(
		(v) => v.id !== id && Math.abs(v.offsetMs + v.durationMs - current.offsetMs) < 0.01,
	);
	const following = views.find(
		(v) => v.id !== id && Math.abs(v.offsetMs - current.offsetMs - current.durationMs) < 0.01,
	);
	if (previous) {
		if (start <= previous.offsetMs) throw new Error("View boundary crosses the previous cut");
		previous.durationMs = start - previous.offsetMs;
	}
	if (following) {
		const followingEnd = following.offsetMs + following.durationMs;
		if (end >= followingEnd) throw new Error("View boundary crosses the next cut");
		following.offsetMs = end;
		following.durationMs = followingEnd - end;
	}
	current.offsetMs = start;
	current.durationMs = end - start;
	return next;
}
