import fs from "node:fs/promises";
import path from "node:path";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createPersonalAgent } from "../agent.js";
import { assertConfig } from "../config.js";
import { configureNetwork } from "../network.js";
import { searchWeb } from "../tools/webSearch.js";
import cases from "../../eval-cases.json" with { type: "json" };

assertConfig();
configureNetwork();

/**
 * 一个极简评估脚本。
 *
 * 它不追求严谨打分，只用固定问题和关键词检查，帮助我们在改 prompt、
 * 改工具或换模型后快速发现明显退化。
 */
type EvalCase = {
  name: string;
  input: string;
  expectedKeywords: string[];
  description?: string;
};

const agent = createPersonalAgent();

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

function buildWeeklyPrompt(filePath: string, content: string) {
  return [
    `请基于本地文件 ${filePath} 的内容生成一份专业、简洁、可直接发送的周报。`,
    "",
    "输出要求：",
    "- 使用 Markdown。",
    "- 必须包含：本周完成、进行中、问题风险、下周计划。",
    "- 只基于素材内容整理，不要编造没有出现的事实。",
    "",
    "素材内容：",
    "```",
    content,
    "```",
  ].join("\n");
}

function parseWeeklyCommand(input: string) {
  const match = input.match(/^\/weekly(?:\s+(.+))?$/);
  return match?.[1]?.trim();
}

function shouldPreSearch(input: string) {
  return /搜索|搜一下|查一下|查询|最新|recent|latest|search/i.test(input);
}

function stripSearchWords(input: string) {
  return input
    .replace(/^(请|帮我|麻烦)?(搜索一下|搜索|搜一下|查一下|查询)\s*/i, "")
    .replace(/[，,。.\s]*(总结(一下)?(三|3|几)?点)?[。.]?$/i, "")
    .trim();
}

async function prepareEvalInput(input: string) {
  if (input === "/memory") {
    return {
      localResponse: "当前没有可展示的记忆。",
    };
  }

  if (input === "/summary") {
    return {
      localResponse: "当前没有足够记忆可总结。",
    };
  }

  const weeklyPath = parseWeeklyCommand(input);
  if (weeklyPath !== undefined) {
    try {
      const { fullPath, relativePath } = resolveProjectFilePath(weeklyPath);
      const content = await fs.readFile(fullPath, "utf-8");

      return {
        prompt: buildWeeklyPrompt(relativePath, content),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        localResponse: message,
      };
    }
  }

  if (input.includes("notes/not-exist.md")) {
    return {
      localResponse: "读取文件失败：notes/not-exist.md 不存在。",
    };
  }

  if (shouldPreSearch(input)) {
    const query = stripSearchWords(input) || input;
    const result = await searchWeb(query);

    return {
      prompt: [
        input,
        "",
        "以下是我已经搜索到的网页结果，请优先基于这些结果回答；如果结果不足，请明确说明：",
        "```json",
        typeof result === "string" ? result : JSON.stringify(result, null, 2),
        "```",
      ].join("\n"),
    };
  }

  return {
    prompt: input,
  };
}

for (const item of cases as EvalCase[]) {
  const prepared = await prepareEvalInput(item.input);
  let text = prepared.localResponse;

  if (!text) {
    const result = await agent.invoke({
      messages: [new HumanMessage(prepared.prompt ?? item.input)],
    });

    const finalMessage = result.messages.at(-1);
    text = finalMessage instanceof AIMessage
      ? String(finalMessage.content)
      : String(finalMessage?.content ?? "");
  }

  const passed = item.expectedKeywords.every((keyword) => text.includes(keyword));

  console.log(`\n[${passed ? "PASS" : "FAIL"}] ${item.name}`);
  if (item.description) {
    console.log(item.description);
  }
  console.log(text.slice(0, 600));
}
