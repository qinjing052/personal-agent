import readline from "node:readline/promises";
import fs from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { createPersonalAgent } from "./agent.js";
import { assertConfig, config } from "./config.js";
import {
  formatMemoryForSummary,
  loadMemory,
  saveMemory,
  summarizeMemoryItems,
} from "./memory.js";
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

console.log("Personal Agent TS 已启动。输入 exit 退出，输入 /clear 清空记忆，输入 /memory 查看记忆。");

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
 * 将用户给出的相对路径解析到项目目录内。
 *
 * 所有本地文件读取都走这里，避免 `/weekly ../secret` 这类路径逃逸。
 */
function resolveProjectFilePath(filePath: string) {
  const fullPath = path.resolve(process.cwd(), filePath);
  const relativePath = path.relative(process.cwd(), fullPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`拒绝读取项目目录外的文件：${filePath}`);
  }

  return {
    fullPath,
    relativePath,
  };
}

async function readProjectTextFile(filePath: string) {
  const { fullPath, relativePath } = resolveProjectFilePath(filePath);
  const content = await fs.readFile(fullPath, "utf-8");

  return {
    content,
    relativePath,
  };
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

  try {
    const { content, relativePath } = await readProjectTextFile(filePath);
    process.stdout.write(`\n[本地] 已读取 ${relativePath}\n`);
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

/**
 * 解析 `/weekly <file>` 命令。
 */
function parseWeeklyCommand(inputText: string): string | undefined {
  const match = inputText.match(/^\/weekly(?:\s+(.+))?$/);

  if (!match) {
    return undefined;
  }

  return match[1]?.trim() ?? "";
}

function buildWeeklyPrompt(filePath: string, content: string) {
  return [
    `请基于本地文件 ${filePath} 的内容生成一份专业、简洁、可直接发送的周报。`,
    "",
    "输出要求：",
    "- 使用 Markdown。",
    "- 必须包含：本周完成、进行中、问题风险、下周计划。",
    "- 只基于素材内容整理，不要编造没有出现的事实。",
    "- 表达要适合发给直属领导或团队群。",
    "",
    "素材内容：",
    "```",
    content,
    "```",
  ].join("\n");
}

function formatDatePart(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatTimePart(date: Date) {
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");

  return `${hour}${minute}${second}`;
}

async function saveWeeklyReport(report: string) {
  const outputDir = path.resolve(process.cwd(), "outputs");
  const now = new Date();
  const datePart = formatDatePart(now);
  let outputPath = path.join(outputDir, `weekly-${datePart}.md`);

  await fs.mkdir(outputDir, { recursive: true });

  try {
    await fs.access(outputPath);
    outputPath = path.join(outputDir, `weekly-${datePart}-${formatTimePart(now)}.md`);
  } catch {
    // 文件不存在时使用默认的日期文件名。
  }

  await fs.writeFile(outputPath, `${report.trim()}\n`, "utf-8");

  return path.relative(process.cwd(), outputPath);
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

async function streamAgentResponse(agentMessages: BaseMessage[]) {
  let lastText = "";
  let printedStatus = false;
  let contentStarted = false;
  let waitingSeconds = 0;
  let lastActivityAt = Date.now();

  function writeStatus(message: string) {
    if (contentStarted) {
      return;
    }

    process.stdout.write(`${printedStatus ? "" : "\n"}${message}\n`);
    printedStatus = true;
  }

  function writeContent(text: string) {
    if (!contentStarted && printedStatus) {
      process.stdout.write("\n");
    }

    contentStarted = true;
    process.stdout.write(text);
    lastText += text;
  }

  const waitingTimer = setInterval(() => {
    if (contentStarted) {
      return;
    }

    if (Date.now() - lastActivityAt < 5_000) {
      return;
    }

    waitingSeconds += 5;
    writeStatus(`[状态] 还在等待模型或工具返回，已等待 ${waitingSeconds} 秒...`);
  }, 5_000);

  try {
    /**
     * streamEvents 能同时拿到模型 token、工具开始/结束等事件。
     * 这样终端不会在工具调用或网络等待时像“卡死”一样没有反馈。
     */
    const stream = await agent.streamEvents(
      { messages: agentMessages },
      { version: "v2" },
    );

    for await (const event of stream) {
      lastActivityAt = Date.now();

      if (event.event === "on_chat_model_start") {
        writeStatus("[状态] 正在请求模型...");
        continue;
      }

      if (event.event === "on_tool_start") {
        const inputSummary = summarizeToolInput(event.data?.input);
        writeStatus(`[工具] ${event.name} 开始${inputSummary ? `：${inputSummary}` : ""}`);
        continue;
      }

      if (event.event === "on_tool_end") {
        writeStatus(`[工具] ${event.name} 完成`);
        continue;
      }

      if (event.event === "on_chat_model_stream") {
        const text = extractText(event.data?.chunk?.content);

        if (text.length > 0) {
          writeContent(text);
        }
      }

      if (event.event === "on_chat_model_end" && lastText.length === 0) {
        const text = extractText(event.data?.output?.content);

        if (text.length > 0) {
          writeContent(text);
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`\n[错误] ${message}`);
  } finally {
    clearInterval(waitingTimer);
  }

  process.stdout.write(contentStarted || printedStatus ? "\n" : "");

  return lastText;
}

async function handleWeeklyCommand(filePath: string) {
  if (!filePath) {
    console.log("助手：用法：/weekly notes/this-week.md");
    return;
  }

  try {
    const { content, relativePath } = await readProjectTextFile(filePath);
    const prompt = buildWeeklyPrompt(relativePath, content);

    process.stdout.write(`\n[周报] 已读取 ${relativePath}`);
    process.stdout.write("\n助手：");

    const agentMessages = [...messages, new HumanMessage(prompt)];
    const report = await streamAgentResponse(agentMessages);

    if (!report.trim()) {
      return;
    }

    const outputPath = await saveWeeklyReport(report);
    process.stdout.write(`[周报] 已保存到 ${outputPath}\n`);

    messages.push(new HumanMessage(`/weekly ${relativePath}`));
    messages.push(new AIMessage(report));
    await saveMemory(config.memoryFile, messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`助手：生成周报失败：${message}`);
  }
}

function handleMemoryCommand() {
  const items = summarizeMemoryItems(messages);

  if (items.length === 0) {
    console.log("助手：当前还没有对话记忆。");
    return;
  }

  console.log(`助手：当前记忆共 ${items.length} 条，最近对话如下：`);
  for (const item of items.slice(-10)) {
    console.log(`${item.index}. ${item.role === "user" ? "你" : "助手"}：${item.preview}`);
  }
}

async function handleClearCommand() {
  messages.length = 0;
  await saveMemory(config.memoryFile, messages);
  console.log("助手：已清空本地记忆。");
}

async function handleSummaryCommand() {
  const memoryText = formatMemoryForSummary(messages);

  if (!memoryText) {
    console.log("助手：当前还没有足够记忆可以总结。");
    return;
  }

  const prompt = [
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

  process.stdout.write("\n助手：");
  const summary = await streamAgentResponse([...messages, new HumanMessage(prompt)]);

  if (!summary.trim()) {
    return;
  }

  messages.push(new HumanMessage("/summary"));
  messages.push(new AIMessage(summary));
  await saveMemory(config.memoryFile, messages);
}

while (true) {
  const userInput = await rl.question("\n你：");
  const trimmed = userInput.trim();

  if (trimmed === "exit") {
    break;
  }

  if (trimmed === "clear" || trimmed === "/clear") {
    await handleClearCommand();
    continue;
  }

  if (trimmed === "/memory") {
    handleMemoryCommand();
    continue;
  }

  if (trimmed === "/summary") {
    await handleSummaryCommand();
    continue;
  }

  const weeklyFilePath = parseWeeklyCommand(trimmed);
  if (weeklyFilePath !== undefined) {
    await handleWeeklyCommand(weeklyFilePath);
    continue;
  }

  const enrichedInput = await readMentionedLocalFile(userInput)
    ?? await searchMentionedTopic(userInput)
    ?? userInput;
  messages.push(new HumanMessage(enrichedInput));
  process.stdout.write("\n助手：");

  const lastText = await streamAgentResponse(messages);

  if (lastText.length > 0) {
    messages.push(new AIMessage(lastText));
    await saveMemory(config.memoryFile, messages);
  }
}

rl.close();
