import { execFile, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import { getBundledWhisperExecutableCandidates } from "../paths/binaries";
import { resolveRecordingSession } from "../project/session";
import { getUsableCompanionAudioCandidates } from "../recording/diagnostics";
import type { CaptionCuePayload, CaptionWordPayload } from "../types";
import { normalizeVideoSourcePath } from "../utils";
import { getCaptionCompanionAudioCandidates } from "./audioCandidates";
import { segmentCuesIntoPhrases } from "./segment";
import { detectSilenceIntervals, transcribeWav } from "./runtime";
export {
	detectSilenceIntervals,
	executeTranscribeKit,
	transcribeKitWavToCues,
	offsetCaptionCues,
	TRANSCRIBE_KIT_CHUNK_MS,
} from "./runtime";

const execFileAsync = promisify(execFile);

export async function ensureReadableFile(filePath: string, options?: { executable?: boolean }) {
	await fs.access(filePath, fsConstants.R_OK);
	if (options?.executable) {
		try {
			await fs.access(filePath, fsConstants.X_OK);
		} catch {
			throw new Error("The selected Whisper executable is not marked as executable.");
		}
	}
}

export async function isExecutableFile(filePath: string) {
	try {
		await fs.access(filePath, fsConstants.R_OK | fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export async function resolveWhisperExecutablePath(preferredPath?: string | null) {
	const candidatePaths = [
		preferredPath?.trim() || null,
		...getBundledWhisperExecutableCandidates(),
		process.env["WHISPER_CPP_PATH"]?.trim() || null,
		process.platform === "darwin" ? "/opt/homebrew/bin/whisper-cli" : null,
		process.platform === "darwin" ? "/usr/local/bin/whisper-cli" : null,
		process.platform === "darwin" ? "/opt/homebrew/bin/whisper-cpp" : null,
		process.platform === "darwin" ? "/usr/local/bin/whisper-cpp" : null,
	].filter((value): value is string => Boolean(value));

	for (const candidate of candidatePaths) {
		const normalized = path.resolve(candidate);
		if (await isExecutableFile(normalized)) {
			return normalized;
		}
	}

	const pathCommand = process.platform === "win32" ? "where" : "which";
	const binaryNames =
		process.platform === "win32"
			? ["whisper-cli.exe", "whisper.exe", "main.exe"]
			: ["whisper-cli", "whisper-cpp", "whisper", "main"];

	for (const binaryName of binaryNames) {
		const result = spawnSync(pathCommand, [binaryName], { encoding: "utf-8" });
		if (result.status === 0) {
			const resolvedPath = result.stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean);

			if (resolvedPath && (await isExecutableFile(resolvedPath))) {
				return resolvedPath;
			}
		}
	}

	throw new Error(
		`No Whisper runtime was found for ${process.platform}/${process.arch}. ` +
			"This Recordly build is missing its bundled caption runtime. Reinstall or update Recordly, or select a whisper-cli executable in Caption settings.",
	);
}

export async function resolveCaptionAudioCandidates(videoPath: string) {
	const candidates: Array<{ path: string; label: string }> = [];
	const seenPaths = new Set<string>();

	const pushCandidate = (candidatePath: string | null | undefined, label: string) => {
		const normalizedCandidatePath = normalizeVideoSourcePath(candidatePath);
		if (!normalizedCandidatePath || seenPaths.has(normalizedCandidatePath)) {
			return;
		}

		seenPaths.add(normalizedCandidatePath);
		candidates.push({ path: normalizedCandidatePath, label });
	};

	pushCandidate(videoPath, "recording");
	const companionAudio = await getUsableCompanionAudioCandidates(videoPath);
	for (const candidate of getCaptionCompanionAudioCandidates(companionAudio)) {
		pushCandidate(candidate.path, candidate.label);
	}

	const requestedRecordingSession = await resolveRecordingSession(videoPath);
	pushCandidate(requestedRecordingSession?.webcamPath, "linked webcam recording");

	return candidates;
}

export const CAPTION_AUDIO_FILTER = "highpass=f=80,loudnorm=I=-16:LRA=11:TP=-1.5";

export function buildCaptionExtractArgs(inputPath: string, wavPath: string): string[] {
	return [
		"-y",
		"-i",
		inputPath,
		"-map",
		"0:a:0",
		"-vn",
		"-ac",
		"1",
		"-ar",
		"16000",
		"-af",
		CAPTION_AUDIO_FILTER,
		"-c:a",
		"pcm_s16le",
		wavPath,
	];
}

export async function extractCaptionAudioSource(options: {
	videoPath: string;
	ffmpegPath: string;
	wavPath: string;
}) {
	const candidates = await resolveCaptionAudioCandidates(options.videoPath);
	const attemptedCandidates: Array<{
		path: string;
		label: string;
		readable: boolean;
		extractedAudio: boolean;
		error?: string;
	}> = [];

	for (const candidate of candidates) {
		try {
			await ensureReadableFile(candidate.path);
			await execFileAsync(
				options.ffmpegPath,
				buildCaptionExtractArgs(candidate.path, options.wavPath),
				{ timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 },
			);
			attemptedCandidates.push({ ...candidate, readable: true, extractedAudio: true });
			return candidate;
		} catch (error) {
			attemptedCandidates.push({
				...candidate,
				readable: true,
				extractedAudio: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	console.warn(
		"[auto-captions] No audio source candidate could be extracted:",
		attemptedCandidates,
	);

	throw new Error(
		"No audio was found to transcribe in the saved recording file. Captions need an audio track. If this recording should have contained sound, the recording was saved without an audio stream.",
	);
}

export async function resolveTranscribeCliPath(preferredPath?: string | null) {
	const candidatePaths = [
		preferredPath?.trim() || null,
		process.env["TRANSCRIBE_CLI_PATH"]?.trim() || null,
		path.join(process.env["HOME"] || "", ".local/bin/transcribe-cli"),
		"/opt/homebrew/bin/transcribe-cli",
		"/usr/local/bin/transcribe-cli",
		"/opt/homebrew/bin/transcribe",
		"/opt/homebrew/bin/1transcribe",
		"/Users/scott/Documents/01-开发项目/mac_app/TranscribeKit/.build/release/transcribe-cli",
		"/Users/scott/Documents/01-开发项目/mac_app/TranscribeKit/.build/debug/transcribe-cli",
	].filter((value): value is string => Boolean(value));

	for (const candidate of candidatePaths) {
		const normalized = path.resolve(candidate);
		if (await isExecutableFile(normalized)) {
			return normalized;
		}
	}

	const pathCommand = process.platform === "win32" ? "where" : "which";
	for (const binaryName of ["transcribe-cli", "transcribe", "1transcribe"]) {
		const result = spawnSync(pathCommand, [binaryName], { encoding: "utf-8" });
		if (result.status === 0) {
			const resolvedPath = result.stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean);

			if (resolvedPath && (await isExecutableFile(resolvedPath))) {
				return resolvedPath;
			}
		}
	}

	throw new Error(
		"TranscribeKit CLI (transcribe-cli) was not found. Please ensure it is installed in ~/.local/bin/ or build it with SwiftPM.",
	);
}

export function tokenizeCueText(text: string): string[] {
	const tokens: string[] = [];
	const regex =
		/[\u4e00-\u9fa5]|[\u3040-\u30ff]|[\uac00-\ud7af]|[a-zA-Z0-9_]+|[^\s\w\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]+/gu;
	let match = regex.exec(text);
	while (match !== null) {
		const token = match[0].trim();
		if (token) {
			tokens.push(token);
		}
		match = regex.exec(text);
	}
	return tokens.length > 0 ? tokens : [text.trim()];
}

export function synthesizeWordsForCue(
	text: string,
	startMs: number,
	endMs: number,
): CaptionWordPayload[] {
	const tokens = tokenizeCueText(text);
	const totalSpan = Math.max(tokens.length * 50, endMs - startMs);
	const totalChars = tokens.reduce((acc, token) => acc + token.length, 0) || 1;

	let cursorMs = startMs;
	return tokens.map((token, index) => {
		const isLast = index === tokens.length - 1;
		const tokenDuration = isLast
			? endMs - cursorMs
			: Math.max(30, Math.round((totalSpan * token.length) / totalChars));
		const wStart = cursorMs;
		const wEnd = isLast ? endMs : Math.min(endMs, cursorMs + tokenDuration);
		cursorMs = wEnd;
		return {
			text: token,
			startMs: wStart,
			endMs: Math.max(wStart + 1, wEnd),
			leadingSpace: index > 0 && /^[a-zA-Z0-9]/.test(token),
		};
	});
}

export function splitCueClauses(cue: CaptionCuePayload, maxCharsPerCue = 18): CaptionCuePayload[] {
	const text = cue.text.trim();
	if (!text) {
		return [];
	}

	const primaryRegex = /[^。！？!?…\n]+[。！？!?…\n]*/g;
	const primary: string[] = [];
	let match = primaryRegex.exec(text);
	while (match !== null) {
		const sentence = match[0].trim();
		if (sentence) {
			primary.push(sentence);
		}
		match = primaryRegex.exec(text);
	}
	if (primary.length === 0) {
		primary.push(text);
	}

	const fragments: string[] = [];
	const subRegex = /[^，,；;]+[，,；;]*/g;
	for (const sent of primary) {
		if (sent.length > maxCharsPerCue && /[，,；;]/.test(sent)) {
			const sub: string[] = [];
			let subMatch = subRegex.exec(sent);
			while (subMatch !== null) {
				const chunk = subMatch[0].trim();
				if (chunk) {
					sub.push(chunk);
				}
				subMatch = subRegex.exec(sent);
			}
			if (sub.length > 1) {
				fragments.push(...sub);
				continue;
			}
		}
		fragments.push(sent);
	}

	if (fragments.length <= 1) {
		return [
			{
				...cue,
				words:
					cue.words && cue.words.length > 0
						? cue.words
						: synthesizeWordsForCue(cue.text, cue.startMs, cue.endMs),
			},
		];
	}

	const totalSpan = Math.max(1, cue.endMs - cue.startMs);
	const totalChars = fragments.reduce((acc, frag) => acc + frag.length, 0) || 1;
	let cursorMs = cue.startMs;

	return fragments.map((frag, idx) => {
		const isLast = idx === fragments.length - 1;
		const duration = isLast
			? cue.endMs - cursorMs
			: Math.max(200, Math.round((totalSpan * frag.length) / totalChars));
		const sStart = cursorMs;
		const sEnd = isLast ? cue.endMs : Math.min(cue.endMs, cursorMs + duration);
		cursorMs = Math.max(sStart + 1, sEnd);
		return {
			id: `${cue.id}-${idx + 1}`,
			startMs: sStart,
			endMs: Math.max(sStart + 1, sEnd),
			text: frag,
			words: synthesizeWordsForCue(frag, sStart, Math.max(sStart + 1, sEnd)),
		};
	});
}

export function processTranscribeKitCues(cues: CaptionCuePayload[]): CaptionCuePayload[] {
	const expanded = cues.flatMap((cue) => splitCueClauses(cue));
	return expanded.map((cue, idx) => ({
		...cue,
		id: `caption-${idx + 1}`,
	}));
}

export async function generateAutoCaptionsFromVideo(options: {
	videoPath: string;
	engine?: "transcribe-kit" | "whisper";
	transcribeCliPath?: string;
	whisperExecutablePath?: string;
	whisperModelPath?: string;
	language?: string;
}) {
	const ffmpegPath = getFfmpegBinaryPath();
	const normalizedVideoPath = normalizeVideoSourcePath(options.videoPath);
	if (!normalizedVideoPath) {
		throw new Error("Missing source video path.");
	}

	const engine = options.engine ?? (options.whisperModelPath ? "whisper" : "transcribe-kit");

	const tempBase = path.join(
		app.getPath("temp"),
		`recordly-captions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	const wavPath = `${tempBase}.wav`;
	const outputBase = `${tempBase}-captions`;
	const srtPath = `${outputBase}.srt`;
	const jsonPath = `${outputBase}.json`;

	try {
		const audioSource = await extractCaptionAudioSource({
			videoPath: normalizedVideoPath,
			ffmpegPath,
			wavPath,
		});

		const language =
			options.language && options.language.trim() ? options.language.trim() : "auto";

		const executable =
			engine === "transcribe-kit"
				? await resolveTranscribeCliPath(options.transcribeCliPath)
				: await resolveWhisperExecutablePath(options.whisperExecutablePath);
		await ensureReadableFile(executable, { executable: true });
		if (options.whisperModelPath) await ensureReadableFile(options.whisperModelPath);
		const cues = await transcribeWav({
			engine,
			executable,
			model: options.whisperModelPath,
			wavPath,
			outputBase,
			language,
			ffmpegPath,
			ffprobePath: getFfprobeBinaryPath(),
		});

		if (cues.length === 0) {
			throw new Error("Speech recognition completed, but no caption cues were produced.");
		}

		let cuesToReturn = cues;
		if (engine === "transcribe-kit") {
			cuesToReturn = processTranscribeKitCues(cues);
		} else {
			try {
				const silences = await detectSilenceIntervals({ ffmpegPath, wavPath });
				cuesToReturn = segmentCuesIntoPhrases(cues, silences).map((cue) => ({
					...cue,
					words:
						cue.words && cue.words.length > 0
							? cue.words
							: synthesizeWordsForCue(cue.text, cue.startMs, cue.endMs),
				}));
			} catch (error) {
				console.warn(
					"[auto-captions] Silence-aware re-segmentation failed, using raw cues:",
					error,
				);
			}
		}

		return {
			cues: cuesToReturn,
			audioSourceLabel: audioSource.label,
			engine,
		};
	} finally {
		await Promise.allSettled([
			fs.rm(wavPath, { force: true }),
			fs.rm(srtPath, { force: true }),
			fs.rm(jsonPath, { force: true }),
		]);
	}
}
