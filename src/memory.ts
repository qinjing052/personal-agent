import fs from "node:fs/promises";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

type StoredMessage = {
  role: "user" | "assistant";
  content: string;
};

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
