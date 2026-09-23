import { timeline, type Composition } from "./composition.ts";

type Region = {
	id: string;
	startMs: number;
	endMs: number;
	words?: { startMs: number; endMs: number }[];
};

/** Keep timeline effects on the same clip content through insert, move, split, trim and speed. */
export function retimeEditingRegions<T extends Region>(
	regions: T[],
	before: Composition,
	after: Composition,
): T[] {
	const previous = timeline(before),
		next = timeline(after),
		used = new Set<string>();
	return regions.flatMap((region) =>
		previous.flatMap((old) => {
			const from = Math.max(old.startMs, region.startMs),
				to = Math.min(old.endMs, region.endMs);
			if (to <= from) return [];
			return next.flatMap((entry) => {
				if (old.shot.kind !== "main" || entry.shot.kind !== "main") {
					if (old.shot.id !== entry.shot.id) return [];
					return [
						{
							...region,
							startMs: entry.startMs + from - old.startMs,
							endMs: Math.min(entry.endMs, entry.startMs + to - old.startMs),
						},
					];
				}
				const oldId = old.shot.instanceId ?? old.shot.id,
					nextId = entry.shot.instanceId ?? entry.shot.id;
				if (oldId !== nextId) return [];
				const sourceFrom = old.shot.sourceStartMs + (from - old.startMs) * old.shot.speed;
				const sourceTo = old.shot.sourceStartMs + (to - old.startMs) * old.shot.speed;
				const a = Math.max(sourceFrom, entry.shot.sourceStartMs),
					b = Math.min(sourceTo, entry.shot.sourceEndMs);
				if (b <= a) return [];
				const map = (time: number) =>
					entry.startMs +
					(old.shot.kind === "main" && entry.shot.kind === "main"
						? (old.shot.sourceStartMs +
								(time - old.startMs) * old.shot.speed -
								entry.shot.sourceStartMs) /
							entry.shot.speed
						: 0);
				const startMs = entry.startMs + (a - entry.shot.sourceStartMs) / entry.shot.speed;
				const endMs = entry.startMs + (b - entry.shot.sourceStartMs) / entry.shot.speed;
				let id = region.id;
				while (used.has(id)) id += `@${entry.shot.id}`;
				used.add(id);
				return [
					{
						...region,
						id,
						startMs,
						endMs,
						...(region.words
							? {
									words: region.words.flatMap((w) => {
										const start = Math.max(startMs, map(w.startMs)),
											end = Math.min(endMs, map(w.endMs));
										return end > start
											? [{ ...w, startMs: start, endMs: end }]
											: [];
									}),
								}
							: {}),
					} as T,
				];
			});
		}),
	);
}
