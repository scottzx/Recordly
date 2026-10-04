import { spawnSync } from "node:child_process";
import path from "node:path";
import { collectCodeSigningMetadataErrors } from "./macos-distribution-policy.mjs";

// Preserve the identity used by Recordly's existing macOS permission grants.
const recordlyTeamId = "3HJ3R6SXAL";

export default function afterSign(context) {
	if (context.electronPlatformName !== "darwin") {
		return;
	}

	const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
	for (const args of [
		["--verify", "--deep", "--strict", appPath],
		["--display", "--verbose=4", appPath],
	]) {
		const result = spawnSync("codesign", args, { encoding: "utf8" });
		const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
		if (result.error || result.status !== 0) {
			throw new Error(
				`Recordly signing verification failed: ${result.error?.message ?? details}`,
			);
		}
		if (args[0] === "--display") {
			const errors = collectCodeSigningMetadataErrors(details, recordlyTeamId);
			if (errors.length > 0) {
				throw new Error(
					`Refusing to package Recordly with a different signing identity:\n${errors.join("\n")}`,
				);
			}
		}
	}
}
