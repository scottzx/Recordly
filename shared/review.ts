import {
	applyOperation,
	durationMs,
	timeline,
	validateComposition,
	type CompositionProject,
} from "./composition.ts";
import { retimeEditingRegions } from "./compositionEffects.ts";
import {
	requireInput,
	resolveReference,
	validateTranscript,
	projectTranscript,
	type SourceReference,
	type TranscriptState,
} from "./transcript.ts";

export interface ReviewSuggestion {
	id: string;
	kind: "pause" | "repetition" | "retake" | "manual";
	reason: string;
	action: "remove-range";
	target: SourceReference;
	evidence?: { keepSegmentIds?: string[]; keepReferences?: SourceReference[] };
}
export interface ReviewPlan {
	schemaVersion: 1;
	id: string;
	baseRevision: string;
	producer: { kind: "agent" | "local" | "manual"; name: string };
	suggestions: ReviewSuggestion[];
}
export interface ReviewFile {
	schemaVersion: 1;
	base: CompositionProject;
	transcript: TranscriptState;
	plan: ReviewPlan;
	fingerprints: Record<string, string>;
	selection: Record<string, "pending" | "accepted" | "rejected">;
}
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
export async function sha256(value: unknown) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonicalJson(value)),
	);
	return `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
/** Only persisted editing state. Review decisions and history cannot invalidate their own base. */
export async function projectRevision(project: CompositionProject) {
	const { reviewHistory: _history, reviewDraft: _draft, ...composition } = project.composition;
	const { composition: _derived, ...editor } = project.editor;
	return sha256({ videoPath: project.videoPath, composition, editor });
}
export function validateReview(
	project: CompositionProject,
	state: TranscriptState,
	plan: ReviewPlan,
) {
	requireInput(
		plan &&
			plan.schemaVersion === 1 &&
			typeof plan.id === "string" &&
			plan.id.length &&
			typeof plan.baseRevision === "string" &&
			plan.producer &&
			["agent", "local", "manual"].includes(plan.producer.kind) &&
			typeof plan.producer.name === "string" &&
			plan.producer.name.length &&
			Array.isArray(plan.suggestions),
		"Invalid ReviewPlan v1",
	);
	requireInput(
		state && Array.isArray(state.documents) && state.sourceSelections && state.corrections,
		"Invalid transcript state",
	);
	state.documents.forEach(validateTranscript);
	requireInput(
		new Set(state.documents.map((d) => d.sourceId)).size === state.documents.length,
		"Duplicate transcript source",
	);
	const ids = new Set<string>();
	return plan.suggestions.map((s) => {
		requireInput(
			s && typeof s.id === "string" && s.id && !ids.has(s.id),
			"Duplicate or missing suggestion ID",
		);
		ids.add(s.id);
		requireInput(
			["pause", "repetition", "retake", "manual"].includes(s.kind) &&
				s.action === "remove-range" &&
				typeof s.reason === "string" &&
				s.reason.trim(),
			"Invalid suggestion action, kind or reason",
		);
		const range = resolveReference(project, state, s.target);
		requireInput(
			!range.shot.locked || (plan.producer.kind === "manual" && s.kind === "manual"),
			"Suggestion modifies a confirmed clip",
			"LOCKED_CLIP",
		);
		if (s.kind === "pause")
			requireInput(
				range.doc.silenceIntervals.some(
					(i) => i.startMs <= s.target.sourceStartMs && i.endMs >= s.target.sourceEndMs,
				),
				"Pause has no detected silence evidence",
				"INVALID_REFERENCE",
			);
		if (s.kind === "retake" || s.kind === "repetition") {
			requireInput(
				s.target.segmentIds?.length,
				"Semantic removal requires sentence references",
				"INVALID_REFERENCE",
			);
			const keep = s.evidence?.keepSegmentIds ?? [];
			const refs = s.evidence?.keepReferences ?? [];
			requireInput(
				Array.isArray(keep) && Array.isArray(refs) && keep.length + refs.length > 0,
				"Semantic suggestion requires retained evidence",
				"INVALID_REFERENCE",
			);
			for (const id of keep)
				requireInput(
					range.doc.segments.some((seg) => seg.id === id) &&
						!s.target.segmentIds?.includes(id),
					"Invalid retained sentence",
					"INVALID_REFERENCE",
				);
			for (const ref of refs) resolveReference(project, state, ref);
		}
		return { id: s.id, ...range };
	});
}
export function reviewConflicts(
	project: CompositionProject,
	state: TranscriptState,
	plan: ReviewPlan,
) {
	const ranges = validateReview(project, state, plan);
	return ranges.flatMap((a, i) =>
		ranges
			.slice(i + 1)
			.filter((b) => a.startMs < b.endMs && b.startMs < a.endMs)
			.map((b) => [a.id, b.id]),
	);
}
export async function compileReview(
	project: CompositionProject,
	state: TranscriptState,
	plan: ReviewPlan,
	acceptedIds: string[],
) {
	requireInput(
		(await projectRevision(project)) === plan.baseRevision,
		"工程已改变，请基于当前工程重新生成建议",
		"STALE_BASE",
	);
	requireInput(
		!project.composition.reviewHistory?.some((r) => r.id === plan.id),
		"This review has already been applied",
		"STALE_BASE",
	);
	const ranges = validateReview(project, state, plan);
	requireInput(
		Array.isArray(acceptedIds) &&
			new Set(acceptedIds).size === acceptedIds.length &&
			acceptedIds.every((id) => ranges.some((r) => r.id === id)),
		"Unknown or duplicate selection ID",
	);
	const selected = ranges
		.filter((r) => acceptedIds.includes(r.id))
		.sort((a, b) => a.startMs - b.startMs);
	for (let i = 1; i < selected.length; i++)
		requireInput(
			selected[i].startMs >= selected[i - 1].endMs,
			"Conflicting suggestions cannot be accepted together",
			"CONFLICTING_SUGGESTIONS",
		);
	// Evidence must survive the complete transaction, not only its own suggestion.
	for (const s of plan.suggestions.filter((s) => acceptedIds.includes(s.id))) {
		for (const id of s.evidence?.keepSegmentIds ?? []) {
			const keptRows = projectTranscript(project, state).filter(
				(r) =>
					r.instanceId === s.target.instanceId &&
					r.transcriptId === s.target.transcriptId &&
					r.segmentIds?.includes(id),
			);
			requireInput(
				keptRows.length &&
					keptRows.every(
						(keep) =>
							!selected.some((r) => r.startMs < keep.endMs && keep.startMs < r.endMs),
					),
				"Selection removes retained evidence or it is no longer present",
				"CONFLICTING_SUGGESTIONS",
			);
		}
		for (const ref of s.evidence?.keepReferences ?? []) {
			const keep = resolveReference(project, state, ref);
			requireInput(
				!selected.some((r) => r.startMs < keep.endMs && keep.startMs < r.endMs),
				"Selection removes retained evidence",
				"CONFLICTING_SUGGESTIONS",
			);
		}
	}
	const next = structuredClone(project);
	if (!selected.length)
		return {
			project: next,
			removedMs: 0,
			acceptedIds: [],
			durationMs: durationMs(next.composition),
		};
	// Descending base-time cuts preserve all earlier boundaries. Shared split/trim handles sources, views and B-roll.
	for (const range of [...selected].reverse()) {
		const entry = timeline(next.composition).find(
			(e) =>
				range.startMs >= e.startMs - 0.001 &&
				range.endMs <= e.endMs + 0.001 &&
				e.shot.kind === "main",
		);
		requireInput(
			entry && entry.shot.kind === "main",
			"Removal crosses a clip boundary",
			"INVALID_REFERENCE",
		);
		let id = entry.shot.id;
		if (range.endMs < entry.endMs - 0.001)
			next.composition = applyOperation(next.composition, {
				type: "split",
				clipId: id,
				offsetMs: range.endMs - entry.startMs,
			});
		if (range.startMs > entry.startMs + 0.001) {
			const offsetMs = range.startMs - entry.startMs;
			next.composition = applyOperation(next.composition, {
				type: "split",
				clipId: id,
				offsetMs,
			});
			id = `${id}-split-${offsetMs}`;
		}
		next.composition = applyOperation(next.composition, { type: "remove", id });
	}
	requireInput(
		project.composition.effectsTime === "timeline",
		"Enable timeline effects before transcript editing",
	);
	for (const key of ["zoomRegions", "annotationRegions", "autoCaptions"] as const) {
		// Each collection retains its own concrete region shape.
		const regions = project.editor[key];
		if (regions)
			(next.editor as Record<string, unknown>)[key] = retimeEditingRegions<{
				id: string;
				startMs: number;
				endMs: number;
			}>(regions, project.composition, next.composition);
	}
	delete next.composition.reviewDraft;
	next.composition.transcript = structuredClone(state);
	next.composition.reviewHistory = [
		...(next.composition.reviewHistory ?? []),
		{ id: plan.id, acceptedIds: [...acceptedIds].sort(), plan },
	];
	next.version = 5;
	const errors = validateComposition(next);
	requireInput(!errors.length, errors.join("\n"));
	return {
		project: next,
		removedMs: durationMs(project.composition) - durationMs(next.composition),
		acceptedIds: [...acceptedIds].sort(),
		durationMs: durationMs(next.composition),
	};
}
export async function pausePlan(
	project: CompositionProject,
	state: TranscriptState,
): Promise<ReviewPlan> {
	const suggestions: ReviewSuggestion[] = [];
	for (const { shot } of timeline(project.composition)) {
		if (shot.kind !== "main" || shot.locked) continue;
		const instanceId = shot.instanceId ?? shot.id;
		const sourceId = state.sourceSelections[instanceId];
		const doc = state.documents.find((d) => d.sourceId === sourceId);
		if (!doc) continue;
		for (const c of shot.sourceClips ?? []) {
			if (c.sourceId !== sourceId) continue;
			for (const silence of doc.silenceIntervals) {
				const from = Math.max(0, c.sourceStartMs, silence.startMs),
					to = Math.min(
						doc.durationMs,
						c.sourceStartMs + c.durationMs * c.speed,
						silence.endMs,
					);
				if ((to - from) / c.speed < 1500) continue;
				suggestions.push({
					id: `pause-${suggestions.length + 1}`,
					kind: "pause",
					action: "remove-range",
					reason: "检测到至少 1.5 秒静音；两端各保留 250 毫秒，请试听切点。",
					target: {
						instanceId,
						clipId: shot.id,
						sourceId,
						transcriptId: doc.id,
						transcriptRevision: doc.revision,
						sourceStartMs: from + 250 * c.speed,
						sourceEndMs: to - 250 * c.speed,
					},
				});
			}
		}
	}
	return {
		schemaVersion: 1,
		id: crypto.randomUUID(),
		baseRevision: await projectRevision(project),
		producer: { kind: "local", name: "Recordly silence detector" },
		suggestions,
	};
}
