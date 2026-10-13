# AI 上下文分析接口 · v1.0

本项目已预留可运行的异步分析适配层。默认仍用本地规则，**没有接入任何真实 AI 厂商，也没有上传文档或使用密钥**。

## 接入结构

```text
浏览器解析 Word → 分析适配层 → 你的后端 POST /api/analyze-article → AI 模型
                       ↓                   ↓
                   默认本地规则      校验并返回结构化结果
                       └──────→ 原文校验 → 现有结果列表、详情与导出
```

- `analysis-config.js`：唯一的前端服务配置。只放公开的模式、地址、超时时间。
- `services/analyzer.mjs`：统一的异步 `analyzeArticle()` 接口；本地 / API 两种实现。
- `services/analysis-contract.mjs`：请求结构与响应校验；原文、位置和结果编号由文档快照生成。
- `server/analyze-handler.mjs`：供后端挂载的 Request/Response 处理函数。未配置模型时返回 501，不伪造 AI 结果。此文件本身不是已部署的服务。
- `server/analysis-prompt.mjs`：厂商无关的上下文分析提示模板，不包含模型调用。

## 以后真正接入时要做什么

1. 部署自己的后端，将 `createAnalyzeHandler({ authorize, analyzeWithModel })` 挂载到 `POST /api/analyze-article`。
2. 实现 `authorize(request)` 验证实际用户权限；实现 `analyzeWithModel(payload, { signal })`，从服务器环境变量读取厂商密钥，调用选定模型。可使用 `buildAnalysisPrompt(payload)` 准备指令与输入。
3. 后端就绪后，修改前端配置：

```js
export const analysisConfig = Object.freeze({
  mode: 'api',
  endpoint: '/api/analyze-article',
  timeoutMs: 60000,
});
```

默认配置是 `mode: 'local'`。页面表单、DOCX 解析、结果列表、上下文窗口和 CSV 导出不需要改写。

如果前端在 GitHub Pages，后端需要另外部署，`endpoint` 改成后端的 HTTPS 完整地址。前端目前使用 `credentials: 'same-origin'`；跨域部署时，需由接入方配好 CORS、身份校验及会话传递。不要把厂商 API Key 写入此配置、HTML、JavaScript 或 Git 仓库。后端密钥使用部署平台的环境变量，不放在静态文件目录中。

## 请求：整篇教程的上下文

每篇教程发起一次请求，包含该篇全部文字块，按原顺序排列；不先按关键词删掉段落。目录作为补充上下文，其他教程的全文默认不发送。

```json
{
  "schemaVersion": "1.0",
  "requestId": "由前端生成的唯一请求编号",
  "document": {
    "name": "教程合集.docx",
    "outline": [{"id": "T-001", "title": "Agent 使用指南"}]
  },
  "change": {
    "description": "平台功能 Agent 更名为 Skills，通用概念保留。",
    "old": "Agent",
    "next": "Skills",
    "scope": "平台功能名称",
    "exceptions": "AI Agent 概念、链接和代码参数保持不变"
  },
  "article": {
    "id": "T-001",
    "title": "Agent 使用指南",
    "blocks": [
      {"id": "B001", "text": "Agent 使用指南", "location": "教程标题", "heading": 1},
      {"id": "B002", "text": "进入 Agent 功能页面。", "location": "正文 · P002", "heading": 0}
    ]
  }
}
```

普通表格块还会包含 `table`、`row`、`col`（从 1 开始）。不发送 Word 二进制、图片或未解析内容。

## 响应：仅返回需要核对的候选项

```json
{
  "schemaVersion": "1.0",
  "requestId": "与请求完全相同",
  "articleId": "T-001",
  "complete": true,
  "checkedBlockIds": ["B001", "B002"],
  "findings": [
    {
      "blockId": "B001",
      "status": "change",
      "reason": "标题使用了本次更名的功能名称。",
      "suggestion": "Skills 使用指南"
    },
    {
      "blockId": "B002",
      "status": "change",
      "reason": "本段描述平台功能入口，需同步显示名称。",
      "suggestion": "进入 Skills 功能页面。"
    }
  ]
}
```

`findings` 可为空，但 `checkedBlockIds` 必须完整、无重复，且 `complete` 为 true，才能把本篇计入完成。

| 字段 | 规则 |
| --- | --- |
| `blockId` | 必须属于本次教程，每个块至多一项结果；同一块的多处调整合并到完整段落改写 |
| `status` | `change`、`confirm`、`keep` |
| `reason` | 非空的判断说明 |
| `suggestion` | change：非空的新段落；confirm：待补充信息或确认事项；keep：null 或与原文完全相同 |
| `originalText` | 可不返回；返回时必须逐字匹配原文，否则本篇失败 |

服务不能覆盖前端保存的原文、位置、教程标题、结果编号。已检查编号只是协议完整性校验，并不能证明模型的语义判断一定正确；真实接入后仍需用人工标注样本验证漏检、误报和建议质量。

## 出错、重试和长文章

- HTTP 401 / 403：身份或权限错误；413：超出处理范围；429：请求限流；501：尚未接入；503：模型暂不可用。
- 非 JSON、错误请求编号、未知段落、重复结果、缺少已检查段落等均视为本篇失败。
- 默认 60 秒超时；支持 `AbortSignal`，重试只处理失败教程，不丢弃已完成结果。
- 不自动降级成本地规则，避免混淆 AI 与规则结果。页面及 CSV 会区分分析来源。
- 后端应按模型实际上下文窗口处理长文章：分块时带章节和相邻上下文、覆盖全部段落、按 blockId 去重合并；覆盖不全就报错，不能静默截断。
- 后端还需设置真实的请求体大小限制、输出预算、模型调用超时和访问配额。模板不等于已可公网使用的完整后端。
- 使用现有 history 快照重试时，会沿用该任务的服务配置。

## 验证

在项目目录运行 `npm test`（已有 Node 即可运行这些测试，无需先安装依赖）。测试使用本地函数和模拟 HTTP 响应，不调用真实模型、不产生 AI 费用。
