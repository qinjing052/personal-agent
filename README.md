# Personal Agent TS

一个用于学习 Agent 全流程的 TypeScript + LangChain.js 个人助手项目。

它目前支持：

- 读取项目内本地文件，例如 `notes/this-week.md`
- 使用 Tavily 搜索网页
- `/weekly` 命令自动生成并保存周报
- 流式输出模型回答
- 保存最近对话记忆
- 诊断 OpenAI 连接、代理和模型可用性
- 跑一组简单评估用例

## 项目结构

```text
src/
  index.ts                 # CLI 主入口，负责用户输入、预处理、流式输出和记忆保存
  server.ts                # Web UI 使用的本地 HTTP/SSE 服务
  agent.ts                 # 创建 LangGraph ReAct Agent，绑定模型、系统提示词和工具
  config.ts                # 读取 .env 配置，并做基础安全校验
  network.ts               # 配置终端代理，让 Node/OpenAI SDK 可以走本地代理
  systemPrompt.ts          # Agent 的系统提示词
  memory.ts                # 将最近对话保存到本地 JSON 文件
  doctor.ts                # OpenAI 连接诊断脚本
  tools/
    readLocalFile.ts       # 本地文件读取工具
    webSearch.ts           # Tavily 网页搜索工具
  evals/
    run.ts                 # 简单评估脚本
notes/
  this-week.md             # 示例周报素材
outputs/
  .gitkeep                 # 保留输出目录，实际生成的周报文件不会提交到 Git
eval-cases.json            # 评估用例列表
web/
  main.tsx                 # Vite React 入口
  src/App.tsx              # Web 版聊天工作台
```

## 安装

```bash
pnpm install
cp .env.example .env
```

然后编辑 `.env`：

```bash
OPENAI_API_KEY=你的 OpenAI Key
OPENAI_MODEL=gpt-5.4-mini
OPENAI_BASE_URL=https://你的网关/v1
ALLOW_CUSTOM_OPENAI_BASE_URL=true
HTTPS_PROXY=http://127.0.0.1:8118
TAVILY_API_KEY=你的 Tavily Key
```

说明：

- `OPENAI_API_KEY` 是模型调用用的 key。
- `TAVILY_API_KEY` 是 Tavily 搜索用的 key，通常以 `tvly-` 开头，不要填 OpenAI key。
- `OPENAI_BASE_URL` 如果使用第三方 OpenAI 兼容网关，通常要以 `/v1` 结尾。
- `ALLOW_CUSTOM_OPENAI_BASE_URL=true` 表示你确认信任这个第三方网关，可以把 API key 发给它。
- `HTTPS_PROXY` 只影响 Node 程序里的网络请求；Git 推送代理需要另外用 `git config` 设置。

## 启动

```bash
pnpm dev
```

可以先试本地文件读取：

```text
读取 notes/this-week.md，帮我写一份专业但简洁的周报
```

也可以直接使用周报命令：

```text
/weekly notes/this-week.md
```

它会自动读取素材、生成周报，并保存到 `outputs/weekly-日期.md`。

再试网页搜索：

```text
搜索一下 LangChain.js Agent 的最新用法，总结三点
```

## Web UI

Web 版使用 Vite + React，并接入 `@apollo/AIChat` 聊天组件。私服依赖通过 `.npmrc` 配置：

```text
@apollo:registry=http://gd-npm.dc.servyou-it.com
@gd:registry=http://gd-npm.dc.servyou-it.com
```

启动 Web UI：

```bash
pnpm dev:web
```

默认端口：

```text
Web:    http://localhost:5173
Server: http://localhost:5174
```

前端只负责展示和发送用户输入，模型、搜索、文件读取都由本地 `src/server.ts` 处理，避免在浏览器暴露 API key。

## 常用命令

在 CLI 中输入 `/` 可以查看支持的命令，输入命令前缀后按 `Tab` 可以补全。

```text
/weekly notes/this-week.md   # 读取素材，生成并保存周报
/memory                      # 查看最近对话记忆
/summary                     # 让助手总结最近对话，方便恢复上下文
/clear                       # 清空本地记忆
exit                         # 退出 CLI
```

## 诊断 OpenAI 连接

如果 CLI 一直停在：

```text
[状态] 正在请求模型...
```

运行：

```bash
pnpm check:openai
```

这个命令会检查：

- API key 是否存在
- 当前模型是否在 `/v1/models` 里
- `OPENAI_BASE_URL` 是否返回 JSON
- 代理是否配置
- 是否误把 key 发往未确认信任的第三方域名

## 运行评估

```bash
pnpm eval
```

评估脚本会读取 `eval-cases.json`，跑固定问题并检查回答里是否包含预期关键词。它不是严格评分系统，更像一个“改 prompt / 改工具后别退化太离谱”的烟雾测试。

当前评估覆盖：

- 读取周报文件并生成周报
- 搜索一个技术问题
- 遇到不存在文件时如何回答
- 不允许读取项目外文件
- `/memory` 和 `/summary` 命令是否可用

## 关键设计

这个项目保留了两层能力：

- LangChain 工具调用：模型可以主动调用 `read_local_file` 和 `web_search`。
- CLI 预处理兜底：当用户明确提到本地文件或搜索意图时，程序先读取/搜索，再把结果交给模型。

这样做是因为一些第三方 OpenAI 兼容网关对 tool calling 支持不完整。确定性动作由程序兜底，模型专注理解、总结和写作，入门阶段会更稳定。

## 常见问题

### 为什么浏览器能打开 OpenAI，但 CLI 连接超时？

浏览器可能走了代理插件或系统分流，而终端里的 Node 进程没有走代理。请在 `.env` 中配置：

```bash
HTTPS_PROXY=http://127.0.0.1:8118
```

端口需要换成你本地代理实际监听的 HTTP/Mixed 端口。

### 为什么搜索失败？

先确认 `.env` 里的 `TAVILY_API_KEY` 是 Tavily 的 key，而不是 OpenAI key。

Tavily key 需要在 [Tavily 控制台](https://app.tavily.com) 单独申请。

### 为什么使用第三方网关要设置 `ALLOW_CUSTOM_OPENAI_BASE_URL=true`？

因为只要设置了自定义 `OPENAI_BASE_URL`，程序就会把 `OPENAI_API_KEY` 发给那个域名。这个开关是一个安全确认，避免误把 key 发到不可信地址。
