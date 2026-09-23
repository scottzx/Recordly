import { checkDoctor } from "../core/doctor.mjs";

export async function runDoctor(args = {}) {
	const result = checkDoctor();
	if (args.json) {
		console.log(JSON.stringify(result, null, 2));
		process.exit(result.healthy ? 0 : 1);
	}

	console.log("\n=== Recordly Environment & Permission Diagnostics ===\n");
	console.log(`- ${result.checks.platform.name}: ${result.checks.platform.ok ? "✅ PASS" : "❌ FAIL"} (${result.checks.platform.details})`);
	
	console.log(`- ${result.checks.binaries.name}: ${result.checks.binaries.ok ? "✅ PASS" : "❌ FAIL"}`);
	for (const [bin, ok] of Object.entries(result.checks.binaries.details)) {
		console.log(`    ${ok ? "✓" : "✗"} ${bin}`);
	}

	console.log(`- ${result.checks.permissions.name}: ${result.checks.permissions.ok ? "✅ PASS" : "❌ FAIL"}`);
	for (const [perm, ok] of Object.entries(result.checks.permissions.details)) {
		console.log(`    ${ok ? "✓" : "✗"} ${perm}`);
	}

	if (result.healthy) {
		console.log("\n✅ All systems ready for CLI & Agent automation.\n");
		process.exit(0);
	} else {
		console.log("\n⚠️  Some checks failed. Please check permissions or run build:native-helpers.\n");
		process.exit(1);
	}
}
