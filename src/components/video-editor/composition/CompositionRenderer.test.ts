import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompositionProject } from "../../../../shared/composition";

vi.mock("@/lib/exporter/modernFrameRenderer", () => ({
	FrameRenderer: class {
		async initialize() {}
	},
}));
vi.mock("@/lib/exporter/muxer", () => ({ VideoMuxer: class {} }));
vi.mock("@/lib/exporter/annotationRenderer", () => ({
	preloadAnnotationAssets: vi.fn(),
	renderAnnotations: vi.fn(),
}));
vi.mock("../projectPersistence", () => ({
	normalizeProjectEditor: (editor: unknown) => editor,
	resolveVideoUrl: async (path: string) => path,
}));
import { CompositionRenderer } from "./CompositionRenderer";

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function setup() {
	const decoding = deferred();
	const started = deferred();
	class Canvas {
		width = 0;
		height = 0;
		context = {
			fillRect: vi.fn(),
			drawImage: vi.fn(),
			save: vi.fn(),
			restore: vi.fn(),
			beginPath: vi.fn(),
			roundRect: vi.fn(),
			clip: vi.fn(),
		};
		getContext() {
			return this.context;
		}
	}
	class Image {
		naturalWidth = 100;
		naturalHeight = 100;
		decode() {
			started.resolve();
			return decoding.promise;
		}
	}
	vi.stubGlobal("document", { createElement: () => new Canvas() });
	vi.stubGlobal("HTMLCanvasElement", Canvas);
	vi.stubGlobal("HTMLImageElement", Image);
	vi.stubGlobal("Image", Image);
	const project = {
		version: 3,
		videoPath: "main.mp4",
		editor: {},
		composition: {
			width: 100,
			height: 100,
			fps: 30,
			broll: [],
			assets: [{ id: "image", path: "image.png", kind: "image" }],
			shots: [
				{ id: "card", kind: "card", template: "image", assetId: "image", durationMs: 3000 },
			],
		},
	} as CompositionProject;
	const renderer = new CompositionRenderer(project);
	const visible = renderer.canvas.getContext("2d")!;
	return { renderer, visible, decoding, started };
}
afterEach(() => vi.unstubAllGlobals());
describe("composition frame presentation", () => {
	it("keeps the displayed frame intact while decoding, then publishes only a complete frame", async () => {
		const { renderer, visible, decoding, started } = setup();
		const frame = renderer.render(100);
		await started.promise;
		expect(visible.fillRect).not.toHaveBeenCalled();
		expect(visible.drawImage).not.toHaveBeenCalled();
		decoding.resolve();
		expect(await frame).toBe(renderer.canvas);
		expect(visible.drawImage).toHaveBeenCalledTimes(1);
	});
	it("serializes playback and refresh requests instead of exposing interleaved frames", async () => {
		const { renderer, visible, decoding, started } = setup();
		const first = renderer.render(100);
		await started.promise;
		const second = renderer.render(200);
		expect(visible.drawImage).not.toHaveBeenCalled();
		decoding.resolve();
		await Promise.all([first, second]);
		expect(visible.drawImage).toHaveBeenCalledTimes(2);
	});
	it("retains the displayed frame on decode failure and allows the next render to recover", async () => {
		const { renderer, visible, decoding, started } = setup();
		const frame = renderer.render(100);
		await started.promise;
		decoding.reject(new Error("decode failed"));
		await expect(frame).rejects.toThrow("decode failed");
		expect(visible.drawImage).not.toHaveBeenCalled();
		// Outside the sequence is a complete background frame; it needs no decoder.
		await renderer.render(4000);
		expect(visible.drawImage).toHaveBeenCalledTimes(1);
	});
});

describe("presenter source duration", () => {
	it.each([
		"presenter",
		"pip",
		"split",
	] as const)("accepts a shorter webcam in %s layout", async (mode) => {
		setup();
		const project = {
			version: 3,
			videoPath: "main.mp4",
			editor: { webcam: { sourcePath: "webcam.mp4", timeOffsetMs: 100 } },
			composition: {
				width: 100,
				height: 100,
				fps: 30,
				assets: [],
				broll: [],
				shots: [
					{
						id: "clip-1",
						kind: "main",
						sourceStartMs: 0,
						sourceEndMs: 3000,
						speed: 1,
						layout: { mode },
					},
				],
			},
		} as unknown as CompositionProject;
		vi.stubGlobal("window", {
			electronAPI: {
				compositionProbe: vi.fn(async (file: string) => ({
					durationMs: file === "main.mp4" ? 3000 : 2000,
					width: 100,
					height: 100,
					hasAudio: false,
				})),
				getCursorTelemetry: vi.fn(async () => ({ success: false })),
			},
		});
		const renderer = new CompositionRenderer(project);
		const sample = { displayWidth: 100, displayHeight: 100, close: vi.fn() };
		// Replace decoding only; exercise real initialization and media validation.
		vi.spyOn(
			renderer as unknown as { sample: () => Promise<typeof sample> },
			"sample",
		).mockResolvedValue(sample);
		await expect(renderer.initialize()).resolves.toBeUndefined();
	});
});
