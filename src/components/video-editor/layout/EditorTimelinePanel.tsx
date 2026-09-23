import { findSourceItem } from "../../../../shared/compositionSources";
import { useMemo } from "react";
import { useCompositionContext } from "../composition/useCompositionEditing";
import {
	brollTimelineRegions,
	sourceTimelineRegions,
	projectSourceRegions,
	sourceRegionSpan,
	sourceSpanAtOutput,
} from "../composition/timelineProjection";
import { timeline as compositionEntries } from "../../../../shared/composition";
import type { RefObject } from "react";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import { retimeCaptionFragment } from "../captionTimeline";
import type { useAnnotationRegionCommands } from "../hooks/useAnnotationRegionCommands";
import type { useAudioRegionCommands } from "../hooks/useAudioRegionCommands";
import type { useCaptionCommands } from "../hooks/useCaptionCommands";
import type { useClipRegionCommands } from "../hooks/useClipRegionCommands";
import type { useEditorPlaybackControls } from "../hooks/useEditorPlaybackControls";
import type { useTimelineProjection } from "../hooks/useTimelineProjection";
import type { useZoomRegionCommands } from "../hooks/useZoomRegionCommands";
import type { useTimelineState } from "../state/useTimelineState";
import TimelineEditor, { type TimelineEditorHandle } from "../timeline/TimelineEditor";

type Props = {
	timelineRef: RefObject<TimelineEditorHandle>;
	timeline: ReturnType<typeof useTimelineState>;
	projection: ReturnType<typeof useTimelineProjection>;
	playback: ReturnType<typeof useEditorPlaybackControls>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	zoomCommands: ReturnType<typeof useZoomRegionCommands>;
	clipCommands: ReturnType<typeof useClipRegionCommands>;
	audioCommands: ReturnType<typeof useAudioRegionCommands>;
	captionCommands: ReturnType<typeof useCaptionCommands>;
	annotationCommands: ReturnType<typeof useAnnotationRegionCommands>;
	videoPath: string | null;
	videoSourcePath: string | null;
	cursorTelemetrySourcePath: string | null;
	normalizedCursorTelemetry: ReturnType<typeof useTimelineState>["cursorTelemetry"];
	autoSuggestZoomsTrigger: number;
	handleAutoSuggestZoomsConsumed: () => void;
	disableSuggestedZooms: boolean;
	currentTime: number;
	handleSelectAnnotation: (id: string | null) => void;
};

