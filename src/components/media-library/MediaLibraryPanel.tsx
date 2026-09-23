import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LIBRARY_DRAG_TYPE, type LibraryMedia } from "../../../shared/mediaLibrary";
import { resolveVideoUrl } from "../video-editor/projectPersistence";

export function MediaLibraryPanel({
	compact = false,
	onCreateProject,
	onInsert,
}: {
	compact?: boolean;
	onCreateProject?: (ids: string[]) => Promise<void>;
	onInsert?: (id: string) => Promise<void>;
}) {
	const [entries, setEntries] = useState<LibraryMedia[]>([]);
	const [selected, setSelected] = useState<string[]>([]);
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [latestId, setLatestId] = useState<string>();
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
			if (entry) setLatestId(entry.id);
			void refresh();
		});
	}, [refresh]);
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
	return (
		<section
			aria-label="素材库"
			className={
				compact ? "w-[280px] overflow-y-auto rounded-xl bg-card p-4 text-sm" : "text-sm"
			}
		>
			<div className="mb-3 flex items-center justify-between gap-2">
				<h2 className="font-semibold">
					素材库 <span className="text-xs opacity-50">{entries.length}</span>
				</h2>
				<button
					disabled={busy}
					className="rounded-lg border px-3 py-1.5 hover:bg-blue-500/10 disabled:opacity-40"
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
				aria-label="搜索素材"
				placeholder="搜索素材"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				className="mb-3 w-full rounded-lg border bg-transparent px-3 py-2"
			/>
			{onCreateProject && (
				<div className="mb-4 flex items-center gap-3">
					<button
						disabled={busy || !selected.length}
						onClick={() => void run(() => onCreateProject(selected))}
						className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40"
					>
						用所选素材创建剪辑（{selected.length}）
					</button>
					<span className="text-xs opacity-60">按选择顺序加入时间线</span>
				</div>
			)}
			{error && (
				<p role="alert" className="mb-3 text-red-500">
					{error} <button onClick={() => void refresh()}>重试</button>
				</p>
			)}
			{loading ? (
				<p className="py-8 text-center opacity-60">正在读取素材…</p>
			) : !entries.length ? (
				<p className="py-10 text-center opacity-60">
					还没有素材。开始录制或导入视频后，会显示在这里。
				</p>
			) : (
				<div
					className={
						compact ? "space-y-3" : "grid grid-cols-2 gap-4 min-[800px]:grid-cols-3"
					}
				>
					{entries
						.filter((e) =>
							e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
						)
						.map((entry) => (
							<article
								key={entry.id}
								draggable={entry.status === "ready" && Boolean(onInsert)}
								onDragStart={(e) => {
									e.dataTransfer.setData(LIBRARY_DRAG_TYPE, entry.id);
									e.dataTransfer.effectAllowed = "copy";
								}}
								className={`overflow-hidden rounded-xl border ${latestId === entry.id || selected.includes(entry.id) ? "border-blue-500 bg-blue-500/10" : "border-foreground/10"}`}
							>
								<button
									disabled={entry.status !== "ready"}
									className="flex aspect-video w-full items-center justify-center bg-gradient-to-br from-blue-500/15 to-indigo-500/5 text-xs disabled:opacity-50"
									onClick={() =>
										void run(async () =>
											setPreview({
												name: entry.name,
												url: await resolveVideoUrl(entry.videoPath),
											}),
										)
									}
								>
									{entry.status === "processing"
										? "正在整理录制…"
										: "▶ 预览原始素材"}
								</button>
								<div className="space-y-2 p-3">
									<div className="truncate font-medium" title={entry.name}>
										{entry.name}
									</div>
									<p className="text-xs opacity-50">
										{new Date(entry.createdAt).toLocaleString()}{" "}
										{entry.webcamPath ? "· 含摄像头" : ""}
									</p>
									{onCreateProject && (
										<label className="flex items-center gap-2 text-xs">
											<input
												type="checkbox"
												disabled={busy || entry.status !== "ready"}
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
											disabled={busy || entry.status !== "ready"}
											className="text-xs text-blue-500 disabled:opacity-40"
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
			{compact && (
				<p className="mt-4 text-xs opacity-50">
					拖到时间线插入。裁剪只影响当前剪辑，原素材保持不变。
				</p>
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
						<div className="mb-3 flex justify-between gap-4">
							<span className="truncate">{preview.name}</span>
							<button autoFocus onClick={() => setPreview(null)}>
								关闭
							</button>
						</div>
						<video
							className="max-h-[65vh] w-full"
							src={preview.url}
							controls
							autoPlay
							onError={() => setError("无法读取素材，请检查原文件是否仍在原位置。")}
						/>
					</div>
				</div>
			)}
		</section>
	);
}
