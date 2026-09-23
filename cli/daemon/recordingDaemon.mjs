import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { getNativeBinaryPath } from "../core/paths.mjs";
import { saveSession } from "../core/session.mjs";

const configRaw = process.argv[2];
if (!configRaw) {
	console.error("Missing daemon configuration JSON");
	process.exit(1);
}

const config = JSON.parse(configRaw);
const {
	sessionId,
	videoPath,
	systemAudioPath,
	micAudioPath,
	telemetryPath,
	markersPath,
	target,
	fps = 60,
	capturesSystemAudio = false,
	capturesMicrophone = false,
} = config;

const socketPath = path.join(path.dirname(telemetryPath), `${sessionId}.sock`);
await fs.rm(socketPath, { force: true });

// Setup SCK Recorder config
const sckConfig = {
	fps,
	outputPath: videoPath,
	capturesSystemAudio,
	capturesMicrophone,
	systemAudioOutputPath: systemAudioPath || undefined,
	microphoneOutputPath: micAudioPath || undefined,
};

if (target?.type === "window" && target?.id) {
	const winIdMatch = target.id.match(/^window:(\d+)/);
	if (winIdMatch) {
		sckConfig.windowId = Number.parseInt(winIdMatch[1], 10);
	}
	if (typeof target.x === "number") sckConfig.windowX = target.x;
	if (typeof target.y === "number") sckConfig.windowY = target.y;
	if (typeof target.width === "number") sckConfig.windowWidth = target.width;
	if (typeof target.height === "number") sckConfig.windowHeight = target.height;
} else if (target?.display_id) {
	sckConfig.displayId = Number.parseInt(target.display_id, 10);
}

const sckHelperBinary = getNativeBinaryPath("recordly-screencapturekit-helper");
const cursorTrackerBinary = getNativeBinaryPath("recordly-cursor-tracker");

// Spawn SCK Recorder
const recorderProcess = spawn(sckHelperBinary, [JSON.stringify(sckConfig)], {
	stdio: ["pipe", "pipe", "pipe"],
});

// Spawn Cursor Tracker
const trackerArgs = ["--output", telemetryPath];
if (sckConfig.windowX !== undefined && sckConfig.windowWidth !== undefined) {
	trackerArgs.push(
		"--window-x",
		String(sckConfig.windowX),
		"--window-y",
		String(sckConfig.windowY),
		"--window-w",
		String(sckConfig.windowWidth),
		"--window-h",
		String(sckConfig.windowHeight),
	);
}

const trackerProcess = spawn(cursorTrackerBinary, trackerArgs, {
	stdio: ["pipe", "pipe", "pipe"],
});

const markers = [];
const startedAt = new Date().toISOString();
let isRecordingStarted = false;
let isTrackerStarted = false;

recorderProcess.stdout.on("data", (chunk) => {
	const text = chunk.toString();
	if (text.includes("Recording started")) {
		isRecordingStarted = true;
	}
});

trackerProcess.stdout.on("data", (chunk) => {
	const text = chunk.toString();
	if (text.includes("TRACKER_STARTED")) {
		isTrackerStarted = true;
	}
});

// Create Unix Domain Socket server for IPC control
const server = net.createServer((socket) => {
	socket.on("data", async (data) => {
		try {
			const req = JSON.parse(data.toString().trim());
			if (req.cmd === "ping") {
				socket.write(
					JSON.stringify({
						status: "ok",
						isRecording: isRecordingStarted && isTrackerStarted,
					}) + "\n",
				);
			} else if (req.cmd === "mark") {
				const marker = {
					timeMs: req.timeMs ?? Date.now() - new Date(startedAt).getTime(),
					action: req.action ?? "action",
					target: req.target ?? null,
					x: req.x ?? null,
					y: req.y ?? null,
				};
				markers.push(marker);
				await fs.writeFile(markersPath, JSON.stringify(markers, null, 2), "utf-8");
				socket.write(JSON.stringify({ status: "ok", marker }) + "\n");
			} else if (req.cmd === "stop") {
				// Stop capture processes
				recorderProcess.stdin.write("stop\n");
				trackerProcess.stdin.write("stop\n");

				await Promise.all([
					new Promise((resolve) => recorderProcess.on("close", resolve)),
					new Promise((resolve) => trackerProcess.on("close", resolve)),
				]);

				const stoppedAt = new Date().toISOString();
				const sessionData = {
					sessionId,
					pid: process.pid,
					status: "stopped",
					startedAt,
					stoppedAt,
					durationMs: new Date(stoppedAt).getTime() - new Date(startedAt).getTime(),
					videoPath,
					systemAudioPath,
					micAudioPath,
					telemetryPath,
					markersPath,
					target,
					markers,
				};

				await saveSession(sessionData);
				socket.write(JSON.stringify({ status: "stopped", session: sessionData }) + "\n");

				server.close();
				await fs.rm(socketPath, { force: true });
				process.exit(0);
			}
		} catch (err) {
			socket.write(JSON.stringify({ status: "error", error: err.message }) + "\n");
		}
	});
});

server.listen(socketPath, async () => {
	// Save initial session state
	await saveSession({
		sessionId,
		pid: process.pid,
		socketPath,
		status: "recording",
		startedAt,
		videoPath,
		systemAudioPath,
		micAudioPath,
		telemetryPath,
		markersPath,
		target,
	});
});
