import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSync } = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync }));

import afterSign from "../scripts/verify-macos-signing.mjs";

const context = {
	electronPlatformName: "darwin",
	appOutDir: "/tmp/mac-arm64",
	packager: { appInfo: { productFilename: "Recordly" } },
};

const developerIdDetails = `
Identifier=dev.recordly.app
CodeDirectory v=20500 flags=0x10000(runtime)
Authority=Developer ID Application: XIAOFENG ZENG (3HJ3R6SXAL)
Timestamp=Oct 4, 2026 at 10:00:00
TeamIdentifier=3HJ3R6SXAL
`;

beforeEach(() => {
	spawnSync.mockReset();
	spawnSync.mockReturnValue({ status: 0, stdout: "", stderr: developerIdDetails });
});

describe("macOS signing hook", () => {
	it("accepts the existing Recordly Developer ID identity", () => {
		expect(() => afterSign(context)).not.toThrow();
		expect(spawnSync).toHaveBeenCalledWith(
			"codesign",
			["--verify", "--deep", "--strict", "/tmp/mac-arm64/Recordly.app"],
			{ encoding: "utf8" },
		);
	});

	it("rejects an otherwise valid ad-hoc signature before creating artifacts", () => {
		spawnSync.mockReturnValue({
			status: 0,
			stdout: "",
			stderr: "Identifier=dev.recordly.app\nSignature=adhoc\nTeamIdentifier=not set",
		});
		expect(() => afterSign(context)).toThrow(/not Developer ID Application/);
	});

	it("rejects a Developer ID signature from a different team", () => {
		spawnSync.mockReturnValue({
			status: 0,
			stdout: "",
			stderr: developerIdDetails.replaceAll("3HJ3R6SXAL", "A1B2C3D4E5"),
		});
		expect(() => afterSign(context)).toThrow(/unexpected TeamIdentifier/);
	});

	it("rejects a broken nested signature", () => {
		spawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "invalid nested signature" });
		expect(() => afterSign(context)).toThrow(/invalid nested signature/);
	});

	it("leaves Windows and Linux packaging alone", () => {
		afterSign({ ...context, electronPlatformName: "win32" });
		afterSign({ ...context, electronPlatformName: "linux" });
		expect(spawnSync).not.toHaveBeenCalled();
	});
});
