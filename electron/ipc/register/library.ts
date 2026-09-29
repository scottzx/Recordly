import {
	analyzeLibraryEntry,
	fingerprint,
	contentHash,
	updateLibraryEntry,
} from "../../../shared/node/media";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { BrowserWindow, dialog, ipcMain } from "electron";
import {
	emptyEditingProject,
	insertLibraryRecording,
	type LibraryMedia,
	type LibraryRecording,
} from "../../../shared/mediaLibrary";
import {
	getLibraryMedia,
	listLibraryMedia,
	registerLibraryMedia,
	libraryDirectory,
} from "../project/mediaLibrary";
import {
	getProjectsDir,
	rememberApprovedLocalReadPath,
	resolveApprovedLocalMediaPath,
} from "../project/manager";
import { getCompanionAudioFallbackInfo } from "../recording/diagnostics";
import { resolveRecordingSession } from "../project/session";
import { probe } from "./composition";

function changed(entry?: LibraryMedia) {
	for (const window of BrowserWindow.getAllWindows())
		if (!window.isDestroyed()) window.webContents.send("media-library-changed", entry);
}
const analysisJobs = new Map<string, Promise<LibraryMedia>>();
let analysisQueue: Promise<unknown> = Promise.resolve();
function analyze(entry: LibraryMedia) {
	const existing = analysisJobs.get(entry.id);
	if (existing) return existing;
	const job = analysisQueue
		.catch(() => undefined)
		.then(async () => {
			const dir = await libraryDirectory();
			changed(await updateLibraryEntry(dir, entry.id, { analysisStatus: "running" }));
			const result = await analyzeLibraryEntry(
				entry,
				dir,
				getFfprobeBinaryPath(),
				getFfmpegBinaryPath(),
			);
			await rememberApprovedLocalReadPath(result.thumbnailPath);
			changed(result);
			return result;
		})
		.finally(() => analysisJobs.delete(entry.id));
	analysisQueue = job;
	analysisJobs.set(entry.id, job);
	return job;
}
async function resolve(id: string): Promise<LibraryRecording> {
	const entry = await getLibraryMedia(id);
	if (entry.status !== "ready") throw new Error("素材仍在处理中，请稍后重试");
	await rememberApprovedLocalReadPath(entry.videoPath);
	await rememberApprovedLocalReadPath(entry.webcamPath);
	const meta = await probe(entry.videoPath);
	const companion = await getCompanionAudioFallbackInfo(entry.videoPath);
	const paths = [...companion.paths];
	// A mic-only sidecar supplements the embedded system audio.
	if (meta.hasAudio && paths.length && paths.every((p) => /[.-]mic\./i.test(p)))
		paths.unshift(entry.videoPath);
	const audio = [];
	for (const file of paths) {
		await rememberApprovedLocalReadPath(file);
		audio.push({
			path: file,
			timeOffsetMs: companion.startDelayMsByPath[file] ?? 0,
			name: path.basename(file),
		});
	}
	return { ...entry, ...meta, audio };
}
export function registerLibraryHandlers() {
	ipcMain.handle(
		"library-update",
		async (_, id: string, patch: { name?: string; tags?: string[]; favorite?: boolean }) => {
			const safe: Partial<LibraryMedia> = {};
			if (typeof patch.name === "string" && patch.name.trim())
				safe.name = patch.name.trim().slice(0, 200);
			if (Array.isArray(patch.tags) && patch.tags.every((t) => typeof t === "string"))
				safe.tags = [...new Set(patch.tags.map((t) => t.trim()).filter(Boolean))].slice(
					0,
					50,
				);
			if (typeof patch.favorite === "boolean") safe.favorite = patch.favorite;
			const entry = await updateLibraryEntry(await libraryDirectory(), id, safe);
			changed(entry);
			return entry;
		},
	);
	ipcMain.handle("library-retry", async (_, id: string) => analyze(await getLibraryMedia(id)));
	ipcMain.handle("library-relocate", async (_, id: string) => {
		const original = await getLibraryMedia(id);
		const picked = await dialog.showOpenDialog({
			title: "重新定位素材（不同内容将登记为新素材）",
			properties: ["openFile"],
			filters: [{ name: "视频", extensions: ["mp4", "mov", "webm", "mkv"] }],
		});
		if (picked.canceled) return null;
		const file = picked.filePaths[0];
		await rememberApprovedLocalReadPath(file);
		if (original.contentHash && (await contentHash(file)) === original.contentHash) {
			const relocated = await updateLibraryEntry(await libraryDirectory(), id, {
				videoPath: file,
				analysisStatus: "pending",
				error: undefined,
			});
			const result = await analyze(relocated);
			changed(result);
			return result;
		}
		// Different or unverifiable bytes are a new asset; references to the original are not silently reused.
		const entry = await registerLibraryMedia({
			videoPath: file,
			origin: original.origin ?? "imported",
		});
		const result = await analyze(entry);
		changed(result);
		return result;
	});
	ipcMain.handle("library-pick-project", async () => {
		const result = await dialog.showOpenDialog({
			properties: ["openFile"],
			filters: [{ name: "剪辑项目", extensions: ["recordly", "screenstudio"] }],
		});
		return result.canceled ? null : result.filePaths[0];
	});
	ipcMain.handle("library-list", async () => {
		const entries = await listLibraryMedia();
		for (const entry of entries) {
			await rememberApprovedLocalReadPath(entry.videoPath);
			await rememberApprovedLocalReadPath(entry.thumbnailPath);
			if (entry.status !== "ready") continue;
			try {
				const identity = await fingerprint(entry.videoPath);
				if (
					!entry.analysisStatus ||
					entry.analysisStatus === "pending" ||
					entry.fingerprint !== identity
				)
					void analyze(entry).catch(console.error);
			} catch {
				entry.analysisStatus = "missing";
				entry.error = "源文件丢失，请重新定位";
			}
		}
		return entries;
	});
	ipcMain.handle("library-resolve", (_, id: string) => resolve(id));
	ipcMain.handle(
		"library-register-recording",
		async (
			_,
			session: Pick<
				LibraryMedia,
				"videoPath" | "webcamPath" | "timeOffsetMs" | "hideOverlayCursorByDefault"
			>,
			status: LibraryMedia["status"] = "ready",
		) => {
			if (!(await resolveApprovedLocalMediaPath(session.videoPath)))
				throw new Error("Recording is not available");
			if (session.webcamPath && !(await resolveApprovedLocalMediaPath(session.webcamPath)))
				throw new Error("Camera recording is not available");
			const entry = await registerLibraryMedia(session, status);
			changed(entry);
			return entry;
		},
	);
	ipcMain.handle("library-import", async () => {
		const result = await dialog.showOpenDialog({
			properties: ["openFile", "multiSelections"],
			filters: [{ name: "视频素材", extensions: ["mp4", "mov", "webm", "mkv"] }],
		});
		const entries = [];
		for (const file of result.filePaths) {
			await rememberApprovedLocalReadPath(file);
			const entry = await registerLibraryMedia({
				...((await resolveRecordingSession(file)) ?? { videoPath: file }),
				origin: "imported",
			});
			entries.push(entry);
			void analyze(entry).catch(console.error);
		}
		if (entries.length) changed(entries[entries.length - 1]);
		return entries;
	});
	ipcMain.handle(
		"library-create-project",
		async (_, ids: string[] = [], name: string = "未命名剪辑") => {
			let project = emptyEditingProject();
			project.projectId = randomUUID();
			for (const id of ids) {
				const media = await resolve(id);
				project = insertLibraryRecording(
					project,
					media,
					Number.MAX_SAFE_INTEGER,
					randomUUID(),
				);
			}
			const safeName =
				Array.from(name.replace(/[<>:"/\\|?*]/g, ""))
					.filter((character) => character.charCodeAt(0) > 31)
					.join("")
					.replace(/[. ]+$/g, "")
					.trim() || "未命名剪辑";
			const directory = await getProjectsDir();
			let index = 0,
				file: string;
			while (true) {
				file = path.join(directory, `${safeName}${index ? ` ${index + 1}` : ""}.recordly`);
				try {
					await fs.writeFile(file, JSON.stringify(project, null, 2), { flag: "wx" });
					break;
				} catch (e) {
					if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
					index++;
				}
			}
			return { success: true, path: file, project };
		},
	);
}
