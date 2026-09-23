import releases from "../../releases.json";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "./ui/dialog";

export function VersionHistoryButton() {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<button className="rounded-lg px-2 py-1 text-xs opacity-70 hover:bg-blue-500/10 hover:opacity-100">
					v{releases[0].version} · 更新记录
				</button>
			</DialogTrigger>
			<DialogContent
				data-hud-interactive
				className="pointer-events-auto max-h-[80vh] max-w-2xl overflow-y-auto text-foreground"
				style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
			>
				<DialogHeader>
					<DialogTitle>版本与更新记录</DialogTitle>
					<DialogDescription>
						Recordly · scottzx 独立分支 · 当前版本 {releases[0].version}
					</DialogDescription>
				</DialogHeader>
				{releases.map((release, index) => (
					<section key={release.version} className="border-t pt-4">
						<div className="mb-2 flex items-center gap-3">
							<h2 className="font-semibold">v{release.version}</h2>
							{index === 0 && (
								<span className="rounded bg-blue-500/10 px-2 py-0.5 text-xs text-blue-500">
									当前版本
								</span>
							)}
							<time className="ml-auto text-xs text-muted-foreground">
								{release.date}
							</time>
						</div>
						<p className="mb-3 text-sm font-medium">{release.title}</p>
						<ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
							{release.changes.map((change) => (
								<li key={change}>{change}</li>
							))}
						</ul>
						{release.notes.map((note) => (
							<p
								key={note}
								className="mt-3 text-xs leading-relaxed text-muted-foreground"
							>
								{note}
							</p>
						))}
					</section>
				))}
			</DialogContent>
		</Dialog>
	);
}
