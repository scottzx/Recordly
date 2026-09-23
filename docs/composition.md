# 叙事编排工程 v3

面向单次录制的口播＋屏幕讲解。主讲段落管理内容顺序；屏幕、多个机位和声音是独立的同步来源；镜头编排单独控制每一时刻显示哪些来源及其叠放位置。B-roll 是辅助画面层，包装幕是占用成片时间的独立片段。CLI 与界面共用 `shared/composition.ts` 的时间线规则。

## 使用

CLI 需要 Node.js 22.18 或以上。开发目录先运行 `npx vite build --config vite.config.ts`，导出不依赖开发服务器或录屏权限。

```sh
node cli/bin/recordly.mjs project inspect input.recordly
node cli/bin/recordly.mjs project apply input.recordly --plan edit.json -o composed.recordly
node cli/bin/recordly.mjs project validate composed.recordly
node cli/bin/recordly.mjs project preview composed.recordly --at 3500 -o frame.png
node cli/bin/recordly.mjs project preview composed.recordly --from 3000 --to 8000 -o excerpt.mp4
node cli/bin/recordly.mjs render composed.recordly -o result.mp4 --json
```

所有时间为毫秒。`apply` 默认输出 `.composed.recordly`，拒绝覆盖输入。相同输入及计划输出相同工程。引用素材必须存在，导出前会再次检查。相对素材路径相对于计划文件（MCP 的内联计划相对于输入工程）。

通过 Recordly 原有的工程导入入口打开生成的工程，继续使用原视频编辑器。侧栏“镜头与素材”提供布局、B-roll、包装幕属性；原时间线固定显示 A-roll 主讲、B-roll 辅助素材、包装三条独立轨道，空轨也保留；字幕、缩放和配乐轨继续独立显示。选择片段后修改属性，使用原有播放、保存、撤销重做和导出按钮。旧工程可在侧栏点击“添加镜头编排”启用新能力。已有 v3 工程点击“展开为独立素材轨道”转换；转换保留原有布局、镜像和裁切，可撤销。新启用的编排工程默认使用独立素材轨。

预览与导出共享组合渲染器及声音分段规则。新工程使用现代画面渲染与 WebCodecs 编码；导出 GIF 会明确报错。包装期间主讲声音暂停，独立配乐继续。

## 同步素材组与镜头编排

A-roll 是主讲用途，不是合并后的单一视频。时间线包括：主讲段落、镜头编排、各屏幕/机位/声音来源，以及原有 B-roll、包装、字幕、标注和配乐轨。素材轨可收起；选择段落会联动编辑，选择来源片段只调整该来源。

- **切镜**：选择镜头编排块，在播放头分割镜头，再选择主画面及第二画面，应用全屏、画中画或分屏。可继续叠加其他机位，逐层调整位置、大小、裁切、镜像、圆角和叠放顺序。
- **切点微调**：拖动镜头边缘或输入段内毫秒数，相邻镜头共用的边界联动，声音和来源入点保持不变。
- **机位与声音**：通过“添加同步机位”“添加同步声音”导入。新来源初始偏移为 0；选择来源片段设置同步偏移（正值表示比主录屏晚开始）。它会调整该来源所有仍跟随同步的片段。
- **独立调整**：分割、裁短或删除单个来源片段；移动片段、修改读取素材起点或速度会标记为独立调整，不再响应来源同步偏移。可点击“恢复该片段同步”。片段音量和静音独立于画面是否显示。
- **整组剪辑**：选择主讲段落后分割、裁剪、重排、变速、删除，嵌套的素材片段与镜头编排跟随变化。整组静音控制该段所有来源的声音；已有配乐仍按成片时间播放。
- **素材边界**：视频在有效素材之外保持首帧/末帧，声音不延长或循环。导入素材的时长用于显示提前结束提示；可在镜头编排里切到其他来源。删除镜头不会删声音，缺少镜头或可见来源的时间显示背景。

数据仍保存在 v3 工程的 `composition` 中，新增可选字段：

- `sources`：`{id, assetId, name, kind, timeOffsetMs}`。`kind` 为 `screen/camera/audio`，文件仍由 `assets` 引用。
- 主讲片段的 `sourceClips`：`{id, sourceId, offsetMs, durationMs, sourceStartMs, speed, linked, muted, volume}`。起点与时长相对于所属主讲段落；素材入点可以为负数，以表达晚开始的同步来源。
- 主讲片段的 `views`：`{id, offsetMs, durationMs, layers}`。每个图层包含 `sourceId`、画布占比 `x/y/width/height`，可选 `crop/mirror/roundness/fit`；数组由底层到顶层排列，声音不依赖此数组。

同一来源的片段不能互相重叠，镜头编排片段也不能重叠；不同来源允许同时存在。展开后的工程所有主讲段落均保存 `sourceClips/views`。原 `layout` 仅用于未展开的旧工程，展开后编辑 `views.layers`。

结构化计划可通过 `composition` 更新这些字段，并用 `split-source` 或 `split-view` 操作只分割指定片段：`{type, clipId, id, offsetMs}`，其中 `offsetMs` 为段内时间。原 `split/trim/speed/move/remove/insert-card` 仍负责整组操作。

## 编辑计划

`version: 1` 是计划协议版本；保存的工程版本为 3。`composition` 字段是声明式替换，省略的字段保留。`operations` 在替换后依次应用。编辑已有时间线时，优先使用操作以维护关联素材。

