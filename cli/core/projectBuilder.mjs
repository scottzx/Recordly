import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { generateAutoZooms } from "./autoZoom.mjs";
import { loadCaptionsFromFile } from "./captionParser.mjs";
import { getFfprobePath, repoRoot } from "./paths.mjs";

export const PRESETS = {
	"modern-gradient": {
		wallpaper: "/wallpapers/sequoia-blue.jpg",
		padding: { top: 48, bottom: 48, left: 48, right: 48, linked: true },
		borderRadius: 12,
		shadowIntensity: 0.67,
		backgroundBlur: 0,
	},
	"minimal-dark": {
		wallpaper: "/wallpapers/midnight-8.jpg",
		padding: { top: 40, bottom: 40, left: 40, right: 40, linked: true },
		borderRadius: 10,
		shadowIntensity: 0.5,
		backgroundBlur: 0,
	},
	glass: {
		wallpaper: "/wallpapers/glassmorphism-3.jpg",
		padding: { top: 48, bottom: 48, left: 48, right: 48, linked: true },
		borderRadius: 14,
		shadowIntensity: 0.7,
		backgroundBlur: 0,
	},
	raw: {
		wallpaper: "",
		padding: { top: 0, bottom: 0, left: 0, right: 0, linked: true },
		borderRadius: 0,
		shadowIntensity: 0,
		backgroundBlur: 0,
	},
};

function parseTimeToMs(val) {
	if (typeof val === "number") return Math.round(val);
	const str = String(val).trim().toLowerCase();
	if (str.endsWith("ms")) {
		return Number.parseInt(str.replace("ms", ""), 10);
	}
	if (str.endsWith("s")) {
		return Math.round(Number.parseFloat(str.replace("s", "")) * 1000);
	}
	return Number.parseInt(str, 10);
}

export function parseRangeString(rangeStr) {
	const parts = String(rangeStr).split(/[:\-]/).map((p) => p.trim());
	if (parts.length >= 2) {
		const startMs = parseTimeToMs(parts[0]);
		const endMs = parseTimeToMs(parts[1]);
		return { startMs, endMs };
	}
	return null;
}

export async function probeVideoDuration(videoPath) {
	const ffprobe = getFfprobePath();
	return new Promise((resolve) => {
		const child = spawn(ffprobe, [
			"-v", "error",
			"-show_entries", "format=duration",
			"-of", "default=noprint_wrappers=1:nokey=1",
			videoPath,
		]);
		let out = "";
		child.stdout.on("data", (c) => {
			out += c.toString();
		});
		child.on("close", (code) => {
			if (code === 0 && out.trim()) {
				const sec = Number.parseFloat(out.trim());
				if (Number.isFinite(sec) && sec > 0) {
					return resolve(Math.round(sec * 1000));
				}
			}
			resolve(0);
		});
		child.on("error", () => resolve(0));
	});
}

/**
 * Convert trim regions to contiguous clip regions covering the timeline without dead gaps.
 */
export function trimsToClips(trims, totalDurationMs, ripple = true) {
	if (!trims || trims.length === 0) {
		return [{ id: "clip-1", startMs: 0, endMs: totalDurationMs, sourceStartMs: 0, speed: 1 }];
	}
	const sorted = [...trims].sort((a, b) => a.startMs - b.startMs);
	const clips = [];
	let sourceCursor = 0;
	let timelineCursor = 0;
	let clipId = 1;

	for (const trim of sorted) {
		if (trim.startMs > sourceCursor) {
			const span = trim.startMs - sourceCursor;
			clips.push({
				id: `clip-${clipId++}`,
				startMs: ripple ? timelineCursor : sourceCursor,
				endMs: ripple ? timelineCursor + span : trim.startMs,
				sourceStartMs: sourceCursor,
				speed: 1,
			});
			timelineCursor += span;
		}
		sourceCursor = trim.endMs;
	}

	if (sourceCursor < totalDurationMs) {
		const span = totalDurationMs - sourceCursor;
		clips.push({
			id: `clip-${clipId++}`,
			startMs: ripple ? timelineCursor : sourceCursor,
			endMs: ripple ? timelineCursor + span : totalDurationMs,
			sourceStartMs: sourceCursor,
			speed: 1,
		});
		timelineCursor += span;
	}

	return clips;
}

