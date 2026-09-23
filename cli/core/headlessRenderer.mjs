import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getRendererLaunch } from "./paths.mjs";

async function artifactStat(filePath) {
	try {
		return await fs.stat(filePath, { bigint: true });
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

function unchanged(before, after) {
	return before && after && before.ino === after.ino &&
		before.size === after.size && before.mtimeNs === after.mtimeNs &&
		before.ctimeNs === after.ctimeNs;
}

export async function renderProject(options) {
	const {
		projectPath,
		inputPath,
		outputPath: requestedOutputPath,
		quality = "good",
		fps = 60,
		encodingMode = "balanced",
		timeoutMs = 180000,
		onProgress,
        compositionRange,
	} = options;

	const outputPath = path.resolve(requestedOutputPath);
	const reportPath = `${outputPath}.report.json`;
	const [previousOutput, previousReport] = await Promise.all([
		artifactStat(outputPath), artifactStat(reportPath),
	]);
	const launch = getRendererLaunch();
	const env = {
		...launch.env,
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

	if (compositionRange) env.RECORDLY_COMPOSITION_RANGE = JSON.stringify(compositionRange);
	const child = spawn(launch.executable, launch.args, {
		cwd: process.cwd(),
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

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGKILL");
	}, timeoutMs);

	const { exitCode, signal } = await new Promise((resolve, reject) => {
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", (code, signal) => {
			clearTimeout(timer);
			resolve({ exitCode: code, signal });
		});
	});

	if (timedOut) {
		throw new Error(`Renderer timed out after ${timeoutMs}ms. Details: ${stderr || stdout}`);
	}
	if (exitCode !== 0 || signal) {
		throw new Error(`Renderer exited with code ${exitCode}${signal ? ` (signal ${signal})` : ""}. Details: ${stderr || stdout}`);
	}

	const currentReport = await artifactStat(reportPath);
	if (!currentReport?.isFile() || unchanged(previousReport, currentReport)) {
		throw new Error(`Export report missing or not updated by this render: ${reportPath}`);
	}
	let report;
	try {
		report = JSON.parse(await fs.readFile(reportPath, "utf-8"));
	} catch (error) {
		throw new Error(`Cannot read export report ${reportPath}: ${error.message}`);
	}
	if (report?.success !== true || report.phase !== "saved" || report.format !== "mp4" ||
		typeof report.outputPath !== "string" || path.resolve(report.outputPath) !== outputPath) {
		throw new Error(`Export report does not confirm a saved MP4: ${report?.error || "invalid status, format, or output path"}`);
	}
	const output = await artifactStat(outputPath);
	if (!output?.isFile() || output.size === 0n || unchanged(previousOutput, output)) {
		throw new Error(`Export output missing, empty, or not updated by this render: ${outputPath}`);
	}

	return {
		success: true,
		outputPath,
		report,
	};
}
