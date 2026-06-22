import readline from "node:readline/promises";
import fs from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createPersonalAgent } from "./agent.js";
import { assertConfig, config } from "./config.js";
import { loadMemory, saveMemory } from "./memory.js";
import { configureNetwork } from "./network.js";
import { searchWeb } from "./tools/webSearch.js";

/**
 * CLI 主入口。
 *
 * 负责读取用户输入、做确定性的本地文件/搜索预处理、调用 Agent 流式输出，
 * 最后把对话写入本地记忆文件。
 */
assertConfig();
configureNetwork();

const agent = createPersonalAgent();
const rl = readline.createInterface({ input, output });
const messages = await loadMemory(config.memoryFile);

console.log("Personal Agent TS 已启动。输入 exit 退出，输入 clear 清空本地记忆。");

/**
 * LangChain/OpenAI 的流式 chunk 可能是字符串，也可能是结构化 content block。
 * CLI 只关心能展示给用户的文本，所以这里统一抽取为 string。
 */
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
        if (typeof value.text === "string") {
          return value.text;
        }
        if (typeof value.content === "string") {
          return value.content;
        }
      }

      return "";
    })
    .join("");
}

/**
 * 工具入参可能很长，终端状态只展示摘要，避免刷屏。
 */
function summarizeToolInput(inputValue: unknown): string {
  if (!inputValue) {
    return "";
  }

  const text = typeof inputValue === "string"
    ? inputValue
    : JSON.stringify(inputValue);

  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/**
 * 从用户输入中识别项目内的常见资料路径。
 */
function extractLocalFilePath(inputText: string): string | undefined {
  const match = inputText.match(/(?:^|[\s`"“”'，,：:])((?:notes|docs|data)\/[^\s`"“”'，,。；;]+?\.(?:md|txt|json|csv))/);
  return match?.[1];
}

/**
 * 本地文件读取兜底。
 *
 * 一些 OpenAI 兼容网关对 tool calling 支持不稳定，所以当用户明确提到文件路径时，
 * CLI 先确定性读取文件，再把文件内容作为上下文交给模型。
 */
async function readMentionedLocalFile(inputText: string): Promise<string | undefined> {
  const filePath = extractLocalFilePath(inputText);

  if (!filePath) {
    return undefined;
  }

  const root = process.cwd();
  const fullPath = path.resolve(root, filePath);
  const relativePath = path.relative(root, fullPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return `用户提到了本地文件 ${filePath}，但它不在当前项目目录内，已拒绝读取。`;
  }

  try {
    const content = await fs.readFile(fullPath, "utf-8");
    process.stdout.write(`\n[本地] 已读取 ${filePath}\n`);
    return [
      inputText,
      "",
      `以下是我已经从本地文件 ${filePath} 读取到的内容，请直接基于它回答：`,
      "```",
      content,
      "```",
    ].join("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `${inputText}\n\n我尝试读取本地文件 ${filePath}，但失败了：${message}`;
  }
}

/**
 * 判断用户是否表达了搜索意图。
 */
function shouldPreSearch(inputText: string) {
  return /搜索|搜一下|查一下|查询|最新|recent|latest|search/i.test(inputText);
}

/**
 * 把自然语言里的命令词去掉，得到更适合作为搜索 query 的文本。
 */
function stripSearchWords(inputText: string) {
  return inputText
    .replace(/^(请|帮我|麻烦)?(搜索一下|搜索|搜一下|查一下|查询)\s*/i, "")
    .replace(/[，,。.\s]*(总结(一下)?(三|3|几)?点)?[。.]?$/i, "")
    .trim();
}

/**
 * 网页搜索兜底。
 *
 * 与本地文件类似，搜索这种确定性动作先由程序执行，再让模型基于搜索结果总结。
 */
async function searchMentionedTopic(inputText: string): Promise<string | undefined> {
  if (!shouldPreSearch(inputText)) {
    return undefined;
  }

  const query = stripSearchWords(inputText) || inputText;
  process.stdout.write(`\n[搜索] 正在搜索：${query}\n`);

  try {
    const result = await searchWeb(query);

    if (typeof result === "string" && /尚未配置|TAVILY_API_KEY/.test(result)) {
      process.stdout.write(`[搜索] ${result}\n`);
    } else {
      process.stdout.write("[搜索] 已获取搜索结果\n");
    }

    return [
      inputText,
      "",
      "以下是我已经搜索到的网页结果，请优先基于这些结果回答；如果结果不足，请明确说明：",
      "```json",
      typeof result === "string" ? result : JSON.stringify(result, null, 2),
      "```",
    ].join("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `${inputText}\n\n我尝试搜索网页，但失败了：${message}`;
  }
}

while (true) {
  const userInput = await rl.question("\n你：");
  const trimmed = userInput.trim();

  if (trimmed === "exit") {
    break;
  }

  if (trimmed === "clear") {
    messages.length = 0;
    await saveMemory(config.memoryFile, messages);
    console.log("助手：已清空本地记忆。");
    continue;
  }

  const enrichedInput = await readMentionedLocalFile(userInput)
    ?? await searchMentionedTopic(userInput)
    ?? userInput;
  messages.push(new HumanMessage(enrichedInput));
  process.stdout.write("\n助手：");

  let lastText = "";
  let printedStatus = false;
  let waitingSeconds = 0;

  const waitingTimer = setInterval(() => {
    waitingSeconds += 5;
    process.stdout.write(
      `\n[状态] 还在等待模型或工具返回，已等待 ${waitingSeconds} 秒...`,
    );
    printedStatus = true;
  }, 5000);

  try {
    /**
     * streamEvents 能同时拿到模型 token、工具开始/结束等事件。
     * 这样终端不会在工具调用或网络等待时像“卡死”一样没有反馈。
     */
    const stream = await agent.streamEvents(
      { messages },
      { version: "v2" },
    );

    for await (const event of stream) {
      if (event.event === "on_chat_model_start") {
        process.stdout.write("\n[状态] 正在请求模型...");
        printedStatus = true;
        continue;
      }

      if (event.event === "on_tool_start") {
        const inputSummary = summarizeToolInput(event.data?.input);
        process.stdout.write(
          `\n[工具] ${event.name} 开始${inputSummary ? `：${inputSummary}` : ""}`,
        );
        printedStatus = true;
        continue;
      }

      if (event.event === "on_tool_end") {
        process.stdout.write(`\n[工具] ${event.name} 完成\n`);
        printedStatus = true;
        continue;
      }

      if (event.event === "on_chat_model_stream") {
        const text = extractText(event.data?.chunk?.content);

        if (text.length > 0) {
          process.stdout.write(text);
          lastText += text;
        }
      }

      if (event.event === "on_chat_model_end" && lastText.length === 0) {
        const text = extractText(event.data?.output?.content);

        if (text.length > 0) {
          process.stdout.write(text);
          lastText += text;
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`\n[错误] ${message}`);
  } finally {
    clearInterval(waitingTimer);
  }

  process.stdout.write(printedStatus ? "\n" : "\n");

  if (lastText.length > 0) {
    messages.push(new AIMessage(lastText));
    await saveMemory(config.memoryFile, messages);
  }
}

rl.close();
