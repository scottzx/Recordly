import {
	FolderOpenIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	VideoCameraIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { Button } from "../ui/button";
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
	onOpenProject: (projectPath: string) => void;
	onNewRecording: () => void;
	onImportFile: () => void;
}) {
	const t = useScopedT("launch");
	const { locale } = useI18n();
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState("recent");
	const visibleEntries = useMemo(
		() =>
			entries
				.filter((entry) =>
					entry.name
						.toLocaleLowerCase(locale)
						.includes(query.trim().toLocaleLowerCase(locale)),
				)
				.sort((a, b) =>
					sort === "name"
						? a.name.localeCompare(b.name, locale)
						: b.updatedAt - a.updatedAt,
				),
		[entries, query, sort, locale],
	);
	const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
	return (
		<section
			data-hud-interactive
			aria-label={t("home.title", "Projects")}
			className={`${styles.electronNoDrag} launch-theme pointer-events-auto mb-2 flex w-[min(960px,calc(100vw-32px))] max-h-[calc(100vh-120px)] flex-col overflow-hidden rounded-2xl border border-[var(--launch-bar-border)] bg-[var(--launch-bar-bg)] text-[var(--launch-text)] shadow-[var(--launch-bar-shadow)]`}
		>
			<header className="flex shrink-0 items-center gap-3 border-b border-[var(--launch-border)] px-6 py-4">
				<img src="/app-icons/recordly-128.png" alt="" className="h-9 w-9 rounded-lg" />
				<span className="text-base font-semibold tracking-tight">Recordly</span>
				<span className="ml-auto text-xs text-[var(--launch-text-muted)]">
					{t("home.workspace", "Your creative workspace")}
				</span>
			</header>
			<div className="overflow-y-auto p-6 sm:p-8">
				<div className="mb-7 flex flex-wrap items-start justify-between gap-4">
					<div>
						<h1 className="text-2xl font-semibold tracking-tight">
							{t("home.title", "Projects")}
						</h1>
						<p className="mt-2 text-sm text-[var(--launch-text-muted)]">
							{t("home.subtitle", "Open a recent project or start a new recording")}
						</p>
					</div>
					<Button
						onClick={onNewRecording}
						className="rounded-xl bg-[#2563EB] text-white hover:bg-[#1d4ed8]"
					>
						<PlusIcon size={18} />
						{t("home.newProject", "New project")}
					</Button>
				</div>
				<div className="mb-8 grid gap-3 sm:grid-cols-2">
					<button
						type="button"
						onClick={onNewRecording}
						className="flex items-center gap-4 rounded-xl border border-blue-500/25 bg-blue-500/10 p-5 text-left transition hover:bg-blue-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
					>
						<VideoCameraIcon size={28} className="shrink-0 text-blue-500" />
						<div>
							<div className="text-sm font-semibold">
								{t("home.newRecording", "New recording")}
							</div>
							<p className="mt-1 text-xs text-[var(--launch-text-muted)]">
								{t(
									"home.recordHint",
									"Capture your screen and turn it into a project",
								)}
							</p>
						</div>
					</button>
					<button
						type="button"
						onClick={onImportFile}
						className="flex items-center gap-4 rounded-xl border border-[var(--launch-border)] bg-[var(--launch-surface)] p-5 text-left transition hover:bg-[var(--launch-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
					>
						<FolderOpenIcon
							size={28}
							className="shrink-0 text-[var(--launch-text-muted)]"
						/>
						<div>
							<div className="text-sm font-semibold">
								{t("home.importFile", "Import a file")}
							</div>
							<p className="mt-1 text-xs text-[var(--launch-text-muted)]">
								{t("home.importHint", "Start with a video or open a saved project")}
							</p>
						</div>
					</button>
				</div>
				<div className="mb-4 flex flex-wrap items-center gap-3">
					<h2 className="mr-auto text-sm font-semibold">
						{t("home.allProjects", "All projects")}{" "}
						<span className="ml-2 rounded-md bg-[var(--launch-surface)] px-2 py-1 text-xs text-[var(--launch-text-muted)]">
							{entries.length}
						</span>
					</h2>
					<label className="flex items-center gap-2 rounded-lg border border-[var(--launch-border)] px-3 py-2">
						<MagnifyingGlassIcon size={16} />
						<input
							aria-label={t("home.search", "Search projects")}
							placeholder={t("home.search", "Search projects")}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							className="w-36 bg-transparent text-xs outline-none sm:w-44"
						/>
					</label>
					<select
						aria-label={t("home.sort", "Sort projects")}
						value={sort}
						onChange={(event) => setSort(event.target.value)}
						className="rounded-lg border border-[var(--launch-border)] bg-[var(--launch-surface)] px-3 py-2 text-xs"
					>
						<option value="recent">{t("home.recent", "Recently updated")}</option>
						<option value="name">{t("home.name", "Name")}</option>
					</select>
				</div>
				{visibleEntries.length ? (
					<div className="grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 min-[800px]:grid-cols-3">
						{visibleEntries.map((entry) => (
							<button
								key={entry.path}
								type="button"
								title={entry.path}
								onClick={() => onOpenProject(entry.path)}
								className="group min-w-0 overflow-hidden rounded-xl border border-[var(--launch-border)] bg-[var(--launch-surface)] text-left transition hover:border-blue-500/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
							>
								<div className="relative aspect-video overflow-hidden bg-gradient-to-br from-blue-500/15 to-indigo-500/5">
									<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--launch-text-muted)]">
										<VideoCameraIcon size={30} weight="duotone" />
										<span className="text-xs">
											{t("home.noPreview", "No preview")}
										</span>
									</div>
									{entry.thumbnailPath && (
										<img
											src={toFileUrl(entry.thumbnailPath)}
											alt=""
											loading="lazy"
											draggable={false}
											onError={(event) => {
												event.currentTarget.style.display = "none";
											}}
											className="relative h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
										/>
									)}
									{entry.isCurrent && (
										<span className="absolute right-2 top-2 rounded-md bg-blue-600 px-2 py-1 text-[10px] text-white">
											{t("home.current", "Current")}
										</span>
									)}
								</div>
								<div className="p-3.5">
									<h3 className="truncate text-sm font-semibold">{entry.name}</h3>
									<p className="mt-1 text-xs text-[var(--launch-text-muted)]">
										{dateFormat.format(entry.updatedAt)}
									</p>
								</div>
							</button>
						))}
					</div>
				) : (
					<div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--launch-border)] p-6 text-center">
						<FolderOpenIcon size={32} className="text-[var(--launch-text-muted)]" />
						<h3 className="text-sm font-semibold">
							{query.trim()
								? t("home.noResults", "No matching projects")
								: t("home.empty", "No saved projects yet")}
						</h3>
						<p className="text-xs text-[var(--launch-text-muted)]">
							{query.trim()
								? t("home.searchHint", "Try a different name or clear your search")
								: t("home.emptyHint", "Start a new recording to create one")}
						</p>
						{query.trim() ? (
							<Button variant="ghost" onClick={() => setQuery("")}>
								{t("home.clearSearch", "Clear search")}
							</Button>
						) : (
							<Button variant="ghost" onClick={onNewRecording}>
								<PlusIcon size={16} />
								{t("home.newProject", "New project")}
							</Button>
						)}
					</div>
				)}
			</div>
		</section>
	);
}
