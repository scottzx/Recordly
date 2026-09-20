import { describe, expect, it } from "vitest";
import { planKeepTimestampedClips } from "./clipTimestampKeep";
import { getClipSourceEndMs, getClipSourceStartMs } from "./types";

function createIdFactory() {
	let next = 1;
	return () => `clip-${next++}`;
}

describe("planKeepTimestampedClips", () => {
	it("splits around timestamped speech and drops the silent middle", () => {
		const kept = planKeepTimestampedClips({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 20_000, speed: 1 }],
			timestamps: [
				{ startMs: 0, endMs: 4_000 },
				{ startMs: 12_000, endMs: 16_000 },
			],
			createId: createIdFactory(),
			mergeGapMs: 0,
			padMs: 0,
		});

		expect(kept).toHaveLength(2);
		expect(kept[0]).toMatchObject({ startMs: 0, endMs: 4_000, speed: 1 });
		expect(kept[1]).toMatchObject({ startMs: 4_000, endMs: 8_000, sourceStartMs: 12_000 });
		expect(getClipSourceStartMs(kept[0])).toBe(0);
		expect(getClipSourceEndMs(kept[0])).toBe(4_000);
		expect(getClipSourceStartMs(kept[1])).toBe(12_000);
		expect(getClipSourceEndMs(kept[1])).toBe(16_000);
	});

	it("leaves clips unchanged when there are no timestamps", () => {
		const clips = [{ id: "clip-1", startMs: 0, endMs: 8_000, speed: 1 }];
		expect(
			planKeepTimestampedClips({
				clipRegions: clips,
				timestamps: [],
				createId: createIdFactory(),
			}),
		).toEqual(clips);
	});
});
