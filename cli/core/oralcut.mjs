import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { emptyEditingProject, insertLibraryRecording } from "../../shared/mediaLibrary.ts";
import {
	projectTranscript,
	prepareTranscriptProject,
	requireInput,
	OralCutError,
	validateTranscript,
} from "../../shared/transcript.ts";
import {
	compileReview,
	pausePlan,
	projectRevision,
	reviewConflicts,
	validateReview,
	canonicalJson,
} from "../../shared/review.ts";
import { generateTranscript, projectFingerprints } from "../../shared/node/transcription.ts";
import { writeNew, mediaId, analyzeLibraryEntry, probeMedia } from "../../shared/node/media.ts";
import { resolveCompanionAudio } from "../../shared/node/companionAudio.ts";
import { migrateProject } from "../../shared/composition.ts";
import { readProject } from "./compositionProject.mjs";
import { getFfmpegPath, getFfprobePath, getNativeBinaryPath } from "./paths.mjs";

export function userDataPath() {
	const base =
		process.platform === "darwin"
			? path.join(os.homedir(), "Library", "Application Support")
			: process.platform === "win32"
				? (process.env.APPDATA ?? os.homedir())
				: path.join(os.homedir(), ".config");
	return process.env.RECORDLY_USER_DATA || path.join(base, "Recordly");
}
async function libraryDirectory() {
	let root = path.join(userDataPath(), "recordings");
	try {
		const settings = JSON.parse(
			await fs.readFile(path.join(userDataPath(), "recordings-settings.json"), "utf8"),
		);
		if (settings.recordingsDir) root = path.resolve(settings.recordingsDir);
	} catch {}
	const dir = path.join(root, "Library");
	await fs.mkdir(dir, { recursive: true });
	return dir;
}
export function transcriptionRuntime(args = {}) {
	const engine = args.engine ?? "transcribe-kit";
	requireInput(["whisper", "transcribe-kit"].includes(engine), "Unknown transcription engine");
	const candidates =
		engine === "whisper"
			? [
					args.executable,
					process.env.WHISPER_CPP_PATH,
					getNativeBinaryPath(
						process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli",
					),
					"/opt/homebrew/bin/whisper-cli",
					"/usr/local/bin/whisper-cli",
				]
			: [
					args.executable,
					process.env.TRANSCRIBE_CLI_PATH,
					path.join(os.homedir(), ".local/bin/transcribe-cli"),
					"/opt/homebrew/bin/transcribe-cli",
				];
	let executable = candidates.find((p) => p && existsSync(p));
	if (!executable)
		try {
			executable = execFileSync(
				process.platform === "win32" ? "where" : "which",
				[engine === "whisper" ? "whisper-cli" : "transcribe-cli"],
				{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
			)
				.trim()
				.split(/\r?\n/)[0];
		} catch {}
	const model =
		engine === "whisper"
			? (args.model ??
				process.env.WHISPER_MODEL_PATH ??
				path.join(userDataPath(), "whisper", "ggml-small.bin"))
			: undefined;
	return {
		engine,
		executable,
		model,
		available: Boolean(executable && (!model || existsSync(model))),
	};
}
const json = async (file) => {
	requireInput(typeof file === "string" && file.length, "A JSON input path is required");
	return JSON.parse(await fs.readFile(file, "utf8"));
};
async function projectAt(file) {
	const project = await readProject(file);
	if (project.composition?.effectsTime === "timeline" && project.composition.sources)
		return project;
	const meta = project.videoPath
		? await probeMedia(project.videoPath, getFfprobePath())
		: { durationMs: 0 };
	return prepareTranscriptProject(migrateProject(project, meta.durationMs));
}

async function checkFingerprints(project, file) {
	requireInput(
		canonicalJson(await projectFingerprints(project)) === canonicalJson(file.fingerprints),
		"素材已改变，请重新转写",
		"MEDIA_CHANGED",
	);
}
export async function oralcutCommand(command, action, input, args = {}) {
	const output = args.output ?? args.o;
	const write = async (data) => {
		requireInput(typeof output === "string" && output.length, "--output is required");
		if (input)
			requireInput(
				path.resolve(output) !== path.resolve(input),
				"Output must differ from input",
			);
		await writeNew(path.resolve(output), data);
		return path.resolve(output);
	};
	if (command === "library") {
		const dir = await libraryDirectory();
		if (action === "list") {
			const entries = [];
			for (const file of await fs.readdir(dir)) {
				if (file.endsWith(".json")) entries.push(await json(path.join(dir, file)));
			}
			return entries.filter(
				(e) =>
					!args.query ||
					`${e.name} ${(e.tags ?? []).join(" ")}`
						.toLowerCase()
						.includes(args.query.toLowerCase()),
			);
		}
		requireInput(action === "import" && input, "Expected library list or import <file>");
		const videoPath = path.resolve(input),
			id = mediaId(videoPath),
			file = path.join(dir, `${id}.json`);
		if (!existsSync(file)) {
			const stat = await fs.stat(videoPath);
			await writeNew(file, {
				id,
				name: path.basename(videoPath, path.extname(videoPath)),
				videoPath,
				createdAt: stat.birthtimeMs || stat.mtimeMs,
				status: "ready",
				origin: "imported",
			});
		}
		const entry = await analyzeLibraryEntry(
			await json(file),
			dir,
			getFfprobePath(),
			getFfmpegPath(),
		);
		requireInput(entry.analysisStatus === "ready", entry.error ?? "Media analysis failed");
		return entry;
	}
	if (command === "project" && action === "create") {
		const ids = args.media ?? args.mediaIds ?? [];
		requireInput(
			Array.isArray(ids) &&
				ids.every((id) => typeof id === "string" && /^[a-f0-9]{24}$/.test(id)),
			"Invalid media IDs",
		);
		let project = emptyEditingProject();
		project.projectId = randomUUID();
		for (const id of ids) {
			const entry = await json(path.join(await libraryDirectory(), `${id}.json`));
			const meta = await probeMedia(entry.videoPath, getFfprobePath());
			requireInput(meta.hasVideo, "Media has no video");
			const companion = await resolveCompanionAudio(entry.videoPath, meta.hasAudio);
			const audioPaths = [...companion.paths];
			if (meta.hasAudio && audioPaths.length && audioPaths.every((p) => /[.-]mic\./i.test(p)))
				audioPaths.unshift(entry.videoPath);
			const audio = audioPaths.map((p) => ({
				path: p,
				name: path.basename(p),
				timeOffsetMs: companion.startDelayMsByPath[p] ?? 0,
			}));
			project = insertLibraryRecording(
				project,
				{ ...entry, ...meta, audio },
				Number.MAX_SAFE_INTEGER,
				randomUUID(),
			);
		}
		return { outputPath: await write(project), project };
	}
	if (command === "transcript") {
		if (action === "generate") {
			const project = await projectAt(input),
				runtime = transcriptionRuntime(args);
			if (!runtime.available)
				throw new OralCutError(
					"ASR_UNAVAILABLE",
					"缺少转写运行时或模型。配置 --engine、--executable、--model，或在 Recordly 下载 Whisper 模型。",
				);
			const selections =
				args.sourceSelections ??
				(args.sources
					? await json(args.sources)
					: (project.composition.transcript?.sourceSelections ?? {}));
			const controller = new AbortController(),
				cancel = () => controller.abort();
			process.once("SIGINT", cancel);
			try {
				const bundle = await generateTranscript(project, selections, {
					...runtime,
					language: args.language ?? "auto",
					ffmpeg: getFfmpegPath(),
					ffprobe: getFfprobePath(),
					cacheDir: path.join(userDataPath(), "transcripts"),
					tempDir: os.tmpdir(),
					signal: controller.signal,
					force: args.force,
					onProgress: (message) => process.stderr.write(`${message}\n`),
				});
				const outputPath = await write(bundle);
				if (!bundle.complete) {
					const error = new OralCutError(
						"ASR_FAILED",
						bundle.errors.map((e) => e.message).join("\n"),
					);
					error.data = { outputPath, ...bundle };
					throw error;
				}
				return { outputPath, ...bundle };
			} catch (error) {
				if (controller.signal.aborted)
					throw new OralCutError("CANCELLED", "转写已取消；完整缓存已保留");
				throw error;
			} finally {
				process.removeListener("SIGINT", cancel);
			}
		}
		requireInput(
			action === "export" && (!args.format || args.format === "markdown"),
			"Expected transcript export --format markdown",
		);
		const bundle = await json(input);
		requireInput(
			bundle.schemaVersion === 1 && bundle.complete && Array.isArray(bundle.documents),
			"Incomplete transcript bundle",
		);
		bundle.documents.forEach(validateTranscript);
		const markdown = [
			"# Recordly 文稿",
			`基础版本：${bundle.baseRevision}`,
			...bundle.documents.flatMap((d) => [
				`\n## ${d.sourceId} · ${d.id} · ${d.revision}`,
				...d.segments.map(
					(s) => `- [${s.id}] ${s.sourceStartMs}–${s.sourceEndMs}ms ${s.text}`,
				),
			]),
			"\n## 来源选择",
			JSON.stringify(bundle.sourceSelections, null, 2),
		].join("\n");
		return { outputPath: await write(markdown) };
	}
	requireInput(command === "review", "Unknown oralcut command");
	if (action === "create") {
		const base = await projectAt(input),
			bundle = await json(args.transcript ?? args.transcriptPath);
		requireInput(
			bundle.schemaVersion === 1 && bundle.complete,
			"Review requires a complete transcript bundle",
		);
		requireInput(
			bundle.baseRevision === (await projectRevision(base)),
			"文稿引用的基础工程已改变",
			"STALE_BASE",
		);
		requireInput(
			Boolean(args.pauses) !== Boolean(args.suggestions ?? args.suggestionsPath),
			"Choose exactly one of --pauses or --suggestions",
		);
		const transcript = {
			documents: bundle.documents,
			history: bundle.history,
			sourceSelections: bundle.sourceSelections,
			corrections: bundle.corrections,
		};
		const plan = args.pauses
			? await pausePlan(base, transcript)
			: await json(args.suggestions ?? args.suggestionsPath);
		requireInput(
			plan.baseRevision === bundle.baseRevision,
			"Suggestion base does not match transcript",
			"STALE_BASE",
		);
		validateReview(base, transcript, plan);
		const fingerprints = await projectFingerprints(base);
		for (const doc of transcript.documents) {
			const asset = base.composition.assets.find((a) => a.id === doc.assetId);
			requireInput(
				asset && fingerprints[asset.path] === doc.fingerprint,
				"转写对应的素材已改变",
				"MEDIA_CHANGED",
			);
		}
		const file = {
			schemaVersion: 1,
			base,
			transcript,
			plan,
			fingerprints,
			selection: Object.fromEntries(plan.suggestions.map((s) => [s.id, "pending"])),
		};
		return {
			outputPath: await write(file),
			suggestions: plan.suggestions.length,
			conflicts: reviewConflicts(base, transcript, plan),
		};
	}
	const file = await json(input);
	requireInput(
		file.schemaVersion === 1 && file.base && file.transcript && file.plan && file.fingerprints,
		"Invalid review file",
	);
	if (action === "inspect") {
		validateReview(file.base, file.transcript, file.plan);
		return {
			plan: file.plan,
			conflicts: reviewConflicts(file.base, file.transcript, file.plan),
			selection: file.selection,
		};
	}
	requireInput(action === "apply", "Expected review create, inspect or apply");
	const project = await projectAt(args.project ?? args.projectPath);
	const selection = args.acceptedIds
		? { schemaVersion: 1, acceptedIds: args.acceptedIds }
		: await json(args.selection);
	requireInput(
		selection.schemaVersion === 1 && Array.isArray(selection.acceptedIds),
		"Invalid selection v1",
	);
	await checkFingerprints(project, file);
	const result = await compileReview(project, file.transcript, file.plan, selection.acceptedIds);
	if (args["dry-run"] || args.dryRun) return { ...result, project: undefined, dryRun: true };
	requireInput(
		output && path.resolve(output) !== path.resolve(args.project ?? args.projectPath),
		"Output must differ from base project",
	);
	// Recheck disk state after compilation before publishing a new project.
	requireInput(
		(await projectRevision(await projectAt(args.project ?? args.projectPath))) ===
			file.plan.baseRevision,
		"基础工程已改变",
		"STALE_BASE",
	);
	await checkFingerprints(project, file);
	return { ...result, project: undefined, outputPath: await write(result.project) };
}
export function oralcutResult(error) {
	return {
		ok: false,
		data: error.data ?? null,
		error: { code: error.code ?? "INVALID_INPUT", message: error.message ?? String(error) },
		warnings: [],
	};
}
