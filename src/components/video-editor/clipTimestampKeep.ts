import { planClipSplit } from "./clipSplit";
import {
	type ClipRegion,
	getClipSourceEndMs,
	getClipSourceStartMs,
	sortClipRegions,
} from "./types";

export interface TimestampRange {
	startMs: number;
	endMs: number;
}

const DEFAULT_MERGE_GAP_MS = 700;
const DEFAULT_PAD_MS = 120;

function getClipSpeed(clip: ClipRegion) {
	return Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
}

export function mergeTimestampRanges(
	ranges: TimestampRange[],
	mergeGapMs = DEFAULT_MERGE_GAP_MS,
	padMs = DEFAULT_PAD_MS,
): TimestampRange[] {
	const normalized = ranges
		.map((range) => ({
			startMs: Math.max(0, Math.round(range.startMs)),
			endMs: Math.max(0, Math.round(range.endMs)),
		}))
		.filter((range) => range.endMs > range.startMs)
		.sort((left, right) => left.startMs - right.startMs);

	const merged: TimestampRange[] = [];
	for (const range of normalized) {
		const padded = {
			startMs: Math.max(0, range.startMs - padMs),
			endMs: range.endMs + padMs,
		};
		const previous = merged[merged.length - 1];
		if (previous && padded.startMs <= previous.endMs + mergeGapMs) {
			previous.endMs = Math.max(previous.endMs, padded.endMs);
			continue;
		}
		merged.push(padded);
	}
	return merged;
}

export function clipOverlapsTimestamps(clip: ClipRegion, ranges: TimestampRange[]): boolean {
	const sourceStartMs = getClipSourceStartMs(clip);
	const sourceEndMs = getClipSourceEndMs(clip);
	return ranges.some((range) => range.endMs > sourceStartMs && range.startMs < sourceEndMs);
}

function mapSourceTimeToClipTimeline(clip: ClipRegion, sourceMs: number): number {
	const sourceStartMs = getClipSourceStartMs(clip);
	return Math.round(clip.startMs + (sourceMs - sourceStartMs) / getClipSpeed(clip));
}

function collectSplitPoints(clips: ClipRegion[], ranges: TimestampRange[]): number[] {
	const points = new Set<number>();
	for (const clip of clips) {
		const sourceStartMs = getClipSourceStartMs(clip);
		const sourceEndMs = getClipSourceEndMs(clip);
		for (const range of ranges) {
			for (const sourceBoundary of [range.startMs, range.endMs]) {
				if (sourceBoundary > sourceStartMs && sourceBoundary < sourceEndMs) {
					points.add(mapSourceTimeToClipTimeline(clip, sourceBoundary));
				}
			}
		}
	}
	return [...points].sort((left, right) => left - right);
}

function compactClips(clips: ClipRegion[]): ClipRegion[] {
	let cursor = 0;
	return sortClipRegions(clips).map((clip) => {
		const durationMs = Math.max(0, clip.endMs - clip.startMs);
		const next = {
			...clip,
			startMs: cursor,
			endMs: cursor + durationMs,
		};
		cursor += durationMs;
		return next;
	});
}

/**
 * Split clips at caption/timestamp boundaries, drop pieces that don't overlap
 * any timestamp, then pack the remaining pieces so playback is contiguous.
 */
export function planKeepTimestampedClips(params: {
	clipRegions: ClipRegion[];
	timestamps: TimestampRange[];
	createId: () => string;
	mergeGapMs?: number;
	padMs?: number;
}): ClipRegion[] {
	const ranges = mergeTimestampRanges(params.timestamps, params.mergeGapMs, params.padMs);
	if (ranges.length === 0 || params.clipRegions.length === 0) {
		return params.clipRegions;
	}

	let clips = sortClipRegions(params.clipRegions);
	for (const splitMs of collectSplitPoints(clips, ranges)) {
		const plan = planClipSplit({
			clipRegions: clips,
			splitMs,
			createId: params.createId,
		});
		if (!plan) continue;
		clips = clips.flatMap((clip) =>
			clip.id === plan.targetId ? [plan.left, plan.right] : [clip],
		);
	}

	return compactClips(clips.filter((clip) => clipOverlapsTimestamps(clip, ranges)));
}
