# macOS 签名与 DMG 打包

在 macOS 上安装 Xcode 命令行工具、Node.js 和 npm，并在钥匙串中安装带私钥的 **Developer ID Application** 证书。

```bash
npm ci
npm run package:mac
```

脚本构建当前 Node.js 架构（Apple Silicon 通常为 arm64，Intel 为 x64），复用 `node_modules/electron/dist` 中同版本、同架构的运行时。原生组件构建仍可能需要下载依赖。不会发布 GitHub Release。

存在多个证书时，指定完整证书名称：

```bash
MAC_SIGN_IDENTITY='Developer ID Application: YOUR NAME (TEAMID)' npm run package:mac
```

默认仅签名，不进行 Apple 公证。需要公证时，先使用 `xcrun notarytool store-credentials` 在钥匙串中配置凭据，再指定已有的 profile 名称：

```bash
NOTARY_PROFILE='your-notary-profile' npm run package:mac
```

该模式会先公证并装订应用票据，再生成、签名、公证并装订 DMG；失败时停止流程。不要把 Apple 密码写入脚本或提交到仓库。

每次结果保存到独立的 `release/macos-版本-架构-随机后缀/` 目录，包括：

- 签名的 `.app` 和带 Applications 快捷入口的 `.dmg`
- DMG 的 `.sha256` 校验文件
- `packaging-report.txt`，记录版本、证书、公证状态和验证结果

流程包含原生组件构建、TypeScript 检查、Vite 构建、主进程冒烟检查、应用深度签名验证、DMG 签名和完整性检查，以及挂载后应用签名检查。它不代替录屏、编辑、导出的手动功能验收。失败时保留构建产物供排查，并清理临时镜像源目录及挂载点。

安装包包含独立 CLI，用户不需要安装 Node.js、Xcode 或 FFprobe。应用菜单 **Recordly → Install ‘recordly’ Command…** 可安装用户级终端命令，具体用法见 [CLI 文档](../cli/README.md)。

签名后还会自动执行安装版 CLI 冒烟测试：从独立临时目录、仅含系统工具的 PATH 下，验证环境诊断、命令安装、工程读写、带音轨的 MP4 导出、PNG 预览与 MCP 工具列表。该测试只使用合成媒体，不录制屏幕。单独执行：

```bash
npm run smoke:packaged-cli -- /path/to/Recordly.app
```

```bash
npm run package:mac -- --help
```
