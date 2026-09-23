import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, ipcMain, dialog } from "electron";
import {
	audioSegments,
	durationMs,
	validateComposition,
	type CompositionProject,
} from "../../../shared/composition";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import { isOwnedExportPath, registerOwnedExportPath } from "../export/exportStream";
import { resolveApprovedLocalMediaPath, rememberApprovedLocalReadPath } from "../project/manager";
const run = promisify(execFile);
export async function probe(file: string) {
	const allowed = await resolveApprovedLocalMediaPath(file);
	if (!allowed) throw new Error(`Media path is not approved: ${file}`);
	const { stdout } = await run(getFfprobeBinaryPath(), [
		"-v",
		"error",
		"-show_entries",
		"format=duration:stream=codec_type,width,height",
		"-of",
		"json",
		allowed,
	]);
	const data = JSON.parse(stdout),
		video = data.streams.find((s: { codec_type: string }) => s.codec_type === "video");
	return {
		durationMs: Number(data.format.duration) * 1000,
		width: video?.width ?? 0,
		height: video?.height ?? 0,
		hasAudio: data.streams.some((s: { codec_type: string }) => s.codec_type === "audio"),
	};
}
function tempo(speed: number) {
	const parts = [];
	while (speed > 2) {
		parts.push("atempo=2");
		speed /= 2;
	}
	while (speed < 0.5) {
		parts.push("atempo=0.5");
		speed *= 2;
	}
	parts.push(`atempo=${speed}`);
	return parts.join(",");
}
export function registerCompositionHandlers() {
	const active = new Map<number, AbortController>();
	ipcMain.handle("composition-pick-media", async () => {
		const result = await dialog.showOpenDialog({
			properties: ["openFile"],
			filters: [
				{
					name: "Media",
					extensions: [
						"mp4",
						"mov",
						"webm",
						"mkv",
						"png",
						"jpg",
						"jpeg",
						"webp",
						"mp3",
						"wav",
						"m4a",
					],
				},
			],
		});
		if (result.canceled) return null;
		const file = result.filePaths[0];
		await rememberApprovedLocalReadPath(file);
		return { path: file, ...(await probe(file)) };
	});
	ipcMain.handle("composition-probe", async (_, file: string) => probe(file));
	ipcMain.handle("composition-cancel", (event) => {
		active.get(event.sender.id)?.abort();
	});
	ipcMain.handle(
		"composition-audio",
		async (
			event,
			project: CompositionProject,
			videoPath: string,
			range?: { fromMs: number; toMs: number },
		) => {
			const errors = validateComposition(project);
			if (errors.length) throw new Error(errors.join("\n"));
			if (!isOwnedExportPath(videoPath))
				throw new Error("Export video is not owned by this process");
			if (active.has(event.sender.id)) throw new Error("An audio export is already running");
			const from = range?.fromMs ?? 0,
				to = range?.toMs ?? durationMs(project.composition);
			if (
				!Number.isFinite(from) ||
				!Number.isFinite(to) ||
				from < 0 ||
				to <= from ||
				to > durationMs(project.composition)
			)
				throw new Error("Invalid export range");
			const controller = new AbortController();
			active.set(event.sender.id, controller);
			const destroy = () => controller.abort();
			event.sender.once("destroyed", destroy);
			const output = path.join(
				app.getPath("temp"),
				`recordly-composition-${randomUUID()}.mp4`,
			);
			try {
				const segments = audioSegments(project).flatMap((s) => {
					const start = Math.max(from, s.startMs),
						end = Math.min(to, s.startMs + s.durationMs);
					return end <= start
						? []
						: [
								{
									...s,
									startMs: start - from,
									sourceStartMs: s.sourceStartMs + (start - s.startMs) * s.speed,
									durationMs: end - start,
								},
							];
				});
				const inputs: string[] = [];
				const info = new Map<string, Awaited<ReturnType<typeof probe>>>();
				for (const s of segments)
					if (!info.has(s.path)) info.set(s.path, await probe(s.path));
				const filters: string[] = [];
				const labels: string[] = [];
				for (const s of segments) {
					if (!info.get(s.path)?.hasAudio || s.volume === 0) continue;
					let index = inputs.indexOf(s.path);
					if (index < 0) {
						index = inputs.length;
						inputs.push(s.path);
					}
					const label = `a${labels.length}`;
					filters.push(
						`[${index + 1}:a:0]atrim=start=${s.sourceStartMs / 1000}:duration=${(s.durationMs * s.speed) / 1000},asetpts=PTS-STARTPTS,${tempo(s.speed)},volume=${s.volume},adelay=${Math.round(s.startMs)}:all=1[${label}]`,
					);
					labels.push(`[${label}]`);
				}
				filters.push(
					`anullsrc=r=48000:cl=stereo,atrim=duration=${(to - from) / 1000}[silence]`,
				);
				filters.push(
					`${labels.join("")}[silence]amix=inputs=${labels.length + 1}:normalize=0:duration=longest,alimiter=limit=0.95:level=false:latency=1,atrim=duration=${(to - from) / 1000}[audio]`,
				);
				const args = [
					"-y",
					"-v",
					"error",
					"-i",
					videoPath,
					...inputs.flatMap((file) => ["-i", file]),
					"-filter_complex",
					filters.join(";"),
					"-map",
					"0:v:0",
					"-map",
					"[audio]",
					"-c:v",
					"copy",
					"-c:a",
					"aac",
					"-b:a",
					"192k",
					"-t",
					String((to - from) / 1000),
					"-movflags",
					"+faststart",
					output,
				];
				await run(getFfmpegBinaryPath(), args, {
					signal: controller.signal,
					maxBuffer: 4 * 1024 * 1024,
				});
				registerOwnedExportPath(output);
				await rememberApprovedLocalReadPath(output);
				const verified = await probe(output);
				if (
					!verified.width ||
					!verified.height ||
					!verified.hasAudio ||
					!Number.isFinite(verified.durationMs) ||
					Math.abs(verified.durationMs - (to - from)) >
						Math.max(1000 / project.composition.fps, 80)
				)
					throw new Error("Exported MP4 is incomplete or missing video/audio streams");
				return { success: true, tempPath: output, hasAudio: labels.length > 0 };
			} catch (error) {
				await fs.rm(output, { force: true });
				throw error;
			} finally {
				active.delete(event.sender.id);
				event.sender.removeListener("destroyed", destroy);
			}
		},
	);
}
