import { it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

it("resolves bundled resources independently of the checkout and preserves Node mode only for the CLI", async () => {
	const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "recordly app paths ")));
	try {
		const resources = path.join(directory, "Recordly.app/Contents/Resources");
		const cli = path.join(resources, "cli/core");
		const archive = path.join(resources, "app.asar");
		await fs.mkdir(cli, { recursive: true });
		await fs.mkdir(path.join(archive, "node_modules/ffmpeg-static"), { recursive: true });
		await fs.writeFile(path.join(archive, "package.json"), JSON.stringify({ version: "9.8.7" }));
		await fs.writeFile(path.join(archive, "node_modules/ffmpeg-static/index.js"), "module.exports = __dirname + '/ffmpeg';");
		await fs.copyFile(new URL("./paths.mjs", import.meta.url), path.join(cli, "paths.mjs"));
		const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", `
import * as paths from ${JSON.stringify(pathToFileURL(path.join(cli, "paths.mjs")).href)};
const launch = paths.getRendererLaunch();
console.log(JSON.stringify({
 packaged: paths.isPackagedCli, root: paths.repoRoot, cli: paths.cliRoot,
 helper: paths.getNativeBinaryPath("recordly-cursor-tracker"), ffmpeg: paths.getFfmpegPath(),
 version: paths.getCliVersion(),
 launch: { executable: launch.executable, args: launch.args, hasNodeMode: Object.hasOwn(launch.env, "ELECTRON_RUN_AS_NODE") },
 nodeMode: process.env.ELECTRON_RUN_AS_NODE,
}));`], { cwd: directory, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8" });
		const result = JSON.parse(stdout);
		expect(result.packaged).toBe(true);
		expect(result.root).toBe(archive);
		expect(result.cli).toBe(path.join(resources, "cli"));
		expect(result.helper).toContain("app.asar.unpacked/electron/native/bin/");
		expect(result.ffmpeg).toBe(path.join(resources, "app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg"));
		expect(result.version).toBe("9.8.7");
		expect(result.launch.args).toEqual([]);
		expect(result.launch.executable).toBe(process.execPath);
		expect(result.launch.hasNodeMode).toBe(false);
		expect(result.nodeMode).toBe("1");
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});
