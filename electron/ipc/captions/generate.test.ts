import { describe, expect, it, vi } from "vitest";
import { isMissingWindowsWhisperRuntimeDependency } from "./runtimeErrors";

vi.mock("electron", () => ({
	app: {
		getPath: () => "/tmp",
	},
}));

describe("isMissingWindowsWhisperRuntimeDependency", () => {
	it("recognizes the signed and unsigned STATUS_DLL_NOT_FOUND exit codes on Windows", () => {
		if (process.platform !== "win32") return;

		expect(isMissingWindowsWhisperRuntimeDependency({ code: -1073741515 })).toBe(true);
		expect(isMissingWindowsWhisperRuntimeDependency({ code: 3221225781 })).toBe(true);
	});

	it("does not classify ordinary Whisper failures as missing runtimes", () => {
		expect(isMissingWindowsWhisperRuntimeDependency({ code: 1 })).toBe(false);
		expect(isMissingWindowsWhisperRuntimeDependency(new Error("bad model"))).toBe(false);
	});
});

describe("offsetCaptionCues", () => {
	it("shifts cue and word timings by the chunk offset", async () => {
		const { offsetCaptionCues } = await import("./generate");
		const shifted = offsetCaptionCues(
			[
				{
					id: "caption-1",
					startMs: 120,
					endMs: 1800,
					text: "hello",
					words: [{ text: "hello", startMs: 120, endMs: 1800 }],
				},
			],
			25_000,
		);
		expect(shifted[0]?.startMs).toBe(25_120);
		expect(shifted[0]?.endMs).toBe(26_800);
		expect(shifted[0]?.words?.[0]?.startMs).toBe(25_120);
	});
});

describe("buildCaptionExtractArgs", () => {
	it("normalizes quiet speech before TranscribeKit VAD", async () => {
		const { buildCaptionExtractArgs, CAPTION_AUDIO_FILTER } = await import("./generate");
		const args = buildCaptionExtractArgs("/tmp/input.mp4", "/tmp/out.wav");
		expect(CAPTION_AUDIO_FILTER).toContain("loudnorm");
		expect(args).toContain("-af");
		expect(args).toContain(CAPTION_AUDIO_FILTER);
		expect(args).toContain("16000");
	});
});

describe("processTranscribeKitCues", () => {
	it("splits multi-sentence and long clause cues into properly timed cues with words", async () => {
		const { processTranscribeKitCues } = await import("./generate");
		const rawCues = [
			{
				id: "caption-1",
				startMs: 4440,
				endMs: 10320,
				text: "有问题啊，没事，问题不大。我们试一下，看一下今天广告吧。",
			},
			{
				id: "caption-2",
				startMs: 11500,
				endMs: 13840,
				text: "哒哒哒哒。",
			},
		];

		const processed = processTranscribeKitCues(rawCues);
		expect(processed.length).toBe(3);
		expect(processed[0].text).toBe("有问题啊，没事，问题不大。");
		expect(processed[1].text).toBe("我们试一下，看一下今天广告吧。");
		expect(processed[2].text).toBe("哒哒哒哒。");

		// Timestamps check
		expect(processed[0].startMs).toBe(4440);
		expect(processed[0].endMs).toBeLessThanOrEqual(processed[1].startMs);
		expect(processed[1].endMs).toBe(10320);

		// Words check
		expect(processed[0].words).toBeDefined();
		expect(processed[0].words?.length).toBeGreaterThan(0);
		expect(processed[0].words?.[0].startMs).toBe(4440);
	});

	it("splits long cues with commas into separate clauses", async () => {
		const { processTranscribeKitCues } = await import("./generate");
		const rawCues = [
			{
				id: "caption-1",
				startMs: 6080,
				endMs: 16040,
				text: "小傻二郎背着书包上学堂，我们看一下这个视频怎么样。",
			},
		];

		const processed = processTranscribeKitCues(rawCues);
		expect(processed.length).toBe(2);
		expect(processed[0].text).toBe("小傻二郎背着书包上学堂，");
		expect(processed[1].text).toBe("我们看一下这个视频怎么样。");
		expect(processed[0].startMs).toBe(6080);
		expect(processed[1].endMs).toBe(16040);
	});
});
