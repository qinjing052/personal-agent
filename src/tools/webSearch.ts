import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { config } from "../config.js";

const tavilySearch = config.tavilyApiKey && config.tavilyApiKey !== "replace_me"
  ? new TavilySearchResults({
      apiKey: config.tavilyApiKey,
      maxResults: 5,
    })
  : null;

export async function searchWeb(query: string) {
  if (!tavilySearch) {
    return "web_search 尚未配置。请在 .env 中设置 TAVILY_API_KEY，或先跳过网页搜索能力。";
  }

  if (config.tavilyApiKey === config.openAiApiKey) {
    return "TAVILY_API_KEY 看起来和 OPENAI_API_KEY 相同。请不要把 OpenAI key 发给 Tavily；需要在 tavily.com 单独申请 Tavily API key。";
  }

  return await tavilySearch.invoke(query);
}

export const webSearch = tool(
  async ({ query }) => {
    return await searchWeb(query);
  },
  {
    name: "web_search",
    description: "搜索网页，适合查询最新资料、技术文档、新闻或公开信息。",
    schema: z.object({
      query: z.string().describe("搜索关键词"),
    }),
  },
);
