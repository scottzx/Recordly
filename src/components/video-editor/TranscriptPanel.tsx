import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCompositionContext } from "./composition/useCompositionEditing";
import { CompositionPreview } from "./composition/CompositionPreview";
import { loadEditorPreferences } from "./editorPreferences";
import {
	compileReview,
	pausePlan,
	projectRevision,
	reviewConflicts,
	validateReview,
	canonicalJson,
	type ReviewFile,
	type ReviewPlan,
} from "../../../shared/review";
import {
	correctionKey,
	projectTranscript,
	requireInput,
	type TranscriptRow,
} from "../../../shared/transcript";
import { timeline, type CompositionProject } from "../../../shared/composition";
import { DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";

const timecode = (ms: number) =>
	`${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const button = "rounded border px-2 py-1.5 text-xs disabled:opacity-40";
export function TranscriptPanel({ reviewOnly = false }: { reviewOnly?: boolean }) {
	const ctx = useCompositionContext()!;
	const current = useRef(ctx);
	current.current = ctx;
	const project = ctx.project,
		state = project?.composition.transcript;
	const review = project?.composition.reviewDraft;
	const [query, setQuery] = useState(""),
		[selected, setSelected] = useState<string[]>([]),
		[busy, setBusy] = useState(false),
		[progress, setProgress] = useState("");
	const job = useRef<string>();
	const [preview, setPreview] = useState<{
		project: CompositionProject;
		time: number;
		end: number;
		playing: boolean;
	} | null>(null);
	const [summary, setSummary] = useState(""),
		[error, setError] = useState("");
	const [stale, setStale] = useState(false);
	useEffect(() => {
		let disposed = false;
		if (!project || !review) {
			setStale(false);
			return;
		}
		void projectRevision(project).then((revision) => {
			if (!disposed) setStale(revision !== review.plan.baseRevision);
		});
		return () => {
			disposed = true;
		};
	}, [project, review]);
	const rows = useMemo(() => (project ? projectTranscript(project) : []), [project]);
	const run = async (action: () => Promise<unknown>) => {
		setBusy(true);
		setError("");
		try {
			await action();
		} catch (e) {
			setError(String(e));
			toast.error(String(e));
		} finally {
			setBusy(false);
		}
	};
	useEffect(
		() =>
			window.electronAPI.onTranscriptProgress((value) => {
				if (value.id === job.current) setProgress(value.message);
			}),
		[],
	);
	useEffect(
		() => () => {
			if (job.current) void window.electronAPI.transcriptCancel(job.current);
		},
		[],
	);
	useEffect(() => {
		let disposed = false;
		if (!review) {
			setSummary("");
			return;
		}
		const ids = Object.keys(review.selection).filter(
			(id) => review.selection[id] === "accepted",
		);
		void compileReview(review.base, review.transcript, review.plan, ids)
			.then((r) => {
				if (!disposed)
					setSummary(
						`已采纳 ${ids.length} / ${review.plan.suggestions.length} 条 · 预计缩短 ${timecode(r.removedMs)}`,
					);
			})
			.catch((e) => {
				if (!disposed) setSummary(String(e));
			});
		return () => {
			disposed = true;
		};
	}, [review]);
	if (!project)
		return (
			<section className="w-[300px] rounded-xl bg-card p-4">
				<p>启用镜头编排后可按文稿剪辑。</p>
				<button className={button} onClick={() => void ctx.enable()}>
					启用镜头编排
				</button>
			</section>
		);
	if (!state || !project.composition.effectsTime)
		return (
			<section className="w-[300px] rounded-xl bg-card p-4">
				<p>建立来源映射后，生成全文文稿。</p>
				<button className={button} onClick={ctx.prepareTranscript}>
					准备文稿工作区
				</button>
			</section>
		);
	const saveReview = (file: ReviewFile) => {
		const next = structuredClone(current.current.project!);
		next.composition.reviewDraft = file;
		ctx.commitSnapshot(next);
	};
	const createReview = async (
		plan: ReviewPlan,
		importedTranscript?: ReviewFile["transcript"],
	) => {
		const base = structuredClone(current.current.project!);
		delete base.composition.reviewDraft;
		const transcript = importedTranscript ?? base.composition.transcript!;
		for (const shot of base.composition.shots)
			if (shot.kind === "main") {
				const instance = shot.instanceId ?? shot.id;
				const hasAudio = (base.composition.sources ?? []).some(
					(s) =>
						s.kind === "audio" &&
						shot.sourceClips?.some((c) => c.sourceId === s.id) &&
						base.composition.assets.find((a) => a.id === s.assetId)?.hasAudio !== false,
				);
				requireInput(
					!hasAudio ||
						transcript.documents.some(
							(d) => d.sourceId === transcript.sourceSelections[instance],
						),
					"仍有来源未成功转写，请先完成或重试文稿",
				);
			}
		requireInput(
			plan.baseRevision === (await projectRevision(base)),
			"建议引用已过期，请重新生成",
			"STALE_BASE",
		);
		validateReview(base, transcript, plan);
		for (const s of plan.suggestions)
			requireInput(
				s.kind === "manual" ? plan.producer.kind === "manual" : true,
				"手工建议必须由手工操作产生",
			);
		const fingerprints = await window.electronAPI.oralcutFingerprints(base);
		for (const doc of transcript.documents) {
			const asset = base.composition.assets.find((a) => a.id === doc.assetId);
			requireInput(
				asset && fingerprints[asset.path] === doc.fingerprint,
				"转写对应的素材已改变",
				"MEDIA_CHANGED",
			);
		}
		requireInput(
			(await projectRevision(current.current.project!)) === plan.baseRevision,
			"工程已改变",
			"STALE_BASE",
		);
		saveReview({
			schemaVersion: 1,
			base,
			transcript,
			plan,
			fingerprints,
			selection: Object.fromEntries(plan.suggestions.map((s) => [s.id, "pending"])),
		});
	};
	const generate = (force = false) =>
		run(async () => {
			const base = current.current.project!,
				revision = await projectRevision(base),
				preferences = loadEditorPreferences();
			const id = crypto.randomUUID();
			job.current = id;
			setProgress("正在准备转写…");
			try {
				const bundle = await window.electronAPI.transcriptGenerate(
					base,
					state.sourceSelections,
					{
						id,
						force,
						engine: base.editor.autoCaptionSettings?.engine ?? "transcribe-kit",
						model: preferences.whisperModelPath ?? undefined,
						executable: preferences.whisperExecutablePath ?? undefined,
						language: base.editor.autoCaptionSettings?.language ?? "auto",
					},
				);
				requireInput(
					(await projectRevision(current.current.project!)) === revision,
					"转写期间工程已修改；缓存已保留，请重试",
					"STALE_BASE",
				);
				const next = structuredClone(current.current.project!);
				next.composition.transcript = {
					documents: bundle.documents,
					history: bundle.history,
					sourceSelections: bundle.sourceSelections,
					corrections: bundle.corrections,
				};
				ctx.commitSnapshot(next);
				setProgress(
					bundle.complete
						? bundle.documents.some((d) => d.segments.length)
							? "文稿已生成"
							: "未识别到语音"
						: bundle.errors.map((e) => e.message).join("\n"),
				);
			} finally {
				job.current = undefined;
			}
		});
	const manual = () =>
		run(async () => {
			const base = current.current.project!;
			await createReview({
				schemaVersion: 1,
				id: crypto.randomUUID(),
				baseRevision: await projectRevision(base),
				producer: { kind: "manual", name: "Recordly" },
				suggestions: rows
					.filter((r) => selected.includes(r.key))
					.map((r, i) => ({
						id: `manual-${i}`,
						kind: "manual",
						action: "remove-range",
						reason: "手工选择整句删除",
						target: r,
					})),
			});
		});
	const audition = async (file: ReviewFile, id: string, after: boolean) => {
		requireInput(
			(await projectRevision(current.current.project!)) === file.plan.baseRevision,
			"审阅已过期，请重新生成",
			"STALE_BASE",
		);
		requireInput(
			canonicalJson(await window.electronAPI.oralcutFingerprints(file.base)) ===
				canonicalJson(file.fingerprints),
			"素材已改变，请重新转写",
			"MEDIA_CHANGED",
		);
		const suggestion = file.plan.suggestions.find((s) => s.id === id)!;
		const { resolveReference } = await import("../../../shared/transcript");
		const range = resolveReference(file.base, file.transcript, suggestion.target);
		const target = after
			? (await compileReview(file.base, file.transcript, file.plan, [id])).project
			: file.base;
		setPreview({
			project: target,
			time: Math.max(0, range.startMs - 1500) / 1000,
			end: (after ? range.startMs + 1500 : range.endMs + 1500) / 1000,
			playing: true,
		});
	};
	const apply = () =>
		run(async () => {
			requireInput(review, "没有审阅");
			const latest = current.current.project!;
			requireInput(
				canonicalJson(await window.electronAPI.oralcutFingerprints(latest)) ===
					canonicalJson(review.fingerprints),
				"素材已改变，请重新转写",
				"MEDIA_CHANGED",
			);
			const revision = await projectRevision(latest);
			const ids = Object.keys(review.selection).filter(
				(id) => review.selection[id] === "accepted",
			);
			const result = await compileReview(latest, review.transcript, review.plan, ids);
			requireInput(
				(await projectRevision(current.current.project!)) === revision,
				"应用前工程已改变",
				"STALE_BASE",
			);
			ctx.commitSnapshot(result.project);
			setSelected([]);
			toast.success(
				ids.length ? "已应用，可用撤销恢复本轮修改" : "未采纳任何建议，工程保持原样",
			);
		});
	const selectRow = (r: TranscriptRow, shift: boolean) => {
		ctx.seek(r.startMs);
		if (shift && selected.length) {
			const a = rows.findIndex((row) => row.key === selected[0]),
				b = rows.indexOf(r);
			setSelected(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((row) => row.key));
		} else setSelected([r.key]);
	};
	return (
		<section
			className="flex w-[320px] min-h-0 flex-col overflow-y-auto rounded-xl bg-card p-3 text-sm"
			aria-label={reviewOnly ? "修改审阅" : "文稿"}
		>
			<h2 className="mb-3 font-semibold">{reviewOnly ? "修改审阅" : "全文文稿"}</h2>
			{!reviewOnly && (
				<>
					<input
						aria-label="搜索文稿"
						placeholder="搜索文稿"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="mb-2 rounded border bg-transparent p-2"
					/>
					{timeline(project.composition)
						.filter((e) => e.shot.kind === "main")
						.filter(
							(e, i, all) =>
								all.findIndex(
									(x) =>
										x.shot.kind === "main" &&
										e.shot.kind === "main" &&
										(x.shot.instanceId ?? x.shot.id) ===
											(e.shot.instanceId ?? e.shot.id),
								) === i,
						)
						.map(({ shot }) => {
							if (shot.kind !== "main") return null;
							const instance = shot.instanceId ?? shot.id,
								sources =
									project.composition.sources?.filter(
										(s) =>
											s.kind === "audio" &&
											shot.sourceClips?.some((c) => c.sourceId === s.id),
									) ?? [];
							return (
								<label key={instance} className="mb-2 text-xs">
									{shot.name ?? instance}
									{sources.length ? (
										<select
											aria-label={`${shot.name ?? instance} 讲解来源`}
											value={
												state.sourceSelections[instance] ??
												(sources.length === 1 ? sources[0].id : "")
											}
											onChange={(e) => {
												const next = structuredClone(project);
												next.composition.transcript!.sourceSelections[
													instance
												] = e.target.value;
												ctx.commitSnapshot(next);
											}}
											className="ml-2 max-w-full rounded border bg-card p-1"
										>
											<option value="">选择讲解来源</option>
											{sources.map((s) => (
												<option key={s.id} value={s.id}>
													{s.name}
												</option>
											))}
										</select>
									) : (
										<span> · 无讲解音频</span>
									)}
								</label>
							);
						})}
					<div className="mb-2 flex flex-wrap gap-2">
						<button disabled={busy} className={button} onClick={() => void generate()}>
							生成／重试文稿
						</button>
						{state.documents.length > 0 && (
							<button
								disabled={busy}
								className={button}
								onClick={() => void generate(true)}
							>
								重新转写
							</button>
						)}
						{busy && (
							<button
								className={button}
								onClick={() =>
									job.current &&
									void window.electronAPI.transcriptCancel(job.current)
								}
							>
								取消
							</button>
						)}
						<button
							disabled={busy || !state.documents.length}
							className={button}
							onClick={() =>
								void run(async () => createReview(await pausePlan(project, state)))
							}
						>
							检查长停顿
						</button>
						<button
							disabled={busy || !selected.length}
							className={button}
							onClick={() => void manual()}
						>
							✂ 从视频中删去（{selected.length} 句）
						</button>
						<button
							className={button}
							disabled={!rows.length}
							onClick={() => {
								const next = structuredClone(project);
								const generated = rows.map((r) => ({
									id: `transcript:${r.key}`,
									text: r.text,
									startMs: r.startMs,
									endMs: r.endMs,
								}));
								next.editor.autoCaptions = [
									...(next.editor.autoCaptions ?? []).filter(
										(c) => !c.id.startsWith("transcript:"),
									),
									...generated,
								];
								next.editor.autoCaptionSettings = {
									...(next.editor.autoCaptionSettings ??
										DEFAULT_AUTO_CAPTION_SETTINGS),
									enabled: true,
								};
								ctx.commitSnapshot(next);
							}}
						>
							生成／更新绑定字幕
						</button>
						<button
							className={button}
							onClick={() =>
								void run(async () => {
									if (!(await ctx.saveProject())) return;
									const saved = current.current;
									requireInput(saved.projectPath, "请保存工程后重试");
									const file = await window.electronAPI.oralcutExport(
										{
											schemaVersion: 1,
											baseRevision: await projectRevision(saved.project!),
											complete: true,
											...saved.project!.composition.transcript,
											errors: [],
										},
										"talk.transcript.json",
									);
									if (file) {
										await navigator.clipboard.writeText(
											`在外部 AI 助手中使用 recordly-oralcut skill，读取文稿 ${JSON.stringify(file)}，工程路径 ${JSON.stringify(saved.projectPath)}。用 recordly project inspect 检查此工程并生成 ReviewPlan v1 建议。保留重复／重录的引用证据；交回 Recordly 审阅后再应用。工程已保存；将建议写入独立 JSON 文件，不覆盖工程。`,
										);
										toast.success("已复制外部助手指令；尚未启动 AI 分析");
									}
								})
							}
						>
							交给 AI 助手
						</button>
					</div>
					{progress && (
						<p role="status" className="mb-2 whitespace-pre-wrap text-xs opacity-70">
							{progress}
						</p>
					)}
					<div className="space-y-2">
						{rows
							.filter((r) =>
								r.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
							)
							.map((r) => (
								<article
									key={r.key}
									className={`rounded border p-2 ${selected.includes(r.key) ? "border-blue-500" : ""} ${ctx.time >= r.startMs && ctx.time < r.endMs ? "bg-blue-500/10" : ""}`}
								>
									<button
										className="w-full text-left"
										onClick={(e) => selectRow(r, e.shiftKey)}
									>
										<span className="text-xs opacity-60">
											{timecode(r.startMs)} · {r.name}
										</span>
										<p>{r.text}</p>
									</button>
									<details className="mt-1 text-xs">
										<summary>校对文字／来源时码</summary>
										<p>
											{timecode(r.sourceStartMs)} – {timecode(r.sourceEndMs)}
										</p>
										<textarea
											aria-label="校对文稿文字"
											key={r.text}
											defaultValue={r.text}
											className="mt-2 w-full border bg-transparent p-1"
											onBlur={(e) => {
												if (e.target.value === r.text) return;
												const next = structuredClone(
													current.current.project!,
												);
												next.composition.transcript!.corrections[
													correctionKey(
														r.instanceId,
														r.transcriptId,
														r.segmentIds![0],
													)
												] = e.target.value;
												next.editor.autoCaptions =
													next.editor.autoCaptions?.map((c) =>
														c.id === `transcript:${r.key}`
															? { ...c, text: e.target.value }
															: c,
													);
												ctx.commitSnapshot(next);
											}}
										/>
									</details>
								</article>
							))}
					</div>
				</>
			)}
			<div className="mt-3 border-t pt-3">
				<button
					className={button}
					disabled={busy}
					onClick={() =>
						void run(async () => {
							const data = await window.electronAPI.oralcutImport();
							if (!data) return;
							const file = data as ReviewFile;
							if (file.base) {
								requireInput(file.schemaVersion === 1, "Invalid review file");
								await createReview(file.plan, file.transcript);
							} else await createReview(data as ReviewPlan);
						})
					}
				>
					导入 Agent 建议
				</button>
				<p className="my-2 text-xs opacity-60">
					长停顿由本地音频检测生成。重复／重录建议需外部 Agent 提供，所有建议默认待处理。
				</p>
				{review && (
					<>
						{stale && (
							<p role="alert" className="text-amber-600">
								审阅已过期：工程已改变，请重新生成建议。当前编辑已保留。
							</p>
						)}
						<p className="my-2" role="status">
							{summary}
						</p>
						{reviewConflicts(review.base, review.transcript, review.plan).map(
							(pair) => (
								<p key={pair.join(",")} className="text-xs text-amber-500">
									冲突：{pair.join(" / ")}，不可同时采纳
								</p>
							),
						)}
						{review.plan.suggestions.map((s) => (
							<article key={s.id} className="mb-2 rounded border p-2">
								<p>{s.reason}</p>
								<p className="text-xs opacity-60">
									{s.kind} · {timecode(s.target.sourceStartMs)}–
									{timecode(s.target.sourceEndMs)}
								</p>
								<p className="my-1 text-xs">
									{review.transcript.documents
										.find((d) => d.id === s.target.transcriptId)
										?.segments.filter((seg) =>
											s.target.segmentIds?.includes(seg.id),
										)
										.map((seg) => seg.text)
										.join(" ")}
								</p>
								<div className="flex flex-wrap gap-2">
									<button
										className={button}
										onClick={() =>
											void run(() => audition(review, s.id, false))
										}
									>
										原片试听
									</button>
									<button
										className={button}
										onClick={() => void run(() => audition(review, s.id, true))}
									>
										修改后试听
									</button>
									<select
										aria-label={`建议 ${s.id} 状态`}
										value={review.selection[s.id] ?? "pending"}
										onChange={(e) =>
											saveReview({
												...review,
												selection: {
													...review.selection,
													[s.id]: e.target.value as
														| "pending"
														| "accepted"
														| "rejected",
												},
											})
										}
										className="border bg-card"
									>
										<option value="pending">待处理</option>
										<option value="accepted">采纳</option>
										<option value="rejected">忽略</option>
									</select>
								</div>
							</article>
						))}
						<p className="my-2 text-xs opacity-60">
							主讲声画、字幕和效果会一起裁剪。独立配乐保持成片时间，请试听新切点。
						</p>
						<div className="sticky bottom-0 flex gap-2 bg-card py-2">
							<button
								disabled={busy || stale}
								className="rounded bg-blue-600 px-3 py-2 text-white"
								onClick={() => void apply()}
							>
								应用已采纳项
							</button>
							<button
								className={button}
								onClick={() =>
									void run(() =>
										window.electronAPI.oralcutExport(
											review,
											"talk.recordly-review.json",
										),
									)
								}
							>
								保存审阅
							</button>
						</div>
					</>
				)}
				{project.composition.reviewHistory?.map((r) => (
					<details key={r.id} className="my-2 text-xs">
						<summary>
							已应用 {r.acceptedIds.length} 项 · {r.id.slice(0, 8)}
						</summary>
						{r.plan.suggestions
							.filter((s) => r.acceptedIds.includes(s.id))
							.map((s) => (
								<p key={s.id}>{s.reason}</p>
							))}
					</details>
				))}
			</div>
			{error && (
				<p role="alert" className="mt-2 whitespace-pre-wrap text-xs text-red-500">
					{error}
				</p>
			)}
			{preview && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="审阅试听"
					className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-8"
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Escape") setPreview(null);
					}}
				>
					<div className="flex h-[70vh] w-full max-w-4xl flex-col rounded-xl bg-card p-4">
						<div className="mb-3 flex justify-between">
							<span>切点上下文试听</span>
							<button autoFocus className={button} onClick={() => setPreview(null)}>
								关闭
							</button>
						</div>
						<div className="relative min-h-0 flex-1">
							<CompositionPreview
								project={preview.project}
								videoPath={preview.project.videoPath}
								time={preview.time}
								playing={preview.playing}
								volume={1}
								suspended={false}
								onTime={(time) =>
									setPreview((p) =>
										p
											? { ...p, time, playing: time < p.end && p.playing }
											: null,
									)
								}
								onPlaying={(playing) =>
									setPreview((p) => (p ? { ...p, playing } : null))
								}
								onDuration={() => {}}
								onReady={() => {}}
								onError={setError}
							/>
						</div>
						<button
							className={button}
							onClick={() =>
								setPreview((p) => (p ? { ...p, playing: !p.playing } : null))
							}
						>
							{preview.playing ? "暂停" : "播放"}
						</button>
					</div>
				</div>
			)}
		</section>
	);
}
