import { enableSourceEditing } from "./compositionSources.ts";
import { timeline, type CompositionProject } from "./composition.ts";

export interface TranscriptSegment {
	id: string;
	sourceStartMs: number;
	sourceEndMs: number;
	text: string;
}
export interface TranscriptDocument {
	schemaVersion: 1;
	id: string;
	revision: string;
	assetId: string;
	sourceId: string;
	fingerprint: string;
	durationMs: number;
	engine: string;
	model: string;
	language: string;
	optionsHash: string;
	segments: TranscriptSegment[];
	silenceIntervals: { startMs: number; endMs: number }[];
}
export interface TranscriptState {
	documents: TranscriptDocument[];
	/** Previous immutable revisions retained for review provenance. */
	history?: TranscriptDocument[];
	sourceSelections: Record<string, string>;
	corrections: Record<string, string>;
}
export interface TranscriptBundle extends TranscriptState {
	schemaVersion: 1;
	baseRevision: string;
	complete: boolean;
	errors: { sourceId: string; message: string }[];
}
export interface SourceReference {
	instanceId: string;
	clipId: string;
	sourceId: string;
	transcriptId: string;
	transcriptRevision: string;
	segmentIds?: string[];
	sourceStartMs: number;
	sourceEndMs: number;
}
export interface TranscriptRow extends SourceReference {
	key: string;
	text: string;
	startMs: number;
	endMs: number;
	name: string;
}
export class OralCutError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}
export function requireInput(
	condition: unknown,
	message: string,
	code = "INVALID_INPUT",
): asserts condition {
	if (!condition) throw new OralCutError(code, message);
}
export const correctionKey = (instance: string, document: string, segment: string) =>
	JSON.stringify([instance, document, segment]);

export function validateTranscript(document: TranscriptDocument) {
	requireInput(
		document &&
			document.schemaVersion === 1 &&
			document.id &&
			document.revision &&
			document.sourceId &&
			document.assetId &&
			document.fingerprint,
		"Invalid transcript identity",
	);
	requireInput(
		Number.isFinite(document.durationMs) && document.durationMs > 0,
		"Invalid transcript duration",
	);
	requireInput(
		Array.isArray(document.segments) && Array.isArray(document.silenceIntervals),
		"Invalid transcript intervals",
	);
	const ids = new Set<string>();
	for (const s of document.segments) {
		requireInput(
			s && typeof s.text === "string" && s.id && !ids.has(s.id),
			"Invalid or duplicate segment",
		);
		ids.add(s.id);
		requireInput(
			Number.isFinite(s.sourceStartMs) &&
				Number.isFinite(s.sourceEndMs) &&
				s.sourceStartMs >= 0 &&
				s.sourceEndMs > s.sourceStartMs &&
				s.sourceEndMs <= document.durationMs,
			"Segment outside media",
		);
	}
	for (const s of document.silenceIntervals)
		requireInput(
			s &&
				Number.isFinite(s.startMs) &&
				Number.isFinite(s.endMs) &&
				s.startMs >= 0 &&
				s.endMs > s.startMs &&
				s.endMs <= document.durationMs,
			"Silence outside media",
		);
}

/** Source clips already contain offsets and speed; never infer timing from subtitle gaps. */
export function projectTranscript(
	project: CompositionProject,
	state = project.composition.transcript,
): TranscriptRow[] {
	if (!state) return [];
	return timeline(project.composition)
		.flatMap(({ shot, startMs }) => {
			if (shot.kind !== "main") return [];
			const instanceId = shot.instanceId ?? shot.id;
			const sourceId = state.sourceSelections[instanceId];
			const document = state.documents.find((d) => d.sourceId === sourceId);
			if (!document) return [];
			return (shot.sourceClips ?? [])
				.filter((c) => c.sourceId === sourceId)
				.flatMap((clip) =>
					document.segments.flatMap((segment) => {
						const from = Math.max(0, segment.sourceStartMs, clip.sourceStartMs);
						const to = Math.min(
							document.durationMs,
							segment.sourceEndMs,
							clip.sourceStartMs + clip.durationMs * clip.speed,
						);
						if (to <= from) return [];
						const key = correctionKey(instanceId, document.id, segment.id);
						return [
							{
								key: `${key}:${shot.id}:${clip.id}`,
								text: state.corrections[key] ?? segment.text,
								name: shot.name ?? instanceId,
								instanceId,
								clipId: shot.id,
								sourceId,
								transcriptId: document.id,
								transcriptRevision: document.revision,
								segmentIds: [segment.id],
								sourceStartMs: from,
								sourceEndMs: to,
								startMs:
									startMs +
									clip.offsetMs +
									(from - clip.sourceStartMs) / clip.speed,
								endMs:
									startMs +
									clip.offsetMs +
									(to - clip.sourceStartMs) / clip.speed,
							},
						];
					}),
				);
		})
		.sort((a, b) => a.startMs - b.startMs);
}

