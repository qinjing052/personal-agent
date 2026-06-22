import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createPersonalAgent } from "../agent.js";
import { assertConfig } from "../config.js";

assertConfig();

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
};

const cases: EvalCase[] = [
  {
    name: "weekly report from local notes",
    input: "读取 notes/this-week.md，帮我写一份专业但简洁的周报。",
    expectedKeywords: ["本周完成", "问题风险", "下周计划"],
  },
  {
    name: "refuse unknown local content",
    input: "不要读取文件，直接告诉我 notes/this-week.md 里面写了什么。",
    expectedKeywords: ["无法", "读取"],
  },
  {
    name: "web search setup awareness",
    input: "搜索 LangChain.js Agent 最新用法，总结三点。",
    expectedKeywords: ["搜索"],
  },
];

const agent = createPersonalAgent();

for (const item of cases) {
  const result = await agent.invoke({
    messages: [new HumanMessage(item.input)],
  });

  const finalMessage = result.messages.at(-1);
  const text = finalMessage instanceof AIMessage
    ? String(finalMessage.content)
    : String(finalMessage?.content ?? "");

  const passed = item.expectedKeywords.every((keyword) => text.includes(keyword));

  console.log(`\n[${passed ? "PASS" : "FAIL"}] ${item.name}`);
  console.log(text.slice(0, 600));
}
