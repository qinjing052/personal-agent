import fs from "node:fs/promises";
import path from "node:path";

export function extractLocalFilePath(inputText: string): string | undefined {
  const match = inputText.match(/(?:^|[\s`"“”'，,：:])((?:notes|docs|data)\/[^\s`"“”'，,。；;]+?\.(?:md|txt|json|csv))/);
  return match?.[1];
}

/**
 * 将用户给出的相对路径解析到项目目录内，避免 `../` 读取项目外文件。
 */
export function resolveProjectFilePath(filePath: string) {
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

export async function readProjectTextFile(filePath: string) {
  const { fullPath, relativePath } = resolveProjectFilePath(filePath);
  const content = await fs.readFile(fullPath, "utf-8");

  return {
    content,
    relativePath,
  };
}
