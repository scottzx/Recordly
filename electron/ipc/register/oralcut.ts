import { app, dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { generateTranscript, projectFingerprints } from "../../../shared/node/transcription";
import { requireInput } from "../../../shared/transcript";
import type { CompositionProject } from "../../../shared/composition";
import { validateComposition } from "../../../shared/composition";
import { resolveApprovedLocalMediaPath } from "../project/manager";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import { resolveTranscribeCliPath, resolveWhisperExecutablePath } from "../captions/generate";
import { WHISPER_SMALL_MODEL_PATH } from "../constants";
import { writeNew } from "../../../shared/node/media";

async function authorize(project: CompositionProject) {
	const errors = validateComposition(project);
	requireInput(!errors.length, errors.join("\n"));
	for (const file of [
		project.videoPath,
		project.editor.webcam?.sourcePath,
		...project.composition.assets.map((a) => a.path),
		...(project.editor.audioRegions ?? []).map((a) => a.audioPath),
	].filter((file): file is string => Boolean(file)))
		requireInput(
			await resolveApprovedLocalMediaPath(file),
			`Media path is not approved: ${file}`,
		);
}
export function registerOralCutHandlers() {
	const active = new Map<number, { id: string; controller: AbortController }>();
	ipcMain.handle(
		"transcript-generate",
		async (
			event,
			project: CompositionProject,
			selections: Record<string, string>,
			options: {
				id: string;
				engine: "whisper" | "transcribe-kit";
				model?: string;
				executable?: string;
				language?: string;
				force?: boolean;
			},
		) => {
			requireInput(!active.has(event.sender.id), "转写任务正在运行");
			const controller = new AbortController();
			active.set(event.sender.id, { id: options.id, controller });
			try {
				await authorize(project);
				const executable =
					options.engine === "whisper"
						? await resolveWhisperExecutablePath(options.executable)
						: await resolveTranscribeCliPath(options.executable);
				return await generateTranscript(project, selections, {
					engine: options.engine,
					executable,
					model:
						options.engine === "whisper"
							? options.model || WHISPER_SMALL_MODEL_PATH
							: undefined,
					language: options.language || "auto",
					ffmpeg: getFfmpegBinaryPath(),
					ffprobe: getFfprobeBinaryPath(),
					cacheDir: path.join(app.getPath("userData"), "transcripts"),
					tempDir: app.getPath("temp"),
					signal: controller.signal,
					force: options.force,
					onProgress: (message) => {
						if (!event.sender.isDestroyed())
							event.sender.send("transcript-progress", { id: options.id, message });
					},
				});
			} finally {
				active.delete(event.sender.id);
			}
		},
	);
	ipcMain.handle("transcript-cancel", (event, id: string) => {
		const job = active.get(event.sender.id);
		if (job?.id === id) job.controller.abort();
	});
	ipcMain.handle("oralcut-fingerprints", async (_, project: CompositionProject) => {
		await authorize(project);
		return projectFingerprints(project);
	});
	ipcMain.handle("oralcut-import", async () => {
		const result = await dialog.showOpenDialog({
			title: "导入 ReviewPlan / 审阅文件",
			properties: ["openFile"],
			filters: [{ name: "JSON", extensions: ["json"] }],
		});
		return result.canceled ? null : JSON.parse(await fs.readFile(result.filePaths[0], "utf8"));
	});
	ipcMain.handle("oralcut-export", async (_, data: unknown, name: string) => {
		const result = await dialog.showSaveDialog({
			defaultPath: path.basename(name),
			filters: [{ name: "JSON", extensions: ["json"] }],
		});
		if (result.canceled || !result.filePath) return null;
		await writeNew(result.filePath, data);
		return result.filePath;
	});
}
