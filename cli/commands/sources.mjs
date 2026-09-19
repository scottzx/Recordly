import { listSources } from "../core/sources.mjs";

export async function runSources(args = {}) {
	const sources = await listSources();
	if (args.json) {
		console.log(JSON.stringify(sources, null, 2));
		return;
	}

	console.log("\n=== Displays ===");
	for (const d of sources.displays) {
		console.log(`  [${d.id}] ${d.name}`);
	}

	console.log("\n=== Windows ===");
	for (const w of sources.windows) {
		console.log(`  [${w.id}] ${w.name} (${w.width}x${w.height} at ${w.x},${w.y})`);
	}
	console.log("");
}
