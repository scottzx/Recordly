import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function renderRelease(entry) {
	return `# Recordly ${entry.version}\n\n${entry.date} · ${entry.title}\n\n${entry.changes.map((item) => `- ${item}`).join("\n")}\n${entry.notes?.length ? `\n## 说明\n\n${entry.notes.map((item) => `- ${item}`).join("\n")}\n` : ""}`;
}

export function validateVersion(pkg, lock, releases) {
	if (pkg.version !== lock.version || pkg.version !== lock.packages?.[""]?.version)
		throw new Error("package.json 与 package-lock.json 的版本号不一致");
	if (!releases.length || releases[0].version !== pkg.version)
		throw new Error("releases.json 首条记录必须对应当前版本");
	const seen = new Set();
	for (const entry of releases) {
		if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(entry.version) || seen.has(entry.version))
			throw new Error("版本号格式错误或重复");
		seen.add(entry.version);
		if (
			!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
			!entry.title?.trim() ||
			!entry.changes?.length ||
			entry.changes.some((item) => !item.trim())
		)
			throw new Error(`${entry.version} 缺少日期、标题或更新内容`);
	}
}

export function syncVersion(root, check = false) {
	const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
	const pkg = read("package.json"),
		lock = read("package-lock.json"),
		releases = read("releases.json");
	validateVersion(pkg, lock, releases);
	const outputs = {
		"release-notes.md": renderRelease(releases[0]),
		"CHANGELOG.md": `# Recordly 独立版本更新记录\n\n本记录从 scottzx/Recordly 2.0.0 开始，仅记录本分支的版本变化。原项目作者和许可信息保留在仓库中。\n\n${releases
			.map((entry) =>
				renderRelease(entry)
					.replace(/^# /, "## ")
					.replace(/\n## 说明/g, "\n### 说明"),
			)
			.join("\n")}`,
	};
	for (const [file, contents] of Object.entries(outputs)) {
		const target = path.join(root, file);
		if (check) {
			if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== contents)
				throw new Error(`${file} 未同步，请运行 npm run version:sync`);
		} else fs.writeFileSync(target, contents);
	}
	return pkg.version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		if (process.argv.slice(2).some((arg) => arg !== "--check"))
			throw new Error("Usage: node scripts/sync-version.mjs [--check]");
		const version = syncVersion(
			path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
			process.argv.includes("--check"),
		);
		console.log(
			`Version ${version}: release notes ${process.argv.includes("--check") ? "verified" : "generated"}.`,
		);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
