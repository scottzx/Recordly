import { projectSourceRegions } from "./timelineProjection";
import { projectCaptionCues } from "../captionTimeline";
import { compositionClips } from "./timelineProjection";
import { retimeEditingRegions } from "../../../../shared/compositionEffects";
import { insertLibraryRecording } from "../../../../shared/mediaLibrary";
import {
	enableSourceEditing,
	findSourceItem,
	resizeView,
} from "../../../../shared/compositionSources";
import { createContext, useContext, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	applyOperation,
	migrateProject,
	timeline as entries,
	validateComposition,
	type CompositionProject,
	type Operation,
	type Shot,
	type BRoll,
} from "../../../../shared/composition";
import { createProjectData, type ProjectEditorState } from "../projectPersistence";
import type { useTimelineState } from "../state/useTimelineState";
import type { EditorEffectSection } from "../types";
import type { Span } from "dnd-timeline";

async function probeSourceMetadata(project: CompositionProject) {
	const ids = new Set(project.composition.sources?.map((source) => source.assetId));
	for (const asset of project.composition.assets)
		if (ids.has(asset.id)) {
			const meta = await window.electronAPI.compositionProbe(asset.path);
			Object.assign(asset, meta);
		}
}

export function useCompositionEditing({
	state,
	editor,
	source,
	duration,
	time,
	setSection,
}: {
	state: ReturnType<typeof useTimelineState>;
	editor: Partial<ProjectEditorState>;
	source: string | null;
	duration: number;
	time: number;
	setSection: (section: EditorEffectSection) => void;
}) {
	const project = useMemo(
		() =>
			source !== null || editor.composition ? createProjectData(source ?? "", editor) : null,
		[source, editor],
	);
	const [sourcesExpanded, setSourcesExpanded] = useState(true);
	const composed = project?.composition ? (project as CompositionProject) : null;
	const commit = (next: CompositionProject) => {
		const errors = validateComposition(next);
		if (errors.length) {
			toast.error(errors.join("\n"));
			return false;
		}
		if (
			composed?.composition.effectsTime === "timeline" &&
			JSON.stringify(composed.composition.shots) !== JSON.stringify(next.composition.shots)
		) {
			state.setZoomRegions((regions) =>
				retimeEditingRegions(regions, composed.composition, next.composition),
			);
			state.setAnnotationRegions((regions) =>
				retimeEditingRegions(regions, composed.composition, next.composition),
			);
			state.setAutoCaptions((regions) =>
				retimeEditingRegions(regions, composed.composition, next.composition),
			);
		}
		state.setComposition(next.composition);
		return true;
	};
	const latest = useRef({ project, composed, state, duration, commit });
	latest.current = { project, composed, state, duration, commit };
	const inserting = useRef(false);
	const operation = (op: Operation) => {
		if (!composed) return;
		try {
			const next = structuredClone(composed);
			if (op.type === "remove" && next.composition.broll.some((b) => b.id === op.id))
				next.composition.broll = next.composition.broll.filter((b) => b.id !== op.id);
			else next.composition = applyOperation(next.composition, op);
			commit(next);
		} catch (e) {
			toast.error(String(e));
		}
	};
	const select = (id: string | null) => {
		state.setSelectedClipId(id);
		state.setSelectedAnnotationId(null);
		state.setSelectedZoomId(null);
		state.setSelectedAudioId(null);
		state.setSelectedCaptionId(null);
		setSection("composition");
	};
	const changeShot = (shot: Shot) =>
		composed &&
		commit({
			...composed,
			composition: {
				...composed.composition,
				shots: composed.composition.shots.map((s) => (s.id === shot.id ? shot : s)),
			},
		});
	const changeBroll = (b: BRoll) =>
		composed &&
		commit({
			...composed,
			composition: {
				...composed.composition,
				broll: composed.composition.broll.map((s) => (s.id === b.id ? b : s)),
			},
		});
	const sourceSpan = (id: string, span: Span) => {
		if (!composed) return;
		const selected = findSourceItem(composed, id);
		if (!selected) return;
		const entry = entries(composed.composition).find((e) => e.shot.id === selected.shot.id)!;
		const start = span.start - entry.startMs,
			end = span.end - entry.startMs;
		try {
			if (selected.view) changeShot(resizeView(selected.shot, id, start, end));
			else if (selected.clip) {
				const clip = selected.clip;
				const moving = Math.abs(end - start - clip.durationMs) < 0.01;
				changeShot({
					...selected.shot,
					sourceClips: selected.shot.sourceClips!.map((c) =>
						c.id !== id
							? c
							: {
									...c,
									offsetMs: start,
									durationMs: end - start,
									linked: moving ? false : c.linked,
									sourceStartMs:
										c.sourceStartMs +
										(moving ? 0 : start - c.offsetMs) * c.speed,
								},
					),
				});
			}
		} catch (e) {
			toast.error(String(e));
		}
	};
	const removeSourceItem = (id: string) => {
		if (!composed) return;
		const selected = findSourceItem(composed, id);
		if (selected)
			changeShot({
				...selected.shot,
				sourceClips: selected.shot.sourceClips?.filter((c) => c.id !== id),
				views: selected.shot.views?.filter((v) => v.id !== id),
			});
	};
	const span = (id: string, span: Span) => {
		if (!composed) return;
		const all = entries(composed.composition),
			entry = all.find((e) => e.shot.id === id);
		if (!entry) return;
		const delta = span.start - entry.startMs,
			endDelta = span.end - entry.endMs;
		if (Math.abs(delta - endDelta) < 1) {
			operation({
				type: "move",
				id,
				index: all.filter((e) => e.shot.id !== id && e.startMs < span.start).length,
			});
			return;
		}
		const shot = entry.shot;
		if (shot.kind === "card") changeShot({ ...shot, durationMs: span.end - span.start });
		else
			operation({
				type: "trim",
				clipId: id,
				sourceStartMs: shot.sourceStartMs + delta * shot.speed,
				sourceEndMs: shot.sourceEndMs + endDelta * shot.speed,
			});
	};
	const split = (at: number) => {
		if (!composed) return;
		const selected = findSourceItem(composed, state.selectedClipId);
		if (selected) {
			const entry = entries(composed.composition).find(
				(e) => e.shot.id === selected.shot.id,
			)!;
			operation({
				type: selected.clip ? "split-source" : "split-view",
				clipId: selected.shot.id,
				id: (selected.clip ?? selected.view)!.id,
				offsetMs: at - entry.startMs,
			});
			return;
		}
		const e = entries(composed.composition).find(
			(e) => e.shot.kind === "main" && at > e.startMs && at < e.endMs,
		);
		if (e) operation({ type: "split", clipId: e.shot.id, offsetMs: at - e.startMs });
	};
	return {
		project: composed,
		insertRecording: async (id: string, atMs: number) => {
			if (inserting.current) {
				toast.info("正在插入素材，请稍候");
				return;
			}
			inserting.current = true;
			try {
				const media = await window.electronAPI.libraryResolve(id);
				const { project, composed, state, duration, commit } = latest.current;
				if (!project) return;
				const base = composed?.composition.sources
					? structuredClone(composed)
					: enableSourceEditing(composed ?? migrateProject(project, duration * 1000));
				if (!base.composition.effectsTime) {
					const zooms = composed
						? projectSourceRegions(state.zoomRegions, base.composition)
						: state.zoomRegions;
					const annotations = composed
						? projectSourceRegions(state.annotationRegions, base.composition)
						: state.annotationRegions;
					const captions = projectCaptionCues(
						state.autoCaptions,
						compositionClips(base.composition).filter(
							(clip) => clip.timelineRole === "aroll",
						),
					).map(({ sourceCueId: _sourceCueId, sourceCue, clip, ...cue }) => ({
						...cue,
						words: sourceCue.words?.flatMap((word) => {
							const map = (time: number) =>
								clip.startMs + (time - (clip.sourceStartMs ?? 0)) / clip.speed;
							const startMs = Math.max(cue.startMs, map(word.startMs));
							const endMs = Math.min(cue.endMs, map(word.endMs));
							return endMs > startMs ? [{ ...word, startMs, endMs }] : [];
						}),
					}));
					base.composition.effectsTime = "timeline";
					for (const shot of base.composition.shots)
						if (shot.kind === "main") shot.instanceId ??= shot.id;
					const next = insertLibraryRecording(base, media, atMs, crypto.randomUUID());
					if (commit(next)) {
						state.setZoomRegions(
							retimeEditingRegions(zooms, base.composition, next.composition),
						);
						state.setAnnotationRegions(
							retimeEditingRegions(annotations, base.composition, next.composition),
						);
						state.setAutoCaptions(
							retimeEditingRegions(captions, base.composition, next.composition),
						);
					}
					return;
				}
				const next = insertLibraryRecording(base, media, atMs, crypto.randomUUID());
				commit(next);
			} catch (error) {
				toast.error(String(error));
			} finally {
				inserting.current = false;
			}
		},
		sourcesExpanded,
		setSourcesExpanded,
		sourceSpan,
		removeSourceItem,
		enableSources: async () => {
			if (!composed) return;
			try {
				const next = enableSourceEditing(composed);
				await probeSourceMetadata(next);
				commit(next);
			} catch (e) {
				toast.error(String(e));
			}
		},
		selected: state.selectedClipId,
		time: time * 1000,
		commit,
		operation,
		select,
		changeShot,
		changeBroll,
		span,
		split,
		enable: async () => {
			if (!project || duration <= 0) return;
			try {
				const next = enableSourceEditing(migrateProject(project, duration * 1000));
				await probeSourceMetadata(next);
				const info = await window.electronAPI.compositionProbe(project.videoPath);
				const scale = Math.min(
					1,
					1920 / (info.width || 1920),
					1080 / (info.height || 1080),
				);
				next.composition.width = Math.round(((info.width || 1920) * scale) / 2) * 2;
				next.composition.height = Math.round(((info.height || 1080) * scale) / 2) * 2;
				if (commit(next)) {
					state.setZoomRegions(next.editor.zoomRegions ?? []);
					state.setAnnotationRegions(next.editor.annotationRegions ?? []);
					select(next.composition.shots[0]?.id ?? null);
				}
			} catch (e) {
				toast.error(String(e));
			}
		},
	};
}
export const CompositionEditingContext = createContext<ReturnType<
	typeof useCompositionEditing
> | null>(null);
export function useCompositionContext() {
	return useContext(CompositionEditingContext);
}
