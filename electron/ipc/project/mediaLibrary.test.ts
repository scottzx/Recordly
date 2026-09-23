import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ root: "" }));
vi.mock("../utils", () => ({ getRecordingsDir: async () => context.root }));
vi.mock("./session", () => ({
	resolveRecordingSession: async (videoPath: string) => ({ videoPath, webcamPath: null }),
}));
import {
	getLibraryMedia,
	listLibraryMedia,
	protectedLibraryPaths,
	registerLibraryMedia,
} from "./mediaLibrary";

beforeEach(async () => {
	context.root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-library-test-"));
});
afterEach(async () => {
	await fs.rm(context.root, { recursive: true, force: true });
});

describe("persistent recording library", () => {
	it("discovers old recordings once without treating camera or audio sidecars as recordings", async () => {
		for (const name of [
			"recording-A.mp4",
			"recording-A-webcam.webm",
			"recording-A.mic.webm",
			"recording-A.system.webm",
		])
			await fs.writeFile(path.join(context.root, name), "media");
		const first = await listLibraryMedia();
		expect(first).toHaveLength(1);
		expect(await listLibraryMedia()).toEqual(first);
		expect(await getLibraryMedia(first[0].id)).toEqual(first[0]);
	});
	it("updates asynchronous companion media without creating duplicates or touching originals", async () => {
		const videoPath = path.join(context.root, "recording-A.mp4");
		const webcamPath = path.join(context.root, "recording-A-webcam.webm");
		await fs.writeFile(videoPath, "original video");
		await fs.writeFile(webcamPath, "original camera");
		const before = await registerLibraryMedia({ videoPath }, "processing");
		await Promise.all([
			registerLibraryMedia({ videoPath, webcamPath, timeOffsetMs: 175 }, "processing"),
			registerLibraryMedia({ videoPath, hideOverlayCursorByDefault: true }),
		]);
		expect(await getLibraryMedia(before.id)).toMatchObject({
			webcamPath,
			timeOffsetMs: 175,
			status: "ready",
			hideOverlayCursorByDefault: true,
		});
		expect(await protectedLibraryPaths()).toEqual([videoPath, webcamPath]);
		expect(await fs.readFile(videoPath, "utf8")).toBe("original video");
	});
	it("does not silently discard unreadable catalogue entries", async () => {
		await fs.mkdir(path.join(context.root, "Library"));
		await fs.writeFile(path.join(context.root, "Library", "broken.json"), "{");
		await expect(protectedLibraryPaths()).rejects.toThrow();
	});
});
