import { describe, expect, it } from "vitest";
import { shouldSeekAudio } from "./audioSync";

describe("composition audio drift correction", () => {
	it("does not interrupt a slow seek or buffering on successive animation frames", () => {
		for (let now = 0; now < 3000; now += 16) {
			expect(shouldSeekAudio({ currentTime: 10, seeking: true, readyState: 4 }, 11 + now / 1000, now, 0, false)).toBe(false);
			expect(shouldSeekAudio({ currentTime: 10, seeking: false, readyState: 2 }, 11 + now / 1000, now, 0, false)).toBe(false);
		}
	});
	it("allows immediate explicit timeline seeks even while buffering", () => {
		expect(shouldSeekAudio({ currentTime: 10, seeking: true, readyState: 2 }, 200, 10, 0, true)).toBe(true);
	});
	it("tolerates small playback drift and spaces larger corrections", () => {
		const playing = { currentTime: 10, seeking: false, readyState: 4 };
		expect(shouldSeekAudio(playing, 10.2, 2000, 0, false)).toBe(false);
		expect(shouldSeekAudio(playing, 11, 500, 0, false)).toBe(false);
		expect(shouldSeekAudio(playing, 11, 1000, 0, false)).toBe(true);
	});
});
