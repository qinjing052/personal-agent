import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const workspaceRoot = process.cwd();

/**
 * LangChain 工具：读取项目目录内的本地文本文件。
 *
 * 关键点是用 `path.relative` 做目录边界检查，防止通过 `../` 读取项目外文件。
 */
export const readLocalFile = tool(
  async ({ filePath }) => {
    const fullPath = path.resolve(workspaceRoot, filePath);
    const relativePath = path.relative(workspaceRoot, fullPath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return "拒绝读取项目目录外的文件。请把要读取的资料放到当前项目目录内。";
    }

    try {
      return await fs.readFile(fullPath, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `读取文件失败：${message}`;
    }
  },
  {
    name: "read_local_file",
    description: "读取当前项目目录内的文本文件，例如 notes/this-week.md。",
    schema: z.object({
      filePath: z.string().describe("相对当前项目根目录的文件路径"),
    }),
  },
);
