import { VideoCameraIcon } from "@phosphor-icons/react";
import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "../ui/button";
import type { ProjectLibraryEntry } from "../video-editor/ProjectBrowserDialog";
import { toFileUrl } from "../video-editor/projectPersistence";
import styles from "./LaunchWindow.module.css";

export function LaunchHomePanel({
	entries,
	onOpenProject,
	onNewRecording,
}: {
	entries: ProjectLibraryEntry[];
	onOpenProject: (projectPath: string) => void;
	onNewRecording: () => void;
}) {
	const t = useScopedT("launch");
	const visibleEntries = entries.slice(0, 24);

	return (
		<div
			data-hud-interactive
			className={`${styles.electronNoDrag} pointer-events-auto mb-1.5 w-[320px] overflow-hidden rounded-[16px] border border-[var(--launch-bar-border)] bg-[var(--launch-bar-bg)] text-[var(--launch-text)] shadow-[var(--launch-bar-shadow)]`}
		>
			<div className="flex items-center justify-between gap-2 border-b border-[var(--launch-border)] px-3 py-2.5">
				<div>
					<div className="text-sm font-medium tracking-tight">
						{t("home.title", "Projects")}
					</div>
					<div className="text-[11px] text-[var(--launch-text-muted)]">
						{t("home.subtitle", "Open a recent project or start a new recording")}
					</div>
				</div>
				<Button
					type="button"
					size="sm"
					className="h-8 shrink-0 rounded-lg bg-[#2563EB] px-2.5 text-xs font-medium text-white hover:bg-[#2563EB]/90"
					onClick={onNewRecording}
				>
					<VideoCameraIcon size={14} />
					{t("home.newRecording", "New recording")}
				</Button>
			</div>
			<div className="max-h-[320px] overflow-y-auto px-2.5 py-2.5">
				{visibleEntries.length > 0 ? (
					<div className="grid grid-cols-2 gap-2">
						{visibleEntries.map((entry) => {
							const thumbnailSrc = entry.thumbnailPath
								? toFileUrl(entry.thumbnailPath)
								: null;
							return (
								<button
									key={entry.path}
									type="button"
									onClick={() => onOpenProject(entry.path)}
									className="group flex flex-col gap-1 rounded-lg bg-transparent p-0.5 text-left outline-none transition focus:outline-none"
								>
									<div className="relative aspect-[16/10] w-full overflow-hidden rounded-[5px] bg-[var(--launch-surface)] shadow-[0_10px_18px_rgba(0,0,0,0.28)] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_30px_rgba(0,0,0,0.38)]">
										{thumbnailSrc ? (
											<img
												src={thumbnailSrc}
												alt=""
												className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
												draggable={false}
											/>
										) : (
											<div className="flex h-full w-full items-center justify-center bg-[linear-gradient(180deg,_rgba(37,99,235,0.22),_rgba(13,17,23,0.92))] text-[10px] font-medium text-white/60">
												{t("home.noPreview", "No preview")}
											</div>
										)}
									</div>
									<div className="truncate px-0.5 py-0.5 text-[11px] font-semibold tracking-tight">
										{entry.name}
									</div>
								</button>
							);
						})}
					</div>
				) : (
					<div className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--launch-border)] px-4 text-center">
						<div className="text-sm font-semibold">
							{t("home.empty", "No saved projects yet")}
						</div>
						<div className="text-[11px] text-[var(--launch-text-muted)]">
							{t("home.emptyHint", "Start a new recording to create one")}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
