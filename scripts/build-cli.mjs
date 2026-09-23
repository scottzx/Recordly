import { build } from "esbuild";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
await build({
	entryPoints: ["cli/bin/recordly.mjs", "cli/daemon/recordingDaemon.mjs"],
	outbase: "cli",
	outdir: "dist-cli",
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
});
await copyFile("cli/recordly", "dist-cli/recordly");
await chmod("dist-cli/recordly", 0o755);

if (process.platform === "darwin") {
	const arch = process.arch;
	const ffprobe = require("@ffprobe-installer/ffprobe").path;
	execFileSync("xcrun", ["lipo", ffprobe, "-verify_arch", arch === "arm64" ? "arm64" : "x86_64"]);
	const destination = path.join("electron/native/bin", `darwin-${arch}`);
	await mkdir(destination, { recursive: true });
	await copyFile(ffprobe, path.join(destination, "ffprobe"));
	await chmod(path.join(destination, "ffprobe"), 0o755);
}
console.log("[build-cli] Bundled CLI, recording daemon, launcher and native FFprobe.");
