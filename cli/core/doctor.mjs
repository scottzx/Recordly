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
		electron: fs.existsSync(electron),
	};

	if (Object.values(checks.binaries.details).some((v) => !v)) {
		checks.binaries.ok = false;
	}

	// Permission checks using Swift one-liner
	try {
		const swiftScript = `
import CoreGraphics
import ApplicationServices
let screen = CGPreflightScreenCaptureAccess()
let ax = AXIsProcessTrusted()
print("\\(screen),\\(ax)")
`;
		const out = execFileSync("swift", ["-e", swiftScript], { encoding: "utf8" }).trim();
		const [screenStr, axStr] = out.split(",");
		const screenOk = screenStr === "true";
		const axOk = axStr === "true";

		checks.permissions.details = {
			screenRecording: screenOk,
			accessibility: axOk,
		};
		checks.permissions.ok = screenOk; // Accessibility is optional/recommended for cursor clicks
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
