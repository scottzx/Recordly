import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { CompositionPreview } from "./CompositionPreview";

const harness = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[] }));
vi.mock("react", () => ({
	forwardRef: (render: unknown) => render,
	useRef: (current: unknown) => ({ current }),
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => void) => harness.effects.push(effect),
	useImperativeHandle: (ref: { current: unknown }, create: () => unknown) => {
		ref.current = create();
	},
}));
vi.mock("./CompositionRenderer", () => ({
	CompositionRenderer: class {
		async initialize() {}
		async render() {}
		destroy() {}
	},
}));
vi.mock("../projectPersistence", () => ({ resolveVideoUrl: async () => "test.wav" }));
vi.mock("../../../../shared/composition", () => ({
	durationMs: () => 60_000,
	audioSegments: () => [{ path: "test.wav", startMs: 0, durationMs: 60_000, sourceStartMs: 0, speed: 1, volume: 1 }],
}));

async function flush() {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

const cleanups: (() => void)[] = [];
afterEach(() => {
	cleanups.splice(0).forEach((cleanup) => cleanup());
	harness.effects = [];
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function setup() {
	class Context extends EventTarget {
		state = "suspended";
		currentTime = 0;
		destination = {};
		resume = vi.fn(async () => { this.state = "running"; });
		close = vi.fn(async () => { this.state = "closed"; });
		createGain() { return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }; }
		createMediaElementSource() { return { connect: (gain: unknown) => gain }; }
	}
	class Audio extends EventTarget {
		paused = true;
		currentTime = 0;
		readyState = 4;
		seeking = false;
		playbackRate = 1;
		play = vi.fn(async () => { this.paused = false; });
		pause = vi.fn(() => { this.paused = true; });
		removeAttribute() {}
		load() {}
	}
	const context = new Context(), audio = new Audio();
	const windowTarget = Object.assign(new EventTarget(), {
		electronAPI: { compositionProbe: async () => ({ hasAudio: true }) },
	});
	const documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
	vi.stubGlobal("window", windowTarget);
	vi.stubGlobal("document", documentTarget);
	vi.stubGlobal("AudioContext", function () { return context; });
	vi.stubGlobal("Audio", function () { return audio; });
	vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
	vi.spyOn(console, "info").mockImplementation(() => undefined);
	const ref = { current: null as VideoPlaybackRef | null };
	const onPlaying = vi.fn(), onError = vi.fn();
	// Exercise the real component's effects and imperative controls without a DOM renderer.
	(CompositionPreview as unknown as Function)({
		project: { composition: { shots: [] } }, time: 0, volume: 1,
		onTime: vi.fn(), onDuration: vi.fn(), onReady: vi.fn(), onPlaying, onError,
	}, ref);
	for (const effect of harness.effects) {
		const cleanup = effect();
		if (cleanup) cleanups.push(cleanup);
	}
	await flush();
	return { context, audio, player: ref.current!, onPlaying, onError, windowTarget, documentTarget };
}

describe("composition audio interruptions", () => {
	it("resumes an audio context interrupted during playback", async () => {
		const { context, player } = await setup();
		await player.play();
		context.resume.mockClear();
		context.state = "suspended";
		context.dispatchEvent(new Event("statechange"));
		await flush();
		expect(context.resume).toHaveBeenCalledOnce();
		expect(context.state).toBe("running");
	});

	it("recovers on focus without resuming a manually paused player", async () => {
		const { context, player, windowTarget, documentTarget } = await setup();
		await player.play();
		context.state = "suspended";
		windowTarget.dispatchEvent(new Event("focus"));
		await flush();
		expect(context.state).toBe("running");
		player.pause();
		context.resume.mockClear();
		context.state = "suspended";
		windowTarget.dispatchEvent(new Event("focus"));
		documentTarget.dispatchEvent(new Event("visibilitychange"));
		context.dispatchEvent(new Event("statechange"));
		await flush();
		expect(context.resume).not.toHaveBeenCalled();
		expect(player.isPlaying).toBe(false);
	});

	it("does not restart playback when pause wins a pending resume", async () => {
		const { context, player, audio } = await setup();
		let resolve!: () => void;
		context.resume.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
		const playing = player.play();
		player.pause();
		context.state = "running";
		resolve();
		await playing;
		expect(player.isPlaying).toBe(false);
		expect(audio.play).not.toHaveBeenCalled();
	});

	it("shares a pending recovery across focus and context events", async () => {
		const { context, player, windowTarget, audio } = await setup();
		await player.play();
		let resolve!: () => void;
		context.state = "interrupted";
		context.resume.mockClear();
		context.resume.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
		context.dispatchEvent(new Event("statechange"));
		windowTarget.dispatchEvent(new Event("focus"));
		context.dispatchEvent(new Event("statechange"));
		expect(context.resume).toHaveBeenCalledOnce();
		player.seekTimeline(10);
		expect(audio.currentTime).toBe(0);
		context.state = "running";
		resolve();
		await flush();
		expect(audio.currentTime).toBe(10);
	});

	it("ignores pending play and recovery after the player is disposed", async () => {
		const { context, player, windowTarget, audio } = await setup();
		let resolve!: () => void;
		context.resume.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
		const playing = player.play();
		cleanups.splice(0).forEach((cleanup) => cleanup());
		resolve();
		await playing;
		context.resume.mockClear();
		windowTarget.dispatchEvent(new Event("focus"));
		context.dispatchEvent(new Event("statechange"));
		await flush();
		expect(context.resume).not.toHaveBeenCalled();
		expect(audio.play).not.toHaveBeenCalled();
		expect(player.isPlaying).toBe(false);
	});

	it("allows a later focus to retry a failed recovery", async () => {
		const { context, player, windowTarget } = await setup();
		await player.play();
		context.state = "suspended";
		context.resume.mockRejectedValueOnce(new Error("device interrupted"));
		context.dispatchEvent(new Event("statechange"));
		await flush();
		expect(context.state).toBe("suspended");
		windowTarget.dispatchEvent(new Event("focus"));
		await flush();
		expect(context.state).toBe("running");
	});

	it("bounds diagnostic history and tolerates unavailable storage", async () => {
		const { windowTarget, player } = await setup();
		for (let i = 0; i < 130; i++) windowTarget.dispatchEvent(new Event("focus"));
		const writes = vi.mocked(localStorage.setItem).mock.calls;
		const entries = JSON.parse(writes.at(-1)![1]);
		expect(entries).toHaveLength(120);
		expect(JSON.stringify(entries)).not.toContain("test.wav");
		vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error("quota"); });
		await player.play();
		expect(player.isPlaying).toBe(true);
	});
});
