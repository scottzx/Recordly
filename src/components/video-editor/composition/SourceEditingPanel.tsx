import { useState } from "react";
import { toast } from "sonner";
import { shotDuration, timeline, type MainShot } from "../../../../shared/composition";
import {
	createSourceClip,
	findSourceItem,
	layoutLayers,
	updateSourceOffset,
	type ViewClip,
	type SourceClip,
	type SyncedSource,
} from "../../../../shared/compositionSources";
import { NumberField } from "./NumberField";
import { useCompositionContext } from "./useCompositionEditing";

export function SourceEditingPanel() {
	const controller = useCompositionContext()!;
	const project = controller.project!;
	const c = project.composition;
	if (!c.sources) return <button onClick={controller.enableSources}>展开为独立素材轨道</button>;
	const selected = findSourceItem(project, controller.selected);
	const group = c.shots.find((shot) => shot.id === controller.selected && shot.kind === "main") as
		| MainShot
		| undefined;
	const source = c.sources.find((s) => s.id === selected?.clip?.sourceId);
	const asset = c.assets.find((a) => a.id === source?.assetId);
	const addSource = async (kind: "camera" | "audio") => {
		const media = await window.electronAPI.compositionPickMedia();
		if (!media) return;
		if (kind === "camera" && (!media.width || /\.(png|jpe?g|webp)$/i.test(media.path)))
			throw new Error("请选择摄像头视频");
		if (kind === "audio" && !media.hasAudio) throw new Error("素材没有声音");
		const assetId = crypto.randomUUID();
		const source: SyncedSource = {
			id: crypto.randomUUID(),
			assetId,
			name: media.path.split(/[\\/]/).pop() || (kind === "camera" ? "摄像头" : "声音"),
			kind,
			timeOffsetMs: 0,
		};
		const next = structuredClone(project);
		next.composition.assets.push({
			id: assetId,
			...media,
			kind: media.width ? "video" : "audio",
		});
		next.composition.sources!.push(source);
		for (const shot of next.composition.shots)
			if (shot.kind === "main") shot.sourceClips!.push(createSourceClip(shot, source));
		if (controller.commit(next)) {
			controller.setSourcesExpanded(true);
			const shot = next.composition.shots.find((s) => s.kind === "main");
			if (shot?.kind === "main")
				controller.select(shot.sourceClips![shot.sourceClips!.length - 1].id);
		}
	};
	const splitSelected = () => {
		if (!selected) return;
		const entry = timeline(c).find((e) => e.shot.id === selected.shot.id)!;
		controller.operation({
			type: selected.clip ? "split-source" : "split-view",
			clipId: selected.shot.id,
			id: (selected.clip ?? selected.view)!.id,
			offsetMs: controller.time - entry.startMs,
		});
	};
	const updateClip = (patch: Partial<SourceClip>) => {
		if (!selected?.clip) return;
		controller.changeShot({
			...selected.shot,
			sourceClips: selected.shot.sourceClips!.map((clip) =>
				clip.id === selected.clip!.id ? { ...clip, ...patch } : clip,
			),
		});
	};
	return (
		<>
			<p>主讲段落联动剪辑；镜头编排只切换画面。选择下方素材轨可独立调整。</p>
			<button onClick={() => controller.setSourcesExpanded(!controller.sourcesExpanded)}>
				{controller.sourcesExpanded ? "收起素材轨道" : "展开素材轨道"}
			</button>
			<button onClick={() => void addSource("camera").catch((e) => toast.error(String(e)))}>
				添加同步机位
			</button>
			<button onClick={() => void addSource("audio").catch((e) => toast.error(String(e)))}>
				添加同步声音
			</button>
			{group && (
				<>
					<h2>主讲段落 · 整组联动</h2>
					<NumberField
						label="段落素材起点（毫秒）"
						value={group.sourceStartMs}
						max={group.sourceEndMs - 1}
						onChange={(n) =>
							controller.operation({
								type: "trim",
								clipId: group.id,
								sourceStartMs: n,
								sourceEndMs: group.sourceEndMs,
							})
						}
					/>
					<NumberField
						label="段落素材终点（毫秒）"
						value={group.sourceEndMs}
						min={group.sourceStartMs + 1}
						onChange={(n) =>
							controller.operation({
								type: "trim",
								clipId: group.id,
								sourceStartMs: group.sourceStartMs,
								sourceEndMs: n,
							})
						}
					/>
					<NumberField
						label="整组速度"
						value={group.speed}
						min={0.125}
						max={16}
						step={0.125}
						onChange={(speed) =>
							controller.operation({ type: "speed", clipId: group.id, speed })
						}
					/>
					<label>
						<input
							type="checkbox"
							checked={Boolean(group.muted)}
							onChange={(e) =>
								controller.changeShot({ ...group, muted: e.target.checked })
							}
						/>
						整组静音
					</label>
					<button onClick={() => controller.split(controller.time)}>
						在播放头分割整组
					</button>
					<button onClick={() => controller.operation({ type: "remove", id: group.id })}>
						删除主讲段落及关联片段
					</button>
					{c.sources.map((s) => (
						<button
							key={s.id}
							onClick={() => {
								const existing = group.sourceClips?.find(
									(clip) => clip.sourceId === s.id,
								);
								if (existing) controller.select(existing.id);
								else {
									const clip = createSourceClip(group, s);
									controller.changeShot({
										...group,
										sourceClips: [...group.sourceClips!, clip],
									});
									controller.select(clip.id);
								}
							}}
						>
							编辑 {s.name}
						</button>
					))}
					{!group.views?.length && (
						<button
							onClick={() => {
								const screen = c.sources!.find((s) => s.kind !== "audio");
								if (!screen) return;
								const view: ViewClip = {
									id: crypto.randomUUID(),
									offsetMs: 0,
									durationMs: shotDuration(group),
									layers: layoutLayers({ mode: "screen" }, screen.id),
								};
								controller.changeShot({ ...group, views: [view] });
								controller.select(view.id);
							}}
						>
							添加镜头编排
						</button>
					)}
				</>
			)}
			{selected?.view && (
				<ViewProperties key={selected.view.id} shot={selected.shot} view={selected.view} />
			)}
			{selected?.clip && source && (
				<>
					<h2>
						{source.name} · {selected.clip.linked ? "跟随同步" : "独立调整"}
					</h2>
					<label>
						素材名称
						<input
							key={source.id + source.name}
							defaultValue={source.name}
							onBlur={(e) => {
								if (e.target.value.trim() && e.target.value !== source.name)
									controller.commit({
										...project,
										composition: {
											...c,
											sources: c.sources!.map((s) =>
												s.id === source.id
													? { ...s, name: e.target.value.trim() }
													: s,
											),
										},
									});
							}}
						/>
					</label>
					<NumberField
						label="来源同步偏移（毫秒，正值表示晚开始）"
						value={source.timeOffsetMs}
						min={-86400000}
						onChange={(n) =>
							controller.commit(updateSourceOffset(project, source.id, n))
						}
					/>
					<small>影响该来源所有跟随同步的片段；独立片段保持原位。</small>
					<NumberField
						label="片段起点（段内毫秒）"
						value={selected.clip.offsetMs}
						max={shotDuration(selected.shot) - selected.clip.durationMs}
						onChange={(n) => updateClip({ offsetMs: n, linked: false })}
					/>
					<NumberField
						label="片段时长（毫秒）"
						value={selected.clip.durationMs}
						min={1}
						max={shotDuration(selected.shot) - selected.clip.offsetMs}
						onChange={(n) => updateClip({ durationMs: n })}
					/>
					<NumberField
						label="读取素材起点（毫秒）"
						value={selected.clip.sourceStartMs}
						min={-86400000}
						onChange={(n) => updateClip({ sourceStartMs: n, linked: false })}
					/>
					<NumberField
						label="片段速度"
						value={selected.clip.speed}
						min={0.125}
						max={16}
						step={0.125}
						onChange={(n) => updateClip({ speed: n, linked: false })}
					/>
					<label>
						<input
							type="checkbox"
							checked={selected.clip.muted}
							onChange={(e) => updateClip({ muted: e.target.checked })}
						/>
						此片段声音静音
					</label>
					<NumberField
						label="片段音量"
						value={selected.clip.volume}
						max={4}
						step={0.1}
						onChange={(n) => updateClip({ volume: n })}
					/>
					{!selected.clip.linked && (
						<button
							onClick={() =>
								updateClip({
									linked: true,
									speed: selected.shot.speed,
									sourceStartMs:
										selected.shot.sourceStartMs +
										selected.clip!.offsetMs * selected.shot.speed -
										source.timeOffsetMs,
								})
							}
						>
							恢复该片段同步
						</button>
					)}
					{source.kind !== "audio" && (
						<p>显示和位置在「镜头编排」轨调整；静音不会隐藏画面。</p>
					)}
					{asset?.durationMs !== undefined &&
						selected.clip.sourceStartMs +
							selected.clip.durationMs * selected.clip.speed >
							asset.durationMs && (
							<p>
								素材提前结束：画面保持末帧，声音在素材结束处停止。可在镜头编排中切换其他来源。
							</p>
						)}
				</>
			)}
			{selected && (
				<>
					<button onClick={splitSelected}>
						在播放头分割{selected.view ? "镜头" : "此素材"}
					</button>
					<button
						onClick={() =>
							controller.removeSourceItem((selected.clip ?? selected.view)!.id)
						}
					>
						删除{selected.view ? "此镜头（保留声音）" : "此素材片段"}
					</button>
				</>
			)}
		</>
	);
}
function ViewProperties({ shot, view }: { shot: MainShot; view: ViewClip }) {
	const controller = useCompositionContext()!;
	const sources = controller.project!.composition.sources!.filter((s) => s.kind !== "audio");
	const [primary, setPrimary] = useState(view.layers[0]?.sourceId ?? sources[0]?.id ?? "");
	const [secondary, setSecondary] = useState(
		view.layers[1]?.sourceId ?? sources.find((s) => s.id !== primary)?.id ?? "",
	);
	const change = (next: ViewClip) =>
		controller.changeShot({
			...shot,
			views: shot.views!.map((v) => (v.id === view.id ? next : v)),
		});
	const span = (start: number, end: number) => {
		const entry = timeline(controller.project!.composition).find((e) => e.shot.id === shot.id)!;
		controller.sourceSpan(view.id, { start: entry.startMs + start, end: entry.startMs + end });
	};
	return (
		<>
			<h2>镜头编排 · 只调整画面</h2>
			<NumberField
				label="镜头起点（段内毫秒）"
				value={view.offsetMs}
				max={view.offsetMs + view.durationMs - 1}
				onChange={(n) => span(n, view.offsetMs + view.durationMs)}
			/>
			<NumberField
				label="镜头终点（段内毫秒）"
				value={view.offsetMs + view.durationMs}
				min={view.offsetMs + 1}
				max={shotDuration(shot)}
				onChange={(n) => span(view.offsetMs, n)}
			/>
			<small>调整切点会同步调整相邻镜头边界，不改变声音或素材入点。</small>
			<label>
				主画面来源
				<select value={primary} onChange={(e) => setPrimary(e.target.value)}>
					{sources.map((s) => (
						<option key={s.id} value={s.id}>
							{s.name}
						</option>
					))}
				</select>
			</label>
			<label>
				第二画面来源
				<select value={secondary} onChange={(e) => setSecondary(e.target.value)}>
					<option value="">选择来源</option>
					{sources
						.filter((s) => s.id !== primary)
						.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name}
							</option>
						))}
				</select>
			</label>
			<button
				onClick={() =>
					change({ ...view, layers: layoutLayers({ mode: "screen" }, primary) })
				}
			>
				主画面全屏
			</button>
			<button
				disabled={!secondary || primary === secondary}
				onClick={() =>
					change({ ...view, layers: layoutLayers({ mode: "pip" }, primary, secondary) })
				}
			>
				画中画
			</button>
			<button
				disabled={!secondary || primary === secondary}
				onClick={() =>
					change({
						...view,
						layers: layoutLayers(
							{ mode: "split", presenterRatio: 0.5 },
							primary,
							secondary,
						),
					})
				}
			>
				左右分屏
			</button>
			{view.layers.map((layer, i) => {
				const update = (patch: Partial<typeof layer>) =>
					change({
						...view,
						layers: view.layers.map((l, index) =>
							index === i ? { ...l, ...patch } : l,
						),
					});
				return (
					<details key={layer.sourceId} open={view.layers.length === 1}>
						<summary>
							图层 {i + 1} · {sources.find((s) => s.id === layer.sourceId)?.name}
						</summary>
						<label>
							替换画面来源
							<select
								value={layer.sourceId}
								onChange={(e) => update({ sourceId: e.target.value })}
							>
								{sources
									.filter(
										(s) =>
											s.id === layer.sourceId ||
											!view.layers.some((l) => l.sourceId === s.id),
									)
									.map((s) => (
										<option key={s.id} value={s.id}>
											{s.name}
										</option>
									))}
							</select>
						</label>
						{(["x", "y", "width", "height"] as const).map((key) => (
							<NumberField
								key={key}
								label={
									{ x: "横向位置", y: "纵向位置", width: "宽度", height: "高度" }[
										key
									]
								}
								value={layer[key]}
								min={key === "width" || key === "height" ? 0.01 : 0}
								max={1}
								step={0.01}
								onChange={(n) => update({ [key]: n })}
							/>
						))}
						<label>
							画面适配
							<select
								value={layer.fit ?? "cover"}
								onChange={(e) =>
									update({ fit: e.target.value as "contain" | "cover" })
								}
							>
								<option value="contain">完整显示</option>
								<option value="cover">裁切填满</option>
							</select>
						</label>
						<label>
							<input
								type="checkbox"
								checked={Boolean(layer.mirror)}
								onChange={(e) => update({ mirror: e.target.checked })}
							/>
							水平镜像
						</label>
						<NumberField
							label="圆角"
							value={layer.roundness ?? 0}
							max={100}
							onChange={(n) => update({ roundness: n })}
						/>
						{(["x", "y", "width", "height"] as const).map((key) => (
							<NumberField
								key={`crop-${key}`}
								label={`裁切${{ x: "横向起点", y: "纵向起点", width: "宽度", height: "高度" }[key]}`}
								value={(layer.crop ?? { x: 0, y: 0, width: 1, height: 1 })[key]}
								min={key === "width" || key === "height" ? 0.01 : 0}
								max={1}
								step={0.01}
								onChange={(n) =>
									update({
										crop: {
											x: 0,
											y: 0,
											width: 1,
											height: 1,
											...layer.crop,
											[key]: n,
										},
									})
								}
							/>
						))}
						<button
							disabled={i === view.layers.length - 1}
							onClick={() => {
								const layers = [...view.layers];
								[layers[i], layers[i + 1]] = [layers[i + 1], layers[i]];
								change({ ...view, layers });
							}}
						>
							上移一层
						</button>
						<button
							onClick={() =>
								change({
									...view,
									layers: view.layers.filter((_, index) => index !== i),
								})
							}
						>
							隐藏此画面
						</button>
					</details>
				);
			})}
			<label>
				叠加更多画面
				<select
					value=""
					onChange={(e) =>
						change({
							...view,
							layers: [
								...view.layers,
								{
									sourceId: e.target.value,
									x: 0.05,
									y: 0.05,
									width: 0.3,
									height: 0.3,
								},
							],
						})
					}
				>
					<option value="">选择来源…</option>
					{sources
						.filter((s) => !view.layers.some((l) => l.sourceId === s.id))
						.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name}
							</option>
						))}
				</select>
			</label>
		</>
	);
}
