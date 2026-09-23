import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
import { spawn } from "node:child_process";
import { renderProject } from "./headlessRenderer.mjs";

let dir, outputPath, child;
beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-render-test-"));
	outputPath = path.join(dir, "out.mp4");
	child = new EventEmitter();
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.kill = vi.fn(() => child.emit("close", null, "SIGKILL"));
});
afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
});
function run(action = async () => {}) {
	spawn.mockImplementation(() => {
		setImmediate(async () => {
			await action();
			child.emit("close", 0, null);
		});
		return child;
	});
	return renderProject({ inputPath: "input.mp4", outputPath });
}
async function report(overrides = {}) {
	await fs.writeFile(`${outputPath}.report.json`, JSON.stringify({
		success: true, phase: "saved", format: "mp4", outputPath, ...overrides,
	}));
}
it("rejects a clean exit without a report or MP4", async () => {
	await expect(run()).rejects.toThrow(/report/i);
});
it("propagates a failed report despite exit code zero", async () => {
	await expect(run(() => report({ success: false, phase: "ready", error: "Not ready" }))).rejects.toThrow(/Not ready/);
});
it.each([null, [], { success: "true" }, { phase: "save" }, { format: "gif" }, { outputPath: "/other.mp4" }])("rejects invalid or inconsistent report %j", async (value) => {
	await expect(run(async () => {
		await fs.writeFile(outputPath, "video");
		if (value === null || Array.isArray(value)) await fs.writeFile(`${outputPath}.report.json`, JSON.stringify(value));
		else await report(value);
	})).rejects.toThrow(/report/i);
});
it("rejects malformed JSON", async () => {
	await expect(run(() => fs.writeFile(`${outputPath}.report.json`, "{"))).rejects.toThrow(/report/i);
});
it.each(["missing", "empty", "directory"])("rejects %s output despite success report", async (kind) => {
	await expect(run(async () => {
		await report();
		if (kind === "empty") await fs.writeFile(outputPath, "");
		if (kind === "directory") await fs.mkdir(outputPath);
	})).rejects.toThrow(/output/i);
});
it("rejects stale artifacts", async () => {
	await fs.writeFile(outputPath, "old video");
	await report();
	await expect(run()).rejects.toThrow(/report.*updated/i);
});
it("rejects stale output even with a new report", async () => {
	await fs.writeFile(outputPath, "old video");
	await expect(run(() => report())).rejects.toThrow(/output.*updated/i);
});
it("accepts a new nonempty output and saved report", async () => {
	await expect(run(async () => {
		await fs.writeFile(outputPath, "video");
		await report();
	})).resolves.toMatchObject({ success: true, outputPath });
});
it("rejects signals", async () => {
	await expect(run(async () => child.emit("close", null, "SIGTERM"))).rejects.toThrow(/SIGTERM/);
});
it("rejects spawn errors", async () => {
	await expect(run(async () => child.emit("error", new Error("ENOENT")))).rejects.toThrow(/ENOENT/);
});
it("reports timeouts", async () => {
	spawn.mockImplementation(() => child);
	await expect(renderProject({ inputPath: "input.mp4", outputPath, timeoutMs: 10 })).rejects.toThrow(/timed out/i);
});
