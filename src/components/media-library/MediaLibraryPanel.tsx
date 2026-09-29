import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LIBRARY_DRAG_TYPE, type LibraryMedia } from "../../../shared/mediaLibrary";
import { resolveVideoUrl } from "../video-editor/projectPersistence";

function MediaPreview({ entry }: { entry: LibraryMedia }) {
	const [url, setUrl] = useState<string>();
	const [thumbnail, setThumbnail] = useState<string>();
	useEffect(() => {
		let disposed = false;
		setThumbnail(undefined);
		if (entry.thumbnailPath)
			void resolveVideoUrl(entry.thumbnailPath).then((value) => {
				if (!disposed) setThumbnail(value);
			});
		return () => {
			disposed = true;
		};
	}, [entry.thumbnailPath]);
	return (
		<div
			className="aspect-video w-full bg-blue-500/10"
			onMouseEnter={() => void resolveVideoUrl(entry.videoPath).then(setUrl)}
			onMouseLeave={() => setUrl(undefined)}
		>
			{url ? (
				<video src={url} muted autoPlay loop className="h-full w-full object-contain" />
			) : thumbnail ? (
				<img
					loading="lazy"
					src={thumbnail}
					alt=""
					className="h-full w-full object-contain"
				/>
			) : (
				<span className="flex h-full items-center justify-center text-xs">
					{entry.status === "processing"
						? "正在整理录制…"
						: entry.analysisStatus === "running"
							? "正在分析素材…"
							: "▶ 预览原始素材"}
				</span>
			)}
		</div>
	);
}
export function MediaLibraryPanel({
	compact = false,
	onCreateProject,
	onInsert,
	usedCounts = {},
}: {
	compact?: boolean;
	onCreateProject?: (ids: string[]) => Promise<void>;
	onInsert?: (id: string) => Promise<void>;
	usedCounts?: Record<string, number>;
}) {
	const [entries, setEntries] = useState<LibraryMedia[]>([]),
		[selected, setSelected] = useState<string[]>([]);
	const [query, setQuery] = useState(""),
		[filter, setFilter] = useState("all"),
		[busy, setBusy] = useState(false),
		[error, setError] = useState<string | null>(null),
		[loading, setLoading] = useState(true);
	const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
	const refresh = useCallback(async () => {
		try {
			setEntries(await window.electronAPI.libraryList());
			setError(null);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void refresh();
		return window.electronAPI.onLibraryChanged((entry) => {
			if (entry)
				setEntries((old) =>
					[entry, ...old.filter((e) => e.id !== entry.id)].sort(
						(a, b) => b.createdAt - a.createdAt,
					),
				);
			else void refresh();
		});
	}, [refresh]);
	useEffect(() => {
		if (!preview) return;
		const close = (e: KeyboardEvent) => {
			if (e.key === "Escape") setPreview(null);
		};
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, [preview]);
	const run = async (action: () => Promise<unknown>) => {
		setBusy(true);
		try {
			await action();
		} catch (e) {
			toast.error(String(e));
			setError(String(e));
		} finally {
			setBusy(false);
		}
	};
	const update = (id: string, patch: { name?: string; tags?: string[]; favorite?: boolean }) =>
		run(() => window.electronAPI.libraryUpdate(id, patch));
	const ready = (e: LibraryMedia) =>
		e.status === "ready" && !["missing", "failed"].includes(e.analysisStatus ?? "");
	const visible = entries.filter(
		(e) =>
			`${e.name} ${(e.tags ?? []).join(" ")}`
				.toLocaleLowerCase()
				.includes(query.toLocaleLowerCase()) &&
			(filter === "all" || (filter === "favorite" && e.favorite) || e.origin === filter),
	);
	return (
		<section
			aria-label="素材库"
			className={
				compact ? "w-[280px] overflow-y-auto rounded-xl bg-card p-4 text-sm" : "text-sm"
			}
		>
			<div className="mb-3 flex items-center justify-between gap-2">
				<h2 className="font-semibold">素材库 · {entries.length}</h2>
				<button
					disabled={busy}
					className="rounded border px-3 py-1.5"
					onClick={() =>
						void run(async () => {
							await window.electronAPI.libraryImport();
							await refresh();
						})
					}
				>
					导入视频
				</button>
			</div>
			<input
				aria-label="搜索素材或标签"
				placeholder="搜索素材或标签"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				className="mb-3 w-full rounded border bg-transparent px-3 py-2"
			/>
			<select
				aria-label="筛选素材"
				value={filter}
				onChange={(e) => setFilter(e.target.value)}
				className="mb-3 w-full rounded border bg-card p-2"
			>
				<option value="all">全部素材</option>
				<option value="recording">录制</option>
				<option value="imported">导入</option>
				<option value="favorite">收藏</option>
			</select>
			{onCreateProject && (
				<div className="mb-4 space-y-2">
					<button
						disabled={busy || !selected.length}
						onClick={() => void run(() => onCreateProject(selected))}
						className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-40"
					>
						用所选素材创建剪辑（{selected.length}）
					</button>
					{selected.map((id, i) => (
						<div key={id} className="flex items-center gap-2 text-xs">
							<span className="truncate">
								{i + 1}. {entries.find((e) => e.id === id)?.name}
							</span>
							<button
								disabled={!i}
								aria-label="前移素材"
								onClick={() =>
									setSelected((ids) => {
										const next = [...ids];
										[next[i - 1], next[i]] = [next[i], next[i - 1]];
										return next;
									})
								}
							>
								↑
							</button>
							<button
								disabled={i === selected.length - 1}
								aria-label="后移素材"
								onClick={() =>
									setSelected((ids) => {
										const next = [...ids];
										[next[i + 1], next[i]] = [next[i], next[i + 1]];
										return next;
									})
								}
							>
								↓
							</button>
						</div>
					))}
				</div>
			)}
			{error && (
				<p role="alert" className="mb-3 text-red-500">
					{error} <button onClick={() => void refresh()}>重试</button>
				</p>
			)}
			{loading ? (
				<p>正在读取素材…</p>
			) : !visible.length ? (
				<p className="py-8 text-center opacity-60">没有匹配素材。可导入视频或开始录制。</p>
			) : (
				<div
					className={
						compact ? "space-y-3" : "grid grid-cols-2 gap-4 min-[800px]:grid-cols-3"
					}
				>
					{visible.map((entry) => (
						<article
							key={entry.id}
							draggable={ready(entry) && Boolean(onInsert)}
							onDragStart={(e) => {
								e.dataTransfer.setData(LIBRARY_DRAG_TYPE, entry.id);
								e.dataTransfer.effectAllowed = "copy";
							}}
							className={`overflow-hidden rounded-xl border ${selected.includes(entry.id) ? "border-blue-500" : "border-foreground/10"}`}
						>
							<button
								disabled={!ready(entry)}
								className="w-full"
								onClick={() =>
									void run(async () =>
										setPreview({
											name: entry.name,
											url: await resolveVideoUrl(entry.videoPath),
										}),
									)
								}
							>
								<MediaPreview entry={entry} />
							</button>
							<div className="space-y-2 p-3">
								<input
									aria-label="素材名称"
									key={entry.name}
									defaultValue={entry.name}
									onBlur={(e) => {
										if (e.target.value.trim() !== entry.name)
											void update(entry.id, { name: e.target.value });
									}}
									className="w-full bg-transparent font-medium"
								/>
								<p className="text-xs opacity-60">
									{entry.durationMs
										? `${Math.floor(entry.durationMs / 60000)}:${String(Math.floor(entry.durationMs / 1000) % 60).padStart(2, "0")}`
										: "时长待探测"}{" "}
									· {entry.origin === "imported" ? "导入" : "录制"}{" "}
									{entry.webcamPath ? "· 摄像头" : ""}{" "}
									{usedCounts[entry.id]
										? `· 已使用 ${usedCounts[entry.id]} 次`
										: ""}
								</p>
								<div className="flex gap-2">
									<button
										aria-pressed={Boolean(entry.favorite)}
										onClick={() =>
											void update(entry.id, { favorite: !entry.favorite })
										}
									>
										{entry.favorite ? "★ 已收藏" : "☆ 收藏"}
									</button>
									<input
										aria-label="素材标签"
										placeholder="标签，以逗号分隔"
										key={(entry.tags ?? []).join(",")}
										defaultValue={(entry.tags ?? []).join(",")}
										onBlur={(e) =>
											void update(entry.id, {
												tags: e.target.value.split(/[,，]/),
											})
										}
										className="min-w-0 flex-1 bg-transparent text-xs"
									/>
								</div>
								{entry.error && (
									<p className="text-xs text-red-500">{entry.error}</p>
								)}
								{entry.thumbnailError && (
									<p className="text-xs opacity-60">缩略图失败；素材仍可剪辑。</p>
								)}
								{(entry.error || entry.thumbnailError) && (
									<button
										onClick={() =>
											void run(() =>
												entry.analysisStatus === "missing"
													? window.electronAPI.libraryRelocate(entry.id)
													: window.electronAPI.libraryRetry(entry.id),
											)
										}
									>
										{entry.analysisStatus === "missing"
											? "重新定位／登记替换素材"
											: "重试分析"}
									</button>
								)}
								{onCreateProject && (
									<label className="flex gap-2">
										<input
											type="checkbox"
											disabled={busy || !ready(entry)}
											checked={selected.includes(entry.id)}
											onChange={(e) =>
												setSelected((ids) =>
													e.target.checked
														? [...ids, entry.id]
														: ids.filter((id) => id !== entry.id),
												)
											}
										/>
										{selected.includes(entry.id)
											? `第 ${selected.indexOf(entry.id) + 1} 段`
											: "选择素材"}
									</label>
								)}
								{onInsert && (
									<button
										disabled={busy || !ready(entry)}
										className="text-blue-500 disabled:opacity-40"
										onClick={() => void run(() => onInsert(entry.id))}
									>
										＋ 插入播放头位置
									</button>
								)}
							</div>
						</article>
					))}
				</div>
			)}
			{preview && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="原始素材预览"
					className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-8"
					onClick={() => setPreview(null)}
				>
					<div
						className="w-full max-w-3xl rounded-xl bg-neutral-900 p-4 text-white"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="mb-3 flex justify-between">
							<span>{preview.name}</span>
							<button autoFocus onClick={() => setPreview(null)}>
								关闭
							</button>
						</div>
						<video
							className="max-h-[65vh] w-full"
							src={preview.url}
							controls
							autoPlay
							onError={() => setError("无法读取素材，请检查原文件位置。")}
						/>
					</div>
				</div>
			)}
		</section>
	);
}
