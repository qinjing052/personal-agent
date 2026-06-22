import "dotenv/config";

/**
 * 读取并集中管理所有环境变量。
 *
 * 这里不直接散落使用 `process.env`，是为了让模型配置、代理、记忆文件等入口
 * 有一个统一位置，后续排查问题时更容易看清当前运行环境。
 */
export const config = {
  openAiApiKey: process.env.OPENAI_API_KEY,
  tavilyApiKey: process.env.TAVILY_API_KEY,
  model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  openAiBaseUrl: process.env.OPENAI_BASE_URL || undefined,
  allowCustomOpenAiBaseUrl: process.env.ALLOW_CUSTOM_OPENAI_BASE_URL === "true",
  openAiTimeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? 20_000),
  proxyUrl: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || undefined,
  memoryFile: process.env.AGENT_MEMORY_FILE ?? ".agent-memory.json",
};

/**
 * 启动前的硬性校验。
 *
 * 自定义 OpenAI Base URL 会接收用户的 API key，所以这里要求显式确认，
 * 避免把 key 误发给不可信的第三方网关。
 */
export function assertConfig() {
  if (!config.openAiApiKey || config.openAiApiKey === "replace_me") {
    throw new Error("Missing OPENAI_API_KEY. Copy .env.example to .env and fill it in.");
  }

  if (usesCustomOpenAiBaseUrl() && !config.allowCustomOpenAiBaseUrl) {
    throw new Error(
      "OPENAI_BASE_URL points to a non-OpenAI domain. Set ALLOW_CUSTOM_OPENAI_BASE_URL=true only if you trust that gateway with your API key.",
    );
  }
}

/**
 * 判断当前是否使用了非官方 OpenAI API 域名。
 */
export function usesCustomOpenAiBaseUrl() {
  if (!config.openAiBaseUrl) {
    return false;
  }

  try {
    const hostname = new URL(config.openAiBaseUrl).hostname;
    return hostname !== "api.openai.com";
  } catch {
    return true;
  }
}
