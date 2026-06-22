# Personal Agent TS

A tiny TypeScript + LangChain.js personal assistant for learning the full Agent loop:

- system prompt
- tool calling
- streamed CLI output
- local conversation memory
- simple evaluation cases

## Setup

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Fill in `OPENAI_API_KEY` in `.env` before running.

`TAVILY_API_KEY` is optional. Without it, the `web_search` tool stays available but returns setup guidance.

## Try It

```text
读取 notes/this-week.md，帮我写一份周报
```

```text
搜索 LangChain.js agent 的最新用法，并结合这个项目说说下一步怎么升级
```

## Evaluate

```bash
pnpm eval
```

The eval script runs a few fixed prompts and prints rough pass/fail checks. It is intentionally simple so you can edit it as your Agent grows.

## Diagnose Connection Issues

If the CLI stays at `[状态] 正在请求模型...`, run:

```bash
pnpm check:openai
```

If it reports a connection timeout, configure your network proxy in the shell before running `pnpm dev`, or set `OPENAI_BASE_URL` to an OpenAI-compatible gateway.

For example, if your local proxy listens on port `7890`, add this to `.env`:

```bash
HTTPS_PROXY=http://127.0.0.1:7890
```

If you use a third-party OpenAI-compatible gateway, its base URL usually needs to end with `/v1`.
Only enable it if you trust that gateway with your API key:

```bash
OPENAI_BASE_URL=https://your-gateway.example.com/v1
ALLOW_CUSTOM_OPENAI_BASE_URL=true
```
