import { useState } from "react";
import { durationMs } from "../../../../shared/composition";
import { DEFAULT_ANNOTATION_STYLE } from "../types";
import { useCompositionContext } from "./useCompositionEditing";
export function OverlayTemplates() {
	const ctx = useCompositionContext()!,
		[text, setText] = useState(""),
		[template, setTemplate] = useState("keyword");
	const project = ctx.project!;
	const add = () => {
		const next = structuredClone(project),
			startMs = Math.max(0, ctx.time),
			endMs = Math.min(durationMs(project.composition), startMs + 3000);
		if (endMs <= startMs || !text.trim()) return;
		next.editor.annotationRegions = [
			...(next.editor.annotationRegions ?? []),
			{
				id: `overlay-${crypto.randomUUID()}`,
				startMs,
				endMs,
				type: "text",
				content: text.trim(),
				textContent: text.trim(),
				position:
					template === "name"
						? { x: 25, y: 82 }
						: template === "steps"
							? { x: 50, y: 14 }
							: { x: 50, y: 50 },
				size: template === "steps" ? { width: 80, height: 12 } : { width: 40, height: 14 },
				style: {
					...DEFAULT_ANNOTATION_STYLE,
					backgroundColor: template === "keyword" ? "#2563eb" : "#111827",
					textAlign: template === "name" ? "left" : "center",
					fontSize: template === "keyword" ? 40 : 28,
				},
				zIndex:
					Math.max(0, ...(next.editor.annotationRegions ?? []).map((a) => a.zIndex)) + 1,
				trackIndex: 0,
			},
		];
		ctx.commitSnapshot(next);
	};
	return (
		<details>
			<summary>讲解叠加包装</summary>
			<p className="text-xs opacity-60">添加为可编辑标注，持续 3 秒；在时间线调整时长。</p>
			{project.composition.effectsTime === "timeline" ? (
				<>
					<select
						aria-label="叠加包装模板"
						value={template}
						onChange={(e) => setTemplate(e.target.value)}
					>
						<option value="keyword">关键词卡</option>
						<option value="steps">步骤条</option>
						<option value="name">人名条</option>
					</select>
					<input
						aria-label="叠加包装文字"
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder={
							template === "steps"
								? "1 导入 → 2 剪辑 → 3 导出"
								: template === "name"
									? "姓名 · 职位"
									: "关键词"
						}
					/>
					<button disabled={!text.trim()} onClick={add}>
						插入播放头
					</button>
				</>
			) : (
				<button onClick={ctx.prepareTranscript}>启用成片时间编辑</button>
			)}
		</details>
	);
}
