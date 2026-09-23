import { type FSWatcher, watch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { BrowserWindow } from "electron";
import {
	isSelfProjectWrite,
	normalizeWatchedProjectPath,
	rememberProjectContents,
} from "./projectFileHash";

const WATCH_DEBOUNCE_MS = 250;

let watcher: FSWatcher | null = null;
let watchedPath: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function broadcastProjectFileChanged(projectPath: string) {
	for (const window of BrowserWindow.getAllWindows()) {
		if (window.isDestroyed()) continue;
		if (!window.webContents.getURL().includes("windowType=editor")) continue;
		window.webContents.send("project-file-changed", { path: projectPath });
	}
}

function stopWatcher() {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	if (watcher) {
		watcher.close();
		watcher = null;
	}
	watchedPath = null;
}

async function inspectWatchedProject() {
	if (!watchedPath) return;

	let contents: string;
	try {
		contents = await fs.readFile(watchedPath, "utf-8");
	} catch {
		return;
	}

	if (isSelfProjectWrite(watchedPath, contents)) {
		return;
	}

	rememberProjectContents(watchedPath, contents);
	broadcastProjectFileChanged(watchedPath);
}

function scheduleInspect() {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		void inspectWatchedProject();
	}, WATCH_DEBOUNCE_MS);
}

export function stopProjectFileWatch() {
	stopWatcher();
}

export async function syncProjectFileWatch(projectPath: string | null) {
	const nextPath = projectPath ? normalizeWatchedProjectPath(projectPath) : null;
	if (watchedPath === nextPath) {
		return;
	}

	stopWatcher();
	if (!nextPath) {
		return;
	}

	watchedPath = nextPath;
	try {
		rememberProjectContents(nextPath, await fs.readFile(nextPath, "utf-8"));
	} catch {
		// The project may not exist yet; still watch the directory for the first write.
	}

	const directory = path.dirname(nextPath);
	const fileName = path.basename(nextPath);
	watcher = watch(directory, (_event, filename) => {
		if (!filename) return;
		if (filename.toString() !== fileName) return;
		scheduleInspect();
	});
	watcher.on("error", () => {
		stopWatcher();
	});
}
