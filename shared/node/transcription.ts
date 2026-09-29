import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CompositionProject } from "../composition.ts";
import {
	requireInput,
	validateTranscript,
	type TranscriptBundle,
	type TranscriptDocument,
} from "../transcript.ts";
import { projectRevision, sha256 } from "../review.ts";
import { detectSilenceIntervals, transcribeWav } from "../../electron/ipc/captions/runtime.ts";
import { fingerprint, probeMedia } from "./media.ts";
const run = promisify(execFile);
export interface TranscriptionOptions {
	engine: "whisper" | "transcribe-kit";
	executable: string;
	model?: string;
	language: string;
	ffmpeg: string;
	ffprobe: string;
	cacheDir: string;
	tempDir: string;
	signal?: AbortSignal;
	force?: boolean;
	onProgress?: (message: string) => void;
}
export async function generateTranscript(
	project: CompositionProject,
	selections: Record<string, string>,
	options: TranscriptionOptions,
): Promise<TranscriptBundle> {
	requireInput(
		selections && typeof selections === "object" && !Array.isArray(selections),
		"Invalid source selections",
	);
	const instances = new Set(
		project.composition.shots.filter((s) => s.kind === "main").map((s) => s.instanceId ?? s.id),
	);
	requireInput(
		Object.entries(selections).every(
			([id, source]) => instances.has(id) && typeof source === "string",
		),
		"Unknown source selection instance",
	);
	const sourceSelections = { ...selections };
	const sources = project.composition.sources ?? [];
	for (const shot of project.composition.shots) {
		if (shot.kind !== "main") continue;
		const instance = shot.instanceId ?? shot.id;
		const available = sources.filter(
			(s) =>
				s.kind === "audio" &&
				shot.sourceClips?.some((c) => c.sourceId === s.id) &&
				project.composition.assets.find((a) => a.id === s.assetId)?.hasAudio !== false,
		);
		if (!sourceSelections[instance] && available.length === 1)
			sourceSelections[instance] = available[0].id;
		requireInput(
			!available.length || available.some((s) => s.id === sourceSelections[instance]),
			`请选择 ${shot.name ?? instance} 的讲解来源`,
		);
	}
	const result: TranscriptBundle = {
		schemaVersion: 1,
		baseRevision: await projectRevision(project),
		complete: true,
		documents: [],
		sourceSelections,
		corrections: project.composition.transcript?.corrections ?? {},
		errors: [],
	};
	await fs.mkdir(options.cacheDir, { recursive: true });
	for (const sourceId of new Set(Object.values(sourceSelections))) {
		options.signal?.throwIfAborted();
		const temp = await fs.mkdtemp(path.join(options.tempDir, "recordly-transcript-"));
		try {
			const source = sources.find((s) => s.id === sourceId),
				asset = project.composition.assets.find((a) => a.id === source?.assetId);
			requireInput(source && asset, `Unknown source: ${sourceId}`);
			const fp = await fingerprint(asset.path),
				meta = await probeMedia(asset.path, options.ffprobe, options.signal);
			requireInput(meta.hasAudio, `来源没有音轨：${source.name}`);
			const optionsHash = await sha256({
				engine: options.engine,
				executable: await fingerprint(options.executable),
				model: options.model ? await fingerprint(options.model) : "",
				language: options.language,
				version: 1,
			});
			const cacheKey = (await sha256({ fp, optionsHash })).slice(7),
				cachePath = path.join(options.cacheDir, `${cacheKey}.json`);
			if (!options.force) {
				try {
					const cached: TranscriptDocument = JSON.parse(
						await fs.readFile(cachePath, "utf8"),
					);
					validateTranscript(cached);
					if (cached.fingerprint === fp && cached.optionsHash === optionsHash) {
						result.documents.push({ ...cached, sourceId, assetId: asset.id });
						continue;
					}
				} catch {
					/* regenerate incomplete or old cache */
				}
			}
			options.onProgress?.(`提取音频：${source.name}`);
			const wavPath = path.join(temp, "audio.wav");
			await run(
				options.ffmpeg,
				[
					"-y",
					"-i",
					asset.path,
					"-map",
					"0:a:0",
					"-vn",
					"-ac",
					"1",
					"-ar",
					"16000",
					"-c:a",
					"pcm_s16le",
					wavPath,
				],
				{ signal: options.signal, maxBuffer: 20 * 1024 * 1024 },
			);
			options.onProgress?.(`转写：${source.name}`);
			const cues = await transcribeWav({
				engine: options.engine,
				executable: options.executable,
				model: options.model,
				wavPath,
				outputBase: path.join(temp, "result"),
				language: options.language,
				ffmpegPath: options.ffmpeg,
				ffprobePath: options.ffprobe,
				signal: options.signal,
			});
			options.onProgress?.(`检测停顿：${source.name}`);
			const silence = await detectSilenceIntervals({
				ffmpegPath: options.ffmpeg,
				wavPath,
				signal: options.signal,
			});
			const document: TranscriptDocument = {
				schemaVersion: 1,
				id: `transcript-${cacheKey}-${randomUUID()}`,
				revision: randomUUID(),
				sourceId,
				assetId: asset.id,
				fingerprint: fp,
				durationMs: meta.durationMs,
				engine: options.engine,
				model: options.model ?? "",
				language: options.language,
				optionsHash,
				segments: cues.flatMap((c, i) => {
					const from = Math.max(0, c.startMs),
						to = Math.min(meta.durationMs, c.endMs);
					return to > from && c.text.trim()
						? [
								{
									id: `sentence-${i + 1}`,
									sourceStartMs: from,
									sourceEndMs: to,
									text: c.text,
								},
							]
						: [];
				}),
				silenceIntervals: silence
					.map((s) => ({
						startMs: Math.max(0, s.startMs),
						endMs: Math.min(meta.durationMs, s.endMs),
					}))
					.filter((s) => s.endMs > s.startMs),
			};
			validateTranscript(document);
			options.signal?.throwIfAborted();
			requireInput(
				(await fingerprint(asset.path)) === fp,
				"转写期间素材被替换",
				"MEDIA_CHANGED",
			);
			const cacheTemp = `${cachePath}.${randomUUID()}.tmp`;
			try {
				await fs.writeFile(cacheTemp, JSON.stringify(document));
				await fs.rename(cacheTemp, cachePath);
			} finally {
				await fs.rm(cacheTemp, { force: true });
			}
			result.documents.push(document);
		} catch (error) {
			if (options.signal?.aborted) throw error;
			result.complete = false;
			result.errors.push({ sourceId, message: String(error) });
		} finally {
			await fs.rm(temp, { recursive: true, force: true });
		}
	}
	const previous = project.composition.transcript;
	result.history = [
		...(previous?.history ?? []),
		...(previous?.documents ?? []).filter(
			(old) => !result.documents.some((d) => d.id === old.id && d.revision === old.revision),
		),
	];
	return result;
}
export async function projectFingerprints(project: CompositionProject) {
	const paths = new Set(
		[
			project.videoPath,
			project.editor.webcam?.sourcePath,
			...project.composition.assets.map((a) => a.path),
			...(project.editor.audioRegions ?? []).map((a) => a.audioPath),
		].filter((p): p is string => Boolean(p)),
	);
	const result: Record<string, string> = {};
	for (const file of paths) result[file] = await fingerprint(file);
	return result;
}
