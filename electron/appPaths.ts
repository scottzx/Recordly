import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { app } from "electron";

if (process.env.RECORDLY_SMOKE_EXPORT === "1") {
	// CLI exports must coexist with the GUI and with other exports.
	const exportUserDataPath = mkdtempSync(path.join(os.tmpdir(), "recordly-export-"));
	app.setPath("userData", exportUserDataPath);
	app.setPath("sessionData", path.join(exportUserDataPath, "session"));
	app.once("quit", () => {
		rmSync(exportUserDataPath, { recursive: true, force: true });
	});
} else if (process.env["VITE_DEV_SERVER_URL"]) {
	const devUserDataPath = path.join(app.getPath("appData"), "Recordly-dev");
	app.setPath("userData", devUserDataPath);
	app.setPath("sessionData", path.join(devUserDataPath, "session"));
}

export const USER_DATA_PATH = app.getPath("userData");
export const RECORDINGS_DIR = path.join(USER_DATA_PATH, "recordings");
