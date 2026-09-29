import { useState } from "react";
import { toast } from "sonner";
import { timeline, type BRoll, type CompositionProject } from "../../../../shared/composition";
import { useCompositionContext } from "./useCompositionEditing";
import { CompositionAuditionDialog } from "./CompositionAuditionDialog";
export function BRollCandidates({ broll }: { broll: BRoll }) {
	const ctx = useCompositionContext()!,
		project = ctx.project!;
	const [preview, setPreview] = useState<CompositionProject | null>(null);
	const entry = timeline(project.composition).find((e) => e.shot.id === broll.clipId)!;
	const fromMs = entry.startMs + broll.offsetMs;
	const build = (id: string) => {
		const asset = project.composition.assets.find((a) => a.id === id)!;
		if (asset.kind === "video" && (asset.durationMs ?? 0) < broll.durationMs * broll.speed)
			throw new Error("候选素材太短，无法覆盖相同时间区间");
		const next = structuredClone(project),
			item = next.composition.broll.find((b) => b.id === broll.id)!;
		item.assetId = id;
		item.sourceStartMs = 0;
		return next;
	};
	return (
		<details open>
			<summary>手工候选集 · 相同时间区间</summary>
			{project.composition.assets
				.filter(
					(a) =>
						a.kind !== "audio" &&
						!project.composition.sources?.some((s) => s.assetId === a.id),
				)
				.map((a) => (
					<div key={a.id} className="my-2">
						<label>
							<input
								type="checkbox"
								checked={(broll.candidateAssetIds ?? []).includes(a.id)}
								onChange={(e) =>
									ctx.changeBroll({
										...broll,
										candidateAssetIds: e.target.checked
											? [...(broll.candidateAssetIds ?? []), a.id]
											: (broll.candidateAssetIds ?? []).filter(
													(id) => id !== a.id,
												),
									})
								}
							/>
							{a.path.split(/[\\/]/).pop()}
						</label>
						{broll.candidateAssetIds?.includes(a.id) && (
							<div className="flex gap-2">
								<button
									onClick={() => {
										try {
											setPreview(build(a.id));
										} catch (e) {
											toast.error(String(e));
										}
									}}
								>
									试听
								</button>
								<button
									onClick={() => {
										try {
											ctx.commit(build(a.id));
										} catch (e) {
											toast.error(String(e));
										}
									}}
								>
									替换当前 B-roll
								</button>
							</div>
						)}
					</div>
				))}
			{preview && (
				<CompositionAuditionDialog
					project={preview}
					fromMs={fromMs}
					toMs={fromMs + broll.durationMs}
					onClose={() => setPreview(null)}
				/>
			)}
		</details>
	);
}
