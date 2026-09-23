import { ALL_FORMATS, Input, UrlSource, VideoSampleSink, type VideoSample } from "mediabunny";
import {
	sceneAt,
	durationMs,
	validateComposition,
	type CompositionProject,
	type Card,
} from "../../../../shared/composition";
import { FrameRenderer } from "@/lib/exporter/modernFrameRenderer";
import { VideoMuxer } from "@/lib/exporter/muxer";
import { preloadAnnotationAssets, renderAnnotations } from "@/lib/exporter/annotationRenderer";
import { normalizeProjectEditor, resolveVideoUrl } from "../projectPersistence";
import { buildActiveCaptionLayout } from "../captionLayout";
import {
	CAPTION_FONT_WEIGHT,
	CAPTION_LINE_HEIGHT,
	getCaptionPadding,
	getCaptionScaledFontSize,
	getCaptionTextMaxWidth,
	getCaptionWordVisualState,
} from "../captionStyle";
import type { CropRegion } from "../types";

type Media = { input: Input; sink: VideoSampleSink };
export class CompositionRenderer {
	readonly canvas = document.createElement("canvas");
	private readonly staging = document.createElement("canvas");
	private readonly output: CanvasRenderingContext2D;
	private pending: Promise<unknown> = Promise.resolve();
	private ctx: CanvasRenderingContext2D;
	private media = new Map<string, Media>();
	private images = new Map<string, HTMLImageElement>();
	private base: FrameRenderer | null = null;
	private annotations: Awaited<ReturnType<typeof preloadAnnotationAssets>> | undefined;
	private editor;
	constructor(readonly project: CompositionProject) {
		this.canvas.width = project.composition.width;
		this.canvas.height = project.composition.height;
		this.staging.width = this.canvas.width;
		this.staging.height = this.canvas.height;
		this.output = this.canvas.getContext("2d")!;
		this.ctx = this.staging.getContext("2d")!;
		this.editor = normalizeProjectEditor(project.editor);
	}
	private async open(file: string) {
		let m = this.media.get(file);
		if (!m) {
			const input = new Input({
				source: new UrlSource(await resolveVideoUrl(file)),
				formats: ALL_FORMATS,
			});
			const track = await input.getPrimaryVideoTrack();
			if (!track) {
				input.dispose();
				throw new Error(`No video track: ${file}`);
			}
			m = { input, sink: new VideoSampleSink(track) };
			this.media.set(file, m);
		}
		return m;
	}
	private async sample(file: string, timeMs: number) {
		const { sink } = await this.open(file);
		const sample = await sink.getSample(Math.max(0, timeMs) / 1000);
		if (!sample) throw new Error(`No frame at ${timeMs}ms: ${file}`);
		return sample;
	}
	private async image(file: string) {
		let image = this.images.get(file);
		if (!image) {
			image = new Image();
			image.src = await resolveVideoUrl(file);
			await image.decode();
			this.images.set(file, image);
		}
		return image;
	}
	async initialize() {
		const errors = validateComposition(this.project);
		if (errors.length) throw new Error(errors.join("\n"));
		const mainInfo = await window.electronAPI.compositionProbe(this.project.videoPath);
		for (const shot of this.project.composition.shots)
			if (shot.kind === "main" && shot.sourceEndMs > mainInfo.durationMs + 40)
				throw new Error(`Main source ends before clip ${shot.id}`);
		for (const asset of this.project.composition.assets) {
			const meta = await window.electronAPI.compositionProbe(asset.path);
			for (const b of this.project.composition.broll.filter((b) => b.assetId === asset.id))
				if (
					asset.kind === "video" &&
					b.sourceStartMs + b.durationMs * b.speed > meta.durationMs + 40
				)
					throw new Error(`B-roll source ends before clip ${b.id}`);
		}
		if (
			this.project.composition.shots.some(
				(s) => s.kind === "main" && s.layout.mode !== "screen",
			)
		) {
			const webcam = await window.electronAPI.compositionProbe(
				this.editor.webcam.sourcePath!,
			);
			for (const shot of this.project.composition.shots)
				if (
					shot.kind === "main" &&
					shot.layout.mode !== "screen" &&
					shot.sourceEndMs - this.editor.webcam.timeOffsetMs > webcam.durationMs + 40
				)
					throw new Error(`Presenter source ends before clip ${shot.id}`);
		}
		const main = await this.sample(this.project.videoPath, 0);
		const telemetry = await window.electronAPI.getCursorTelemetry(this.project.videoPath);
		this.base = new FrameRenderer({
			...this.editor,
			width: this.canvas.width,
			height: this.canvas.height,
			videoWidth: main.displayWidth,
			videoHeight: main.displayHeight,
			showShadow: this.editor.shadowIntensity > 0,
			webcam: undefined,
			webcamUrl: null,
			annotationRegions: [],
			autoCaptions: [],
			timelineEffects: false,
			cursorTelemetry: telemetry.success ? telemetry.samples : [],
			// Stateless camera evaluation keeps random-access preview and export identical.
			zoomClassicMode: true,
			zoomMotionBlur: 0,
			cursorMotionBlur: 0,
		});
		main.close();
		await this.base.initialize();
		this.annotations = await preloadAnnotationAssets(this.editor.annotationRegions);
	}
	private draw(
		source: CanvasImageSource | VideoSample,
		x: number,
		y: number,
		w: number,
		h: number,
		crop: CropRegion = { x: 0, y: 0, width: 1, height: 1 },
		mirror = false,
		roundness = 0,
	) {
		const ctx = this.ctx;
		const sw =
			source instanceof HTMLImageElement
				? source.naturalWidth
				: source instanceof HTMLCanvasElement
					? source.width
					: (source as VideoSample).displayWidth;
		const sh =
			source instanceof HTMLImageElement
				? source.naturalHeight
				: source instanceof HTMLCanvasElement
					? source.height
					: (source as VideoSample).displayHeight;
		let cw = sw * crop.width,
			ch = sh * crop.height,
			sx = sw * crop.x,
			sy = sh * crop.y;
		if (cw / ch > w / h) {
			const next = (ch * w) / h;
			sx += (cw - next) / 2;
			cw = next;
		} else {
			const next = (cw * h) / w;
			sy += (ch - next) / 2;
			ch = next;
		}
		ctx.save();
		ctx.beginPath();
		ctx.roundRect(x, y, w, h, ((Math.min(w, h) / 2) * roundness) / 100);
		ctx.clip();
		if (mirror) {
			ctx.translate(x * 2 + w, 0);
			ctx.scale(-1, 1);
		}
		if ("draw" in source) (source as VideoSample).draw(ctx, sx, sy, cw, ch, x, y, w, h);
		else ctx.drawImage(source, sx, sy, cw, ch, x, y, w, h);
		ctx.restore();
	}
	private lines(text: string, maxWidth: number) {
		const lines: string[] = [];
		let line = "";
		for (const char of text) {
			if (char === "\n" || (line && this.ctx.measureText(line + char).width > maxWidth)) {
				lines.push(line);
				line = char === "\n" ? "" : char;
			} else line += char;
		}
		if (line) lines.push(line);
		return lines;
	}
	private async card(card: Card, localMs: number) {
		const ctx = this.ctx,
			w = this.canvas.width,
			h = this.canvas.height;
		ctx.fillStyle = card.background || "#111827";
		ctx.fillRect(0, 0, w, h);
		if (card.assetId) {
			const a = this.project.composition.assets.find((a) => a.id === card.assetId)!;
			this.draw(await this.image(a.path), 0, 0, w, h);
		}
		if (card.template === "image") return;
		ctx.save();
		if (card.animation === "fade")
			ctx.globalAlpha = Math.max(
				0,
				Math.min(1, localMs / 200, (card.durationMs - localMs) / 200),
			);
		ctx.fillStyle = card.color || "#ffffff";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		const fontSize = w * (card.template === "chapter" ? 0.047 : 0.055);
		ctx.font = `700 ${fontSize}px sans-serif`;
		const lines = this.lines(card.title || "", w * 0.82),
			lineHeight = fontSize * 1.4;
		lines.forEach((line, i) =>
			ctx.fillText(line, w / 2, h * 0.45 + (i - (lines.length - 1) / 2) * lineHeight),
		);
		ctx.font = `400 ${w * 0.022}px sans-serif`;
		this.lines(card.subtitle || "", w * 0.78).forEach((line, i) =>
			ctx.fillText(line, w / 2, h * 0.69 + i * w * 0.032),
		);
		ctx.restore();
	}
	private captions(timeMs: number) {
		const ctx = this.ctx,
			settings = this.editor.autoCaptionSettings,
			w = this.canvas.width,
			h = this.canvas.height;
		if (!settings.enabled) return;
		const fontSize = getCaptionScaledFontSize(settings.fontSize, w, settings.maxWidth);
		ctx.font = `${CAPTION_FONT_WEIGHT} ${fontSize}px ${settings.fontFamily}`;
		const layout = buildActiveCaptionLayout({
			cues: this.editor.autoCaptions,
			timeMs,
			settings,
			maxWidthPx: getCaptionTextMaxWidth(w, settings.maxWidth, fontSize),
			measureText: (t) => ctx.measureText(t).width,
		});
		if (!layout) return;
		const pad = getCaptionPadding(fontSize),
			lh = fontSize * CAPTION_LINE_HEIGHT;
		const bw = Math.max(...layout.visibleLines.map((l) => l.width)) + pad.x * 2,
			bh = layout.visibleLines.length * lh + pad.y * 2;
		ctx.save();
		ctx.translate(w / 2, h - (h * settings.bottomOffset) / 100 - bh / 2 + layout.translateY);
		ctx.scale(layout.scale, layout.scale);
		ctx.globalAlpha = layout.opacity;
		ctx.fillStyle = `rgba(0,0,0,${settings.backgroundOpacity})`;
		ctx.beginPath();
		ctx.roundRect(-bw / 2, -bh / 2, bw, bh, Math.min(bh / 2, settings.boxRadius));
		ctx.fill();
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		layout.visibleLines.forEach((line, i) => {
			let x = -line.width / 2;
			for (const word of line.words) {
				const text = `${word.leadingSpace ? " " : ""}${word.text}`;
				const state = getCaptionWordVisualState(layout.hasWordTimings, word.state);
				ctx.fillStyle = state.isInactive ? settings.inactiveTextColor : settings.textColor;
				ctx.globalAlpha = layout.opacity * state.opacity;
				ctx.fillText(text, x, -bh / 2 + pad.y + lh * (i + 0.5));
				x += ctx.measureText(text).width;
			}
		});
		ctx.restore();
	}
	render(timeMs: number): Promise<HTMLCanvasElement> {
		// Decode and compose offscreen; never expose a partially drawn frame.
		// Refreshes and playback can request frames concurrently.
		const frame = this.pending.catch(() => undefined).then(async () => {
			await this.renderFrame(timeMs);
			this.output.drawImage(this.staging, 0, 0);
			return this.canvas;
		});
		this.pending = frame;
		return frame;
	}
	private async renderFrame(timeMs: number) {
		const scene = sceneAt(this.project, timeMs),
			ctx = this.ctx,
			w = this.canvas.width,
			h = this.canvas.height;
		ctx.fillStyle = "#111827";
		ctx.fillRect(0, 0, w, h);
		if (!scene) return this.canvas;
		if (scene.shot.kind === "card") {
			await this.card(scene.shot, scene.localMs);
			return this.canvas;
		}
		const layout = scene.shot.layout,
			sourceMs = scene.sourceMs!,
			b = scene.broll;
		if (b?.mode !== "fullscreen") {
			if (layout.mode !== "presenter") {
				const sample = await this.sample(this.project.videoPath, sourceMs),
					frame = sample.toVideoFrame();
				try {
					await this.base!.renderFrame(
						frame,
						sourceMs * 1000,
						sourceMs * 1000,
						1e6 / this.project.composition.fps,
						sourceMs * 1000,
					);
				} finally {
					frame.close();
					sample.close();
				}
				const screen = this.base!.getCanvas();
				if (layout.mode === "split") {
					const ratio = layout.presenterRatio ?? 0.35,
						available = w * (1 - ratio),
						scale = Math.min(available / screen.width, h / screen.height);
					ctx.drawImage(
						screen,
						w * ratio + (available - screen.width * scale) / 2,
						(h - screen.height * scale) / 2,
						screen.width * scale,
						screen.height * scale,
					);
				} else ctx.drawImage(screen, 0, 0, w, h);
			}
			if (layout.mode !== "screen") {
				const webcam = this.editor.webcam;
				const sample = await this.sample(
					webcam.sourcePath!,
					sourceMs - webcam.timeOffsetMs,
				);
				try {
					if (layout.mode === "presenter")
						this.draw(sample, 0, 0, w, h, webcam.cropRegion, webcam.mirror);
					else if (layout.mode === "split")
						this.draw(
							sample,
							0,
							0,
							w * (layout.presenterRatio ?? 0.35),
							h,
							webcam.cropRegion,
							webcam.mirror,
						);
					else {
						const pw = w * (layout.width ?? 0.23),
							ph = h * (layout.height ?? 0.23);
						this.draw(
							sample,
							(w - pw) * (layout.x ?? 0.98),
							(h - ph) * (layout.y ?? 0.98),
							pw,
							ph,
							webcam.cropRegion,
							webcam.mirror,
							layout.roundness ?? 100,
						);
					}
				} finally {
					sample.close();
				}
			}
		}
		if (b) {
			const asset = this.project.composition.assets.find((a) => a.id === b.assetId)!;
			const media =
				asset.kind === "image"
					? await this.image(asset.path)
					: await this.sample(asset.path, scene.brollSourceMs!);
			try {
				this.draw(
					media,
					b.mode === "fullscreen" ? 0 : b.x * w,
					b.mode === "fullscreen" ? 0 : b.y * h,
					b.mode === "fullscreen" ? w : b.width * w,
					b.mode === "fullscreen" ? h : b.height * h,
					b.crop,
				);
			} finally {
				if ("close" in media) media.close();
			}
		}
		await renderAnnotations(
			ctx,
			this.editor.annotationRegions,
			w,
			h,
			sourceMs,
			w / 1920,
			this.annotations,
		);
		this.captions(sourceMs);
		return this.canvas;
	}
	destroy() {
		this.base?.destroy();
		this.base = null;
		for (const m of this.media.values()) m.input.dispose();
		this.media.clear();
		this.images.clear();
	}
}
export async function exportComposition(
	project: CompositionProject,
	options: {
		outputPath?: string;
		preview?: boolean;
		range?: { fromMs: number; toMs: number };
		signal?: AbortSignal;
		onProgress?: (progress: number) => void;
	} = {},
) {
	const renderer = new CompositionRenderer(project),
		c = project.composition;
	const from = options.range?.fromMs ?? 0,
		to = options.range?.toMs ?? durationMs(c),
		seconds = (to - from) / 1000;
	if (from < 0 || to > durationMs(c) || to <= from) throw new Error("Invalid export range");
	const muxer = new VideoMuxer({
		width: c.width,
		height: c.height,
		frameRate: c.fps,
		bitrate: 8_000_000,
	});
	let encoder: VideoEncoder | null = null,
		encodeError: Error | null = null,
		writes = Promise.resolve(),
		silentPath: string | undefined,
		mixedPath: string | undefined;
	const abort = () => {
		void window.electronAPI.compositionCancel();
	};
	options.signal?.addEventListener("abort", abort);
	const check = () => {
		if (options.signal?.aborted) throw new Error("Export cancelled");
		if (encodeError) throw encodeError;
	};
	try {
		await renderer.initialize();
		await muxer.initialize();
		const config: VideoEncoderConfig = {
			codec: "avc1.640033",
			width: c.width,
			height: c.height,
			framerate: c.fps,
			bitrate: 8_000_000,
			hardwareAcceleration: "prefer-hardware",
			latencyMode: "realtime",
		};
		const supported = await VideoEncoder.isConfigSupported(config);
		if (!supported.supported)
			throw new Error("H.264 encoder does not support the selected dimensions");
		encoder = new VideoEncoder({
			output: (chunk, meta) => {
				writes = writes
					.then(() => muxer.addVideoChunk(chunk, meta))
					.catch((e) => {
						encodeError = e;
					});
			},
			error: (e) => {
				encodeError = e;
			},
		});
		encoder.configure(config);
		const frames = Math.ceil(seconds * c.fps);
		for (let i = 0; i < frames; i++) {
			check();
			while (encoder.encodeQueueSize > 8) {
				await new Promise((r) => setTimeout(r, 5));
				check();
			}
			const canvas = await renderer.render(Math.min(to - 0.001, from + (i * 1000) / c.fps));
			const frame = new VideoFrame(canvas, {
				timestamp: Math.round((i * 1e6) / c.fps),
				duration: Math.round(Math.min(1 / c.fps, seconds - i / c.fps) * 1e6),
			});
			encoder.encode(frame, { keyFrame: i % (c.fps * 2) === 0 });
			frame.close();
			options.onProgress?.((i / frames) * 0.9);
		}
		await encoder.flush();
		await writes;
		check();
		const result = await muxer.finalize();
		if (result.mode !== "stream")
			throw new Error("Composition export requires streamed output");
		silentPath = result.tempFilePath;
		options.onProgress?.(0.92);
		const mixed = await window.electronAPI.compositionAudio(project, silentPath, {
			fromMs: from,
			toMs: to,
		});
		mixedPath = mixed.tempPath;
		check();
		if (options.preview) {
			const previewPath = mixedPath;
			mixedPath = undefined;
			return {
				success: true,
				phase: "saved",
				format: "mp4",
				outputPath: previewPath,
				durationMs: to - from,
				expectedAudio: true,
			};
		}
		const saved = await window.electronAPI.finalizeExportedVideo({
			tempPath: mixedPath,
			fileName: "composition.mp4",
			outputPath: options.outputPath,
		});
		if (!saved.success) throw new Error(saved.error || "Export cancelled");
		mixedPath = undefined;
		options.onProgress?.(1);
		return {
			success: true,
			phase: "saved",
			format: "mp4",
			outputPath: saved.path,
			durationMs: to - from,
			expectedAudio: true,
		};
	} finally {
		options.signal?.removeEventListener("abort", abort);
		if (encoder && encoder.state !== "closed") encoder.close();
		renderer.destroy();
		await muxer.abortStream();
		if (silentPath) await window.electronAPI.discardExportedTemp(silentPath);
		if (mixedPath) await window.electronAPI.discardExportedTemp(mixedPath);
	}
}
