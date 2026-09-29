import fs from "node:fs/promises";
import type { CompanionAudioCandidate } from "../../electron/ipc/types.ts";
type CompanionAudioTimingMetadata = { startDelayMs?: number };
export const COMPANION_AUDIO_LAYOUTS = [
	{ platform: "mac" as const, systemSuffix: ".system.m4a", micSuffix: ".mic.m4a" },
	{ platform: "win" as const, systemSuffix: ".system.wav", micSuffix: ".mic.wav" },
	{ platform: "mac" as const, systemSuffix: ".system.webm", micSuffix: ".mic.webm" },
];
export async function getUsableCompanionAudioCandidates(
	videoPath: string,
): Promise<CompanionAudioCandidate[]> {
	const basePath = videoPath.replace(/\.[^.]+$/u, "");
	const candidates: CompanionAudioCandidate[] = [];

	for (const layout of COMPANION_AUDIO_LAYOUTS) {
		const systemPath = `${basePath}${layout.systemSuffix}`;
		const micPath = `${basePath}${layout.micSuffix}`;
		const usablePaths: string[] = [];

		for (const companionPath of [systemPath, micPath]) {
			try {
				const stat = await fs.stat(companionPath);
				if (stat.size > 0) {
					usablePaths.push(companionPath);
				}
			} catch {
				// Missing companion audio is expected for many recordings.
			}
		}

		if (usablePaths.length > 0) {
			candidates.push({
				platform: layout.platform,
				systemPath,
				micPath,
				usablePaths,
			});
		}
	}

	return candidates;
}

async function readCompanionAudioTimingMetadata(
	companionPath: string,
): Promise<CompanionAudioTimingMetadata | null> {
	try {
		const raw = await fs.readFile(`${companionPath}.json`, "utf8");
		const parsed = JSON.parse(
			raw.replace(/^\uFEFF/, ""),
		) as CompanionAudioTimingMetadata | null;
		if (!parsed || typeof parsed !== "object") {
			return null;
		}

		return parsed;
	} catch {
		return null;
	}
}

export async function getCompanionAudioStartDelayMs(companionPath: string) {
	const metadata = await readCompanionAudioTimingMetadata(companionPath);
	const startDelayMs = metadata?.startDelayMs;
	if (!Number.isFinite(startDelayMs) || (startDelayMs ?? 0) < 0) {
		return null;
	}

	return Math.round(startDelayMs ?? 0);
}

export async function resolveCompanionAudio(videoPath: string, hasAudio: boolean) {
	const companionCandidates = await getUsableCompanionAudioCandidates(videoPath);
	if (companionCandidates.length === 0) {
		return { paths: [], startDelayMsByPath: {} };
	}

	let paths: string[];
	if (hasAudio) {
		const hasUsableMacSystemCompanion = companionCandidates.some(
			(candidate) =>
				candidate.platform === "mac" &&
				candidate.usablePaths.includes(candidate.systemPath),
		);
		const usableMacMicOnlyCompanions = Array.from(
			new Set(
				companionCandidates.flatMap((candidate) =>
					candidate.platform === "mac" &&
					!candidate.usablePaths.includes(candidate.systemPath) &&
					candidate.usablePaths.includes(candidate.micPath)
						? [candidate.micPath]
						: [],
				),
			),
		);

		if (!hasUsableMacSystemCompanion && usableMacMicOnlyCompanions.length > 0) {
			paths = usableMacMicOnlyCompanions;
		} else if (hasUsableMacSystemCompanion) {
			// The inline mp4 audio track carries system audio only (the helper skips
			// the microphone while system audio is captured), so returning the video
			// alone drops the mic entirely.  Hand over both mac sidecars instead and
			// let the renderer route them as independent system/mic tracks.
			paths = Array.from(
				new Set(
					companionCandidates.flatMap((candidate) =>
						candidate.platform === "mac" ? candidate.usablePaths : [],
					),
				),
			);
		} else {
			const companionPaths = Array.from(
				new Set(
					companionCandidates.flatMap((candidate) =>
						candidate.usablePaths.filter(
							(companionPath) => companionPath === candidate.micPath,
						),
					),
				),
			);
			if (companionPaths.length === 0) {
				return { paths: [], startDelayMsByPath: {} };
			}

			paths = [videoPath, ...companionPaths];
		}
	} else {
		paths = Array.from(
			new Set(companionCandidates.flatMap((candidate) => candidate.usablePaths)),
		);
	}

	const metadataEntries = await Promise.all(
		paths.map(async (audioPath) => {
			const startDelayMs = await getCompanionAudioStartDelayMs(audioPath);
			if (!Number.isFinite(startDelayMs)) {
				return null;
			}

			return [audioPath, startDelayMs] as const;
		}),
	);

	return {
		paths,
		startDelayMsByPath: Object.fromEntries(
			metadataEntries.filter((entry): entry is readonly [string, number] => entry !== null),
		),
	};
}
