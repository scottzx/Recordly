import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getElectronBinaryPath, getFfmpegPath, getNativeBinaryPath, getFfprobePath, repoRoot } from "./paths.mjs";

export function checkDoctor() {
	const checks = {
		platform: {
			name: "Operating System",
			ok: process.platform === "darwin",
			details: `${os.type()} ${os.release()} (${os.arch()})`,
		},
		binaries: {
			name: "Native Helpers & Runtimes",
			ok: true,
			details: {},
		},
		permissions: {
			name: "System Permissions",
			ok: true,
			details: {},
		},
	};

	const sckHelper = getNativeBinaryPath("recordly-screencapturekit-helper");
	const winList = getNativeBinaryPath("recordly-window-list");
	const cursorMonitor = getNativeBinaryPath("recordly-native-cursor-monitor");
	const ffmpeg = getFfmpegPath();
	const electron = getElectronBinaryPath();

	checks.binaries.details = {
		"screencapturekit-helper": fs.existsSync(sckHelper),
		"window-list-helper": fs.existsSync(winList),
		"cursor-monitor-helper": fs.existsSync(cursorMonitor),
		ffmpeg: fs.existsSync(ffmpeg),
		ffprobe: fs.existsSync(getFfprobePath()),
		"cursor-tracker": fs.existsSync(getNativeBinaryPath("recordly-cursor-tracker")),
		"permission-helper": fs.existsSync(getNativeBinaryPath("recordly-cli-permissions")),
		electron: fs.existsSync(electron),
	};

	if (Object.values(checks.binaries.details).some((v) => !v)) {
		checks.binaries.ok = false;
	}

	// Use a shipped native helper: installed users do not need Xcode or Swift.
	try {
		const permissions = JSON.parse(execFileSync(getNativeBinaryPath("recordly-cli-permissions"), [], {
			encoding: "utf8", timeout: 10000,
		}));
		checks.permissions.details = permissions;
		checks.permissions.ok = permissions.screenRecording === true;
	} catch (e) {
 checks.permissions.ok = false;
		checks.permissions.details = {
			checkError: e.message,
		};
	}

	const allOk = checks.platform.ok && checks.binaries.ok && checks.permissions.ok;

	return {
		healthy: allOk,
        recordingReady: allOk,
        exportReady: [getElectronBinaryPath(), getFfmpegPath(), getFfprobePath(), path.join(repoRoot, "dist", "index.html"), path.join(repoRoot, "dist-electron", "main.cjs")].every(p => p && fs.existsSync(p)),
        exportRequirements: {recordingPermissionsRequired:false, builtRenderer:fs.existsSync(path.join(repoRoot,"dist","index.html"))},
		checks,
	};
}
