import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { createPersonalAgent } from "../agent.js";
import { config } from "../config.js";
import {
  formatMemoryForSummary,
  loadMemory,
  saveMemory,
  summarizeMemoryItems,
} from "../memory.js";
import { searchWeb } from "../tools/webSearch.js";
import { extractWeatherLocation, getWeather } from "../tools/weather.js";
import {
  parseWeeklyCommand,
  shouldPreSearch,
  stripSearchWords,
} from "./commands.js";
import { extractLocalFilePath, readProjectTextFile } from "./files.js";
import { buildWeeklyPrompt, saveWeeklyReport } from "./weekly.js";

export type RunnerEvent =
  | { type: "status"; message: string }
  | { type: "tool"; message: string }
  | { type: "text"; text: string }
  | { type: "saved"; path: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }

      if (block && typeof block === "object") {
        const value = block as { text?: unknown; content?: unknown };
        return typeof value.text === "string"
          ? value.text
          : typeof value.content === "string"
            ? value.content
            : "";
      }

      return "";
    })
    .join("");
}

function summarizeToolInput(inputValue: unknown): string {
  if (!inputValue) {
    return "";
  }

  const text = typeof inputValue === "string"
    ? inputValue
    : JSON.stringify(inputValue);

  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export class PersonalAgentRunner {
  private readonly agent = createPersonalAgent();

  readonly messages: BaseMessage[];

  constructor(messages: BaseMessage[]) {
    this.messages = messages;
  }

  static async create() {
    return new PersonalAgentRunner(await loadMemory(config.memoryFile));
  }

  async saveMemory() {
    await saveMemory(config.memoryFile, this.messages);
  }

  getMemoryItems() {
    return summarizeMemoryItems(this.messages);
  }

  async clearMemory() {
    this.messages.length = 0;
    await this.saveMemory();
  }

  async prepareInput(inputText: string): Promise<string> {
    const filePath = extractLocalFilePath(inputText);
    if (filePath) {
      try {
        const { content, relativePath } = await readProjectTextFile(filePath);
        return [
          inputText,
          "",
          `以下是我已经从本地文件 ${relativePath} 读取到的内容，请直接基于它回答：`,
          "```",
          content,
          "```",
        ].join("\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `${inputText}\n\n我尝试读取本地文件 ${filePath}，但失败了：${message}`;
      }
    }

    const weatherLocation = extractWeatherLocation(inputText);
    if (weatherLocation !== undefined) {
      if (!weatherLocation) {
        return [
          inputText,
          "",
          "用户想查询天气，但没有提供城市。请直接询问用户要查哪个城市，并给出示例：/weather 杭州。",
        ].join("\n");
      }

      const result = await getWeather(weatherLocation);
      return [
        inputText,
        "",
        `以下是我已经查询到的 ${weatherLocation} 天气数据，请基于数据回答；如果用户问是否下雨，要重点看 precipitation、rain 和 precipitationProbabilityMax：`,
        "```json",
        result,
        "```",
      ].join("\n");
    }

    if (shouldPreSearch(inputText)) {
      const query = stripSearchWords(inputText) || inputText;
      const result = await searchWeb(query);
      return [
        inputText,
        "",
        "以下是我已经搜索到的网页结果，请优先基于这些结果回答；如果结果不足，请明确说明：",
        "```json",
        typeof result === "string" ? result : JSON.stringify(result, null, 2),
        "```",
      ].join("\n");
    }

    return inputText;
  }

  async buildSummaryPrompt() {
    const memoryText = formatMemoryForSummary(this.messages);

    if (!memoryText) {
      return "";
    }

    return [
      "请总结下面这段最近对话记忆，帮助用户快速回顾目前在做什么。",
      "",
      "输出要求：",
      "- 用中文。",
      "- 分成：当前目标、已完成、待处理、注意事项。",
      "- 保持简洁，不要编造记忆里没有的信息。",
      "",
      "最近对话记忆：",
      memoryText,
    ].join("\n");
  }

  async buildWeeklyPromptFromCommand(inputText: string) {
    const filePath = parseWeeklyCommand(inputText);

    if (filePath === undefined) {
      return undefined;
    }

    if (!filePath) {
      throw new Error("用法：/weekly notes/this-week.md");
    }

    const { content, relativePath } = await readProjectTextFile(filePath);
    return {
      relativePath,
      prompt: buildWeeklyPrompt(relativePath, content),
    };
  }

  async *streamMessages(agentMessages: BaseMessage[]): AsyncGenerator<RunnerEvent> {
    let text = "";

    try {
      const stream = await this.agent.streamEvents(
        { messages: agentMessages },
        { version: "v2" },
      );

      for await (const event of stream) {
        if (event.event === "on_chat_model_start") {
          yield { type: "status", message: "正在请求模型..." };
          continue;
        }

        if (event.event === "on_tool_start") {
          const inputSummary = summarizeToolInput(event.data?.input);
          yield {
            type: "tool",
            message: `${event.name} 开始${inputSummary ? `：${inputSummary}` : ""}`,
          };
          continue;
        }

        if (event.event === "on_tool_end") {
          yield { type: "tool", message: `${event.name} 完成` };
          continue;
        }

        if (event.event === "on_chat_model_stream") {
          const delta = extractText(event.data?.chunk?.content);
          if (delta) {
            text += delta;
            yield { type: "text", text: delta };
          }
        }

        if (event.event === "on_chat_model_end" && text.length === 0) {
          const finalText = extractText(event.data?.output?.content);
          if (finalText) {
            text += finalText;
            yield { type: "text", text: finalText };
          }
        }
      }

      yield { type: "done", text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: "error", message };
    }
  }

  async *runPrompt(prompt: string): AsyncGenerator<RunnerEvent> {
    const enrichedInput = await this.prepareInput(prompt);
    this.messages.push(new HumanMessage(enrichedInput));

    for await (const event of this.streamMessages(this.messages)) {
      yield event;

      if (event.type === "done" && event.text.trim()) {
        this.messages.push(new AIMessage(event.text));
        await this.saveMemory();
      }
    }
  }

  async *runWeekly(inputText: string): AsyncGenerator<RunnerEvent> {
    const weekly = await this.buildWeeklyPromptFromCommand(inputText);
    if (!weekly) {
      return;
    }

    yield { type: "status", message: `已读取 ${weekly.relativePath}` };
    const agentMessages = [...this.messages, new HumanMessage(weekly.prompt)];

    for await (const event of this.streamMessages(agentMessages)) {
      yield event;

      if (event.type === "done" && event.text.trim()) {
        const outputPath = await saveWeeklyReport(event.text);
        yield { type: "saved", path: outputPath };
        this.messages.push(new HumanMessage(`/weekly ${weekly.relativePath}`));
        this.messages.push(new AIMessage(event.text));
        await this.saveMemory();
      }
    }
  }

  async *runSummary(): AsyncGenerator<RunnerEvent> {
    const prompt = await this.buildSummaryPrompt();

    if (!prompt) {
      yield { type: "text", text: "当前还没有足够记忆可以总结。" };
      yield { type: "done", text: "当前还没有足够记忆可以总结。" };
      return;
    }

    const agentMessages = [...this.messages, new HumanMessage(prompt)];
    for await (const event of this.streamMessages(agentMessages)) {
      yield event;

      if (event.type === "done" && event.text.trim()) {
        this.messages.push(new HumanMessage("/summary"));
        this.messages.push(new AIMessage(event.text));
        await this.saveMemory();
      }
    }
  }
}
