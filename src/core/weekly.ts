import fs from "node:fs/promises";
import path from "node:path";

export function buildWeeklyPrompt(filePath: string, content: string) {
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

export async function saveWeeklyReport(report: string) {
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
