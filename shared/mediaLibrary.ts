import {
	applyOperation,
	durationMs,
	timeline,
	type CompositionProject,
	type MainShot,
} from "./composition.ts";
import { createSourceClip, layoutLayers, type SyncedSource } from "./compositionSources.ts";

export interface LibraryMedia {
	id: string;
	name: string;
	videoPath: string;
	webcamPath?: string | null;
	timeOffsetMs?: number;
	hideOverlayCursorByDefault?: boolean;
	createdAt: number;
	status: "processing" | "ready";
}
export interface LibraryRecording extends LibraryMedia {
	durationMs: number;
	width: number;
	height: number;
	hasAudio: boolean;
	audio?: { path: string; timeOffsetMs: number; name: string }[];
}
export const LIBRARY_DRAG_TYPE = "application/x-recordly-library";

export function emptyEditingProject(): CompositionProject {
	return {
		version: 4,
		videoPath: "",
		editor: { clipRegions: [] },
		composition: {
			effectsTime: "timeline",
			assets: [],
			sources: [],
			shots: [],
			broll: [],
			width: 1920,
			height: 1080,
			fps: 30,
		},
	};
}

/** Insert a fresh clip instance; source files and other uses remain untouched. */
export function insertLibraryRecording(
	project: CompositionProject,
	recording: LibraryRecording,
	atMs: number,
	instanceId: string,
): CompositionProject {
	if (
		recording.status !== "ready" ||
		!Number.isFinite(recording.durationMs) ||
		recording.durationMs <= 0
	)
		throw new Error("素材尚未完成处理");
	const next = structuredClone(project);
	const c = next.composition;
	if (!c.sources) throw new Error("请先启用独立素材轨道");
	const point = Math.max(0, Math.min(atMs, durationMs(c)));
	const containing = timeline(c).find((e) => point > e.startMs && point < e.endMs);
	if (containing) {
		if (containing.shot.kind === "main")
			next.composition = applyOperation(c, {
				type: "split",
				clipId: containing.shot.id,
				offsetMs: point - containing.startMs,
			});
		else {
			const index = c.shots.indexOf(containing.shot);
			c.shots.splice(
				index,
				1,
				{ ...containing.shot, durationMs: point - containing.startMs },
				{
					...containing.shot,
					id: `${instanceId}:card-tail`,
					durationMs: containing.endMs - point,
				},
			);
		}
	}
	const composition = next.composition;
	const sources: SyncedSource[] = [];
	const add = (
		key: string,
		file: string,
		kind: SyncedSource["kind"],
		offset = 0,
		name = recording.name,
	) => {
		const assetId = `${recording.id}:${key}:asset`;
		const id = `${recording.id}:${key}`;
		if (!composition.assets.some((a) => a.id === assetId))
			composition.assets.push({
				id: assetId,
				path: file,
				kind: kind === "audio" ? "audio" : "video",
				...(kind === "screen"
					? {
							durationMs: recording.durationMs,
							width: recording.width,
							height: recording.height,
							hasAudio: recording.hasAudio,
						}
					: {}),
			});
		let source = composition.sources!.find((s) => s.id === id);
		if (!source) {
			source = {
				id,
				assetId,
				kind,
				name,
				timeOffsetMs: offset,
				hideOverlayCursorByDefault: recording.hideOverlayCursorByDefault,
			};
			composition.sources!.push(source);
		}
		sources.push(source);
		return id;
	};
	const screen = add("screen", recording.videoPath, "screen");
	const camera = recording.webcamPath
		? add(
				"camera",
				recording.webcamPath,
				"camera",
				recording.timeOffsetMs,
				`${recording.name} · 摄像头`,
			)
		: undefined;
	if (recording.audio?.length)
		recording.audio.forEach((a, i) =>
			add(`audio-${i}`, a.path, "audio", a.timeOffsetMs, a.name),
		);
	else if (recording.hasAudio)
		add("audio", recording.videoPath, "audio", 0, `${recording.name} · 声音`);
	const shot: MainShot = {
		id: instanceId,
		instanceId,
		kind: "main",
		name: recording.name,
		recordingId: recording.id,
		sourceStartMs: 0,
		sourceEndMs: recording.durationMs,
		speed: 1,
		layout: { mode: camera ? "pip" : "screen" },
	};
	shot.sourceClips = sources.map((s) => createSourceClip(shot, s));
	shot.views = [
		{
			id: `${instanceId}:view`,
			offsetMs: 0,
			durationMs: recording.durationMs,
			layers: layoutLayers(shot.layout, screen, camera),
		},
	];
	const index = timeline(composition).filter((e) => e.endMs <= point + 0.001).length;
	composition.shots.splice(index, 0, shot);
	return next;
}
