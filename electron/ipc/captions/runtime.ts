import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { CaptionCuePayload } from "../types";
import { parseSrtCues, parseWhisperJsonCues, shouldRetryWhisperWithoutJson } from "./parser.ts";
import { isMissingWindowsWhisperRuntimeDependency } from "./runtimeErrors.ts";
import {
	parseSilenceIntervals,
	SILENCE_DETECT_MIN_S,
	SILENCE_NOISE_DB,
	type SilenceInterval,
} from "./silence.ts";
const execFileAsync = promisify(execFile);
async function executeWhisper(whisperExecutablePath: string, args: string[], signal?: AbortSignal) {
	try {
		await execFileAsync(whisperExecutablePath, args, {
			signal,
			timeout: 30 * 60 * 1000,
			maxBuffer: 20 * 1024 * 1024,
		});
	} catch (error) {
		if (isMissingWindowsWhisperRuntimeDependency(error)) {
			throw new Error(
				"Whisper could not start because the Microsoft Visual C++ x64 Redistributable is missing. Install it from https://aka.ms/vc14/vc_redist.x64.exe, then restart Recordly.",
			);
		}
		throw error;
	}
}

export async function detectSilenceIntervals(options: {
	ffmpegPath: string;
	wavPath: string;
	signal?: AbortSignal;
}): Promise<SilenceInterval[]> {
	// ffmpeg writes silencedetect results to stderr; the null muxer just runs the filter.
	const { stderr } = await execFileAsync(
		options.ffmpegPath,
		[
			"-hide_banner",
			"-nostats",
			"-i",
			options.wavPath,
			"-af",
			`silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_DETECT_MIN_S}`,
			"-f",
			"null",
			"-",
		],
		{ signal: options.signal, timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 },
	);

	return parseSilenceIntervals(stderr ?? "");
}

export async function executeTranscribeKit(
	transcribeCliPath: string,
	audioPath: string,
	outputDir: string,
	language?: string,
	signal?: AbortSignal,
) {
	let lang = "zh";
	if (language && language.trim() && language.trim() !== "auto") {
		lang = language.trim();
	}

	const args = [audioPath, "-o", outputDir, "-f", "srt", "-l", lang];

	await execFileAsync(transcribeCliPath, args, {
		signal,
		timeout: 30 * 60 * 1000,
		maxBuffer: 20 * 1024 * 1024,
	});
}

export const TRANSCRIBE_KIT_CHUNK_MS = 25_000;

export function offsetCaptionCues(
	cues: CaptionCuePayload[],
	offsetMs: number,
): CaptionCuePayload[] {
	if (offsetMs === 0) {
		return cues;
	}

	return cues.map((cue) => ({
		...cue,
		startMs: cue.startMs + offsetMs,
		endMs: cue.endMs + offsetMs,
		words: cue.words?.map((word) => ({
			...word,
			startMs: word.startMs + offsetMs,
			endMs: word.endMs + offsetMs,
		})),
	}));
}

async function getWavDurationMs(
	ffprobePath: string,
	wavPath: string,
	signal?: AbortSignal,
): Promise<number> {
	const { stdout } = await execFileAsync(
		ffprobePath,
		[
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"default=noprint_wrappers=1:nokey=1",
			wavPath,
		],
		{ signal, timeout: 30_000 },
	);
	const seconds = Number.parseFloat(stdout.trim());
	if (!Number.isFinite(seconds) || seconds <= 0) {
		throw new Error("Could not determine caption audio duration.");
	}
	return Math.round(seconds * 1000);
}

