import "dotenv/config";

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
