import {
	sliceSourceClips,
	sliceViews,
	validateSourceEditing,
	type SyncedSource,
	type SourceClip,
	type ViewClip,
} from "./compositionSources.ts";
import type { EditorProjectData } from "../src/components/video-editor/projectPersistence.ts";
import type { CropRegion } from "../src/components/video-editor/types.ts";

export type LayoutMode = "screen" | "presenter" | "pip" | "split";
export interface Layout {
	mode: LayoutMode;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	roundness?: number;
	presenterRatio?: number;
}
export interface Asset {
	id: string;
	path: string;
	kind: "video" | "image" | "audio";
	durationMs?: number;
	width?: number;
	height?: number;
	hasAudio?: boolean;
}
export interface MainShot {
	sourceClips?: SourceClip[];
	views?: ViewClip[];
	id: string;
	kind: "main";
	sourceStartMs: number;
	sourceEndMs: number;
	speed: number;
	muted?: boolean;
	volume?: number;
	layout: Layout;
}
export interface Card {
	id: string;
	kind: "card";
	template: "intro" | "chapter" | "quote" | "outro" | "image";
	durationMs: number;
	title?: string;
	subtitle?: string;
	background?: string;
	color?: string;
	assetId?: string;
	animation?: "none" | "fade";
}
export type Shot = MainShot | Card;
export interface BRoll {
	id: string;
	clipId: string;
	assetId: string;
	offsetMs: number;
	durationMs: number;
	sourceStartMs: number;
	speed: number;
	muted: boolean;
	volume: number;
	mode: "fullscreen" | "pip";
	x: number;
	y: number;
	width: number;
	height: number;
	crop?: CropRegion;
}
export interface Composition {
	sources?: SyncedSource[];
	assets: Asset[];
	shots: Shot[];
	broll: BRoll[];
	width: number;
	height: number;
	fps: number;
}
export type CompositionProject = EditorProjectData & { composition: Composition };
export interface EditPlan {
	version: 1;
	composition?: Partial<Composition>;
	editor?: EditorProjectData["editor"];
	operations?: Operation[];
}
export type Operation =
	| { type: "split"; clipId: string; offsetMs: number }
	| { type: "split-source" | "split-view"; clipId: string; id: string; offsetMs: number }
	| { type: "trim"; clipId: string; sourceStartMs: number; sourceEndMs: number }
	| { type: "speed"; clipId: string; speed: number }
	| { type: "layout"; clipId: string; layout: Layout }
	| { type: "move"; id: string; index: number }
	| { type: "remove"; id: string }
	| { type: "insert-card"; atMs: number; card: Card };
