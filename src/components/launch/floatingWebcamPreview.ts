export function canShowFloatingWebcamPreview(
	requested: boolean,
	hudOverlayMousePassthroughSupported: boolean | null,
): boolean {
	return requested && hudOverlayMousePassthroughSupported === true;
}

export function shouldStartWebcamStream({
	recording,
	webcamEnabled,
	floatingPreviewRequested,
	hudOverlayMousePassthroughSupported,
}: {
	recording: boolean;
	webcamEnabled: boolean;
	floatingPreviewRequested: boolean;
	hudOverlayMousePassthroughSupported: boolean | null;
}): boolean {
	return (
		recording &&
		webcamEnabled &&
		canShowFloatingWebcamPreview(floatingPreviewRequested, hudOverlayMousePassthroughSupported)
	);
}

export function canToggleFloatingWebcamPreview(
	hudOverlayMousePassthroughSupported: boolean | null,
): boolean {
	return hudOverlayMousePassthroughSupported !== false;
}