export async function transcribeKitWavToCues(options: {
	transcribeCliPath: string;
	wavPath: string;
	outputDir: string;
	language?: string;
	ffmpegPath: string;
	ffprobePath: string;
	signal?: AbortSignal;
}): Promise<CaptionCuePayload[]> {
	const durationMs = await getWavDurationMs(options.ffprobePath, options.wavPath, options.signal);
	const shouldChunk = durationMs > TRANSCRIBE_KIT_CHUNK_MS + 2000;
	const chunkStarts = shouldChunk
		? Array.from(
				{ length: Math.ceil(durationMs / TRANSCRIBE_KIT_CHUNK_MS) },
				(_, index) => index * TRANSCRIBE_KIT_CHUNK_MS,
			)
		: [0];

	const cues: CaptionCuePayload[] = [];
	for (const startMs of chunkStarts) {
		options.signal?.throwIfAborted();
		const remainingMs = durationMs - startMs;
		const chunkDurationMs = shouldChunk
			? Math.min(TRANSCRIBE_KIT_CHUNK_MS, remainingMs)
			: durationMs;
		let inputPath = options.wavPath;
		let chunkDir = options.outputDir;
		let chunkWav: string | null = null;

		if (shouldChunk) {
			chunkWav = path.join(options.outputDir, `chunk-${startMs}.wav`);
			chunkDir = path.join(options.outputDir, `chunk-${startMs}`);
			await fs.mkdir(chunkDir, { recursive: true });
			await execFileAsync(
				options.ffmpegPath,
				[
					"-y",
					"-ss",
					String(startMs / 1000),
					"-t",
					String(chunkDurationMs / 1000),
					"-i",
					options.wavPath,
					"-c",
					"copy",
					chunkWav,
				],
				{ signal: options.signal, timeout: 60_000 },
			);
			inputPath = chunkWav;
		}

		const generatedSrtPath = path.join(
			chunkDir,
			`${path.basename(inputPath, path.extname(inputPath))}.srt`,
		);
		try {
			await executeTranscribeKit(
				options.transcribeCliPath,
				inputPath,
				chunkDir,
				options.language,
				options.signal,
			);
			const parsed = parseSrtCues(await fs.readFile(generatedSrtPath, "utf-8"));
			cues.push(...offsetCaptionCues(parsed, startMs));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/未在音频中检测到人声音段|no speech|no caption/i.test(message)) {
				throw error;
			}
		} finally {
			await Promise.allSettled([
				fs.rm(generatedSrtPath, { force: true }),
				chunkWav ? fs.rm(chunkWav, { force: true }) : Promise.resolve(),
			]);
		}
	}

	return cues;
}

/** Both desktop captions and transcript jobs use this engine adapter. Paths and cancellation are injected. */
export async function transcribeWav(options: {
	engine: "whisper" | "transcribe-kit";
	executable: string;
	model?: string;
	wavPath: string;
	outputBase: string;
	language: string;
	ffmpegPath: string;
	ffprobePath: string;
	signal?: AbortSignal;
}): Promise<CaptionCuePayload[]> {
	if (options.engine === "transcribe-kit")
		return transcribeKitWavToCues({
			transcribeCliPath: options.executable,
			wavPath: options.wavPath,
			outputDir: path.dirname(options.outputBase),
			language: options.language,
			ffmpegPath: options.ffmpegPath,
			ffprobePath: options.ffprobePath,
			signal: options.signal,
		});
	if (!options.model) throw new Error("Missing Whisper model path.");
	const args = [
		"-m",
		options.model,
		"-f",
		options.wavPath,
		"-osrt",
		"-of",
		options.outputBase,
		"-l",
		options.language,
		"-np",
	];
	let json = true;
	try {
		await executeWhisper(options.executable, [...args, "-ojf"], options.signal);
	} catch (error) {
		if (!shouldRetryWhisperWithoutJson(error)) throw error;
		json = false;
		await executeWhisper(options.executable, args, options.signal);
	}
	const cues = json
		? parseWhisperJsonCues(await fs.readFile(`${options.outputBase}.json`, "utf8"))
		: [];
	return cues.length
		? cues
		: parseSrtCues(await fs.readFile(`${options.outputBase}.srt`, "utf8"));
}