```json
{
  "version": 1,
  "composition": {
    "width": 1280,
    "height": 720,
    "fps": 30,
    "assets": [
      { "id": "demo", "path": "demo.mp4", "kind": "video" },
      { "id": "diagram", "path": "diagram.png", "kind": "image" }
    ],
    "shots": [
      {
        "id": "intro", "kind": "card", "template": "intro",
        "durationMs": 3000, "title": "直接调 API，还有价值吗？",
        "subtitle": "从一个实际工具说起", "background": "#111827",
        "color": "#ffffff", "animation": "fade"
      },
      {
        "id": "talk", "kind": "main", "sourceStartMs": 1000,
        "sourceEndMs": 11000, "speed": 1,
        "layout": { "mode": "pip", "x": 0.98, "y": 0.98, "width": 0.23, "height": 0.23, "roundness": 100 }
      }
    ],
    "broll": [
      {
        "id": "demo-cutaway", "clipId": "talk", "assetId": "demo",
        "offsetMs": 2000, "durationMs": 3000, "sourceStartMs": 0,
        "speed": 1, "muted": true, "volume": 1,
        "mode": "fullscreen", "x": 0.04, "y": 0.04,
        "width": 0.35, "height": 0.35
      }
    ]
  }
}
```

- `shots` 数组顺序就是成片顺序。主讲时长为 `(sourceEndMs-sourceStartMs)/speed`，不需要手工计算后续时间。
- 布局：`screen`、`presenter`、`pip`、`split`。后三种需要 `editor.webcam.sourcePath`。分屏的 `presenterRatio` 为 0.2–0.8；画中画的 `x/y` 表示可移动空间中的相对位置，`width/height` 表示画布占比，`roundness` 为 0–100。
- B-roll 的 `offsetMs` 相对于所属主讲片段。`sourceStartMs` 和 `durationMs*speed` 决定入出点；同一时刻不允许多个 B-roll。`crop` 使用归一化的 `{x,y,width,height}`，画中画位置大小也使用画布占比。
- 包装模板：`intro`、`chapter`、`quote`、`outro`、`image`。界面默认时长依次为 3000、2000、3000、3000、3000 毫秒。结构化计划必须明确 `durationMs`。`assetId` 可指定背景图；`image` 模板必须指定图片。动画为 `none` 或 `fade`。
- 包装期间不推进主讲素材，字幕、人像和主讲声音暂停。独立配乐仍按成片时间播放，导出时裁掉超出成片的尾部。
- 所有素材、片段和 B-roll 使用唯一稳定 ID。素材不会被复制进工程，移动工程时需保留素材路径。

## 编辑操作

```json
{
  "version": 1,
  "operations": [
    { "type": "split", "clipId": "talk", "offsetMs": 4000 },
    { "type": "layout", "clipId": "talk", "layout": { "mode": "screen" } },
    { "type": "speed", "clipId": "talk", "speed": 1.25 },
    { "type": "move", "id": "talk", "index": 0 },
    {
      "type": "insert-card", "atMs": 0,
      "card": { "id": "chapter-1", "kind": "card", "template": "chapter", "durationMs": 2000, "title": "实际案例" }
    }
  ]
}
```

另有 `trim`（`clipId/sourceStartMs/sourceEndMs`，范围必须在原片段内）、`remove`（`id`）。分割生成的右片段 ID 为 `<原ID>-split-<offsetMs>`。分割、裁剪、变速维护 B-roll 入点与覆盖范围；删除主讲片段会删除关联 B-roll。

`editor` 可更新已有字幕、标注、音频及外观设置。v3 编排工程中的字幕、缩放和标注使用主素材时间；独立 `audioRegions` 使用成片时间。旧工程转为编排工程时会转换原时间线上的缩放和标注位置。

## 自动化与错误

MCP 提供 `recordly_project_inspect/apply/validate/preview`，分别使用 `inputPath`、`output`、`planData`、`at/from/to` 参数，调用与 CLI 相同的实现。

`project validate` 返回 `valid/errors/durationMs`，无效工程退出码为 1。导出报告包含实际输出路径、时长和声音流预期。文件缺失、越界、重叠、取消、超时均不会报告成功。`doctor --json` 分别给出 `recordingReady` 和 `exportReady`。

旧工程仍可在原编辑器打开；保存为 v3 时，首次保存保留 `.v2.bak`（更早版本为相应版本号）。新增编排状态纳入原编辑器的保存、脏状态和撤销记录。

支持同一录制组的多个机位和多层画面；不包含跨录制组的自由主素材时间线、自由关键帧、自动配乐压低或内置 AI 剪辑决策。录屏缩放采用确定性经典运动计算，保证跳转预览与导出一致。


## 验证

`npm test` 覆盖时间映射、素材验证、计划确定性、保存往返、撤销重做及旧版本备份。构建后运行 `npm run test:composition-export`，使用临时生成的录屏、人像、辅助视频和图片执行真实 MP4 导出，检查包装静音、主讲声音延续、B-roll 静音/混音，以及 CLI 截图与导出帧的一致性。测试结束自动清理素材；个人录制不进入测试仓库。

人工验收还应在原编辑器分割镜头、微调切点、独立调整来源并验证撤销、保存重开，再重新导出。此步骤不能由单元测试或 CLI 修改替代。
