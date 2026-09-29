const { app } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const dir = process.env.RECORDLY_TEST_DIR;
if (!dir) throw Error("Run scripts/test-editor-design.mjs to create an isolated test project");
app.setPath("userData", path.join(dir, "userdata"));
app.setAppPath(process.cwd());
process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT = path.join(dir, "talk.recordly");
const wait = async (check) => {
	const end = Date.now() + 20000;
	while (Date.now() < end) {
		if (await check()) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw Error("Design regression check timed out");
};
async function run(win) {
	const js = (code) => win.webContents.executeJavaScript(code, true);
	const click = (label) =>
		js(`(() => {
		const buttons = [...document.querySelectorAll('button')];
		const b = buttons.find(b => b.title === ${JSON.stringify(label)}) ?? buttons.find(b => b.textContent.trim() === ${JSON.stringify(label)});
		if (!b) throw Error('Missing button: ' + ${JSON.stringify(label)});
		b.scrollIntoView({block: 'nearest'}); b.click();
	})()`);
	try {
		await wait(() => js(`!!document.querySelector('button[title="文稿"]')`));
		win.setContentSize(1100, 740);
		await click("文稿");
		await wait(() =>
			js(
				`document.querySelectorAll('section[aria-label="文稿"] article > button').length === 4`,
			),
		);
		// This failed before the redesign: setup controls consumed the entire small-window panel.
		assert.ok(
			await js(`(() => {
			const panel = document.querySelector('.editor-inspector').getBoundingClientRect();
			const sentence = document.querySelector('section[aria-label="文稿"] article > button').getBoundingClientRect();
			const nav = document.querySelector('nav[aria-label="编辑工具"]').getBoundingClientRect();
			const timeline = document.querySelector('[aria-label="轨道分组"]').getBoundingClientRect();
			return sentence.top >= panel.top && sentence.bottom <= panel.bottom && nav.bottom <= timeline.top;
		})()`),
			"Transcript text and navigation must fit above the timeline at 1100×740",
		);
		const widths = [];
		for (const label of ["文稿", "修改审阅", "素材库", "镜头与素材", "字幕"]) {
			await click(label);
			widths.push(
				await js(
					`document.querySelector('.editor-inspector').getBoundingClientRect().width`,
				),
			);
		}
		assert.equal(new Set(widths).size, 1, "Tool switching must not resize the workspace");
		await js(`document.querySelector('[aria-label="收起属性面板"]').click()`);
		assert.equal(await js(`!!document.querySelector('.editor-inspector')`), false);
		await click("文稿");
		assert.equal(
			await js(`!!document.querySelector('.editor-inspector')`),
			true,
			"Selecting a tool reopens the inspector",
		);
		await js(
			`(() => { const d = [...document.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent === '转写与字幕工具'); if(d.open) throw Error('Maintenance tools should start collapsed'); d.querySelector('summary').click(); })()`,
		);
		assert.ok(
			await js(
				`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '重新转写'); return b && b.getBoundingClientRect().height > 0; })()`,
			),
			"Retranscription remains reachable through disclosure",
		);
		await js(
			`document.querySelector('section[aria-label="文稿"] details').querySelector('summary').click()`,
		);
		await js(
			`document.querySelectorAll('section[aria-label="文稿"] article > button')[2].click()`,
		);
		await click("从视频中删去");
		await wait(() => js(`!!document.querySelector('select[aria-label="建议 manual-0 状态"]')`));
		assert.ok(
			await js(
				`document.querySelector('select[aria-label="建议 manual-0 状态"]').getBoundingClientRect().height > 0`,
			),
			"A new review must expand automatically",
		);
		await js(
			`(() => { const select = document.querySelector('select[aria-label="建议 manual-0 状态"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'accepted'); select.dispatchEvent(new Event('change', {bubbles:true})); })()`,
		);
		await wait(() =>
			js(
				`(() => { const panel = document.querySelector('.editor-inspector').getBoundingClientRect(); const select = document.querySelector('select[aria-label="建议 manual-0 状态"]').getBoundingClientRect(); return select.top >= panel.top && select.bottom <= panel.bottom; })()`,
			),
		);
		await fs.writeFile(
			path.join(dir, "review-visible.png"),
			(await win.webContents.capturePage()).toPNG(),
		);
		await click("应用已采纳项");
		await wait(() =>
			js(
				`document.querySelectorAll('section[aria-label="文稿"] article > button').length === 3`,
			),
		);
		await click("撤销");
		await wait(() =>
			js(
				`document.querySelectorAll('section[aria-label="文稿"] article > button').length === 4`,
			),
		);
		await js(`document.querySelector('section[aria-label="文稿"]').scrollTop = 0`);
		await fs.writeFile(
			path.join(dir, "desktop-light.png"),
			(await win.webContents.capturePage()).toPNG(),
		);
		await js(`document.documentElement.classList.add('dark')`);
		assert.equal(
			await js(`getComputedStyle(document.querySelector('.editor-workspace')).colorScheme`),
			"dark",
		);
		await fs.writeFile(
			path.join(dir, "desktop-dark.png"),
			(await win.webContents.capturePage()).toPNG(),
		);
		console.log(
			"EDITOR_DESIGN_SUCCESS: compact reading, contained navigation, stable geometry, disclosure, review apply/undo, native dark controls",
		);
		app.exit(0);
	} catch (error) {
		console.error(error);
		await fs.writeFile(
			path.join(dir, "failure.png"),
			(await win.webContents.capturePage()).toPNG(),
		);
		app.exit(1);
	}
}
app.on("browser-window-created", (_, win) =>
	win.webContents.once("did-finish-load", () => {
		if (win.webContents.getURL().includes("windowType=editor")) void run(win);
	}),
);
require(path.join(process.cwd(), "dist-electron/main.cjs"));
setTimeout(() => app.exit(1), 80000);