export function EditorTimelinePanel(props: Props) {
	const {
		timelineRef,
		timeline,
		projection,
		playback,
		audio,
		zoomCommands,
		clipCommands,
		audioCommands,
		captionCommands,
		annotationCommands,
		videoPath,
		videoSourcePath,
		cursorTelemetrySourcePath,
		normalizedCursorTelemetry,
		autoSuggestZoomsTrigger,
		handleAutoSuggestZoomsConsumed,
		disableSuggestedZooms,
		currentTime,
		handleSelectAnnotation,
	} = props;

	const composition = useCompositionContext();
	const c = timeline.composition;
	const visualAnnotations = useMemo(
		() =>
			c
				? [
						...brollTimelineRegions(c),
						...sourceTimelineRegions(c, composition?.sourcesExpanded),
						...projectSourceRegions(timeline.annotationRegions, c),
					]
				: timeline.annotationRegions,
		[c, timeline.annotationRegions, composition?.sourcesExpanded],
	);
	const visualZooms = useMemo(
		() => (c ? projectSourceRegions(timeline.zoomRegions, c) : timeline.zoomRegions),
		[c, timeline.zoomRegions],
	);
	return (
		<div
			className="flex flex-shrink-0 flex-col"
			style={{ height: c?.sources ? "35%" : "25%", minHeight: c?.sources ? 300 : 240 }}
		>
			<TimelineEditor
				sequenceMode={Boolean(c)}
				ref={timelineRef}
				videoDuration={projection.timelineDuration}
				currentTime={currentTime}
				playheadTime={projection.timelinePlayheadTime}
				onSeek={playback.handleTimelineSeek}
				videoPath={videoPath}
				videoSourcePath={videoSourcePath}
				cursorTelemetrySourcePath={cursorTelemetrySourcePath}
				cursorTelemetry={normalizedCursorTelemetry}
				autoSuggestZoomsTrigger={autoSuggestZoomsTrigger}
				onAutoSuggestZoomsConsumed={handleAutoSuggestZoomsConsumed}
				disableSuggestedZooms={Boolean(c) || disableSuggestedZooms}
				zoomRegions={visualZooms}
				onZoomAdded={(span) => {
					const mapped = c ? sourceSpanAtOutput(span, c) : span;
					if (mapped) zoomCommands.handleZoomAdded(mapped);
				}}
				onZoomSuggested={(span, focus) => {
					const mapped = c ? sourceSpanAtOutput(span, c) : span;
					if (mapped) zoomCommands.handleZoomSuggested(mapped, focus);
				}}
				onZoomSpanChange={(id, span) => {
					if (c) {
						const mapped = sourceRegionSpan(id, span, c);
						if (mapped) zoomCommands.handleZoomSpanChange(mapped.id, mapped.span);
					} else zoomCommands.handleZoomSpanChange(id, span);
				}}
				onZoomDelete={(id) =>
					zoomCommands.handleZoomDelete(c ? id.slice(0, id.lastIndexOf("::")) : id)
				}
				selectedZoomId={
					visualZooms.find((z) =>
						c
							? z.id.startsWith(`${timeline.selectedZoomId}::`)
							: z.id === timeline.selectedZoomId,
					)?.id ?? null
				}
				onSelectZoom={(id) =>
					zoomCommands.handleSelectZoom(c && id ? id.slice(0, id.lastIndexOf("::")) : id)
				}
				trimRegions={timeline.trimRegions}
				clipRegions={projection.clipRegions}
				onClipSplit={clipCommands.handleClipSplit}
				onClipDelete={clipCommands.handleClipDelete}
				onClipSpanChange={clipCommands.handleClipSpanChange}
				selectedClipId={
					c && !c.shots.some((shot) => shot.id === timeline.selectedClipId)
						? null
						: timeline.selectedClipId
				}
				onSelectClip={clipCommands.handleSelectClip}
				audioRegions={timeline.audioRegions}
				onAudioAdded={audioCommands.handleAudioAdded}
				onAudioSpanChange={audioCommands.handleAudioSpanChange}
				onAudioDelete={audioCommands.handleAudioDelete}
				selectedAudioId={timeline.selectedAudioId}
				onSelectAudio={audioCommands.handleSelectAudio}
				captionRegions={projection.effectiveCaptionRegions}
				onCaptionSpanChange={(id, span) => {
					const fragment = projection.effectiveCaptionRegions.find(
						(cue) => cue.id === id,
					);
					if (!fragment) return;
					captionCommands.handleCaptionRetime(
						fragment.sourceCueId,
						retimeCaptionFragment(fragment, span),
					);
				}}
				selectedCaptionId={
					projection.effectiveCaptionRegions.find(
						(cue) =>
							cue.sourceCueId === timeline.selectedCaptionId &&
							currentTime * 1000 >= cue.startMs &&
							currentTime * 1000 < cue.endMs,
					)?.id ?? null
				}
				onSelectCaption={(id) => {
					const fragment = projection.effectiveCaptionRegions.find(
						(cue) => cue.id === id,
					);
					captionCommands.handleSelectCaption(fragment?.sourceCueId ?? null);
					if (fragment) playback.handleTimelineSeek(fragment.startMs / 1000);
				}}
				onCaptionDelete={(id) => {
					const fragment = projection.effectiveCaptionRegions.find(
						(cue) => cue.id === id,
					);
					if (fragment) captionCommands.handleCaptionDelete(fragment.sourceCueId);
				}}
				onCaptionAdded={captionCommands.handleCaptionAdded}
				captionsEnabled={timeline.autoCaptionSettings.enabled}
				captionQuickAddEnabled={timeline.autoCaptionSettings.timelineQuickAdd}
				annotationRegions={visualAnnotations}
				onAnnotationAdded={(span, track) => {
					const mapped = c ? sourceSpanAtOutput(span, c) : span;
					if (mapped)
						annotationCommands.handleAnnotationAdded(mapped, c ? (track ?? 0) : track);
				}}
				onAnnotationSpanChange={(id, span, track) => {
					if (composition?.project && findSourceItem(composition.project, id)) {
						composition.sourceSpan(id, span);
						return;
					}
					const b = c?.broll.find((b) => b.id === id);
					if (b && c && composition) {
						const entry = compositionEntries(c).find((e) => e.shot.id === b.clipId)!;
						const offset = span.start - entry.startMs;
						const oldStart = entry.startMs + b.offsetMs;
						const moving = Math.abs(span.end - span.start - b.durationMs) < 1;
						composition.changeBroll({
							...b,
							offsetMs: offset,
							durationMs: span.end - span.start,
							sourceStartMs:
								b.sourceStartMs + (moving ? 0 : (span.start - oldStart) * b.speed),
						});
					} else if (c) {
						const mapped = sourceRegionSpan(id, span, c);
						if (mapped)
							annotationCommands.handleAnnotationSpanChange(
								mapped.id,
								mapped.span,
								track ?? 0,
							);
					} else annotationCommands.handleAnnotationSpanChange(id, span, track);
				}}
				onAnnotationDelete={(id) => {
					if (composition?.project && findSourceItem(composition.project, id)) {
						composition.removeSourceItem(id);
						return;
					}
					if (c?.broll.some((b) => b.id === id) && composition?.project)
						composition.commit({
							...composition.project,
							composition: { ...c, broll: c.broll.filter((b) => b.id !== id) },
						});
					else
						annotationCommands.handleAnnotationDelete(
							c ? id.slice(0, id.lastIndexOf("::")) : id,
						);
				}}
				selectedAnnotationId={
					c?.broll.some((b) => b.id === timeline.selectedClipId) ||
					(composition?.project &&
						findSourceItem(composition.project, timeline.selectedClipId))
						? timeline.selectedClipId
						: (visualAnnotations.find((a) =>
								c
									? a.id.startsWith(`${timeline.selectedAnnotationId}::`)
									: a.id === timeline.selectedAnnotationId,
							)?.id ?? null)
				}
				onSelectAnnotation={(id) => {
					if (
						c?.broll.some((b) => b.id === id) ||
						(composition?.project && findSourceItem(composition.project, id))
					)
						composition?.select(id);
					else handleSelectAnnotation(c && id ? id.slice(0, id.lastIndexOf("::")) : id);
				}}
				showSourceAudioTrack={timeline.clipRegions.some((clip) => clip.showSourceAudio)}
				sourceAudioResourceVersion={timeline.sourceAudioFallbackRefreshKey}
				sourceAudioTrackSettings={audio.activeSourceAudioTrackSettings}
				getSourceAudioTrackSettingsForClip={audio.getSourceAudioTrackSettingsForClip}
				onSourceAudioAvailabilityChange={timeline.setHasClipSourceAudio}
				onSourceAudioTracksMetaChange={audio.onSourceAudioTracksMetaChange}
			/>
		</div>
	);
}