export async function buildProjectFile(options) {
	const {
		videoPath,
		telemetryPath,
		markersPath,
		outputPath,
		presetName = "modern-gradient",
		autoZoom = true,
		durationMs: inputDurationMs = 0,
		trims = [],
		captions = null,
		captionFile = null,
		captionStyle = "pop",
		captionFontSize = 30,
		speedRamps = [],
		clickEffect = "ripple",
		clickColor = "#3b82f6",
		clickScale = 1.2,
		cursorSmoothing = 1.0,
		zoomEasing = "ease-out",
		zoomInMs = 400,
		zoomOutMs = 400,
		motionBlur = 0.5,
	} = options;

	let durationMs = inputDurationMs;
	if (durationMs <= 0 && videoPath) {
		try {
			durationMs = await probeVideoDuration(videoPath);
		} catch {
			durationMs = 0;
		}
	}

	let telemetrySamples = [];
	if (telemetryPath) {
		try {
			const raw = await fs.readFile(telemetryPath, "utf-8");
			const parsed = JSON.parse(raw);
			telemetrySamples = parsed.samples || [];
		} catch {
			// ignore
		}
	}

	let markers = [];
	if (markersPath) {
		try {
			const raw = await fs.readFile(markersPath, "utf-8");
			markers = JSON.parse(raw) || [];
		} catch {
			// ignore
		}
	}

	const zoomRegions = autoZoom && durationMs > 0 ? generateAutoZooms(telemetrySamples, markers, durationMs) : [];
	const preset = PRESETS[presetName] || PRESETS["modern-gradient"];

	// 1. Process Trims
	const trimRegions = [];
	const rawTrims = Array.isArray(trims) ? trims : [trims].filter(Boolean);
	let trimIndex = 1;
	for (const item of rawTrims) {
		if (typeof item === "string") {
			const parsed = parseRangeString(item);
			if (parsed) {
				trimRegions.push({
					id: `trim-${trimIndex++}`,
					startMs: parsed.startMs,
					endMs: parsed.endMs,
				});
			}
		} else if (typeof item === "object" && item.startMs !== undefined && item.endMs !== undefined) {
			trimRegions.push({
				id: item.id || `trim-${trimIndex++}`,
				startMs: item.startMs,
				endMs: item.endMs,
			});
		}
	}

	// 2. Process Clips
	let clipRegions = undefined;
	if (durationMs > 0) {
		clipRegions = trimsToClips(trimRegions, durationMs);
	}

	// 3. Process Speed Ramps (e.g. "3000:8000:2.0")
	const speedRegions = [];
	const rawSpeeds = Array.isArray(speedRamps) ? speedRamps : [speedRamps].filter(Boolean);
	let speedIndex = 1;
	for (const item of rawSpeeds) {
		if (typeof item === "string") {
			const parts = item.split(":").map((p) => p.trim());
			if (parts.length >= 3) {
				const startMs = parseTimeToMs(parts[0]);
				const endMs = parseTimeToMs(parts[1]);
				const speed = Number.parseFloat(parts[2]) || 1.5;
				speedRegions.push({
					id: `speed-${speedIndex++}`,
					startMs,
					endMs,
					speed,
				});
			}
		} else if (typeof item === "object" && item.startMs !== undefined && item.endMs !== undefined) {
			speedRegions.push({
				id: item.id || `speed-${speedIndex++}`,
				startMs: item.startMs,
				endMs: item.endMs,
				speed: item.speed || 1.5,
			});
		}
	}

	// 4. Process Captions
	let autoCaptions = [];
	if (Array.isArray(captions)) {
		autoCaptions = captions;
	} else if (captionFile) {
		try {
			autoCaptions = await loadCaptionsFromFile(captionFile);
		} catch (e) {
			console.warn(`[Recordly] Could not load caption file: ${e.message}`);
		}
	}

	const autoCaptionSettings = {
		enabled: autoCaptions.length > 0,
		timelineQuickAdd: true,
		engine: "whisper",
		language: "auto",
		fontFamily: "\"SF Pro Text\", \"SF Pro Display\", \"Helvetica Neue\", sans-serif",
		fontSize: captionFontSize,
		bottomOffset: 4,
		maxWidth: 68,
		maxRows: 1,
		animationStyle: ["pop", "fade", "rise", "none"].includes(captionStyle) ? captionStyle : "pop",
		boxRadius: 16,
		textColor: "#FFFFFF",
		inactiveTextColor: "#9CA3AF",
		backgroundOpacity: 0.85,
	};

	const editorState = {
		wallpaper: preset.wallpaper,
		padding: preset.padding,
		borderRadius: preset.borderRadius,
		shadowIntensity: preset.shadowIntensity,
		backgroundBlur: preset.backgroundBlur,
		cropRegion: {
			x: 0,
			y: 0,
			width: 1,
			height: 1,
		},
		zoomRegions,
		trimRegions,
		speedRegions,
		annotationRegions: [],
		audioRegions: [],
		autoCaptions,
		autoCaptionSettings,
		showCursor: true,
		cursorSize: 1.5,
		cursorSmoothing,
		cursorClickEffect: clickEffect,
		cursorClickEffectColor: clickColor,
		cursorClickEffectScale: clickScale,
		cursorClickEffectOpacity: 0.85,
		cursorClickEffectDurationMs: 420,
		zoomInEasing: zoomEasing,
		zoomOutEasing: "ease-in-out",
		zoomInDurationMs: zoomInMs,
		zoomOutDurationMs: zoomOutMs,
		zoomMotionBlur: motionBlur,
		aspectRatio: "16:9",
		exportEncodingMode: "balanced",
		exportQuality: "good",
		mp4FrameRate: 60,
		exportFormat: "mp4",
	};

	if (clipRegions) {
		editorState.clipRegions = clipRegions;
	}

	const projectPayload = {
		version: 2,
		projectId: crypto.randomUUID(),
		videoPath: path.resolve(videoPath),
		editor: editorState,
	};

	const targetPath = outputPath || `${videoPath}.recordly`;
	await fs.writeFile(targetPath, JSON.stringify(projectPayload, null, 2), "utf-8");

	return {
		projectPath: targetPath,
		durationMs,
		zoomRegionsCount: zoomRegions.length,
		trimRegionsCount: trimRegions.length,
		clipRegionsCount: clipRegions ? clipRegions.length : 0,
		speedRegionsCount: speedRegions.length,
		captionsCount: autoCaptions.length,
		project: projectPayload,
	};
}
