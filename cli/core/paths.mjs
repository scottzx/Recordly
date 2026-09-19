import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..", "..");

export function getPlatformArchTag() {
	const platform = process.platform;
	const arch = process.arch;
	if (platform === "darwin") {
		return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
	}
	if (platform === "win32") {
		return "win32-x64";
	}
	return `${platform}-${arch}`;
}

export function getNativeBinaryPath(binaryName) {
	const archTag = getPlatformArchTag();
	return path.join(repoRoot, "electron", "native", "bin", archTag, binaryName);
}

export function getFfmpegPath() {
	return ffmpegStatic;
}

export function getFfprobePath() {
	return ffprobeStatic?.path || "ffprobe";
}

export function getElectronBinaryPath() {
	if (process.platform === "darwin") {
		return path.join(
			repoRoot,
			"node_modules",
			"electron",
			"dist",
			"Electron.app",
			"Contents",
			"MacOS",
			"Electron",
		);
	}
	return path.join(repoRoot, "node_modules", "electron", "dist", "electron");
}

export function getSessionsDir() {
	return path.join(os.homedir(), ".recordly", "cli-sessions");
}

export function getDefaultRecordingsDir() {
	return path.join(os.homedir(), "Movies", "Recordly");
}

export async function ensureDir(dirPath) {
	await fs.mkdir(dirPath, { recursive: true });
	return dirPath;
}
