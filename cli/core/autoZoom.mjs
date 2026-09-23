export function generateAutoZooms(telemetrySamples, markers = [], durationMs = 0) {
	const zoomRegions = [];
	let zoomIndex = 1;

	// 1. Convert Agent Action Markers into explicit zoom regions
	for (const marker of markers) {
		const centerTime = marker.timeMs;
		const startMs = Math.max(0, centerTime - 800);
		const endMs = Math.min(durationMs > 0 ? durationMs : centerTime + 2200, centerTime + 2200);
		const x = typeof marker.x === "number" ? marker.x : 0.5;
		const y = typeof marker.y === "number" ? marker.y : 0.5;

		zoomRegions.push({
			id: `zoom-marker-${zoomIndex++}`,
			startMs,
			endMs,
			focus: { x, y },
			depth: 1.6,
			source: "agent-marker",
			label: marker.action || "Action",
		});
	}

	if (!Array.isArray(telemetrySamples) || telemetrySamples.length === 0) {
		return zoomRegions;
	}

	// 2. Identify interaction clicks from cursor telemetry
	const clicks = telemetrySamples.filter(
		(s) => s.interactionType === "click" || s.interactionType === "double-click",
	);

	let lastZoomEnd = 0;
	for (const click of clicks) {
		// Avoid overlap with existing zooms or recent clicks (keep at least 2.5s distance)
		if (click.timeMs < lastZoomEnd + 800) {
			continue;
		}

		// Also check conflict with agent markers
		const conflict = zoomRegions.some(
			(z) => Math.abs(z.startMs + 800 - click.timeMs) < 2000,
		);
		if (conflict) continue;

		const startMs = Math.max(0, click.timeMs - 600);
		const endMs = click.timeMs + 1800;

		zoomRegions.push({
			id: `zoom-click-${zoomIndex++}`,
			startMs,
			endMs,
			focus: { x: click.cx, y: click.cy },
			depth: 1.5,
			source: "cursor-click",
		});

		lastZoomEnd = endMs;
	}

	// Sort zooms chronologically
	zoomRegions.sort((a, b) => a.startMs - b.startMs);
	return zoomRegions;
}
