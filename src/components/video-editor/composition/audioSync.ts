export function shouldSeekAudio(
	element: Pick<HTMLMediaElement, "currentTime" | "seeking" | "readyState">,
	target: number,
	now: number,
	lastSeek: number,
	force: boolean,
) {
	if (Math.abs(element.currentTime - target) < 0.05) return false;
	if (force) return true;
	// Let a pending seek and its decoder buffers settle before correcting drift.
	return !element.seeking && element.readyState >= 3 &&
		now - lastSeek >= 1000 && Math.abs(element.currentTime - target) > 0.35;
}