export const CARD_DURATIONS = { intro: 3000, chapter: 2000, quote: 3000, outro: 3000, image: 3000 };
export function shotDuration(shot: Shot): number {
	return shot.kind === "card"
		? shot.durationMs
		: (shot.sourceEndMs - shot.sourceStartMs) / shot.speed;
}
export function timeline(composition: Composition) {
	let startMs = 0;
	return composition.shots.map((shot) => {
		const item = { shot, startMs, endMs: startMs + shotDuration(shot) };
		startMs = item.endMs;
		return item;
	});
}
export function durationMs(composition: Composition): number {
	return composition.shots.reduce((total, shot) => total + shotDuration(shot), 0);
}
export function sceneAt(project: CompositionProject, timeMs: number) {
	const entry = timeline(project.composition).find(
		(item) => timeMs >= item.startMs && timeMs < item.endMs,
	);
	if (!entry) return null;
	const localMs = timeMs - entry.startMs;
	const broll =
		entry.shot.kind === "main"
			? project.composition.broll.find(
					(b) =>
						b.clipId === entry.shot.id &&
						localMs >= b.offsetMs &&
						localMs < b.offsetMs + b.durationMs,
				)
			: undefined;
	return {
		...entry,
		localMs,
		sourceMs:
			entry.shot.kind === "main"
				? entry.shot.sourceStartMs + localMs * entry.shot.speed
				: null,
		broll,
		brollSourceMs: broll
			? broll.sourceStartMs + (localMs - broll.offsetMs) * broll.speed
			: null,
	};
}
export function migrateProject(
	project: EditorProjectData & { composition?: Composition },
	sourceDurationMs: number,
): CompositionProject {
	const result = structuredClone(project);
	if (!result.composition) {
		const clips = result.editor.clipRegions?.length
			? result.editor.clipRegions
			: [{ id: "main-1", startMs: 0, endMs: sourceDurationMs, sourceStartMs: 0, speed: 1 }];
		// Legacy zooms/annotations live on the edited timeline; captions already use source time.
		const sourceEffects = <T extends { id: string; startMs: number; endMs: number }>(
			items: T[] = [],
		): T[] =>
			items.flatMap((item) =>
				clips.flatMap((clip) => {
					const start = Math.max(item.startMs, clip.startMs),
						end = Math.min(item.endMs, clip.endMs);
					if (end <= start) return [];
					const source = clip.sourceStartMs ?? clip.startMs;
					return [
						{
							...item,
							id: `${item.id}@${clip.id}`,
							startMs: source + (start - clip.startMs) * clip.speed,
							endMs: source + (end - clip.startMs) * clip.speed,
						},
					];
				}),
			);
		if (result.editor.zoomRegions)
			result.editor.zoomRegions = sourceEffects(result.editor.zoomRegions);
		if (result.editor.annotationRegions)
			result.editor.annotationRegions = sourceEffects(result.editor.annotationRegions);
		result.composition = {
			assets: [],
			width: 1920,
			height: 1080,
			fps: result.editor.mp4FrameRate || 30,
			broll: [],
			shots: clips.map((clip) => ({
				id: clip.id,
				kind: "main",
				sourceStartMs: clip.sourceStartMs ?? clip.startMs,
				sourceEndMs:
					(clip.sourceStartMs ?? clip.startMs) + (clip.endMs - clip.startMs) * clip.speed,
				speed: clip.speed,
				muted: clip.muted,
				layout: {
					mode: result.editor.webcam?.enabled ? "pip" : "screen",
					x: result.editor.webcam?.positionX,
					y: result.editor.webcam?.positionY,
					width: (result.editor.webcam?.width ?? 23) / 100,
					height: (result.editor.webcam?.height ?? 23) / 100,
					roundness: result.editor.webcam?.roundness ?? 100,
				},
			})),
		};
	}
	result.version = 3;
	return result as CompositionProject;
}
function split(composition: Composition, clipId: string, offsetMs: number) {
	const index = composition.shots.findIndex((s) => s.id === clipId);
	const shot = composition.shots[index];
	if (!shot || shot.kind !== "main" || offsetMs <= 0 || offsetMs >= shotDuration(shot))
		throw new Error("Split must be inside a main clip");
	const rightId = `${clipId}-split-${offsetMs}`;
	if (composition.shots.some((s) => s.id === rightId))
		throw new Error(`Duplicate split ID: ${rightId}`);
	const point = shot.sourceStartMs + offsetMs * shot.speed;
	composition.shots.splice(
		index,
		1,
		{
			...shot,
			sourceEndMs: point,
			...(shot.sourceClips
				? { sourceClips: sliceSourceClips(shot.sourceClips, 0, offsetMs) }
				: {}),
			...(shot.views ? { views: sliceViews(shot.views, 0, offsetMs) } : {}),
		},
		{
			...shot,
			id: rightId,
			sourceStartMs: point,
			...(shot.sourceClips
				? {
						sourceClips: sliceSourceClips(
							shot.sourceClips,
							offsetMs,
							shotDuration(shot),
							`:${rightId}`,
						),
					}
				: {}),
			...(shot.views
				? { views: sliceViews(shot.views, offsetMs, shotDuration(shot), `:${rightId}`) }
				: {}),
		},
	);
	composition.broll = composition.broll.flatMap((b) => {
		if (b.clipId !== clipId) return [b];
		const leftDuration = Math.max(0, Math.min(b.durationMs, offsetMs - b.offsetMs));
		const rightStart = Math.max(b.offsetMs, offsetMs);
		const rightDuration = b.offsetMs + b.durationMs - rightStart;
		return [
			...(leftDuration > 0 ? [{ ...b, durationMs: leftDuration }] : []),
			...(rightDuration > 0
				? [
						{
							...b,
							id: leftDuration ? `${b.id}-split-${offsetMs}` : b.id,
							clipId: rightId,
							offsetMs: rightStart - offsetMs,
							sourceStartMs: b.sourceStartMs + (rightStart - b.offsetMs) * b.speed,
							durationMs: rightDuration,
						},
					]
				: []),
		];
	});
}
export function applyOperation(composition: Composition, op: Operation): Composition {
	if (
		![
			"split",
			"split-source",
			"split-view",
			"insert-card",
			"move",
			"remove",
			"layout",
			"speed",
			"trim",
		].includes(op.type)
	)
		throw new Error("Unknown edit operation");
	const c = structuredClone(composition);
	if (op.type === "split") split(c, op.clipId, op.offsetMs);
	else if (op.type === "insert-card") {
		if (op.atMs < 0 || op.atMs > durationMs(c))
			throw new Error("Card insertion is outside the timeline");
		const entry = timeline(c).find((e) => op.atMs > e.startMs && op.atMs < e.endMs);
		if (entry) {
			if (entry.shot.kind === "card") throw new Error("Insert cards at card boundaries");
			split(c, entry.shot.id, op.atMs - entry.startMs);
		}
		const at = timeline(c).findIndex((e) => e.startMs >= op.atMs);
		c.shots.splice(at < 0 ? c.shots.length : at, 0, op.card);
	} else if (op.type === "move" || op.type === "remove") {
		const index = c.shots.findIndex((s) => s.id === op.id);
		if (index < 0) throw new Error(`Unknown shot: ${op.id}`);
		const [shot] = c.shots.splice(index, 1);
		if (op.type === "move") {
			if (!Number.isInteger(op.index) || op.index < 0 || op.index > c.shots.length)
				throw new Error("Invalid move index");
			c.shots.splice(op.index, 0, shot);
		} else c.broll = c.broll.filter((b) => b.clipId !== op.id);
	} else {
		const shot = c.shots.find((s) => s.id === op.clipId);
		if (!shot || shot.kind !== "main") throw new Error(`Unknown main clip: ${op.clipId}`);
		if (op.type === "split-source" || op.type === "split-view") {
			const items = op.type === "split-source" ? shot.sourceClips : shot.views;
			const index = items?.findIndex((item) => item.id === op.id) ?? -1;
			if (!items || index < 0) throw new Error("Unknown source/view clip");
			const item = items[index],
				delta = op.offsetMs - item.offsetMs;
			if (!(delta > 0 && delta < item.durationMs))
				throw new Error("Split must be inside the selected source/view clip");
			const right = {
				...item,
				id: `${item.id}:split:${op.offsetMs}`,
				offsetMs: op.offsetMs,
				durationMs: item.durationMs - delta,
			};
			if ("sourceStartMs" in right) right.sourceStartMs += delta * right.speed;
			// Both arrays retain their own homogeneous item type.
			(items as (SourceClip | ViewClip)[]).splice(
				index,
				1,
				{ ...item, durationMs: delta },
				right,
			);
		}
		if (op.type === "layout") {
			if (shot.views) throw new Error("Edit the view clip layout in source editing mode");
			shot.layout = op.layout;
		}
		if (op.type === "speed") {
			if (!(op.speed > 0 && op.speed <= 16)) throw new Error("Speed must be > 0 and <= 16");
			const ratio = shot.speed / op.speed;
			c.broll = c.broll.map((b) =>
				b.clipId === shot.id
					? {
							...b,
							offsetMs: b.offsetMs * ratio,
							durationMs: b.durationMs * ratio,
							speed: b.speed / ratio,
						}
					: b,
			);
			if (shot.sourceClips)
				shot.sourceClips = shot.sourceClips.map((clip) => ({
					...clip,
					offsetMs: clip.offsetMs * ratio,
					durationMs: clip.durationMs * ratio,
					speed: clip.speed / ratio,
				}));
			if (shot.views)
				shot.views = shot.views.map((view) => ({
					...view,
					offsetMs: view.offsetMs * ratio,
					durationMs: view.durationMs * ratio,
				}));
			shot.speed = op.speed;
		}
		if (op.type === "trim") {
			if (
				op.sourceStartMs < shot.sourceStartMs ||
				op.sourceEndMs > shot.sourceEndMs ||
				op.sourceEndMs <= op.sourceStartMs
			)
				throw new Error("Trim must be within the existing source span");
			const from = (op.sourceStartMs - shot.sourceStartMs) / shot.speed;
			const to = (op.sourceEndMs - shot.sourceStartMs) / shot.speed;
			c.broll = c.broll.flatMap((b) => {
				if (b.clipId !== shot.id) return [b];
				const start = Math.max(b.offsetMs, from),
					end = Math.min(b.offsetMs + b.durationMs, to);
				return end <= start
					? []
					: [
							{
								...b,
								offsetMs: start - from,
								durationMs: end - start,
								sourceStartMs: b.sourceStartMs + (start - b.offsetMs) * b.speed,
							},
						];
			});
			if (shot.sourceClips) shot.sourceClips = sliceSourceClips(shot.sourceClips, from, to);
			if (shot.views) shot.views = sliceViews(shot.views, from, to);
			shot.sourceStartMs = op.sourceStartMs;
			shot.sourceEndMs = op.sourceEndMs;
		}
	}
	return c;
}
export function applyPlan(project: CompositionProject, plan: EditPlan): CompositionProject {
	if (plan.version !== 1) throw new Error("Unsupported edit plan version");
	const result = structuredClone(project);
	result.version = 3;
	result.editor = { ...result.editor, ...plan.editor };
	result.composition = { ...result.composition, ...plan.composition };
	for (const op of plan.operations ?? [])
		result.composition = applyOperation(result.composition, op);
	const errors = validateComposition(result);
	if (errors.length) throw new Error(errors.join("\n"));
	return result;
}
export function validateComposition(project: CompositionProject): string[] {
	const c = project.composition,
		errors: string[] = [];
	if (!c || !Array.isArray(c.shots) || !Array.isArray(c.assets) || !Array.isArray(c.broll))
		return ["Invalid composition structure"];
	if ([...c.assets, ...c.shots, ...c.broll].some((item) => !item || typeof item !== "object"))
		return ["Invalid composition element"];
	if (!c.shots.length) errors.push("Timeline must contain at least one shot");
	if (![24, 25, 30, 50, 60].includes(c.fps)) errors.push("Unsupported frame rate");
	if (
		![c.width, c.height].every(
			(n) => Number.isInteger(n) && n >= 64 && n <= 4096 && n % 2 === 0,
		)
	)
		errors.push("Dimensions must be even integers between 64 and 4096");
	const ids = new Set<string>();
	for (const item of [...c.assets, ...c.shots, ...c.broll]) {
		if (!item.id || ids.has(item.id)) errors.push(`Missing or duplicate ID: ${item.id}`);
		ids.add(item.id);
	}
	for (const a of c.assets)
		if (!a.path || !["video", "image", "audio"].includes(a.kind))
			errors.push(`Invalid asset: ${a.id}`);
	for (const s of c.shots) {
		if (!Number.isFinite(shotDuration(s)) || shotDuration(s) <= 0)
			errors.push(`Invalid duration: ${s.id}`);
		if (s.kind === "main") {
			if (
				![s.sourceStartMs, s.sourceEndMs, s.speed].every(Number.isFinite) ||
				s.sourceStartMs < 0 ||
				s.speed < 0.125 ||
				s.speed > 16
			)
				errors.push(`Invalid source range/speed: ${s.id}`);
			if (!s.layout || !["screen", "presenter", "pip", "split"].includes(s.layout.mode))
				errors.push(`Invalid layout: ${s.id}`);
			else if (!s.views && s.layout.mode !== "screen" && !project.editor.webcam?.sourcePath)
				errors.push(`Presenter source required: ${s.id}`);
			if (
				s.volume !== undefined &&
				(!Number.isFinite(s.volume) || s.volume < 0 || s.volume > 4)
			)
				errors.push(`Invalid main volume: ${s.id}`);
			for (const key of ["x", "y", "width", "height"] as const) {
				const value = s.layout?.[key];
				if (
					value !== undefined &&
					(!Number.isFinite(value) ||
						value < 0 ||
						value > 1 ||
						((key === "width" || key === "height") && value === 0))
				)
					errors.push(`Invalid layout placement: ${s.id}`);
			}
			if (
				s.layout?.presenterRatio !== undefined &&
				!(s.layout.presenterRatio >= 0.2 && s.layout.presenterRatio <= 0.8)
			)
				errors.push(`Invalid split ratio: ${s.id}`);
		} else if (s.kind === "card") {
			if (!["intro", "chapter", "quote", "outro", "image"].includes(s.template))
				errors.push(`Invalid card template: ${s.id}`);
			if (s.template === "image" && !s.assetId)
				errors.push(`Image card requires an asset: ${s.id}`);
			if (s.assetId && !c.assets.some((a) => a.id === s.assetId && a.kind === "image"))
				errors.push(`Unknown card image: ${s.id}`);
			if (s.animation && !["none", "fade"].includes(s.animation))
				errors.push(`Invalid card animation: ${s.id}`);
		} else errors.push("Unknown shot kind");
	}
	for (const a of project.editor.audioRegions ?? [])
		if (
			![a.startMs, a.endMs, a.volume].every(Number.isFinite) ||
			a.startMs < 0 ||
			a.endMs <= a.startMs ||
			a.volume < 0 ||
			a.volume > 4
		)
			errors.push(`Invalid audio region: ${a.id}`);
	for (const b of c.broll) {
		const shot = c.shots.find((s) => s.id === b.clipId),
			asset = c.assets.find((a) => a.id === b.assetId);
		if (!shot || shot.kind !== "main") errors.push(`Unknown B-roll clip: ${b.id}`);
		if (!asset || asset.kind === "audio") errors.push(`Unknown B-roll media: ${b.id}`);
		if (
			![
				b.offsetMs,
				b.durationMs,
				b.sourceStartMs,
				b.speed,
				b.volume,
				b.x,
				b.y,
				b.width,
				b.height,
			].every(Number.isFinite) ||
			b.offsetMs < 0 ||
			b.durationMs <= 0 ||
			b.sourceStartMs < 0 ||
			b.speed < 0.125 ||
			b.speed > 16 ||
			b.volume < 0 ||
			b.volume > 4
		)
			errors.push(`Invalid B-roll range: ${b.id}`);
		if (shot && b.offsetMs + b.durationMs > shotDuration(shot) + 0.01)
			errors.push(`B-roll exceeds its clip: ${b.id}`);
		if (b.mode !== "fullscreen" && b.mode !== "pip")
			errors.push(`Invalid B-roll mode: ${b.id}`);
		if (
			b.x < 0 ||
			b.y < 0 ||
			b.width <= 0 ||
			b.height <= 0 ||
			b.x + b.width > 1.001 ||
			b.y + b.height > 1.001
		)
			errors.push(`Invalid B-roll placement: ${b.id}`);
		if (
			b.crop &&
			(!(b.crop.width > 0 && b.crop.height > 0) ||
				b.crop.x < 0 ||
				b.crop.y < 0 ||
				b.crop.x + b.crop.width > 1 ||
				b.crop.y + b.crop.height > 1)
		)
			errors.push(`Invalid crop: ${b.id}`);
		if (
			asset?.kind === "video" &&
			asset.durationMs !== undefined &&
			b.sourceStartMs + b.durationMs * b.speed > asset.durationMs + 40
		)
			errors.push(`B-roll exceeds its source: ${b.id}`);
	}
	const spans = timeline(c)
		.flatMap((e) =>
			c.broll
				.filter((b) => b.clipId === e.shot.id)
				.map((b) => ({
					start: e.startMs + b.offsetMs,
					end: e.startMs + b.offsetMs + b.durationMs,
				})),
		)
		.sort((a, b) => a.start - b.start);
	for (let i = 1; i < spans.length; i++)
		if (spans[i].start < spans[i - 1].end - 0.01) errors.push("B-roll regions overlap");
	errors.push(...validateSourceEditing(project));
	return errors;
}
export function audioSegments(project: CompositionProject) {
	const segments: {
		path: string;
		startMs: number;
		sourceStartMs: number;
		durationMs: number;
		speed: number;
		volume: number;
	}[] = [];
	for (const entry of timeline(project.composition)) {
		const s = entry.shot;
		if (s.kind !== "main") continue;
		const settings =
			project.editor.sourceAudioTrackSettingsByClip?.[s.id] ??
			project.editor.defaultSourceAudioTrackSettings;
		const gain = (settings?.mixed?.volume ?? 1) * (settings?.mixed?.normalize ? 1.35 : 1);
		if (!s.muted && !s.sourceClips)
			segments.push({
				path: project.videoPath,
				startMs: entry.startMs,
				sourceStartMs: s.sourceStartMs,
				durationMs: shotDuration(s),
				speed: s.speed,
				volume: (s.volume ?? 1) * gain,
			});
		if (!s.muted)
			for (const clip of s.sourceClips ?? []) {
				if (clip.muted) continue;
				const source = project.composition.sources?.find(
					(source) => source.id === clip.sourceId,
				);
				const asset = project.composition.assets.find(
					(asset) => asset.id === source?.assetId,
				);
				if (!asset) continue;
				const lead = Math.max(0, -clip.sourceStartMs / clip.speed);
				const duration =
					Math.min(
						clip.durationMs,
						asset.durationMs === undefined
							? Infinity
							: (asset.durationMs - clip.sourceStartMs) / clip.speed,
					) - lead;
				if (duration > 0)
					segments.push({
						path: asset.path,
						startMs: entry.startMs + clip.offsetMs + lead,
						sourceStartMs: Math.max(0, clip.sourceStartMs),
						durationMs: duration,
						speed: clip.speed,
						volume:
							clip.volume *
							(s.volume ?? 1) *
							(source?.kind === "audio" && asset.path === project.videoPath
								? gain
								: 1),
					});
			}
		for (const b of project.composition.broll.filter((b) => b.clipId === s.id && !b.muted)) {
			const a = project.composition.assets.find((a) => a.id === b.assetId);
			if (a?.kind === "video")
				segments.push({
					path: a.path,
					startMs: entry.startMs + b.offsetMs,
					sourceStartMs: b.sourceStartMs,
					durationMs: b.durationMs,
					speed: b.speed,
					volume: b.volume,
				});
		}
	}
	for (const a of project.editor.audioRegions ?? [])
		if (a.startMs < durationMs(project.composition))
			segments.push({
				path: a.audioPath,
				startMs: a.startMs,
				sourceStartMs: 0,
				durationMs: Math.min(a.endMs, durationMs(project.composition)) - a.startMs,
				speed: 1,
				volume: a.volume,
			});
	return segments;
}
