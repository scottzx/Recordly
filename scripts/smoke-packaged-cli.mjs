// Exercise only the installed app's CLI and binaries, with no developer tools on PATH.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const sourceApp = path.resolve(process.argv[2] ?? "release/mac-arm64/Recordly.app");
const run = promisify(execFile);
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "recordly-installed-cli-")));
const app = path.join(temp, "Installed App", "Recordly.app");
const launcher = path.join(app, "Contents/Resources/cli/recordly");
const binaryRoot = path.join(app, "Contents/Resources/app.asar.unpacked/electron/native/bin", `darwin-${process.arch}`);
const ffmpeg = path.join(app, "Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg");
const env = { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
delete env.ELECTRON_RUN_AS_NODE;
const options = { cwd: temp, env, timeout: 180000, maxBuffer: 8 * 1024 * 1024 };
const cli = async (...args) => (await run(launcher, args, options)).stdout;
try {
	// Moving the app prevents Node from finding missing dependencies in the checkout.
	await run("/usr/bin/ditto", [sourceApp, app]);
	assert.match(await cli("--version"), /recordly-cli/);
	assert.match(await cli("--help"), /project/);
	let doctorOutput;
	try {
		doctorOutput = await cli("doctor", "--json");
	} catch (error) {
		// Missing screen permission is legitimate; missing runtime dependencies are not.
		assert.equal(error.code, 1);
		doctorOutput = error.stdout;
	}
	const doctor = JSON.parse(doctorOutput);
	assert.equal(doctor.checks.binaries.ok, true, JSON.stringify(doctor));
	assert.equal(doctor.exportReady, true);
	assert.equal(typeof doctor.checks.permissions.details.screenRecording, "boolean");

	// Installing is idempotent and must not replace another command.
	const home = path.join(temp, "home");
	await fs.mkdir(home);
	const installOptions = { ...options, env: { ...env, HOME: home } };
	await run(launcher, ["--install"], installOptions);
	await run(launcher, ["--install"], installOptions);
	const link = path.join(home, ".local/bin/recordly");
	assert.match((await run(link, ["--version"], options)).stdout, /recordly-cli/);
	await fs.unlink(link);
	await fs.writeFile(link, "existing command");
	await assert.rejects(run(launcher, ["--install"], installOptions));
	assert.equal(await fs.readFile(link, "utf8"), "existing command");

	await run(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=blue:s=320x180:r=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "input.mp4"], options);
	await fs.writeFile(path.join(temp, "input.recordly"), JSON.stringify({
		version: 2, videoPath: "input.mp4",
		editor: { clipRegions: [{ id: "main", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 }] },
	}));
	assert.equal(JSON.parse(await cli("project", "inspect", "input.recordly")).videoPath, path.join(temp, "input.mp4"));
	await fs.writeFile(path.join(temp, "plan.json"), JSON.stringify({ version: 1, operations: [] }));
	await cli("project", "apply", "input.recordly", "--plan", "plan.json", "-o", "output.recordly");
	assert.equal(JSON.parse(await cli("project", "validate", "output.recordly")).valid, true);
	const renders = await Promise.allSettled([
		cli("render", "output.recordly", "-o", "output.mp4", "--json"),
		cli("render", "output.recordly", "-o", "parallel.mp4", "--json"),
	]);
	for (const result of renders) {
		if (result.status === "rejected") throw result.reason;
	}
	assert.ok((await fs.stat(path.join(temp, "parallel.mp4"))).size > 0);
	const probe = JSON.parse((await run(path.join(binaryRoot, "ffprobe"), ["-v", "error", "-show_streams", "-show_format", "-of", "json", "output.mp4"], options)).stdout);
	assert.ok(probe.streams.some((stream) => stream.codec_type === "video"));
	assert.ok(probe.streams.some((stream) => stream.codec_type === "audio"));
	assert.ok(Math.abs(Number(probe.format.duration) - 1) < 0.15);
	await cli("project", "preview", "output.recordly", "--at", "500", "-o", "preview.png");
	assert.equal((await fs.readFile(path.join(temp, "preview.png"))).subarray(1, 4).toString(), "PNG");

	const mcpOutput = await new Promise((resolve, reject) => {
		const child = spawn(launcher, ["mcp"], options);
		let stdout = "", stderr = "";
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.on("error", reject);
		child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
		child.stdin.end(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
	});
	const responses = mcpOutput.trim().split("\n").map((line) => JSON.parse(line));
	assert.ok(responses.find((response) => response.id === 2)?.result.tools.some((tool) => tool.name === "recordly_project_apply"));
	console.log("[packaged-cli] PASS: isolated runtime, doctor, command installation, project inspect/apply/validate, concurrent MP4 audio/video export, PNG preview, MCP.");
} catch (error) {
	for (const name of await fs.readdir(temp)) {
		if (name.endsWith(".report.json")) {
			console.error(`[packaged-cli] ${name}: ${await fs.readFile(path.join(temp, name), "utf8")}`);
		}
	}
	throw error;
} finally {
	await fs.rm(temp, { recursive: true, force: true });
}
