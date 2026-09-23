import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { getDefaultRecordingsDir, getSessionsDir, cliRoot } from "./paths.mjs";
import { getLatestActiveSession, getSession } from "./session.mjs";

function sendSocketCommand(socketPath, command, timeoutMs = 15000) {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(socketPath);
		let buffer = "";

		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error(`Socket command timeout (${timeoutMs}ms)`));
		}, timeoutMs);

		socket.on("connect", () => {
			socket.write(JSON.stringify(command) + "\n");
		});

		socket.on("data", (chunk) => {
			buffer += chunk.toString();
			if (buffer.includes("\n")) {
				clearTimeout(timer);
				socket.end();
				try {
					resolve(JSON.parse(buffer.trim()));
				} catch (e) {
					resolve({ raw: buffer.trim() });
				}
			}
		});

		socket.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

export async function startRecording(options = {}) {
	const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
	const sessionId = options.sessionId || `session-${timestamp}`;
	const outputDir = options.outputDir || getDefaultRecordingsDir();
	await fs.mkdir(outputDir, { recursive: true });

	const videoPath = options.outputPath || path.join(outputDir, `${sessionId}.mp4`);
	const telemetryPath = `${videoPath}.cursor.json`;
	const markersPath = `${videoPath}.markers.json`;
	const systemAudioPath = options.systemAudio ? `${videoPath}.system.m4a` : null;
	const micAudioPath = options.mic ? `${videoPath}.mic.m4a` : null;

	const config = {
		sessionId,
		videoPath,
		systemAudioPath,
		micAudioPath,
		telemetryPath,
		markersPath,
		target: options.target || null,
		fps: options.fps || 60,
		capturesSystemAudio: Boolean(options.systemAudio),
		capturesMicrophone: Boolean(options.mic),
	};

	const daemonScript = path.join(cliRoot, "daemon", "recordingDaemon.mjs");
	const daemon = spawn(process.execPath, [daemonScript, JSON.stringify(config)], {
		detached: true,
		stdio: "ignore",
	});
	daemon.unref();

	const socketPath = path.join(path.dirname(telemetryPath), `${sessionId}.sock`);

	// Poll socket until ready
	let ready = false;
	const deadline = Date.now() + 8000;
	while (Date.now() < deadline) {
		try {
			const res = await sendSocketCommand(socketPath, { cmd: "ping" }, 1000);
			if (res.status === "ok") {
				ready = true;
				break;
			}
		} catch {
			await new Promise((r) => setTimeout(r, 200));
		}
	}

	if (!ready) {
		throw new Error("Recording daemon failed to initialize within 8 seconds.");
	}

	return {
		status: "recording",
		sessionId,
		videoPath,
		telemetryPath,
		markersPath,
		socketPath,
	};
}

export async function stopRecording(sessionId) {
	let session = null;
	if (sessionId) {
		session = await getSession(sessionId);
	} else {
		session = await getLatestActiveSession();
	}

	if (!session) {
		throw new Error(sessionId ? `Session '${sessionId}' not found.` : "No active recording session found.");
	}

	const socketPath = session.socketPath || path.join(path.dirname(session.telemetryPath), `${session.sessionId}.sock`);
	const res = await sendSocketCommand(socketPath, { cmd: "stop" }, 20000);

	if (res.status !== "stopped") {
		throw new Error(`Failed to stop recording: ${JSON.stringify(res)}`);
	}

	return res.session;
}

export async function markAction(sessionId, markerData) {
	let session = null;
	if (sessionId) {
		session = await getSession(sessionId);
	} else {
		session = await getLatestActiveSession();
	}

	if (!session) {
		throw new Error("No active recording session found to mark.");
	}

	const socketPath = session.socketPath || path.join(path.dirname(session.telemetryPath), `${session.sessionId}.sock`);
	return await sendSocketCommand(socketPath, { cmd: "mark", ...markerData });
}
