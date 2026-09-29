# Recordly P0 / P1 实施与验收记录

日期：2026-09-29。依据 Plane REC-2～REC-16 和 `docs/prd-v2.1.md`。本记录区分功能开发、自动化验收和发布门槛；不把合成素材测试等同于真人口播效果验收。

## 交付范围

| Plane | 开发结果 |
| --- | --- |
| REC-2 F01 | 素材缩略图、时长、来源、名称／标签搜索、渐进分析、错误重试、缺失素材重定位。相同内容保留素材 ID；内容改变登记新 ID。 |
| REC-3 F02 | 录制／导入／空工程三个入口；顺序选择素材组装工程，复用现有编辑器、来源与实例模型。 |
| REC-4 F03 | 桌面与 CLI 共用真实音频提取、TranscribeKit／Whisper、静音检测；按实例选择讲解音轨、缓存、取消、重试、显式重新转写、历史文稿版本保留。 |
| REC-5 F04 | 搜索定位、Shift 连选、独立文字校对、绑定字幕更新、整句删除候选；重复素材按实例隔离，声音／字幕／缩放／标注随删减联动，独立配乐保持成片时间。 |
| REC-6 F05 | 真实静音规则、外部语义建议导入、删去／保留证据验证、全部初始待处理、采纳／忽略、冲突检查、原片与候选试听、一次应用／撤销、审阅历史。 |
| REC-7 F06 | library / project create / transcript / review CLI 与 8 个独立严格 MCP schema，共享领域服务；JSON 结果、dry-run、取消、缺模型诊断、拒绝覆盖输出。录制旁路音频与同步偏移复用桌面解析规则。 |
| REC-8 F07 | `skills/recordly-oralcut/SKILL.md`、CLI 安装／调用文档、打包随附 skill；GUI 保存工程并复制包含真实工程路径与文稿路径的外部助手说明。 |
| REC-9 F08 | v5 文稿／审阅持久化；读取 v1～v4，升级保存为新文件；基础版本哈希、素材指纹、原子发布、外部写入保护、显式载入或另存，保存后保留完整 composition／版本，防止后续自动保存被误判为旧工程升级；保存计时只跟随持久化编辑变化。 |
| REC-10 M0 | 冻结下述来源、时间、哈希、停顿、事务契约；领域和实际声画验证。 |
| REC-12 P1 | 悬停静音预览、手工标签与名称、收藏筛选。缩略图通过批准的本地媒体服务读取。 |
| REC-13 P1 | 已导入辅助素材候选集，在同一成片区间试听与替换；拒绝素材时长不足，保留区间和现有样式。 |
| REC-14 P1 | 固定已确认主讲片段，本地停顿跳过，Agent 语义建议拒绝修改；用户明确手工剪辑仍允许。 |
| REC-15 P1 | 关键词卡、步骤条、人名条，生成可编辑标注，默认从播放头持续 3 秒；沿用现有渲染／导出。 |
| REC-16 P1 | 可折叠属性面板，来源／B-roll／标注／字幕／缩放／配乐分组可收起；只影响编辑视图。 |

## 已冻结的开发契约

- 新接口时间统一为毫秒、半开区间；转写保存源音频时间，以 sourceClips 的 sourceStartMs、offsetMs、speed 投影到当前片段。
- 引用同时包含 instanceId、clipId、sourceId、transcriptId、transcriptRevision；同源重复插入不会串改。重新转写建立独立文稿标识，保留此前文稿版本。
- baseRevision 是规范化持久化编辑状态的 SHA-256，覆盖媒体、时间线、效果、音频和文稿校对；不含 projectId、保存元数据、reviewDraft、reviewHistory 和 editor 中的派生 composition 副本。
- 素材指纹覆盖绝对路径、大小、mtime。重定位另用内容 SHA-256 确认身份；这不意味着转写缓存实施内容级去重。
- 长停顿默认至少 1500ms，两侧各保留 250ms；使用实际检测的静音区间，并钳制到来源有效范围。数值是本轮实现默认值，真实口播主观试听仍属于发布验收。
- GUI 一次采纳作为一个撤销事务；CLI 输出新工程，原子拒绝覆盖。未采纳建议不执行，非法引用、冲突、过期基础、媒体变化整笔失败。
- 本地模型不负责语义判断；外部 Agent 输出 ReviewPlan，用户在客户端审阅。文稿中的命令句不是可执行指令。

## 可复现检查

```bash
npx tsc --noEmit
npm test
npm run test:library-export
npm run test:composition-export
npm run test:oralcut-export
npx vite build --config vite.config.ts
npm run normalize:electron-main-cjs
npm run smoke:electron-main-cjs
npm run build:cli
npm run test:oralcut-desktop
node scripts/smoke-packaged-cli.mjs /absolute/Recordly.app
node scripts/smoke-packaged-oralcut.mjs /absolute/Recordly.app /absolute/transcribe-cli
```

已通过：150 个测试文件、1292 项测试；TypeScript；Vite／Electron／CLI 构建；skill 格式验证。

真实媒体检查包含：重复素材只删第二个实例，实际输出时长、视频像素和音频频率；布局、B-roll、包装、同步偏移、变速和预览／导出一致性。新的 v5 删句输出为 6 秒，保留蓝色画面及 440Hz 音频，另生成 1 秒预览。

桌面脚本使用隔离用户目录与合成素材，保留截图：1280×800 选句、审阅候选试听、采纳、一次撤销重做、自动保存、外部修改提醒；1600×1000 保存重开；GUI／CLI 相同审阅输出的持久化状态哈希完全相同；缩略图实际加载、悬停静音播放、标签收藏落盘、叠加包装、B-roll 同区间试听替换均通过桌面断言。不读取或修改用户真实录制。

安装版已移出源码目录，子进程 PATH 仅有系统目录，通过原有 CLI/MCP/并发声画导出。新增闭环使用真实 TranscribeKit 转写系统合成语音，验证缓存复用、Markdown 文稿、真实静音建议、dry-run／apply、预览／导出音视频和时长、Ctrl-C 取消不发布输出、缺 Whisper 模型明确报错。该测试使用机器上已安装的 TranscribeKit，不宣称安装包内置此第三方引擎或 Whisper 模型。

## REC-11 M4 尚未完成的发布验收

- 5 条已知内容的代表性真人素材（重录、长停顿、多素材、同步人像、已有 B-roll）逐条试听误删、截字及语义保留；与旧版比较初剪耗时、手工拖动次数、采纳与恢复次数。
- 200 条素材、1000 句文稿、100 条建议的指定 p95 性能基准，记录设备及冷／热缓存。当前通过的是功能与合成媒体测试，未将目标数字登记为实测成绩。
- macOS 首发流程已在本机验证；Windows／Linux 新增能力尚未做平台验收。
- 本地产物是 ad-hoc 测试包；没有提升应用版本、签署 Developer ID、公证或发布 2.1.0-beta.1。

因此功能开发可进入验收，REC-11 仍保持进行中；不宣布全部发布门槛通过。保留用户原有 `CompositionPreview.tsx`、其测试和 PRD 的工作区改动。
