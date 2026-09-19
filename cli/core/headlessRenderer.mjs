import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getElectronBinaryPath, repoRoot } from "./paths.mjs";

export async function renderProject(options) {
	const {
		projectPath,
		inputPath,
		outputPath,
		quality = "good",
		fps = 60,
		encodingMode = "balanced",
		timeoutMs = 180000,
		onProgress,
	} = options;

	const electronBin = getElectronBinaryPath();
	const env = {
		...process.env,
		RECORDLY_SMOKE_EXPORT: "1",
		RECORDLY_SMOKE_EXPORT_OUTPUT: outputPath,
		RECORDLY_SMOKE_EXPORT_QUALITY: quality,
		RECORDLY_SMOKE_EXPORT_FPS: String(fps),
		RECORDLY_SMOKE_EXPORT_ENCODING_MODE: encodingMode,
	};

	if (projectPath) {
		env.RECORDLY_SMOKE_EXPORT_PROJECT = path.resolve(projectPath);
	} else if (inputPath) {
		env.RECORDLY_SMOKE_EXPORT_INPUT = path.resolve(inputPath);
	} else {
		throw new Error("Either projectPath or inputPath must be provided for rendering.");
	}

	const child = spawn(electronBin, [repoRoot], {
		cwd: repoRoot,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});

	let stdout = "";
	let stderr = "";

	child.stdout.on("data", (chunk) => {
		const text = chunk.toString();
		stdout += text;
		if (onProgress) {
			onProgress({ stream: "stdout", text });
		}
	});

	child.stderr.on("data", (chunk) => {
		const text = chunk.toString();
		stderr += text;
		if (onProgress) {
			onProgress({ stream: "stderr", text });
		}
	});

	const timer = setTimeout(() => {
		child.kill("SIGKILL");
	}, timeoutMs);

	const exitCode = await new Promise((resolve) => {
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve(code);
		});
	});

	const reportPath = `${outputPath}.report.json`;
	let report = null;
	try {
		const raw = await fs.readFile(reportPath, "utf-8");
		report = JSON.parse(raw);
	} catch {
		// Report not available or still writing
	}

	if (exitCode !== 0) {
		throw new Error(`Renderer exited with code ${exitCode}. Details: ${stderr || stdout}`);
	}

	return {
		success: true,
		outputPath,
		report,
	};
}
