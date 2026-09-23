import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
export const isPackagedCli = existsSync(path.join(root, "app.asar"));
export const repoRoot = isPackagedCli ? path.join(root, "app.asar") : root;
export const cliRoot = path.join(root, "cli");
const nodeRequire = createRequire(path.join(repoRoot, "package.json"));
const unpack = (file) => file.replace(/\.asar([/\\])/, ".asar.unpacked$1");

export function getCliVersion() {
	return nodeRequire("./package.json").version;
}

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
	return unpack(path.join(repoRoot, "electron", "native", "bin", archTag, binaryName));
}

export function getFfmpegPath() {
	return unpack(nodeRequire("ffmpeg-static"));
}

export function getFfprobePath() {
	const native = getNativeBinaryPath("ffprobe");
	return existsSync(native) ? native : unpack(nodeRequire("ffprobe-static").path);
}

export function getElectronBinaryPath() {
	if (isPackagedCli) return process.execPath;
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

export function getRendererLaunch() {
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	return { executable: getElectronBinaryPath(), args: isPackagedCli ? [] : [repoRoot], env };
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
