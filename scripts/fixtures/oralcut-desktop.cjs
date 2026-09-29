const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd(),
	dir = process.env.RECORDLY_TEST_DIR;
app.setPath("userData", path.join(dir, "userdata"));
app.setAppPath(root);
process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT = path.join(dir, "talk.recordly");
const wait = async (fn, timeout = 20000) => {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const result = await fn();
		if (result) return result;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw Error("UI condition timed out");
};
const main = async (win) => {
	const js = (code) => win.webContents.executeJavaScript(code, true);
	const click = (label) =>
		js(
			`(()=>{const buttons=[...document.querySelectorAll('button')];const b=buttons.find(b=>b.title===${JSON.stringify(label)})??buttons.find(b=>b.textContent.trim()===${JSON.stringify(label)})??buttons.find(b=>b.textContent.includes(${JSON.stringify(label)}));if(!b)throw Error('Missing button: '+${JSON.stringify(label)});b.click();return true;})()`,
		);
	try {
		await wait(() => js(`Boolean(document.querySelector('button[title="文稿"]'))`));
		win.setContentSize(1280, 800);
		await click("文稿");
		if (process.env.RECORDLY_TEST_MODE === "reopen") {
			await wait(() =>
				js(
					`document.querySelectorAll('section[aria-label="文稿"] article > button').length===3`,
				),
			);
			win.setContentSize(1600, 1000);
			await fs.promises.writeFile(
				path.join(dir, "reopened-1600.png"),
				(await win.webContents.capturePage()).toPNG(),
			);

			await click("镜头与素材");
			await js(
				`(()=>{const input=document.querySelector('[aria-label="叠加包装文字"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'验收关键词');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
			);
			await click("插入播放头");
			await click("添加 B-roll");
			await wait(() =>
				js(
					`Boolean([...document.querySelectorAll('summary')].find(s=>s.textContent.includes('手工候选集')))`,
				),
			);
			await js(
				`[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes('手工候选集')).querySelectorAll('input[type="checkbox"]')[1].click()`,
			);
			await click("试听");
			await wait(() =>
				js(`Boolean(document.querySelector('[aria-label="候选试听"] canvas'))`),
			);
			await js(`document.querySelector('[aria-label="候选试听"] button').click()`);
			await click("替换当前 B-roll");
			await wait(() => {
				const p = JSON.parse(fs.readFileSync(path.join(dir, "talk.recordly"), "utf8"));
				return (
					p.composition.broll[0]?.assetId === "candidate-b" &&
					p.editor.annotationRegions.some((a) => a.textContent === "验收关键词")
				);
			});
			const persisted = JSON.parse(fs.readFileSync(path.join(dir, "talk.recordly"), "utf8"));
			if (
				persisted.composition.broll[0].durationMs !== 3000 ||
				persisted.composition.broll[0].offsetMs !== 0
			)
				throw Error("Candidate changed the selected interval");
			await click("素材库");
			await wait(() =>
				js(`document.querySelector('section[aria-label="素材库"] img')?.naturalWidth > 0`),
			);
			await click("☆ 收藏");
			await wait(() => js(`document.body.innerText.includes('★ 已收藏')`));
			await js(
				`(()=>{const input=document.querySelector('[aria-label="素材标签"]');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'口播,验收');input.dispatchEvent(new Event('input',{bubbles:true}));input.blur();})()`,
			);
			await wait(() => {
				const lib = path.join(dir, "userdata/recordings/Library");
				const name = fs.readdirSync(lib).find((n) => n.endsWith(".json"));
				const entry = JSON.parse(fs.readFileSync(path.join(lib, name), "utf8"));
				return entry.favorite && entry.tags?.includes("验收");
			});
			await js(
				`document.querySelector('section[aria-label="素材库"] article button > div').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`,
			);
			await wait(() =>
				js(`Boolean(document.querySelector('section[aria-label="素材库"] video')?.muted)`),
			);
			console.log(
				"GUI_P1_SUCCESS: thumbnail, favorite, tags, hover, overlay, candidate preview and same-span replacement",
			);
			console.log("GUI_REOPEN_SUCCESS");
			app.exit(0);
			return;
		}
		await js(`document.querySelector('[aria-label="收起属性面板"]').click()`);
		await wait(() => js(`Boolean(document.querySelector('[aria-label="展开属性面板"]'))`));
		await js(`document.querySelector('[aria-label="展开属性面板"]').click()`);
		await js(`document.querySelector('[aria-label="轨道分组"] button').click()`);
		await wait(() =>
			js(
				`document.querySelector('[aria-label="轨道分组"] button').textContent.includes('▸')`,
			),
		);
		await js(`document.querySelector('[aria-label="轨道分组"] button').click()`);
		await wait(() =>
			js(`document.querySelectorAll('section[aria-label="文稿"] article').length===4`),
		);
		await fs.promises.writeFile(
			path.join(dir, "transcript-1280.png"),
			(await win.webContents.capturePage()).toPNG(),
		);
		await js(
			`document.querySelectorAll('section[aria-label="文稿"] article > button')[2].click()`,
		);
		await click("从视频中删去");
		await wait(() =>
			js(`Boolean(document.querySelector('select[aria-label="建议 manual-0 状态"]'))`),
		);
		await js(
			`(()=>{const s=document.querySelector('select[aria-label="建议 manual-0 状态"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'accepted');s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
		);
		await wait(() => js(`document.body.innerText.includes('已采纳 1 / 1')`));
		await click("修改后试听");
		await wait(() => js(`Boolean(document.querySelector('[aria-label="审阅试听"] canvas'))`));
		await fs.promises.writeFile(
			path.join(dir, "candidate-1280.png"),
			(await win.webContents.capturePage()).toPNG(),
		);
		await js(`document.querySelector('[aria-label="审阅试听"] button').click()`);
		await wait(() => {
			try {
				return (
					JSON.parse(fs.readFileSync(path.join(dir, "talk.recordly"), "utf8")).composition
						.reviewDraft?.selection["manual-0"] === "accepted"
				);
			} catch {
				return false;
			}
		});
		const reviewFixture = JSON.parse(fs.readFileSync(path.join(dir, "talk.recordly"), "utf8"))
			.composition.reviewDraft;
		fs.writeFileSync(path.join(dir, "parity.review.json"), JSON.stringify(reviewFixture));
		fs.writeFileSync(
			path.join(dir, "parity.base.recordly"),
			JSON.stringify(reviewFixture.base),
		);
		await click("应用已采纳项");
		await wait(() =>
			js(`document.querySelectorAll('section[aria-label="文稿"] article').length===3`),
		);
		await fs.promises.writeFile(
			path.join(dir, "applied-1280.png"),
			(await win.webContents.capturePage()).toPNG(),
		);
		await wait(async () => {
			try {
				return (
					JSON.parse(fs.readFileSync(path.join(dir, "talk.recordly"), "utf8")).composition
						.reviewHistory?.length === 1
				);
			} catch {
				return false;
			}
		});
		const saved = JSON.parse(fs.readFileSync(path.join(dir, "talk.recordly"), "utf8"));
		fs.writeFileSync(path.join(dir, "parity.gui.recordly"), JSON.stringify(saved));
		if (saved.composition.shots[0].sourceEndMs !== 5000) throw Error("First instance altered");
		await click("撤销");
		await wait(() =>
			js(
				`document.querySelectorAll('section[aria-label="文稿"] article > button').length===4`,
			),
		);
		await click("重做");
		await wait(() =>
			js(
				`document.querySelectorAll('section[aria-label="文稿"] article > button').length===3`,
			),
		);
		const altered = { ...saved, projectId: "external-test" };
		fs.writeFileSync(path.join(dir, "talk.recordly"), JSON.stringify(altered));
		await wait(() => js(`document.body.innerText.includes('磁盘工程已改变')`));
		await fs.promises.writeFile(
			path.join(dir, "external-change.png"),
			(await win.webContents.capturePage()).toPNG(),
		);
		console.log(
			"GUI_CHECK_SUCCESS " +
				JSON.stringify({
					dir,
					checks: [
						"1280x800 transcript",
						"select second instance sentence",
						"accept one review",
						"shared candidate playback",
						"apply removes one sentence",
						"v5 autosave",
						"single undo/redo",
						"property panel collapse",
						"track group collapse",
						"external edit retained with reload banner",
					],
				}),
		);
		app.exit(0);
	} catch (error) {
		console.error("GUI_CHECK_FAILED", error);
		console.error(await js("document.body.innerText"));
		await fs.promises.writeFile(
			path.join(dir, "failure.png"),
			(await win.webContents.capturePage()).toPNG(),
		);
		app.exit(1);
	}
};
app.on("browser-window-created", (_, win) => {
	win.webContents.on("did-finish-load", () => {
		if (win.webContents.getURL().includes("windowType=editor")) void main(win);
	});
});
require(path.join(root, "dist-electron/main.cjs"));
setTimeout(() => {
	console.error("GUI_CHECK_TIMEOUT");
	app.exit(1);
}, 90000);
