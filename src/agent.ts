import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import type { BaseMessage } from "@langchain/core/messages";
import { config } from "./config.js";
import { systemPrompt } from "./systemPrompt.js";
import { readLocalFile } from "./tools/readLocalFile.js";
import { webSearch } from "./tools/webSearch.js";

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
