import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncVersion } from "./sync-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function printUsage() {
	console.error(`Usage:
  node scripts/create-release.mjs --tag <tag> [--title <title>] [--notes <text> | --notes-file <path>] [--prerelease] [--draft] [--dry-run]

Examples:
  node scripts/create-release.mjs --tag v2.0.0 --dry-run
  node scripts/create-release.mjs --tag v2.1.0-beta.1 --prerelease
`);
}

function parseArgs(argv) {
	const parsed = {
		tag: "",
		title: "",
		notes: "",
		notesFile: "",
		prerelease: false,
		draft: false,
		dryRun: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case "--tag":
				parsed.tag = argv[++i] ?? "";
				break;
			case "--title":
				parsed.title = argv[++i] ?? "";
				break;
			case "--notes":
				parsed.notes = argv[++i] ?? "";
				break;
			case "--notes-file":
				parsed.notesFile = argv[++i] ?? "";
				break;
			case "--prerelease":
				parsed.prerelease = true;
				break;
			case "--draft":
				parsed.draft = true;
				break;
			case "--dry-run":
				parsed.dryRun = true;
				break;
			case "--help":
			case "-h":
				printUsage();
				process.exit(0);
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (!parsed.tag) {
		throw new Error("Missing required --tag argument");
	}

	if (parsed.notes && parsed.notesFile) {
		throw new Error("Use either --notes or --notes-file, not both");
	}

	return parsed;
}

function loadNotes({ notes, notesFile }) {
	if (notesFile) {
		return fs.readFileSync(notesFile, "utf8");
	}

	return notes || fs.readFileSync(path.join(root, "release-notes.md"), "utf8");
}

function resolveGhBinary() {
	const candidates = [
		process.env.GH_BIN,
		"gh",
		"/opt/homebrew/bin/gh",
		"/usr/local/bin/gh",
	].filter(Boolean);

	for (const candidate of candidates) {
		try {
			execFileSync(candidate, ["--version"], { stdio: "ignore" });
			return candidate;
		} catch {
			continue;
		}
	}

	throw new Error(
		"Could not find the GitHub CLI. Install `gh`, add it to PATH, or set GH_BIN to its full path.",
	);
}

try {
	const options = parseArgs(process.argv.slice(2));
	const version = syncVersion(root, true);
	if (options.tag !== `v${version}`)
		throw new Error(`Tag must match package version: v${version}`);
	if (version.includes("-") !== options.prerelease)
		throw new Error("Prerelease versions require --prerelease; stable versions must omit it.");
	const notes = loadNotes(options).trim();
	if (!notes) throw new Error("Release notes must not be empty");
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	const repository = new URL(pkg.repository.url).pathname
		.replace(/^\//, "")
		.replace(/\.git$/, "");
	const commandArgs = ["release", "create", options.tag, "--repo", repository, "--verify-tag"];

	if (options.title) {
		commandArgs.push("--title", options.title);
	}

	if (options.prerelease) {
		commandArgs.push("--prerelease");
	}

	if (options.draft) {
		commandArgs.push("--draft");
	}

	if (options.dryRun) {
		console.log(
			JSON.stringify(
				{
					repository,
					tag: options.tag,
					draft: options.draft,
					prerelease: options.prerelease,
					notes,
				},
				null,
				2,
			),
		);
	} else {
		const ghBinary = resolveGhBinary();
		const temp = fs.mkdtempSync(path.join(os.tmpdir(), "recordly-release-"));
		try {
			const notesFile = path.join(temp, "notes.md");
			fs.writeFileSync(notesFile, notes);
			execFileSync(ghBinary, [...commandArgs, "--notes-file", notesFile], {
				stdio: "inherit",
				cwd: root,
			});
		} finally {
			fs.rmSync(temp, { recursive: true, force: true });
		}
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	printUsage();
	process.exit(1);
}
