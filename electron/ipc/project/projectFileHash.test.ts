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
