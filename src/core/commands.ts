export const commands = [
  { name: "/weekly", usage: "/weekly notes/this-week.md", description: "读取素材，生成并保存周报" },
  { name: "/weather", usage: "/weather 杭州", description: "查询城市当前天气和 3 天预报" },
  { name: "/memory", usage: "/memory", description: "查看最近对话记忆" },
  { name: "/summary", usage: "/summary", description: "总结最近对话记忆" },
  { name: "/clear", usage: "/clear", description: "清空本地记忆" },
  { name: "/help", usage: "/help", description: "显示命令帮助" },
];

export function parseWeeklyCommand(inputText: string): string | undefined {
  const match = inputText.match(/^\/weekly(?:\s+(.+))?$/);

  if (!match) {
    return undefined;
  }

  return match[1]?.trim() ?? "";
}

export function shouldPreSearch(inputText: string) {
  return /搜索|搜一下|查一下|查询|最新|recent|latest|search/i.test(inputText);
}

export function stripSearchWords(inputText: string) {
  return inputText
    .replace(/^(请|帮我|麻烦)?(搜索一下|搜索|搜一下|查一下|查询)\s*/i, "")
    .replace(/[，,。.\s]*(总结(一下)?(三|3|几)?点)?[。.]?$/i, "")
    .trim();
}
