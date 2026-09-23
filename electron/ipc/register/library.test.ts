import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompositionProject } from "../../../shared/composition";
import type { LibraryMedia, LibraryRecording } from "../../../shared/mediaLibrary";

const context = vi.hoisted(() => ({
	root: "",
	handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
	send: vi.fn(),
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
			context.handlers.set(name, handler),
	},
	BrowserWindow: {
		getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: context.send } }],
	},
	dialog: {},
}));
vi.mock("../utils", () => ({ getRecordingsDir: async () => context.root }));
vi.mock("../project/manager", () => ({
	getProjectsDir: async () => context.root,
	rememberApprovedLocalReadPath: async () => {},
	resolveApprovedLocalMediaPath: async (file: string) =>
		file.startsWith(context.root) ? file : null,
}));
vi.mock("../project/session", () => ({
	resolveRecordingSession: async (videoPath: string) => ({ videoPath }),
}));
vi.mock("../recording/diagnostics", () => ({
	getCompanionAudioFallbackInfo: async () => ({ paths: [], startDelayMsByPath: {} }),
}));
vi.mock("./composition", () => ({
	probe: async () => ({ durationMs: 1000, width: 640, height: 360, hasAudio: true }),
}));
import { registerLibraryHandlers } from "./library";
import { registerLibraryMedia } from "../project/mediaLibrary";
import { validateComposition } from "../../../shared/composition";

const invoke = <T = { path: string; project: CompositionProject }>(
	name: string,
	...args: unknown[]
) => context.handlers.get(name)!(null, ...args) as Promise<T>;
beforeEach(async () => {
	context.root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-library-ipc-"));
	context.send.mockClear();
	registerLibraryHandlers();
});
afterEach(async () => {
	await fs.rm(context.root, { recursive: true, force: true });
});

describe("editing project library IPC", () => {
	it("creates reloadable empty projects without overwriting an existing project", async () => {
		const first = await invoke("library-create-project");
		const second = await invoke("library-create-project");
		expect(first.path).not.toBe(second.path);
		expect(first.project.projectId).not.toBe(second.project.projectId);
		const saved = JSON.parse(await fs.readFile(first.path, "utf8"));
		expect(saved.videoPath).toBe("");
		expect(saved.composition.shots).toEqual([]);
		expect(validateComposition(saved)).toEqual([]);
	});
	it("creates a sequence in selection order, with repeated media as independent clips", async () => {
		const ids = [];
		for (const name of ["A", "B"]) {
			const videoPath = path.join(context.root, `${name}.mp4`);
			await fs.writeFile(videoPath, "original");
			ids.push((await registerLibraryMedia({ videoPath })).id);
		}
		const result = await invoke("library-create-project", [ids[1], ids[0], ids[1]]);
		expect(
			result.project.composition.shots.map((shot) =>
				shot.kind === "main" ? shot.name : "card",
			),
		).toEqual(["B", "A", "B"]);
		expect(new Set(result.project.composition.shots.map((shot) => shot.id)).size).toBe(3);
		expect(validateComposition(result.project)).toEqual([]);
	});
	it("publishes recording readiness and refuses unapproved source paths", async () => {
		const videoPath = path.join(context.root, "A.mp4");
		await fs.writeFile(videoPath, "original");
		const entry = await invoke<LibraryMedia>(
			"library-register-recording",
			{ videoPath },
			"processing",
		);
		await expect(invoke("library-resolve", entry.id)).rejects.toThrow("处理中");
		await invoke("library-register-recording", { videoPath });
		expect(await invoke<LibraryRecording>("library-resolve", entry.id)).toMatchObject({
			status: "ready",
			durationMs: 1000,
		});
		expect(context.send).toHaveBeenCalledWith(
			"media-library-changed",
			expect.objectContaining({ id: entry.id, status: "ready" }),
		);
		await expect(
			invoke("library-register-recording", { videoPath: "/unapproved.mp4" }),
		).rejects.toThrow("not available");
	});
});
