<div align="center">

<img src="docs/logo-512.png" width="120" alt="Offer Pilot" />

# Offer Pilot

**本地优先的 AI 网申填表助手**

维护一份标准简历，在任意招聘网页表单上一键完成 AI 字段映射与自动填写。

[![test](https://github.com/lll-gr/offer-pilot/actions/workflows/test.yml/badge.svg)](https://github.com/lll-gr/offer-pilot/actions/workflows/test.yml)
[![release](https://github.com/lll-gr/offer-pilot/actions/workflows/release.yml/badge.svg)](https://github.com/lll-gr/offer-pilot/actions/workflows/release.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A522-339933)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

</div>

---

## 为什么做这个

校招季的网申是一场复制粘贴马拉松：同一个姓名、同一段实习经历，要在几十个结构各异的表单里重复填写。Offer Pilot 把「填写」这件事变成一次点击——你只维护一份结构化简历，剩下的映射交给 AI，写入交给本地。

三个产品决策：

- **本地优先**：简历数据只存在你浏览器的 `chrome.storage.local`，没有任何账号、云同步或遥测
- **BYOK**（Bring Your Own Key）：AI 调用直连你自己配置的 DeepSeek / OpenAI 兼容端点，密钥不出本机
- **不自动提交**：扩展只填写，永远不碰提交按钮——最后一步永远由你确认

## 功能

| 能力 | 说明 |
| --- | --- |
| **整页填入** | 扫描当前页面全部表单字段，AI 建立字段映射后一次填写 |
| **增量填入** | 已有内容的字段自动跳过，只填空缺 |
| **选区填入** | 在页面上拖拽框选区域，只填选区内字段 |
| **分步填入** | 多步网申逐块填写，填完一块等你在页面上点「下一步」后自动续填；下一步按钮有歧义时 AI 辅助决策，AI 也拿不准则回退人工 |
| **AI 导入简历** | 粘贴原始简历文本或上传 PDF，AI 解析为结构化标准简历 |
| **多简历档位** | 多份简历互相独立，每档可绑定目标公司/职位（投递上下文） |
| **映射缓存** | 按「页面 URL + 字段签名」缓存映射结果，同结构表单秒级复用，零 AI 调用 |
| **诊断日志** | 结构化填充日志，可自动导出到本地项目目录，保留最近 50 份 |

填写成功的字段会在页面上短暂高亮，方便快速检查。

## 快速开始

```bash
git clone <repo> && cd offer-pilot
npm install          # postinstall 自动执行 wxt prepare
npm run icons        # 从 assets/logo.svg 生成扩展图标（已提交，可跳过）
npm run build        # 产物在 .output/chrome-mv3/
```

1. 打开 `chrome://extensions`，开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择 `.output/chrome-mv3`
3. 点扩展图标打开右侧面板 → 在模型设置里配置你的 API Key
4. 「标准简历」→ 打开配置页，填写或 AI 导入你的简历
5. 打开任意招聘网页，点「开始填充」

联调测试页（content script 只注入 http/https，需本地服务器）：

```bash
npx serve manual-test
# http://localhost:3000/test-form.html       单页表单
# http://localhost:3000/segmented-form.html  多步表单
```

## 开发

```bash
npm run dev         # 开发模式，Chrome 自动加载热更新
npm test            # vitest（148 用例，同目录 .test.ts）
npm run typecheck   # tsc --noEmit
npm run build       # 生产构建
npm run zip         # 打包 .output/chrome-mv3.zip
npm run icons       # logo.svg → public/icons/*.png（幂等）
```

### 架构

```
src/
├── entrypoints/        # 薄入口：background / content / sidepanel / resume-editor
├── features/           # React 组合层（hooks + 页面组件）
├── fill/               # 填表领域：扫描 → 映射 → 填充 → 分步流程
├── resume/             # schema（字段目录唯一来源）/ 档位存储 / 提示词 / PDF
├── models/             # AI 模型配置存储
├── ai/                 # client / proxy / JSON 解析 / 系统提示词
├── logs/               # 诊断日志 / 目录导出
├── messaging/          # 跨上下文消息契约 + content script 版本握手
└── components/         # Modal 等共享 UI
```

依赖方向只允许自上而下：entrypoints → features → 领域层（fill/resume/models/ai/logs 互不横向依赖）→ messaging/components/lib。

### 如何扩展

- **新增简历字段**：`src/resume/schema.ts` 的 `SECTION_DEFINITIONS` 加一条，编辑器 UI、字段目录、AI 映射模板自动生效
- **新增表单控件类型**：`src/fill/types.ts` 加 `FieldKind` + `src/fill/filler/modes.ts` 加分发分支
- **新增填充模式**：`src/features/fill-flow/useFillFlow.ts` 加 action 配置 + controller 加分支

### 发布

CI 由 tag 驱动：推送 `v*` 标签 → 质量门禁（typecheck + test）→ 从 `assets/logo.svg` 再生图标 → 打包 → 附件创建 GitHub Release。

```bash
git tag v0.2.0 && git push origin v0.2.0
```

## 隐私

- 简历数据、模型配置、映射缓存全部保存在本地 `chrome.storage.local`
- content script 注册于 http/https 页面，但**仅在点击填充按钮时**才读取当前页面 DOM
- AI 调用仅发生在字段映射与简历导入时，从本机直接发往你配置的模型端点
- 无账号体系、无遥测、无第三方分析

## License

[GPL-3.0](LICENSE)
