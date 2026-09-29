import { describe, expect, it } from "vitest";
import {
	clearProjectFileHashes,
	hashProjectContents,
	isSelfProjectWrite,
	noteSelfProjectWrite,
} from "./projectFileHash";

describe("projectFileHash", () => {
	it("treats our own writes as self writes and later edits as external", () => {
		clearProjectFileHashes();
		const projectPath = "/tmp/recordly-project-hash.recordly";
		const original = '{"autoCaptions":[]}';
		const updated = '{"autoCaptions":[{"id":"caption-1","text":"hello"}]}';

		noteSelfProjectWrite(projectPath, original);
		expect(isSelfProjectWrite(projectPath, original)).toBe(true);
		expect(isSelfProjectWrite(projectPath, updated)).toBe(false);
		expect(hashProjectContents(original)).not.toBe(hashProjectContents(updated));
	});
});

describe("loaded project protection", () => {
	it("does not let a watcher notification authorize overwriting external changes", async () => {
		const {
			noteLoadedProject,
			assertLoadedProjectUnchanged,
			rememberProjectContents,
			clearProjectFileHashes,
		} = await import("./projectFileHash");
		clearProjectFileHashes();
		noteLoadedProject("/tmp/protected.recordly", "original");
		rememberProjectContents("/tmp/protected.recordly", "external");
		expect(() => assertLoadedProjectUnchanged("/tmp/protected.recordly", "external")).toThrow(
			"STALE_BASE",
		);
		noteLoadedProject("/tmp/protected.recordly", "external");
		expect(() =>
			assertLoadedProjectUnchanged("/tmp/protected.recordly", "external"),
		).not.toThrow();
		clearProjectFileHashes();
	});
});
