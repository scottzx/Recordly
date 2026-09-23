import { compositionClips } from './timelineProjection';
import { buildTimelineItems, resolveDropRowId } from '../timeline/model/timelineModel';
import { CLIP_ROW_ID, BROLL_ROW_ID, PACKAGING_ROW_ID } from '../timeline/core/constants';
import { describe, it, expect } from "vitest";
import {
	applyOperation,
	migrateProject,
	type CompositionProject,
} from "../../../../shared/composition";
import { brollTimelineRegions, projectSourceRegions, sourceRegionSpan } from "./timelineProjection";
import { createProjectData, normalizeProjectEditor } from "../projectPersistence";
import {
	createEditorHistoryStack,
	recordEditorHistorySnapshot,
	undoEditorHistoryStack,
	redoEditorHistoryStack,
	type EditorHistorySnapshot,
} from "../editorHistory";
const project = (): CompositionProject => ({
	version: 3,
	videoPath: "source.mp4",
	editor: {},
	composition: {
		width: 640,
		height: 360,
		fps: 30,
		assets: [{ id: "image", path: "image.png", kind: "image" }],
		shots: [
			{ id: "title", kind: "card", template: "intro", durationMs: 3000 },
			{
				id: "talk",
				kind: "main",
				sourceStartMs: 10000,
				sourceEndMs: 18000,
				speed: 2,
				layout: { mode: "screen" },
			},
		],
		broll: [
			{
				id: "cover",
				clipId: "talk",
				assetId: "image",
				offsetMs: 500,
				durationMs: 1000,
				sourceStartMs: 0,
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
});
describe("composition in the original editor", () => {
	it("projects source effects after packaging and reverses edits at the clip speed", () => {
		const c = project().composition;
		const regions = projectSourceRegions([{ id: "zoom", startMs: 11000, endMs: 15000 }], c);
		expect(regions).toEqual([{ id: "zoom::talk", startMs: 3500, endMs: 5500 }]);
		expect(sourceRegionSpan(regions[0].id, { start: 4000, end: 6000 }, c)).toEqual({
			id: "zoom",
			span: { start: 12000, end: 16000 },
		});
		expect(brollTimelineRegions(c)[0]).toMatchObject({
			id: "cover",
			startMs: 3500,
			endMs: 4500,
		});
	});
	it("moves overlays after changing a card duration and preserves source spans", () => {
		const p = project();
		p.composition.shots[0] = {
			...p.composition.shots[0],
			kind: "card",
			template: "intro",
			durationMs: 5000,
		};
		expect(brollTimelineRegions(p.composition)[0]).toMatchObject({
			startMs: 5500,
			endMs: 6500,
		});
		expect(
			projectSourceRegions([{ id: "a", startMs: 11000, endMs: 12000 }], p.composition)[0],
		).toMatchObject({ startMs: 5500, endMs: 6000 });
	});
	it("round trips the root composition through normal editor snapshots", () => {
		const p = project();
		const normalized = normalizeProjectEditor({ ...p.editor, composition: p.composition });
		const saved = createProjectData(p.videoPath, normalized);
		expect(saved.composition).toEqual(p.composition);
		expect(saved.editor).not.toHaveProperty("composition");
		expect(migrateProject(saved, 30000).composition).toEqual(p.composition);
	});
	it("undoes and redoes linked splits as one existing editor history entry", () => {
		const stack = createEditorHistoryStack();
		const initial: EditorHistorySnapshot = {
			composition: project().composition,
			zoomRegions: [],
			clipRegions: [],
			speedRegions: [],
			annotationRegions: [],
			audioRegions: [],
			autoCaptions: [],
			selectedZoomId: null,
			selectedClipId: "talk",
			selectedAnnotationId: null,
			selectedAudioId: null,
		};
		recordEditorHistorySnapshot(stack, initial);
		const next = {
			...initial,
			composition: applyOperation(initial.composition!, {
				type: "split",
				clipId: "talk",
				offsetMs: 1000,
			}),
		};
		recordEditorHistorySnapshot(stack, next);
		expect(undoEditorHistoryStack(stack, next)?.composition).toEqual(initial.composition);
		expect(redoEditorHistoryStack(stack, initial)?.composition?.broll).toHaveLength(2);
	});
});

describe('three composition tracks',()=>{
 it('places A-roll, B-roll and cards on distinct existing timeline lanes',()=>{
  const c=project().composition;
  const items=buildTimelineItems({clipRegions:compositionClips(c),annotationRegions:brollTimelineRegions(c),zoomRegions:[],audioRegions:[]});
  expect(items.find(i=>i.id==='talk')?.rowId).toBe(CLIP_ROW_ID);
  expect(items.find(i=>i.id==='cover')?.rowId).toBe(BROLL_ROW_ID);
  expect(items.find(i=>i.id==='title')?.rowId).toBe(PACKAGING_ROW_ID);
  expect(new Set(items.map(i=>i.rowId)).size).toBe(3);
 });
 it('keeps media in its own lane when dragged vertically across another track',()=>{
  const c=project().composition;
  const items=buildTimelineItems({clipRegions:compositionClips(c),annotationRegions:brollTimelineRegions(c),zoomRegions:[],audioRegions:[]});
  expect(resolveDropRowId('title',CLIP_ROW_ID,items)).toBe(PACKAGING_ROW_ID);
  expect(resolveDropRowId('cover',PACKAGING_ROW_ID,items)).toBe(BROLL_ROW_ID);
  expect(resolveDropRowId('talk',BROLL_ROW_ID,items)).toBe(CLIP_ROW_ID);
 });
 it('keeps an A-roll gap aligned with the independent packaging lane',()=>{
  const c=project().composition;const regions=compositionClips(c);
  expect(regions.find(r=>r.timelineRole==='packaging')).toMatchObject({startMs:0,endMs:3000});
  expect(regions.find(r=>r.timelineRole==='aroll')).toMatchObject({startMs:3000,endMs:7000});
  expect(brollTimelineRegions(c)[0]).toMatchObject({startMs:3500,endMs:4500});
 });
});
