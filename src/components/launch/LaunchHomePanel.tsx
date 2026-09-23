import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MediaLibraryPanel } from "../media-library/MediaLibraryPanel";
import { VersionHistoryButton } from "../VersionHistoryButton";
import type { ProjectLibraryEntry } from "../video-editor/ProjectBrowserDialog";
import { toFileUrl } from "../video-editor/projectPersistence";
import styles from "./LaunchWindow.module.css";

export function LaunchHomePanel({
	entries,
	onOpenProject,
	onNewRecording,
	onImportFile,
}: {
	entries: ProjectLibraryEntry[];
	onOpenProject: (path: string) => void;
	onNewRecording: () => void;
	onImportFile: () => void;
}) {
	const [tab, setTab] = useState<"library" | "projects">("library");
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => window.electronAPI.onLibraryChanged(() => setTab("library")), []);
	const createProject = async (ids: string[]) => {
		setBusy(true);
		try {
			const result = await window.electronAPI.libraryCreateProject(ids);
			if (!result.success || !result.path) throw new Error(result.message || "创建剪辑失败");
			onOpenProject(result.path);
		} catch (e) {
			toast.error(String(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<section
			data-hud-interactive
			aria-label="创作空间"
			className={`${styles.electronNoDrag} launch-theme pointer-events-auto mb-2 flex w-[min(960px,calc(100vw-32px))] max-h-[calc(100vh-120px)] flex-col overflow-hidden rounded-2xl border border-[var(--launch-bar-border)] bg-[var(--launch-bar-bg)] text-[var(--launch-text)] shadow-[var(--launch-bar-shadow)]`}
		>
			<header className="flex shrink-0 items-center gap-3 border-b border-[var(--launch-border)] px-6 py-4">
				<img src="/app-icons/recordly-128.png" alt="" className="h-9 w-9 rounded-lg" />
				<span className="text-base font-semibold">Recordly</span>
				<VersionHistoryButton />
				<nav aria-label="工作区" className="ml-5 flex gap-2">
					{(["library", "projects"] as const).map((id) => (
						<button
							key={id}
							aria-pressed={tab === id}
							className={`rounded-lg px-4 py-2 text-sm ${tab === id ? "bg-blue-500/15 text-blue-500" : "opacity-60"}`}
							onClick={() => setTab(id)}
						>
							{id === "library" ? "素材库" : "剪辑项目"}
						</button>
					))}
				</nav>
				<button
					className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm text-white"
					onClick={onNewRecording}
				>
					开始录制
				</button>
			</header>
			<div className="overflow-y-auto p-6 sm:p-8">
				<div className="mb-6 flex items-start justify-between gap-4">
					<div>
						<h1 className="text-2xl font-semibold">
							{tab === "library" ? "素材库" : "剪辑项目"}
						</h1>
						<p className="mt-2 text-sm opacity-60">
							{tab === "library"
								? "先录下每一段，再自由组合成片。"
								: "一条时间线，一个独立的剪辑作品。"}
						</p>
					</div>
					<button
						disabled={busy}
						className="rounded-lg border border-[var(--launch-border)] px-4 py-2 text-sm disabled:opacity-40"
						onClick={() => void createProject([])}
					>
						＋ 新建空白剪辑
					</button>
				</div>
				{tab === "library" ? (
					<MediaLibraryPanel onCreateProject={createProject} />
				) : (
					<>
						<div className="mb-4 flex gap-3">
							<input
								aria-label="搜索剪辑"
								placeholder="搜索剪辑项目"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								className="mr-auto rounded-lg border border-[var(--launch-border)] bg-transparent px-3 py-2 text-sm"
							/>
							<button className="text-sm text-blue-500" onClick={onImportFile}>
								打开项目文件
							</button>
						</div>
						<div className="grid grid-cols-2 gap-4 min-[800px]:grid-cols-3">
							{entries
								.filter((entry) =>
									entry.name.toLowerCase().includes(query.toLowerCase()),
								)
								.map((entry) => (
									<button
										key={entry.path}
										onClick={() => onOpenProject(entry.path)}
										className="overflow-hidden rounded-xl border border-[var(--launch-border)] text-left hover:border-blue-500"
									>
										<div className="flex aspect-video items-center justify-center bg-blue-500/10 text-xs opacity-70">
											{entry.thumbnailPath ? (
												<img
													className="h-full w-full object-cover"
													src={toFileUrl(entry.thumbnailPath)}
													alt=""
												/>
											) : (
												"剪辑项目"
											)}
										</div>
										<div className="p-3">
											<h3 className="truncate text-sm font-semibold">
												{entry.name}
											</h3>
											<p className="mt-1 text-xs opacity-50">
												{new Date(entry.updatedAt).toLocaleString()}
											</p>
										</div>
									</button>
								))}
						</div>
						{!entries.length && (
							<p className="py-12 text-center text-sm opacity-60">
								还没有剪辑项目。新建空白剪辑，或从素材库选择素材开始。
							</p>
						)}
					</>
				)}
			</div>
		</section>
	);
}
