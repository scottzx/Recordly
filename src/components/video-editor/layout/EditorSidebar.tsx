import "./editorWorkspace.css";
import { TranscriptPanel } from "../TranscriptPanel";
import { MediaLibraryPanel } from "../../media-library/MediaLibraryPanel";
import { useCompositionContext } from "../composition/useCompositionEditing";
import { CompositionSettingsPanel } from "../composition/CompositionSettingsPanel";
import {
	House,
	Camera,
	ClosedCaptioning,
	Cursor,
	Gear,
	PuzzlePiece,
	Sparkle,
	FileText,
	ListChecks,
	FolderOpen,
	FilmStrip,
	CaretLeft,
	CaretRight,
} from "@phosphor-icons/react";
import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import type { useI18n } from "@/contexts/I18nContext";
import ExtensionManager from "../ExtensionManager";
import { SettingsPanel } from "../SettingsPanel";
import type { EditorEffectSection } from "../types";

type Props = {
	onReturnHome: () => void;
	t: ReturnType<typeof useI18n>["t"];
	activeSection: EditorEffectSection;
	setActiveSection: Dispatch<SetStateAction<EditorEffectSection>>;
	settingsPanelProps: ComponentProps<typeof SettingsPanel>;
};

export function EditorSidebar({ t, activeSection, setActiveSection, settingsPanelProps, onReturnHome }: Props) {
	const composition = useCompositionContext();
	const [collapsed, setCollapsed] = useState(false);
	const sourceEditing = Boolean(composition?.project?.composition.sources);
	const sections = useMemo(
		() => [
			{ id: "transcript" as const, label: "文稿", icon: FileText },
			{ id: "review" as const, label: "修改审阅", shortLabel: "审阅", icon: ListChecks },
			{ id: "library" as const, label: "素材库", icon: FolderOpen },
			{ id: "composition" as const, label: "镜头与素材", shortLabel: "镜头", icon: FilmStrip },
			{ id: "scene" as const, label: t("settings.sections.scene", "Scene"), icon: Sparkle },
			{ id: "cursor" as const, label: t("settings.sections.cursor", "Cursor"), icon: Cursor },
			{ id: "webcam" as const, label: t("settings.sections.webcam", "Webcam"), icon: Camera },
			{
				id: "captions" as const,
				label: t("settings.sections.captions", "Captions"),
				icon: ClosedCaptioning,
			},
			{
				id: "settings" as const,
				label: t("settings.sections.settings", "设置"),
				icon: Gear,
			},
			{
				id: "extensions" as const,
				label: t("settings.sections.extensions", "扩展"),
				icon: PuzzlePiece,
			},
		],
		[t],
	);
	return (
		<div className="flex min-h-0 flex-shrink-0 gap-3">
			<aside className="flex w-[104px] min-h-0 flex-shrink-0 flex-col border-r border-border pr-2">
				<button type="button" onClick={onReturnHome} title="返回首页，录制或打开工程" className="mb-2 flex min-h-9 flex-shrink-0 items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><House aria-hidden="true" className="h-[18px] w-[18px]" />首页</button>
				<nav aria-label="编辑工具" className="min-h-0 flex-1 overflow-y-auto py-1">
					{sections
						.filter((section) => !sourceEditing || section.id !== "webcam")
						.map((section) => {
							const isActive = activeSection === section.id;
							return (
								<div key={section.id} className={section.id === "scene" || section.id === "settings" ? "mt-3 border-t border-border pt-3" : "mt-1"}>
									<button
										type="button"
										onClick={() => {
											setActiveSection(section.id);
											setCollapsed(false);
										}}
										title={section.label}
										aria-label={section.label}
										aria-pressed={isActive}
										className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
									>
										<section.icon aria-hidden="true" className="h-[18px] w-[18px] flex-shrink-0" weight={isActive ? "fill" : "regular"} />
										<span className="whitespace-nowrap">{section.shortLabel ?? section.label}</span>
									</button>
								</div>
							);
						})}
				</nav>
				<button
					type="button"
					className="mt-2 flex min-h-9 flex-shrink-0 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label={collapsed ? "展开属性面板" : "收起属性面板"}
					aria-expanded={!collapsed}
					onClick={() => setCollapsed((v) => !v)}
				>
					{collapsed ? <CaretRight aria-hidden="true" /> : <CaretLeft aria-hidden="true" />}
					{collapsed ? "展开面板" : "收起面板"}
				</button>
			</aside>
			{!collapsed && <div className="editor-inspector">{activeSection === "transcript" || activeSection === "review" ? (
				<TranscriptPanel reviewOnly={activeSection === "review"} />
			) : activeSection === "library" ? (
				<MediaLibraryPanel
					compact
					usedCounts={Object.fromEntries(
						(composition?.project?.composition.shots ?? []).flatMap((s) =>
							s.kind === "main" && s.recordingId
								? [
										[
											s.recordingId,
											new Set(
												composition!.project!.composition.shots.flatMap(
													(x) =>
														x.kind === "main" &&
														x.recordingId === s.recordingId
															? [x.instanceId ?? x.id]
															: [],
												),
											).size,
										],
									]
								: [],
						),
					)}
					onInsert={(id) => composition!.insertRecording(id, composition!.time)}
				/>
			) : activeSection === "composition" || (sourceEditing && activeSection === "webcam") ? (
				<CompositionSettingsPanel />
			) : activeSection === "extensions" ? (
				<ExtensionManager />
			) : (
				<SettingsPanel {...settingsPanelProps} />
			)}</div>}
		</div>
	);
}
