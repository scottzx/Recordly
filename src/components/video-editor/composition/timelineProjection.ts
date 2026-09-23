import type { ClipRegion } from "../types";
import { timeline, type Composition } from "../../../../shared/composition";
import {
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	type AnnotationRegion,
} from "../types";

// Existing timeline tracks display output-time spans; effects remain attached to source content.
export function projectSourceRegions<T extends { id: string; startMs: number; endMs: number }>(
	regions: T[],
	composition: Composition,
): T[] {
	return timeline(composition).flatMap(({ shot, startMs }) =>
		shot.kind === "main"
			? regions.flatMap((region) => {
					const a = Math.max(region.startMs, shot.sourceStartMs),
						b = Math.min(region.endMs, shot.sourceEndMs);
					return b > a
						? [
								{
									...region,
									id: `${region.id}::${shot.id}`,
									startMs: startMs + (a - shot.sourceStartMs) / shot.speed,
									endMs: startMs + (b - shot.sourceStartMs) / shot.speed,
								},
							]
						: [];
				})
			: [],
	);
}
export function sourceRegionSpan(
	id: string,
	span: { start: number; end: number },
	composition: Composition,
) {
	const separator = id.lastIndexOf("::");
	const sourceId = id.slice(0, separator),
		clipId = id.slice(separator + 2);
	const entry = timeline(composition).find((e) => e.shot.id === clipId);
	if (!entry || entry.shot.kind !== "main") return null;
	return {
		id: sourceId,
		span: {
			start: entry.shot.sourceStartMs + (span.start - entry.startMs) * entry.shot.speed,
			end: entry.shot.sourceStartMs + (span.end - entry.startMs) * entry.shot.speed,
		},
	};
}
export function brollTimelineRegions(composition: Composition): AnnotationRegion[] {
	const entries = timeline(composition);
	return composition.broll.flatMap((b) => {
		const entry = entries.find((e) => e.shot.id === b.clipId);
		if (!entry) return [];
		return [
			{
				id: b.id,
				timelineRole: "broll" as const,
				startMs: entry.startMs + b.offsetMs,
				endMs: entry.startMs + b.offsetMs + b.durationMs,
				type: "text" as const,
				content: `B-roll · ${
					composition.assets
						.find((a) => a.id === b.assetId)
						?.path.split(/[\\/]/)
						.pop() || b.id
				}`,
				position: DEFAULT_ANNOTATION_POSITION,
				size: DEFAULT_ANNOTATION_SIZE,
				style: DEFAULT_ANNOTATION_STYLE,
				zIndex: 0,
				trackIndex: 0,
			},
		];
	});
}

export function compositionClips(
	composition: import("../../../../shared/composition").Composition,
): ClipRegion[] {
	return timeline(composition).map(({ shot, startMs, endMs }) => ({
		id: shot.id,
		timelineRole: shot.kind === "card" ? "packaging" : "aroll",
		startMs,
		endMs,
		sourceStartMs: shot.kind === "main" ? shot.sourceStartMs : 0,
		speed: shot.kind === "main" ? shot.speed : 1,
		muted: shot.kind === "card" || shot.muted,
		displayLabel: shot.kind === "card" ? `包装 · ${shot.title || shot.template}` : undefined,
	}));
}

export function sourceSpanAtOutput(span: { start: number; end: number }, composition: Composition) {
	const entry = timeline(composition).find(
		(e) => span.start >= e.startMs && span.start < e.endMs,
	);
	if (!entry || entry.shot.kind !== "main") return null;
	return {
		start: entry.shot.sourceStartMs + (span.start - entry.startMs) * entry.shot.speed,
		end:
			entry.shot.sourceStartMs +
			(Math.min(span.end, entry.endMs) - entry.startMs) * entry.shot.speed,
	};
}

export function sourceTimelineRegions(
	composition: Composition,
	expanded = true,
): AnnotationRegion[] {
	return timeline(composition).flatMap(({ shot, startMs }) => {
		if (shot.kind !== "main") return [];
		const make = (
			item: { id: string; offsetMs: number; durationMs: number },
			rowId: string,
			rowLabel: string,
			content: string,
			sourceKind?: AnnotationRegion["compositionSourceKind"],
		): AnnotationRegion => ({
			id: item.id,
			startMs: startMs + item.offsetMs,
			endMs: startMs + item.offsetMs + item.durationMs,
			timelineRole: "source",
			compositionRowId: rowId,
			compositionRowLabel: rowLabel,
			compositionSourceKind: sourceKind,
			type: "text",
			content,
			position: DEFAULT_ANNOTATION_POSITION,
			size: DEFAULT_ANNOTATION_SIZE,
			style: DEFAULT_ANNOTATION_STYLE,
			zIndex: 0,
		});
		return [
			...(shot.views ?? []).map((view) =>
				make(
					view,
					"row-composition-view",
					"镜头编排",
					view.layers
						.map(
							(layer) =>
								composition.sources?.find((s) => s.id === layer.sourceId)?.name ??
								"",
						)
						.join("＋") || "空画面",
				),
			),
			...(expanded ? (shot.sourceClips ?? []) : []).map((clip) => {
				const source = composition.sources?.find((s) => s.id === clip.sourceId);
				return make(
					clip,
					`row-composition-source-${clip.sourceId}`,
					source?.name ?? "素材",
					`${clip.linked ? "同步" : "独立"} · ${source?.name ?? "素材"}${clip.muted && source?.kind === "audio" ? " · 静音" : ""}`,
					source?.kind,
				);
			}),
		];
	});
}
