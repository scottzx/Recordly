import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { CompositionRenderer } from "./CompositionRenderer";
import { audioSegments, durationMs, type CompositionProject } from "../../../../shared/composition";
import { resolveVideoUrl } from "../projectPersistence";
import type { VideoPlaybackRef } from "../VideoPlayback";
import "./composition.css";
import { shouldSeekAudio } from "./audioSync";

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
				lastSeek: number;
				active: boolean;
				playPending: boolean;
			}[]
		>([]),
		audioContext = useRef<AudioContext | null>(null);
	const playRequest = useRef(0);
	const resumePending = useRef<Promise<void> | null>(null);
	const diagnostics = useRef<unknown[] | null>(null);
	const recordAudioState = useCallback((event: string) => {
		// Keep a bounded local trace for intermittent failures; no media paths or content.
		try {
			const key = "recordly:composition-audio-diagnostics";
			if (!diagnostics.current) {
				const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
				diagnostics.current = Array.isArray(saved) ? saved.slice(-119) : [];
			}
			const entry = {
				at: new Date().toISOString(), event, playing: playState.current,
				time: position.current, visibility: document.visibilityState,
				context: audioContext.current?.state,
				contextTime: audioContext.current?.currentTime,
				tracks: tracks.current.map(({ element, gain, active, playPending }) => ({
					time: element.currentTime, paused: element.paused, ended: element.ended,
					seeking: element.seeking, ready: element.readyState,
					network: element.networkState, error: element.error?.code,
					gain: gain.gain.value, active, playPending,
				})),
			};
			diagnostics.current = [...diagnostics.current.slice(-119), entry];
			localStorage.setItem(key, JSON.stringify(diagnostics.current));
			if (event !== "sample") console.info("[composition-audio]", entry);
		} catch {
			// Diagnostics must never interfere with playback, including storage failures.
		}
	}, []);
	const ensureAudioRunning = useCallback(() => {
		const context = audioContext.current;
		if (!context || context.state === "closed") return Promise.resolve();
		if (context.state === "running") return Promise.resolve();
		if (!resumePending.current) {
			const pending = context.resume().finally(() => {
				if (resumePending.current === pending) resumePending.current = null;
			});
			resumePending.current = pending;
		}
		return resumePending.current;
	}, []);
	const stop = useCallback(() => {
		playRequest.current++;
		playState.current = false;
		tracks.current.forEach((t) => t.element.pause());
		latest.current.onPlaying(false);
		recordAudioState("pause");
	}, [recordAudioState]);
	const paint = useCallback(async () => {
		await renderer.current?.render(
			Math.min(
				Math.max(0, position.current * 1000),
				Math.max(0, durationMs(latest.current.project.composition) - 0.001),
			),
		);
	}, []);
	const syncAudio = useCallback((force = false) => {
		// A suspended audio graph cannot advance. Do not keep seeking its inputs.
		if (audioContext.current?.state !== "running") return;
		const at = position.current * 1000;
		for (const track of tracks.current) {
			const { element, segment: s, gain } = track;
			const active = playState.current && at >= s.startMs && at < s.startMs + s.durationMs;
			if (!active) {
				element.pause();
				track.active = false;
				continue;
			}
			const source = (s.sourceStartMs + (at - s.startMs) * s.speed) / 1000;
			const now = performance.now();
			if (shouldSeekAudio(element, source, now, track.lastSeek, force || !track.active)) {
				element.currentTime = source;
				track.lastSeek = now;
			}
			track.active = true;
			element.playbackRate = s.speed;
			gain.gain.value = s.volume * latest.current.volume;
			if (element.paused && !track.playPending) {
				track.playPending = true;
				void element.play().catch((error) => {
					if (error?.name !== "AbortError" && playState.current)
						latest.current.onError(`Audio playback failed: ${String(error)}`);
				}).finally(() => { track.playPending = false; });
			}
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
				syncAudio(true);
				queue.current = queue.current.catch(() => undefined).then(paint);
			},
			async play() {
				const request = ++playRequest.current;
				const context = audioContext.current;
				if (position.current >= durationMs(latest.current.project.composition) / 1000)
					position.current = 0;
				try {
					await ensureAudioRunning();
				} catch (error) {
					if (request === playRequest.current) {
						recordAudioState("resume-failed");
						latest.current.onError(`Audio resume failed: ${String(error)}`);
					}
					return;
				}
				if (request !== playRequest.current || context !== audioContext.current) return;
				if (!context || context.state !== "running") return;
				playState.current = true;
				anchor.current = { at: performance.now(), time: position.current };
				latest.current.onPlaying(true);
				syncAudio(true);
				recordAudioState("play");
			},
			pause: stop,
			refreshFrame: paint,
			cancelCaptionEdit() {
				/* Captions are edited through the existing property panel. */
			},
		}),
		[paint, stop, syncAudio, ensureAudioRunning, recordAudioState],
	);
	useEffect(() => {
		let disposed = false;
		const instance = new CompositionRenderer(props.project);
		position.current = Math.min(
			latest.current.time,
			durationMs(props.project.composition) / 1000,
		);
		latest.current.onDuration(durationMs(props.project.composition) / 1000);
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
		const recover = () => {
			if (disposed || !playState.current) return;
			const request = playRequest.current;
			void ensureAudioRunning().then(() => {
				if (disposed || !playState.current || request !== playRequest.current) return;
				syncAudio();
			}).catch(() => {
				if (!disposed) recordAudioState("recovery-failed");
			});
		};
		const onStateChange = () => {
			recordAudioState("context-statechange");
			recover();
		};
		const onFocus = () => { recordAudioState("focus"); recover(); };
		const onBlur = () => recordAudioState("blur");
		const onVisibility = () => {
			recordAudioState("visibilitychange");
			if (document.visibilityState === "visible") recover();
		};
		context.addEventListener("statechange", onStateChange);
		window.addEventListener("focus", onFocus);
		window.addEventListener("blur", onBlur);
		document.addEventListener("visibilitychange", onVisibility);
		const sample = setInterval(() => {
			if (playState.current) recordAudioState("sample");
		}, 5000);
		recordAudioState("context-created");
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
				const element = new Audio();
				element.crossOrigin = "anonymous";
				element.preload = "auto";
				element.src = url;
				const gain = context.createGain();
				context
					.createMediaElementSource(element)
					.connect(gain)
					.connect(context.destination);
				owned.push({ element, segment, gain, lastSeek: -Infinity, active: false, playPending: false });
			}
			if (!disposed) {
				tracks.current = owned;
				recordAudioState("tracks-ready");
				recover();
			}
		})().catch((e) => {
			if (!disposed) latest.current.onError(String(e));
		});
		return () => {
			disposed = true;
			playRequest.current++;
			recordAudioState("context-disposed");
			clearInterval(sample);
			context.removeEventListener("statechange", onStateChange);
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("blur", onBlur);
			document.removeEventListener("visibilitychange", onVisibility);
			owned.forEach((t) => {
				t.element.pause();
				t.element.removeAttribute("src");
				t.element.load();
			});
			tracks.current = [];
			audioContext.current = null;
			resumePending.current = null;
			void context.close().catch(() => undefined);
		};
	}, [props.project, ensureAudioRunning, recordAudioState, syncAudio]);
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
			{!props.project.composition.shots.length && (
				<div className="absolute text-center text-sm text-white/60">
					从左侧素材库拖入录制，开始剪辑
				</div>
			)}
			<video ref={video} hidden muted preload="metadata" src={props.videoPath || undefined} />
		</div>
	);
});
