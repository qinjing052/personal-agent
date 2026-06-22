import fs from "node:fs/promises";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

/**
 * 落盘时只保存最小必要信息，避免把 LangChain message 对象的内部字段写进文件。
 */
type StoredMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * 从本地 JSON 文件恢复最近对话。
 *
 * 读取失败时直接返回空数组，这样第一次启动或用户删除记忆文件时不会中断 CLI。
 */
export async function loadMemory(filePath: string): Promise<BaseMessage[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const stored = JSON.parse(raw) as StoredMessage[];

    return stored.map((message) =>
      message.role === "user"
        ? new HumanMessage(message.content)
        : new AIMessage(message.content),
    );
  } catch {
    return [];
  }
}

/**
 * 保存最近 20 条人类/助手消息，控制上下文和本地文件体积。
 */
export async function saveMemory(filePath: string, messages: BaseMessage[]) {
  const stored = messages
    .filter((message) => message._getType() === "human" || message._getType() === "ai")
    .map<StoredMessage>((message) => ({
      role: message._getType() === "human" ? "user" : "assistant",
      content: String(message.content),
    }))
    .slice(-20);

  await fs.writeFile(filePath, `${JSON.stringify(stored, null, 2)}\n`, "utf-8");
}
