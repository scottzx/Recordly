import { useState } from "react";
import { CompositionPreview } from "./CompositionPreview";
import type { CompositionProject } from "../../../../shared/composition";
export function CompositionAuditionDialog({
	project,
	fromMs,
	toMs,
	onClose,
}: {
	project: CompositionProject;
	fromMs: number;
	toMs: number;
	onClose: () => void;
}) {
	const [time, setTime] = useState(fromMs / 1000),
		[playing, setPlaying] = useState(true),
		[error, setError] = useState("");
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="候选试听"
			className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-8"
			onKeyDown={(e) => {
				e.stopPropagation();
				if (e.key === "Escape") onClose();
			}}
		>
			<div className="flex h-[70vh] w-full max-w-4xl flex-col rounded-xl bg-card p-4">
				<div className="mb-3 flex justify-between">
					<span>候选试听</span>
					<button autoFocus onClick={onClose}>
						关闭
					</button>
				</div>
				<div className="relative min-h-0 flex-1">
					<CompositionPreview
						project={project}
						videoPath={project.videoPath}
						time={time}
						playing={playing}
						volume={1}
						suspended={false}
						onTime={(t) => {
							setTime(t);
							if (t >= toMs / 1000) setPlaying(false);
						}}
						onPlaying={setPlaying}
						onDuration={() => {}}
						onReady={() => {}}
						onError={setError}
					/>
				</div>
				{error && <p role="alert">{error}</p>}
				<button
					onClick={() => {
						if (time >= toMs / 1000) setTime(fromMs / 1000);
						setPlaying(!playing);
					}}
				>
					{playing ? "暂停" : "播放"}
				</button>
			</div>
		</div>
	);
}
