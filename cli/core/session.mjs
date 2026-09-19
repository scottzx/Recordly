import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, getSessionsDir } from "./paths.mjs";

export async function saveSession(sessionData) {
	const dir = await ensureDir(getSessionsDir());
	const filePath = path.join(dir, `${sessionData.sessionId}.json`);
	await fs.writeFile(filePath, JSON.stringify(sessionData, null, 2), "utf-8");
	return filePath;
}

export async function getSession(sessionId) {
	const dir = getSessionsDir();
	const filePath = path.join(dir, `${sessionId}.json`);
	try {
		const raw = await fs.readFile(filePath, "utf-8");
		return JSON.parse(raw);
	} catch (e) {
		return null;
	}
}

export async function getLatestActiveSession() {
	const sessions = await listSessions();
	const active = sessions.filter((s) => s.status === "recording");
	if (active.length === 0) return null;
	active.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
	return active[0];
}

export async function listSessions() {
	const dir = await ensureDir(getSessionsDir());
	const files = await fs.readdir(dir);
	const sessions = [];
	for (const file of files) {
		if (!file.endsWith(".json")) continue;
		try {
			const raw = await fs.readFile(path.join(dir, file), "utf-8");
			sessions.push(JSON.parse(raw));
		} catch {
			// ignore corrupt files
		}
	}
	return sessions;
}

export async function removeSession(sessionId) {
	const dir = getSessionsDir();
	const filePath = path.join(dir, `${sessionId}.json`);
	try {
		await fs.rm(filePath, { force: true });
	} catch {
		// ignore
	}
}
