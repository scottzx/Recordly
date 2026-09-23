# 独立版本与更新记录

本 fork 使用 `scottzx/Recordly` 的版本和更新源，从 **2.0.0** 开始。版本号高于此前的 `1.5.0-beta.1`，已有版本可以按正常升序升级。应用名称、应用 ID 和用户数据目录不变，原作者和 AGPL 许可信息保留。

- 修复问题：`2.0.1`、`2.0.2`。
- 新增兼容功能：`2.1.0`。
- 重大不兼容变更：`3.0.0`。
- 需要独立测试通道时：`2.1.0-beta.1`，发布为 prerelease。

## 每次更新

1. 使用 `npm version patch --no-git-tag-version` 升级补丁版本；新增功能用 `minor`，重大变更用 `major`。也可指定完整版本号。这会同时更新 `package.json` 和 `package-lock.json`。
2. 在 `releases.json` 顶部加入对应版本的日期、标题、`changes` 与 `notes`。只记录本分支实际改动；`notes` 无内容时使用空数组。已有版本记录保留。
3. 运行 `npm run version:sync`，生成 `CHANGELOG.md` 和当前版本的 `release-notes.md`，不要单独编辑生成文件。
4. 运行 `npm run version:check`、测试与构建。应用首页和 Help 菜单会展示打包时的更新记录，离线也可查看。
5. 运行 `npm run package:mac -- --release`，生成带版本号的本地 DMG，并把当前更新说明放入同一个输出目录。该命令不会上传 GitHub。本机快速验证可运行 `npm run package:mac`，仅生成测试用应用。

## GitHub 发布与自动更新

确认安装测试后，再提交代码、推送对应的 `v版本号` 标签，执行：

```bash
npm run release:create -- --tag v2.0.0
```

脚本会校验标签与当前版本一致，向 `scottzx/Recordly` 发布，并默认使用本地 `release-notes.md`，不从上游历史自动生成说明。可使用 `--draft`；测试版需要 `--prerelease`。

发布后的工作流会构建并上传各平台文件及更新元数据，需要在 fork 中配置对应的签名凭据。本地 DMG 不等于在线更新：macOS 自动更新还需要 GitHub Release 中的 ZIP 和匹配的 `latest-mac.yml`（测试版为 `beta-mac.yml`）。本次配置修改不会创建远程 Release。

Homebrew 分发仅在配置本 fork 的 `HOMEBREW_TAP_REPO` 后启用，不使用上游 tap。

旧版 `1.5.0-beta.1` 安装包仍包含其构建时的更新配置，需要手动安装本分支新包才能切换更新源。上游历史说明 `release-notes-1.5.0-beta.1.md` 保留供追溯。
