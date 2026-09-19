import fs from "node:fs/promises";

export function parseSrtTimestamp(value) {
	const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
	if (!match) return null;
	const [, hours, minutes, seconds, milliseconds] = match;
	return (
		Number(hours) * 3600000 +
		Number(minutes) * 60000 +
		Number(seconds) * 1000 +
		Number(milliseconds)
	);
}

export function parseSrtContent(content) {
	return content
		.split(/\r?\n\r?\n/)
		.map((block, index) => {
			const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
			const timingLine = lines.find((l) => l.includes("-->"));
			if (!timingLine) return null;

			const [rawStart, rawEnd] = timingLine.split("-->").map((p) => p.trim());
			const startMs = parseSrtTimestamp(rawStart);
			const endMs = parseSrtTimestamp(rawEnd);
			if (startMs == null || endMs == null || endMs <= startMs) return null;

			const textLines = lines.filter((l) => l !== timingLine && !/^\d+$/.test(l));
			const text = textLines.join(" ").trim();
			if (!text) return null;

			return {
				id: `caption-${index + 1}`,
				startMs,
				endMs,
				text,
			};
		})
		.filter(Boolean);
}

export async function loadCaptionsFromFile(filePath) {
	const content = await fs.readFile(filePath, "utf-8");
	if (filePath.endsWith(".json")) {
		const parsed = JSON.parse(content);
		return Array.isArray(parsed) ? parsed : parsed.cues || [];
	}
	return parseSrtContent(content);
}
