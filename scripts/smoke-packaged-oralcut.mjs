// Run against an ad-hoc/signed macOS app with an installed TranscribeKit runtime.
// The harness uses Node; every tested CLI process uses only the app's Electron runtime.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const sourceApp = path.resolve(process.argv[2] ?? "release/mac-arm64/Recordly.app");
const transcriber = path.resolve(
	process.argv[3] ?? path.join(os.homedir(), ".local/bin/transcribe-cli"),
);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-installed-oralcut-"));
const app = path.join(dir, "Isolated", "Recordly.app");
const launcher = path.join(app, "Contents/Resources/cli/recordly");
const file = (name) => path.join(dir, name);
const env = {
	...process.env,
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
	RECORDLY_USER_DATA: file("userdata"),
};
delete env.ELECTRON_RUN_AS_NODE;
const options = { cwd: dir, env, timeout: 180000, maxBuffer: 8 * 1024 * 1024 };
const cli = async (...args) => JSON.parse((await run(launcher, args, options)).stdout);
try {
	await fs.access(transcriber);
	await run("/usr/bin/ditto", [sourceApp, app]);
	const ffmpeg = path.join(
		app,
		"Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg",
	);
	const ffprobe = path.join(
		app,
		`Contents/Resources/app.asar.unpacked/electron/native/bin/darwin-${process.arch}/ffprobe`,
	);
	await run("/usr/bin/say", [
		"-o",
		file("speech.aiff"),
		"Welcome to Recordly. This is a short test of speech transcription. We can edit this video by selecting sentences.",
	]);
	await run(
		ffmpeg,
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=blue:s=320x180:r=30",
			"-i",
			file("speech.aiff"),
			"-af",
			"apad=pad_dur=3",
			"-shortest",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			file("talk.mp4"),
		],
		options,
	);
	const media = (await cli("library", "import", file("talk.mp4"), "--json")).data;
	assert.equal(media.analysisStatus, "ready");
	await cli("project", "create", "--media", media.id, "-o", file("talk.recordly"));
	const base = JSON.parse(await fs.readFile(file("talk.recordly"), "utf8"));
	base.composition.width = 320;
	base.composition.height = 180;
	await fs.writeFile(file("talk.recordly"), JSON.stringify(base));
	const transcribeArgs = [
		"transcript",
		"generate",
		file("talk.recordly"),
		"--engine",
		"transcribe-kit",
		"--executable",
		transcriber,
		"--language",
		"en",
	];
	const bundle = (await cli(...transcribeArgs, "-o", file("transcript.json"))).data;
	assert.equal(bundle.complete, true);
	assert.ok(bundle.documents[0].segments.length);
	const cached = (await cli(...transcribeArgs, "-o", file("cached.json"))).data;
	assert.equal(cached.documents[0].revision, bundle.documents[0].revision);
	await cli(
		"transcript",
		"export",
		file("transcript.json"),
		"--format",
		"markdown",
		"-o",
		file("transcript.md"),
	);
	await cli(
		"review",
		"create",
		file("talk.recordly"),
		"--transcript",
		file("transcript.json"),
		"--pauses",
		"-o",
		file("review.json"),
	);
	const inspection = (await cli("review", "inspect", file("review.json"))).data;
	assert.ok(
		inspection.plan.suggestions.length,
		"Real trailing silence should produce a proposal",
	);
	const acceptedIds = inspection.plan.suggestions.map((s) => s.id);
	await fs.writeFile(file("selection.json"), JSON.stringify({ schemaVersion: 1, acceptedIds }));
	const apply = [
		"review",
		"apply",
		file("review.json"),
		"--project",
		file("talk.recordly"),
		"--selection",
		file("selection.json"),
	];
	const dry = (await cli(...apply, "--dry-run")).data;
	const applied = (await cli(...apply, "-o", file("roughcut.recordly"))).data;
	assert.equal(dry.removedMs, applied.removedMs);
	await run(
		launcher,
		[
			"project",
			"preview",
			file("roughcut.recordly"),
			"--from",
			"0",
			"--to",
			"1000",
			"-o",
			file("preview.mp4"),
		],
		options,
	);
	await run(
		launcher,
		["render", file("roughcut.recordly"), "-o", file("result.mp4"), "--json"],
		options,
	);
	const probe = JSON.parse(
		(
			await run(
				ffprobe,
				["-v", "error", "-show_format", "-show_streams", "-of", "json", file("result.mp4")],
				options,
			)
		).stdout,
	);
	assert.ok(probe.streams.some((s) => s.codec_type === "audio"));
	assert.ok(probe.streams.some((s) => s.codec_type === "video"));
	assert.ok(Math.abs(Number(probe.format.duration) * 1000 - dry.durationMs) < 100);
	// Cancel during real audio extraction; no incomplete success/output may be published.
	const cancelled = await new Promise((resolve, reject) => {
		const child = spawn(
			launcher,
			[...transcribeArgs, "--force", "-o", file("cancelled.json")],
			{ cwd: dir, env },
		);
		let output = "",
			sent = false;
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(Error("Cancellation timed out"));
		}, 30000);
		child.stdout.on("data", (data) => (output += data));
		child.stderr.on("data", () => {
			if (!sent) {
				sent = true;
				child.kill("SIGINT");
			}
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			clearTimeout(timer);
			resolve({ code, output });
		});
	});
	assert.equal(cancelled.code, 130);
	assert.equal(JSON.parse(cancelled.output).error.code, "CANCELLED");
	await assert.rejects(fs.access(file("cancelled.json")));
	try {
		await cli(
			"transcript",
			"generate",
			file("talk.recordly"),
			"--engine",
			"whisper",
			"--model",
			file("missing.bin"),
			"-o",
			file("missing.json"),
		);
		throw Error("Expected unavailable model");
	} catch (error) {
		assert.equal(error.code, 1);
		assert.equal(JSON.parse(error.stdout).error.code, "ASR_UNAVAILABLE");
	}
	console.log(
		JSON.stringify({
			success: true,
			checks: [
				"isolated packaged CLI without developer Node",
				"real TranscribeKit speech",
				"cache reuse",
				"Markdown export",
				"real silence review",
				"dry-run/apply duration parity",
				"preview/export audio and video",
				"cancellation without output",
				"missing model diagnosis",
			],
			segments: bundle.documents[0].segments.length,
			removedMs: dry.removedMs,
		}),
	);
} finally {
	await fs.rm(dir, { recursive: true, force: true });
}
