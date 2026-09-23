import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { CompositionRenderer } from "./CompositionRenderer";
import { audioSegments, durationMs, type CompositionProject } from "../../../../shared/composition";
import { resolveVideoUrl } from "../projectPersistence";
import type { VideoPlaybackRef } from "../VideoPlayback";
import "./composition.css";

type Props = {
	project: CompositionProject;
	videoPath: string;
	time: number;
	playing: boolean;
	volume: number;
	suspended: boolean;
	onTime: (n: number) => void;
	onPlaying: (v: boolean) => void;
	onDuration: (n: number) => void;
	onReady: (v: boolean) => void;
	onError: (message: string) => void;
};
export const CompositionPreview = forwardRef<VideoPlaybackRef, Props>((props, ref) => {
	const host = useRef<HTMLDivElement>(null),
		canvasHost = useRef<HTMLDivElement>(null),
		video = useRef<HTMLVideoElement>(null);
	const latest = useRef(props);
	latest.current = props;
	const renderer = useRef<CompositionRenderer | null>(null),
		queue = useRef(Promise.resolve());
	const playState = useRef(false),
		position = useRef(props.time),
		anchor = useRef({ at: 0, time: 0 });
	const tracks = useRef<
			{
				element: HTMLAudioElement;
				segment: ReturnType<typeof audioSegments>[number];
				gain: GainNode;
			}[]
		>([]),
		audioContext = useRef<AudioContext | null>(null);
	const stop = useCallback(() => {
		playState.current = false;
		tracks.current.forEach((t) => t.element.pause());
		latest.current.onPlaying(false);
	}, []);
	const paint = useCallback(async () => {
		await renderer.current?.render(
			Math.min(
				Math.max(0, position.current * 1000),
				durationMs(latest.current.project.composition) - 0.001,
			),
		);
	}, []);
	const syncAudio = useCallback(() => {
		const at = position.current * 1000;
		for (const { element, segment: s, gain } of tracks.current) {
			const active = playState.current && at >= s.startMs && at < s.startMs + s.durationMs;
			if (!active) {
				element.pause();
				continue;
			}
			const source = (s.sourceStartMs + (at - s.startMs) * s.speed) / 1000;
			if (Math.abs(element.currentTime - source) > 0.15) element.currentTime = source;
			element.playbackRate = s.speed;
			gain.gain.value = s.volume * latest.current.volume;
			if (element.paused) void element.play().catch(() => undefined);
		}
	}, []);
	useImperativeHandle(
		ref,
		() => ({
			get isPlaying() {
				return playState.current;
			},
			get video() {
				return video.current;
			},
			app: null,
			videoSprite: null,
			videoContainer: null,
			containerRef: host,
			seekTimeline(t) {
				position.current = Math.max(
					0,
					Math.min(t, durationMs(latest.current.project.composition) / 1000),
				);
				anchor.current = { at: performance.now(), time: position.current };
				latest.current.onTime(position.current);
				syncAudio();
				queue.current = queue.current.catch(() => undefined).then(paint);
			},
			async play() {
				if (position.current >= durationMs(latest.current.project.composition) / 1000)
					position.current = 0;
				await audioContext.current?.resume();
				playState.current = true;
				anchor.current = { at: performance.now(), time: position.current };
				latest.current.onPlaying(true);
				syncAudio();
			},
			pause: stop,
			refreshFrame: paint,
			cancelCaptionEdit() {
				/* Captions are edited through the existing property panel. */
			},
		}),
		[paint, stop, syncAudio],
	);
	useEffect(() => {
		let disposed = false;
		const instance = new CompositionRenderer(props.project);
		position.current = latest.current.time;
		latest.current.onReady(false);
		stop();
		queue.current = queue.current
			.catch(() => undefined)
			.then(async () => {
				if (disposed) return;
				try {
					await instance.initialize();
					if (disposed) {
						instance.destroy();
						return;
					}
					renderer.current = instance;
					canvasHost.current?.replaceChildren(instance.canvas);
					await paint();
					latest.current.onReady(true);
				} catch (e) {
					if (!disposed) latest.current.onError(String(e));
				}
			});
		return () => {
			disposed = true;
			renderer.current = null;
			queue.current = queue.current.catch(() => undefined).then(() => instance.destroy());
		};
	}, [props.project, paint, stop]);
	useEffect(() => {
		let disposed = false;
		const context = new AudioContext();
		audioContext.current = context;
		const owned: typeof tracks.current = [];
		void (async () => {
			const hasAudio = new Map<string, boolean>();
			for (const segment of audioSegments(props.project)) {
				if (!hasAudio.has(segment.path))
					hasAudio.set(
						segment.path,
						(await window.electronAPI.compositionProbe(segment.path)).hasAudio,
					);
				if (disposed) return;
				if (!hasAudio.get(segment.path)) continue;
				const url = await resolveVideoUrl(segment.path);
				if (disposed) return;
				const element = new Audio(url);
				element.crossOrigin = "anonymous";
				element.preload = "auto";
				const gain = context.createGain();
				context
					.createMediaElementSource(element)
					.connect(gain)
					.connect(context.destination);
				owned.push({ element, segment, gain });
			}
			if (!disposed) tracks.current = owned;
		})().catch((e) => {
			if (!disposed) latest.current.onError(String(e));
		});
		return () => {
			disposed = true;
			owned.forEach((t) => {
				t.element.pause();
				t.element.removeAttribute("src");
				t.element.load();
			});
			tracks.current = [];
			void context.close();
		};
	}, [props.project]);
	useEffect(() => {
		let disposed = false,
			frame = 0,
			busy = false;
		const tick = () => {
			if (disposed) return;
			if (playState.current && !latest.current.suspended) {
				position.current =
					anchor.current.time + (performance.now() - anchor.current.at) / 1000;
				const end = durationMs(latest.current.project.composition) / 1000;
				if (position.current >= end) {
					position.current = end;
					stop();
				}
				latest.current.onTime(position.current);
				syncAudio();
				if (!busy) {
					busy = true;
					queue.current = queue.current
						.catch(() => undefined)
						.then(paint)
						.catch((e) => {
							stop();
							latest.current.onError(String(e));
						})
						.finally(() => {
							busy = false;
						});
				}
			}
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => {
			disposed = true;
			cancelAnimationFrame(frame);
			stop();
		};
	}, [paint, stop, syncAudio]);
	return (
		<div
			ref={host}
			className="composition-preview relative flex h-full w-full items-center justify-center"
		>
			<div className="flex h-full w-full items-center justify-center" ref={canvasHost} />
			<video
				ref={video}
				hidden
				muted
				preload="metadata"
				src={props.videoPath}
				onLoadedMetadata={(e) => props.onDuration(e.currentTarget.duration)}
			/>
		</div>
	);
});
