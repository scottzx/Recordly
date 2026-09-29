import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireInput, OralCutError } from "../transcript.ts";
import type { LibraryMedia } from "../mediaLibrary.ts";
const run = promisify(execFile);
export const mediaId = (file: string) =>
	createHash("sha256").update(path.resolve(file)).digest("hex").slice(0, 24);
export async function contentHash(file: string) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(file)) hash.update(chunk);
	return hash.digest("hex");
}
export async function fingerprint(file: string) {
	try {
		const stat = await fs.stat(file);
		return createHash("sha256")
			.update(JSON.stringify([path.resolve(file), stat.size, stat.mtimeMs]))
			.digest("hex");
	} catch {
		throw new OralCutError("MISSING_MEDIA", `无法读取素材：${file}`);
	}
}
export async function probeMedia(file: string, ffprobe: string, signal?: AbortSignal) {
	const { stdout } = await run(
		ffprobe,
		[
			"-v",
			"error",
			"-show_entries",
			"format=duration:stream=codec_type,width,height",
			"-of",
			"json",
			file,
		],
		{ signal, maxBuffer: 1024 * 1024 },
	);
	const info = JSON.parse(stdout),
		video = info.streams.find((s: { codec_type: string }) => s.codec_type === "video");
	const durationMs = Number(info.format.duration) * 1000;
	requireInput(Number.isFinite(durationMs) && durationMs > 0, "无法解析素材时长");
	return {
		durationMs,
		width: video?.width ?? 0,
		height: video?.height ?? 0,
		hasAudio: info.streams.some((s: { codec_type: string }) => s.codec_type === "audio"),
		hasVideo: Boolean(video),
	};
}
export async function writeNew(file: string, data: unknown) {
	const temp = `${file}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temp, typeof data === "string" ? data : JSON.stringify(data, null, 2), {
			flag: "wx",
		});
		// Hard-link publication is atomic and cannot overwrite an existing output.
		await fs.link(temp, file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new OralCutError("OUTPUT_EXISTS", `输出已存在：${file}`);
		throw error;
	} finally {
		await fs.rm(temp, { force: true });
	}
}
const libraryWrites = new Map<string, Promise<unknown>>();
export function updateLibraryEntry(
	directory: string,
	id: string,
	patch: Partial<LibraryMedia>,
): Promise<LibraryMedia> {
	const key = path.join(directory, id);
	const task = (libraryWrites.get(key) ?? Promise.resolve())
		.catch(() => {})
		.then(() => writeLibraryEntry(directory, id, patch));
	libraryWrites.set(key, task);
	void task
		.finally(() => {
			if (libraryWrites.get(key) === task) libraryWrites.delete(key);
		})
		.catch(() => {});
	return task;
}
async function writeLibraryEntry(directory: string, id: string, patch: Partial<LibraryMedia>) {
	requireInput(/^[a-f0-9]{24}$/.test(id), "Invalid library ID");
	const file = path.join(directory, `${id}.json`);
	const entry: LibraryMedia = JSON.parse(await fs.readFile(file, "utf8"));
	const next = { ...entry, ...patch, id };
	const temp = `${file}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temp, JSON.stringify(next, null, 2));
		await fs.rename(temp, file);
	} finally {
		await fs.rm(temp, { force: true });
	}
	return next;
}
export async function analyzeLibraryEntry(
	entry: LibraryMedia,
	directory: string,
	ffprobe: string,
	ffmpeg: string,
): Promise<LibraryMedia> {
	let identity: string;
	try {
		identity = await fingerprint(entry.videoPath);
	} catch (error) {
		return updateLibraryEntry(directory, entry.id, {
			analysisStatus: "missing",
			error: String(error),
		});
	}
	try {
		const meta = await probeMedia(entry.videoPath, ffprobe);
		requireInput(meta.hasVideo, "素材中没有视频画面");
		const thumbnailPath = path.join(directory, `${entry.id}-${identity.slice(0, 12)}.jpg`);
		let thumbnailError: string | undefined;
		try {
			await run(
				ffmpeg,
				[
					"-y",
					"-ss",
					String(Math.min(1, meta.durationMs / 2000)),
					"-i",
					entry.videoPath,
					"-frames:v",
					"1",
					"-vf",
					"scale=480:-2",
					thumbnailPath,
				],
				{ timeout: 30000 },
			);
		} catch (error) {
			thumbnailError = String(error);
		}
		return updateLibraryEntry(directory, entry.id, {
			...meta,
			fingerprint: identity,
			contentHash: await contentHash(entry.videoPath),
			thumbnailPath: thumbnailError ? undefined : thumbnailPath,
			thumbnailError,
			analysisStatus: "ready",
			error: undefined,
		});
	} catch (error) {
		return updateLibraryEntry(directory, entry.id, {
			fingerprint: identity,
			analysisStatus: "failed",
			error: String(error),
		});
	}
}
