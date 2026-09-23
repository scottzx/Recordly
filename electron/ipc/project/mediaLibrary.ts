import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { LibraryMedia } from "../../../shared/mediaLibrary";
import { getRecordingsDir } from "../utils";
import { resolveRecordingSession } from "./session";

const writes = new Map<string, Promise<LibraryMedia>>();
const processing = new Set<string>();
const idFor = (file: string) =>
	createHash("sha256").update(path.resolve(file)).digest("hex").slice(0, 24);
async function directory() {
	const dir = path.join(await getRecordingsDir(), "Library");
	await fs.mkdir(dir, { recursive: true });
	return dir;
}
export async function registerLibraryMedia(
	session: {
		videoPath: string;
		webcamPath?: string | null;
		timeOffsetMs?: number;
		hideOverlayCursorByDefault?: boolean;
	},
	status: LibraryMedia["status"] = "ready",
): Promise<LibraryMedia> {
	const videoPath = path.resolve(session.videoPath),
		id = idFor(videoPath);
	if (status === "processing") processing.add(id);
	else processing.delete(id);
	const operation = (writes.get(id) ?? Promise.resolve())
		.catch(() => undefined)
		.then(async () => {
			const file = path.join(await directory(), `${id}.json`);
			let existing: LibraryMedia | undefined;
			try {
				existing = JSON.parse(await fs.readFile(file, "utf8"));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			const stat = await fs.stat(videoPath);
			const entry: LibraryMedia = {
				id,
				name: path.basename(videoPath, path.extname(videoPath)),
				createdAt: stat.birthtimeMs || stat.mtimeMs,
				...existing,
				...session,
				videoPath,
				status,
			};
			const temp = `${file}.${randomUUID()}.tmp`;
			try {
				await fs.writeFile(temp, JSON.stringify(entry, null, 2));
				await fs.rename(temp, file);
			} finally {
				await fs.rm(temp, { force: true });
			}
			return entry;
		});
	writes.set(id, operation);
	try {
		return await operation;
	} finally {
		if (writes.get(id) === operation) writes.delete(id);
	}
}
export async function listLibraryMedia(): Promise<LibraryMedia[]> {
	const dir = await directory();
	const entries: LibraryMedia[] = [];
	for (const name of await fs.readdir(dir)) {
		if (!name.endsWith(".json")) continue;
		const entry = JSON.parse(await fs.readFile(path.join(dir, name), "utf8")) as LibraryMedia;
		// A previous process may have exited after writing the video but before
		// publishing completion. Resolve companions again so recordings stay usable.
		if (entry.status === "processing" && !processing.has(entry.id)) {
			const session = await resolveRecordingSession(entry.videoPath);
			entries.push(
				await registerLibraryMedia({
					...session,
					...entry,
					webcamPath: entry.webcamPath ?? session?.webcamPath,
				}),
			);
		} else entries.push(entry);
	}
	// Discover existing recordings without rewriting any project or original media.
	const root = await getRecordingsDir();
	for (const item of await fs.readdir(root, { withFileTypes: true })) {
		if (
			!item.isFile() ||
			!/\.(mp4|mov|webm|mkv)$/i.test(item.name) ||
			/(?:-webcam|\.(mic|system))\./i.test(item.name)
		)
			continue;
		const file = path.join(root, item.name);
		if (entries.some((e) => e.videoPath === file)) continue;
		const session = await resolveRecordingSession(file);
		if (session) entries.push(await registerLibraryMedia(session));
	}
	return entries.sort((a, b) => b.createdAt - a.createdAt);
}
export async function getLibraryMedia(id: string): Promise<LibraryMedia> {
	if (!/^[a-f0-9]{24}$/.test(id)) throw new Error("Invalid library ID");
	return JSON.parse(await fs.readFile(path.join(await directory(), `${id}.json`), "utf8"));
}

export async function protectedLibraryPaths(): Promise<string[]> {
	const dir = await directory(),
		paths: string[] = [];
	for (const name of await fs.readdir(dir)) {
		if (!name.endsWith(".json")) continue;
		const entry: LibraryMedia = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
		paths.push(entry.videoPath);
		if (entry.webcamPath) paths.push(entry.webcamPath);
	}
	return paths;
}
