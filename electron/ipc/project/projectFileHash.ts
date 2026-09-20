import { createHash } from "node:crypto";
import path from "node:path";

const selfWriteHashes = new Map<string, string>();

export function normalizeWatchedProjectPath(projectPath: string): string {
	const resolved = path.resolve(projectPath);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function hashProjectContents(contents: string): string {
	return createHash("sha256").update(contents).digest("hex");
}

export function noteSelfProjectWrite(projectPath: string, contents: string) {
	selfWriteHashes.set(normalizeWatchedProjectPath(projectPath), hashProjectContents(contents));
}

export function rememberProjectContents(projectPath: string, contents: string) {
	noteSelfProjectWrite(projectPath, contents);
}

export function isSelfProjectWrite(projectPath: string, contents: string): boolean {
	return (
		selfWriteHashes.get(normalizeWatchedProjectPath(projectPath)) ===
		hashProjectContents(contents)
	);
}

export function clearProjectFileHashes() {
	selfWriteHashes.clear();
}
