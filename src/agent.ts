import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import type { BaseMessage } from "@langchain/core/messages";
import { config } from "./config.js";
import { systemPrompt } from "./systemPrompt.js";
import { readLocalFile } from "./tools/readLocalFile.js";
import { webSearch } from "./tools/webSearch.js";

/**
 * 创建个人助手 Agent。
 *
 * 这里使用 LangGraph 的预置 ReAct Agent，把模型、系统提示词和工具绑定在一起。
 * CLI 层还有本地文件/搜索的预处理兜底，但保留工具调用可以帮助学习标准 Agent 流程。
 */
export function createPersonalAgent() {
  const model = new ChatOpenAI({
    model: config.model,
    temperature: 0.3,
    streaming: true,
    timeout: config.openAiTimeoutMs,
    configuration: {
      baseURL: config.openAiBaseUrl,
    },
  });

  return createReactAgent({
    llm: model,
    tools: [readLocalFile, webSearch],
    messageModifier: systemPrompt,
  });
}

export type AgentResult = {
  text: string;
  messages: BaseMessage[];
};
