import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getNativeBinaryPath } from "./paths.mjs";

const execFileAsync = promisify(execFile);

export async function listWindows() {
	const windowListBinary = getNativeBinaryPath("recordly-window-list");
	try {
		const { stdout } = await execFileAsync(windowListBinary, [], {
			timeout: 10000,
			maxBuffer: 10 * 1024 * 1024,
		});
		const raw = stdout.trim();
		if (!raw) return [];
		return JSON.parse(raw);
	} catch (error) {
		throw new Error(`Failed to list windows: ${error.message}`);
	}
}

export async function listSources() {
	const windows = await listWindows();
	// Deduplicate and extract displays from window list or fallback
	const displaySet = new Set();
	for (const win of windows) {
		if (win.display_id) {
			displaySet.add(win.display_id);
		}
	}
	const displays = Array.from(displaySet).map((id) => ({
		id: `display:${id}`,
		display_id: id,
		name: `Display ${id}`,
		type: "display",
	}));

	return {
		displays,
		windows: windows.map((w) => ({
			...w,
			type: "window",
		})),
	};
}
