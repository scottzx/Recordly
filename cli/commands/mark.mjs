import { markAction } from "../core/capture.mjs";

export async function runMark(args = {}) {
	const sessionId = args.session || args["session-id"];
	const action = args.action || "action";
	const target = args.target || null;
	const x = args.x ? Number.parseFloat(args.x) : null;
	const y = args.y ? Number.parseFloat(args.y) : null;

	try {
		const res = await markAction(sessionId, { action, target, x, y });
		if (args.json) {
			console.log(JSON.stringify(res, null, 2));
		} else {
			console.log(`[Recordly] Marked action: "${action}" (target: ${target || "none"})`);
		}
	} catch (err) {
		if (args.json) {
			console.log(JSON.stringify({ status: "error", error: err.message }));
		} else {
			console.error(`[Recordly] Error marking action: ${err.message}`);
		}
		process.exit(1);
	}
}
