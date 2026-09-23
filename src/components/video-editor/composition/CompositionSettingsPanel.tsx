import { NumberField } from "./NumberField";
import { SourceEditingPanel } from "./SourceEditingPanel";
import { toast } from "sonner";
import {
	timeline,
	shotDuration,
	CARD_DURATIONS,
	type LayoutMode,
	type Card,
	type BRoll,
} from "../../../../shared/composition";
import { useCompositionContext } from "./useCompositionEditing";
import "./composition.css";
const layoutNames: Record<LayoutMode, string> = {
	screen: "屏幕全屏",
	presenter: "人物全屏",
	pip: "屏幕＋人像",
	split: "左右分屏",
};
export function CompositionSettingsPanel() {
	const controller = useCompositionContext();
	if (!controller) return null;
	if (!controller.project)
		return (
			<div className="w-[280px] rounded-xl bg-card p-4 text-sm">
				<h2>镜头与素材</h2>
				<p className="my-3 text-muted-foreground">
					为当前录制添加分段布局、辅助画面和包装幕。
				</p>
				<button
					className="rounded bg-primary px-3 py-2 text-primary-foreground"
					onClick={() => void controller.enable()}
				>
					添加镜头编排
				</button>
			</div>
		);
	const { project, commit, operation, changeShot, changeBroll, time } = controller;
	const c = project.composition,
		selectedShot = c.shots.find((s) => s.id === controller.selected),
		selectedBroll = c.broll.find((b) => b.id === controller.selected);
	const setSelected = controller.select,
		setError = (message: string) => toast.error(message);
	const addAsset = async () => {
		const media = await window.electronAPI.compositionPickMedia();
		if (!media) return;
		const kind = /\.(png|jpe?g|webp)$/i.test(media.path)
			? "image"
			: media.width
				? "video"
				: "audio";
		commit({
			...project,
			composition: {
				...c,
				assets: [...c.assets, { id: crypto.randomUUID(), kind, ...media }],
			},
		});
	};
	const addBroll = () => {
		const shot =
			selectedShot?.kind === "main"
				? selectedShot
				: timeline(c).find(
						(e) => e.shot.kind === "main" && time >= e.startMs && time < e.endMs,
					)?.shot;
		const asset = c.assets.find(
			(a) => a.kind !== "audio" && !c.sources?.some((source) => source.assetId === a.id),
		);
		if (!shot || !asset) {
			setError("先导入视频或图片，再选择主讲片段。");
			return;
		}
		const entry = timeline(c).find((e) => e.shot.id === shot.id)!;
		let offset = Math.max(0, Math.min(time - entry.startMs, shotDuration(shot)));
		const existing = c.broll
			.filter((b) => b.clipId === shot.id)
			.sort((a, b) => a.offsetMs - b.offsetMs);
		for (const b of existing)
			if (offset >= b.offsetMs && offset < b.offsetMs + b.durationMs)
				offset = b.offsetMs + b.durationMs;
		const availableEnd =
			existing.find((b) => b.offsetMs > offset)?.offsetMs ?? shotDuration(shot);
		const length = Math.min(
			3000,
			availableEnd - offset,
			asset.kind === "video" ? (asset.durationMs ?? 3000) : 3000,
		);
		if (length <= 0) {
			setError("当前片段没有可放置辅助画面的空余时间。");
			return;
		}
		const b: BRoll = {
			id: crypto.randomUUID(),
			clipId: shot.id,
			assetId: asset.id,
			offsetMs: offset,
			durationMs: length,
			sourceStartMs: 0,
			speed: 1,
			muted: true,
			volume: 1,
			mode: "fullscreen",
			x: 0.04,
			y: 0.04,
			width: 0.35,
			height: 0.35,
		};
		if (commit({ ...project, composition: { ...c, broll: [...c.broll, b] } }))
			setSelected(b.id);
	};
	const addCard = (template: Card["template"]) => {
		const card: Card = {
			id: crypto.randomUUID(),
			kind: "card",
			template,
			durationMs: CARD_DURATIONS[template],
			title:
				template === "intro" ? "视频标题" : template === "outro" ? "感谢观看" : "核心观点",
			subtitle: "",
			background: "#111827",
			color: "#ffffff",
			animation: "fade",
		};
		operation({ type: "insert-card", atMs: time, card });
		setSelected(card.id);
	};
	return (
		<div className="composition-settings w-[280px] overflow-y-auto rounded-xl bg-card p-4 text-sm">
			<fieldset>
				<h2>镜头与素材</h2>
				<SourceEditingPanel />
				{!c.sources && !project.editor.webcam?.sourcePath && (
					<p>当前工程未关联人像素材。请先在摄像头面板导入，才能使用人物布局。</p>
				)}
				<button onClick={() => void addAsset().catch((e) => setError(String(e)))}>
					导入辅助素材
				</button>
				<button onClick={addBroll}>添加 B-roll</button>
				<label>
					插入包装幕
					<select
						aria-label="插入包装幕"
						value=""
						onChange={(e) => addCard(e.target.value as Card["template"])}
					>
						<option value="" disabled>
							选择模板…
						</option>
						{(["intro", "chapter", "quote", "outro"] as const).map((v, i) => (
							<option key={v} value={v}>
								{["片头", "章节卡", "观点卡", "片尾"][i]}
							</option>
						))}
					</select>
				</label>
				{!selectedShot && !selectedBroll && !c.sources && (
					<p>在时间线上选择片段，调整布局、时长和属性。</p>
				)}

				{selectedShot && !(selectedShot.kind === "main" && selectedShot.sourceClips) && (
					<>
						<h2>{selectedShot.kind === "main" ? "主讲片段" : "包装幕"}</h2>
						<small>{selectedShot.id}</small>
						{selectedShot.kind === "main" ? (
							<>
								<label>
									画面布局
									<select
										aria-label="画面布局"
										value={selectedShot.layout.mode}
										onChange={(e) =>
											operation({
												type: "layout",
												clipId: selectedShot.id,
												layout: {
													...selectedShot.layout,
													mode: e.target.value as LayoutMode,
												},
											})
										}
									>
										{Object.entries(layoutNames).map(([mode, label]) => (
											<option
												key={mode}
												value={mode}
												disabled={
													mode !== "screen" &&
													!project.editor.webcam?.sourcePath
												}
											>
												{label}
											</option>
										))}
									</select>
								</label>
								<NumberField
									label="素材起点（毫秒）"
									value={selectedShot.sourceStartMs}
									onChange={(n) =>
										operation({
											type: "trim",
											clipId: selectedShot.id,
											sourceStartMs: n,
											sourceEndMs: selectedShot.sourceEndMs,
										})
									}
								/>
								<NumberField
									label="素材终点（毫秒）"
									value={selectedShot.sourceEndMs}
									onChange={(n) =>
										operation({
											type: "trim",
											clipId: selectedShot.id,
											sourceStartMs: selectedShot.sourceStartMs,
											sourceEndMs: n,
										})
									}
								/>
								<NumberField
									label="播放速度"
									value={selectedShot.speed}
									min={0.125}
									max={16}
									step={0.25}
									onChange={(n) =>
										operation({
											type: "speed",
											clipId: selectedShot.id,
											speed: n,
										})
									}
								/>
								<NumberField
									label="原声音量"
									value={selectedShot.volume ?? 1}
									max={4}
									step={0.1}
									onChange={(n) => changeShot({ ...selectedShot, volume: n })}
								/>
								<label>
									<input
										type="checkbox"
										checked={selectedShot.muted ?? false}
										onChange={(e) =>
											changeShot({
												...selectedShot,
												muted: e.target.checked,
											})
										}
									/>
									静音
								</label>
								{selectedShot.layout.mode === "split" && (
									<NumberField
										label="人物占比"
										value={selectedShot.layout.presenterRatio ?? 0.35}
										min={0.2}
										max={0.8}
										step={0.05}
										onChange={(n) =>
											changeShot({
												...selectedShot,
												layout: {
													...selectedShot.layout,
													presenterRatio: n,
												},
											})
										}
									/>
								)}
								{selectedShot.layout.mode === "pip" &&
									(["x", "y", "width", "height", "roundness"] as const).map(
										(key) => (
											<NumberField
												key={key}
												label={
													{
														x: "人像横向位置",
														y: "人像纵向位置",
														width: "人像宽度",
														height: "人像高度",
														roundness: "人像圆角",
													}[key]
												}
												value={
													selectedShot.layout[key] ??
													(key === "roundness"
														? 100
														: key === "x" || key === "y"
															? 0.98
															: 0.23)
												}
												max={key === "roundness" ? 100 : 1}
												step={key === "roundness" ? 5 : 0.05}
												onChange={(n) =>
													changeShot({
														...selectedShot,
														layout: {
															...selectedShot.layout,
															[key]: n,
														},
													})
												}
											/>
										),
									)}
								<button
									onClick={() => {
										const entry = timeline(c).find(
											(e) => e.shot.id === selectedShot.id,
										)!;
										operation({
											type: "split",
											clipId: selectedShot.id,
											offsetMs: time - entry.startMs,
										});
									}}
								>
									在播放头分割
								</button>
							</>
						) : (
							<>
								<label>
									包装类型
									<select
										value={selectedShot.template}
										onChange={(e) =>
											changeShot({
												...selectedShot,
												template: e.target.value as Card["template"],
												assetId:
													e.target.value === "image"
														? c.assets.find((a) => a.kind === "image")
																?.id
														: selectedShot.assetId,
											})
										}
									>
										{["intro", "chapter", "quote", "outro", "image"].map(
											(v, i) => (
												<option key={v} value={v}>
													{
														[
															"片头",
															"章节卡",
															"观点卡",
															"片尾",
															"图片卡",
														][i]
													}
												</option>
											),
										)}
									</select>
								</label>
								<label>
									标题
									<input
										key={selectedShot.id + "title" + selectedShot.title}
										defaultValue={selectedShot.title}
										onBlur={(e) => {
											if (e.target.value !== selectedShot.title)
												changeShot({
													...selectedShot,
													title: e.target.value,
												});
										}}
									/>
								</label>
								<label>
									副标题
									<input
										key={selectedShot.id + "subtitle" + selectedShot.subtitle}
										defaultValue={selectedShot.subtitle}
										onBlur={(e) => {
											if (e.target.value !== selectedShot.subtitle)
												changeShot({
													...selectedShot,
													subtitle: e.target.value,
												});
										}}
									/>
								</label>
								<NumberField
									label="包装时长（毫秒）"
									value={selectedShot.durationMs}
									min={100}
									step={100}
									onChange={(n) => changeShot({ ...selectedShot, durationMs: n })}
								/>
								<label>
									背景颜色
									<input
										type="color"
										value={selectedShot.background ?? "#111827"}
										onChange={(e) =>
											changeShot({
												...selectedShot,
												background: e.target.value,
											})
										}
									/>
								</label>
								<label>
									文字颜色
									<input
										type="color"
										value={selectedShot.color ?? "#ffffff"}
										onChange={(e) =>
											changeShot({
												...selectedShot,
												color: e.target.value,
											})
										}
									/>
								</label>
								<label>
									背景图片
									<select
										value={selectedShot.assetId ?? ""}
										onChange={(e) =>
											changeShot({
												...selectedShot,
												assetId: e.target.value || undefined,
											})
										}
									>
										<option value="">无</option>
										{c.assets
											.filter((a) => a.kind === "image")
											.map((a) => (
												<option key={a.id} value={a.id}>
													{a.path.split(/[\\/]/).pop()}
												</option>
											))}
									</select>
								</label>
								<label>
									动画
									<select
										value={selectedShot.animation ?? "none"}
										onChange={(e) =>
											changeShot({
												...selectedShot,
												animation: e.target.value as "none" | "fade",
											})
										}
									>
										<option value="none">静态</option>
										<option value="fade">淡入淡出</option>
									</select>
								</label>
							</>
						)}
						<button onClick={() => operation({ type: "remove", id: selectedShot.id })}>
							删除片段
						</button>
					</>
				)}
				{selectedBroll && (
					<>
						<h2>B-roll 辅助画面</h2>
						<label>
							素材
							<select
								value={selectedBroll.assetId}
								onChange={(e) =>
									changeBroll({
										...selectedBroll,
										assetId: e.target.value,
									})
								}
							>
								{c.assets
									.filter((a) => a.kind !== "audio")
									.map((a) => (
										<option key={a.id} value={a.id}>
											{a.path.split(/[\\/]/).pop()}
										</option>
									))}
							</select>
						</label>
						<label>
							展示方式
							<select
								value={selectedBroll.mode}
								onChange={(e) =>
									changeBroll({
										...selectedBroll,
										mode: e.target.value as "pip" | "fullscreen",
									})
								}
							>
								<option value="fullscreen">全屏覆盖</option>
								<option value="pip">画中画</option>
							</select>
						</label>
						{(
							[
								"offsetMs",
								"durationMs",
								"sourceStartMs",
								"speed",
								"volume",
								"x",
								"y",
								"width",
								"height",
							] as const
						).map((key) => (
							<NumberField
								key={key}
								label={
									{
										offsetMs: "段内起点（毫秒）",
										durationMs: "持续时间（毫秒）",
										sourceStartMs: "素材起点（毫秒）",
										speed: "播放倍速",
										volume: "素材音量",
										x: "横向位置",
										y: "纵向位置",
										width: "宽度",
										height: "高度",
									}[key]
								}
								value={selectedBroll[key]}
								step={
									["speed", "volume", "x", "y", "width", "height"].includes(key)
										? 0.05
										: 100
								}
								onChange={(n) => changeBroll({ ...selectedBroll, [key]: n })}
							/>
						))}
						{(["x", "y", "width", "height"] as const).map((key) => (
							<NumberField
								key={"crop" + key}
								label={"裁切 " + key}
								value={
									selectedBroll.crop?.[key] ??
									(key === "width" || key === "height" ? 1 : 0)
								}
								max={1}
								step={0.05}
								onChange={(n) =>
									changeBroll({
										...selectedBroll,
										crop: {
											x: 0,
											y: 0,
											width: 1,
											height: 1,
											...selectedBroll.crop,
											[key]: n,
										},
									})
								}
							/>
						))}
						<label>
							<input
								type="checkbox"
								checked={selectedBroll.muted}
								onChange={(e) =>
									changeBroll({
										...selectedBroll,
										muted: e.target.checked,
									})
								}
							/>
							辅助素材静音
						</label>
						<button
							onClick={() =>
								commit({
									...project,
									composition: {
										...c,
										broll: c.broll.filter((b) => b.id !== selectedBroll.id),
									},
								})
							}
						>
							删除 B-roll
						</button>
					</>
				)}
				<h2>素材库</h2>
				{c.assets.map((a) => (
					<p key={a.id}>
						{a.kind} · {a.path.split(/[\\/]/).pop()}
					</p>
				))}
			</fieldset>
		</div>
	);
}
