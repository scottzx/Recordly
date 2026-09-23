import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	migrateProject,
	applyPlan,
	validateComposition,
	durationMs,
	timeline,
} from "../../shared/composition.ts";
import { getFfprobePath, getFfmpegPath } from "./paths.mjs";
import { renderProject } from "./headlessRenderer.mjs";
const run = promisify(execFile);
export async function probeMedia(file) {
	const { stdout } = await run(getFfprobePath(), [
		"-v",
		"error",
		"-show_entries",
		"format=duration:stream=codec_type,width,height",
		"-of",
		"json",
		file,
	]);
	const info = JSON.parse(stdout),
		video = info.streams.find((s) => s.codec_type === "video");
	return {
		durationMs: Number(info.format.duration) * 1000,
		width: video?.width,
		height: video?.height,
		hasAudio: info.streams.some((s) => s.codec_type === "audio"),
		hasVideo: Boolean(video),
	};
}
export async function readProject(input) {
	const project = JSON.parse(await fs.readFile(input, "utf8"));
	if (![1, 2, 3].includes(project.version) || !project.videoPath || !project.editor)
		throw new Error("Unsupported project");
	const base = path.dirname(path.resolve(input));
	const resolve = (p) => (path.isAbsolute(p) ? p : path.resolve(base, p));
	project.videoPath = resolve(project.videoPath);
	if (project.editor.webcam?.sourcePath)
		project.editor.webcam.sourcePath = resolve(project.editor.webcam.sourcePath);
	for (const a of project.editor.audioRegions ?? []) a.audioPath = resolve(a.audioPath);
	for (const a of project.composition?.assets ?? []) a.path = resolve(a.path);
	return project;
}
export async function validateMedia(project) {
	const errors = validateComposition(project);
 if(errors.length)return {valid:false,errors,durationMs:0};
	const paths = new Set([
		project.videoPath,
		...project.composition.assets.map((a) => a.path),
		...(project.editor.audioRegions ?? []).map((a) => a.audioPath),
	]);
	if (project.editor.webcam?.sourcePath) paths.add(project.editor.webcam.sourcePath);
	const metadata = new Map();
	for (const file of paths) {
		try {
			metadata.set(file, await probeMedia(file));
		} catch {
			errors.push(`Missing or unreadable media: ${file}`);
		}
	}
	const main = metadata.get(project.videoPath);
	if (main && !main.hasVideo) errors.push("Main source has no video stream");
	for (const s of project.composition.shots)
		if (s.kind === "main") {
			if (main && s.sourceEndMs > main.durationMs + 40)
				errors.push(`Main clip exceeds its source: ${s.id}`);
			if (s.layout.mode !== "screen") {
				const webcam = metadata.get(project.editor.webcam?.sourcePath);
				const end = s.sourceEndMs - (project.editor.webcam?.timeOffsetMs ?? 0);
				if (webcam && (!webcam.hasVideo || end > webcam.durationMs + 40))
					errors.push(`Presenter source does not cover clip: ${s.id}`);
			}
		}
	for (const b of project.composition.broll) {
		const asset = project.composition.assets.find((a) => a.id === b.assetId),
			m = asset && metadata.get(asset.path);
		if (m && !m.hasVideo) errors.push(`B-roll source has no image/video stream: ${b.id}`);
		if (
			m &&
			asset.kind === "video" &&
			b.sourceStartMs + b.durationMs * b.speed > m.durationMs + 40
		)
			errors.push(`B-roll exceeds its source: ${b.id}`);
	}
	return { valid: errors.length === 0, errors, durationMs: durationMs(project.composition) };
}
export async function projectCommand(action, input, args = {}) {
	if (!input) throw new Error("A .recordly input path is required");
	const original = await readProject(input);
	const meta = await probeMedia(original.videoPath);
	let project = migrateProject(original, meta.durationMs);
	if (!original.composition && meta.width && meta.height) {
		const scale = Math.min(1, 1920 / meta.width, 1080 / meta.height);
		project.composition.width = Math.round((meta.width * scale) / 2) * 2;
		project.composition.height = Math.round((meta.height * scale) / 2) * 2;
	}
	if (action === "inspect")
		return {
			version: project.version,
			videoPath: project.videoPath,
			composition: project.composition,
			timeline: timeline(project.composition),
			durationMs: durationMs(project.composition),
			editor: project.editor,
		};
	if (action === "validate") return validateMedia(project);
	if (action === "apply") {
		const plan = args.planData ?? JSON.parse(await fs.readFile(args.plan, "utf8"));
		if (plan.composition?.assets) {
			const base = args.plan
				? path.dirname(path.resolve(args.plan))
				: path.dirname(path.resolve(input));
			for (const a of plan.composition.assets) a.path = path.resolve(base, a.path);
		}
		project = applyPlan(project, plan);
		const checked = await validateMedia(project);
		if (!checked.valid) throw new Error(checked.errors.join("\n"));
		const output = path.resolve(
			args.output || args.o || input.replace(/\.recordly$/i, "") + ".composed.recordly",
		);
		if (output === path.resolve(input))
			throw new Error("Choose a new output path; apply never overwrites its input");
		const temp = `${output}.${process.pid}.tmp`;
		try {
			await fs.writeFile(temp, JSON.stringify(project, null, 2));
			await fs.rename(temp, output);
		} finally {
			await fs.rm(temp, { force: true });
		}
		return { success: true, outputPath: output, ...checked };
	}
	if (action === "preview") {
		const output = args.output || args.o;
		if (!output) throw new Error("Preview requires --output");
		const at = args.at === undefined ? null : Number(args.at);
		const from = at ?? Number(args.from ?? 0),
			to =
				at === null
					? Number(args.to ?? durationMs(project.composition))
					: from + 1000 / project.composition.fps;
		if (
			!Number.isFinite(from) ||
			!Number.isFinite(to) ||
			from < 0 ||
			to <= from ||
			from >= durationMs(project.composition) ||
			to > durationMs(project.composition) + 40
		)
			throw new Error("Invalid preview range in milliseconds");
		const checked = await validateMedia(project);
		if (!checked.valid) throw new Error(checked.errors.join("\n"));
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-preview-"));
		try {
			const projectPath = path.join(dir, "preview.recordly"),
				video = at === null ? path.resolve(output) : path.join(dir, "preview.mp4");
			await fs.writeFile(projectPath, JSON.stringify(project));
			await renderProject({
				projectPath,
				outputPath: video,
				fps: project.composition.fps,
				timeoutMs: 900000,
				compositionRange: {
					fromMs: from,
					toMs: Math.min(to, durationMs(project.composition)),
				},
			});
			if (at !== null)
				await run(getFfmpegPath(), [
					"-y",
					"-v",
					"error",
					"-i",
					video,
					"-frames:v",
					"1",
					path.resolve(output),
				]);
			return { success: true, outputPath: path.resolve(output), fromMs: from, toMs: to };
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	}
	throw new Error(`Unknown project command: ${action}`);
}
