import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { syncVersion, validateVersion } from "../scripts/sync-version.mjs";

const pkg = { version: "2.0.0" };
const lock = { version: "2.0.0", packages: { "": { version: "2.0.0" } } };
const releases = [
	{
		version: "2.0.0",
		date: "2026-09-23",
		title: "素材库",
		changes: ["录制与剪辑分离"],
		notes: [],
	},
];
const directories: string[] = [];
afterEach(() => {
	for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("independent fork versions", () => {
	it("rejects stale lockfiles and release entries", () => {
		expect(() => validateVersion(pkg, { ...lock, version: "1.5.0" }, releases)).toThrow(
			"不一致",
		);
		expect(() => validateVersion(pkg, lock, [{ ...releases[0], version: "1.5.0" }])).toThrow(
			"首条",
		);
		expect(() => validateVersion(pkg, lock, [...releases, ...releases])).toThrow("重复");
		expect(() => validateVersion(pkg, lock, [{ ...releases[0], changes: [] }])).toThrow("缺少");
	});
	it("generates notes from the local history and detects stale generated files without rewriting them", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "recordly-version-"));
		directories.push(root);
		for (const [file, value] of Object.entries({
			"package.json": pkg,
			"package-lock.json": lock,
			"releases.json": releases,
		}))
			fs.writeFileSync(path.join(root, file), JSON.stringify(value));
		expect(syncVersion(root)).toBe("2.0.0");
		expect(syncVersion(root, true)).toBe("2.0.0");
		expect(fs.readFileSync(path.join(root, "release-notes.md"), "utf8")).toContain(
			"录制与剪辑分离",
		);
		fs.writeFileSync(path.join(root, "release-notes.md"), "stale");
		expect(() => syncVersion(root, true)).toThrow("未同步");
		expect(fs.readFileSync(path.join(root, "release-notes.md"), "utf8")).toBe("stale");
	});
	it("previews releases against the fork with curated notes and rejects mismatched tags", () => {
		const preview = JSON.parse(
			execFileSync(
				process.execPath,
				[
					"scripts/create-release.mjs",
					"--tag",
					`v${JSON.parse(fs.readFileSync("package.json", "utf8")).version}`,
					"--dry-run",
				],
				{ encoding: "utf8" },
			),
		);
		expect(preview.repository).toBe("scottzx/Recordly");
		expect(preview.notes).toContain(
			JSON.parse(fs.readFileSync("releases.json", "utf8"))[0].title,
		);
		expect(() =>
			execFileSync(
				process.execPath,
				["scripts/create-release.mjs", "--tag", "v1.5.0", "--dry-run"],
				{ stdio: "pipe" },
			),
		).toThrow();
		const builder = fs.readFileSync("electron-builder.json5", "utf8");
		expect(builder).toContain('"owner": "scottzx"');
		expect(builder).not.toContain('"owner": "webadderall"');
	});
});