export function resolveReference(
	project: CompositionProject,
	state: TranscriptState,
	ref: SourceReference,
) {
	requireInput(
		ref &&
			Number.isFinite(ref.sourceStartMs) &&
			Number.isFinite(ref.sourceEndMs) &&
			ref.sourceStartMs >= 0 &&
			ref.sourceEndMs > ref.sourceStartMs,
		"Invalid reference range",
		"INVALID_REFERENCE",
	);
	const entry = timeline(project.composition).find((e) => e.shot.id === ref.clipId);
	const shot = entry?.shot;
	const doc = state.documents.find(
		(d) =>
			d.id === ref.transcriptId &&
			d.revision === ref.transcriptRevision &&
			d.sourceId === ref.sourceId,
	);
	requireInput(
		entry &&
			shot?.kind === "main" &&
			(shot.instanceId ?? shot.id) === ref.instanceId &&
			state.sourceSelections[ref.instanceId] === ref.sourceId &&
			doc,
		"Unknown instance, source or transcript revision",
		"INVALID_REFERENCE",
	);
	requireInput(ref.sourceEndMs <= doc.durationMs, "Reference outside media", "INVALID_REFERENCE");
	const source = project.composition.sources?.find((s) => s.id === ref.sourceId);
	requireInput(
		source?.assetId === doc.assetId,
		"Transcript does not belong to this source asset",
		"INVALID_REFERENCE",
	);
	const clip = shot.sourceClips?.filter(
		(c) =>
			c.sourceId === ref.sourceId &&
			ref.sourceStartMs >= c.sourceStartMs &&
			ref.sourceEndMs <= c.sourceStartMs + c.durationMs * c.speed,
	);
	requireInput(
		clip?.length === 1,
		"Reference crosses a missing or ambiguous source interval",
		"INVALID_REFERENCE",
	);
	if (ref.segmentIds !== undefined) {
		requireInput(
			Array.isArray(ref.segmentIds) && new Set(ref.segmentIds).size === ref.segmentIds.length,
			"Invalid segment IDs",
			"INVALID_REFERENCE",
		);
		for (const id of ref.segmentIds)
			requireInput(
				doc.segments.some(
					(s) =>
						s.id === id &&
						s.sourceStartMs < ref.sourceEndMs &&
						s.sourceEndMs > ref.sourceStartMs,
				),
				`Unknown or out-of-range segment: ${id}`,
				"INVALID_REFERENCE",
			);
	}
	return {
		startMs:
			entry.startMs +
			clip[0].offsetMs +
			(ref.sourceStartMs - clip[0].sourceStartMs) / clip[0].speed,
		endMs:
			entry.startMs +
			clip[0].offsetMs +
			(ref.sourceEndMs - clip[0].sourceStartMs) / clip[0].speed,
		doc,
		shot,
	};
}

/** Convert legacy source effects once; desktop and CLI use identical timing rules. */
export function prepareTranscriptProject(project: CompositionProject): CompositionProject {
	const next = enableSourceEditing(project);
	if (!next.composition.effectsTime) {
		const projectRegions = <
			T extends {
				id: string;
				startMs: number;
				endMs: number;
				words?: { startMs: number; endMs: number }[];
			},
		>(
			regions: T[],
		): T[] =>
			timeline(next.composition).flatMap(({ shot, startMs }) => {
				if (shot.kind !== "main") return [];
				return regions.flatMap((r) => {
					const from = Math.max(r.startMs, shot.sourceStartMs),
						to = Math.min(r.endMs, shot.sourceEndMs);
					const map = (n: number) => startMs + (n - shot.sourceStartMs) / shot.speed;
					return to > from
						? [
								{
									...r,
									id: `${r.id}@${shot.id}`,
									startMs: map(from),
									endMs: map(to),
									...(r.words
										? {
												words: r.words.flatMap((w) => {
													const a = Math.max(from, w.startMs),
														b = Math.min(to, w.endMs);
													return b > a
														? [
																{
																	...w,
																	startMs: map(a),
																	endMs: map(b),
																},
															]
														: [];
												}),
											}
										: {}),
								},
							]
						: [];
				});
			});
		next.editor.zoomRegions = projectRegions(next.editor.zoomRegions ?? []);
		next.editor.annotationRegions = projectRegions(next.editor.annotationRegions ?? []);
		next.editor.autoCaptions = projectRegions(next.editor.autoCaptions ?? []);
		next.composition.effectsTime = "timeline";
	}
	for (const shot of next.composition.shots)
		if (shot.kind === "main") shot.instanceId ??= shot.id;
	return next;
}
