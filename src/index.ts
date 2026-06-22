import readline, { clearLine, cursorTo } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { assertConfig } from "./config.js";
import { commands, parseWeeklyCommand } from "./core/commands.js";
import { PersonalAgentRunner, type RunnerEvent } from "./core/agentRunner.js";
import { configureNetwork } from "./network.js";

/**
 * CLI 主入口。
 *
 * 负责读取用户输入、显示命令提示、把用户意图分发给 core runner，
 * 并将 runner 的事件渲染成终端里的流式输出。
 */
assertConfig();
configureNetwork();

const runner = await PersonalAgentRunner.create();
const rl = readline.createInterface({
  input,
  output,
  completer(line: string) {
    if (!line.startsWith("/")) {
      return [[], line];
    }

    const hits = commands
      .map((command) => command.name)
      .filter((name) => name.startsWith(line));

    return [hits.length > 0 ? hits : commands.map((command) => command.name), line];
  },
});

console.log("Personal Agent TS 已启动。输入 / 查看命令，Tab 可补全命令，输入 exit 退出。");

function printPrompt() {
  process.stdout.write("\n你：");
}

function printCommandHelp() {
  console.log("助手：支持的命令：");
  for (const command of commands) {
    console.log(`${command.usage.padEnd(30)} ${command.description}`);
  }
}

function renderMemory() {
  const items = runner.getMemoryItems();

  if (items.length === 0) {
    console.log("助手：当前还没有对话记忆。");
    return;
  }

  console.log(`助手：当前记忆共 ${items.length} 条，最近对话如下：`);
  for (const item of items.slice(-10)) {
    console.log(`${item.index}. ${item.role === "user" ? "你" : "助手"}：${item.preview}`);
  }
}

async function renderRunnerEvents(events: AsyncGenerator<RunnerEvent>) {
  let contentStarted = false;
  let printedStatus = false;
  let activeStatus = "";
  let spinnerIndex = 0;
  const spinnerFrames = ["-", "\\", "|", "/"];

  function writeStatus(message: string) {
    if (contentStarted) {
      return;
    }

    if (!printedStatus) {
      process.stdout.write("\n");
    }

    activeStatus = message;
    process.stdout.write(`${activeStatus} ${spinnerFrames[spinnerIndex]}`);
    printedStatus = true;
  }

  function clearStatusLine() {
    if (!printedStatus || contentStarted) {
      return;
    }

    clearLine(output, 0);
    cursorTo(output, 0);
  }

  function writeContent(text: string) {
    if (!contentStarted && printedStatus) {
      clearStatusLine();
      process.stdout.write("\n");
    }

    contentStarted = true;
    process.stdout.write(text);
  }

  const loadingTimer = setInterval(() => {
    if (contentStarted || !activeStatus) {
      return;
    }

    spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
    clearLine(output, 0);
    cursorTo(output, 0);
    process.stdout.write(`${activeStatus} ${spinnerFrames[spinnerIndex]}`);
  }, 120);

  try {
    for await (const event of events) {
      if (event.type === "status") {
        writeStatus(`[状态] ${event.message}`);
        continue;
      }

      if (event.type === "tool") {
        writeStatus(`[工具] ${event.message}`);
        continue;
      }

      if (event.type === "text") {
        writeContent(event.text);
        continue;
      }

      if (event.type === "saved") {
        process.stdout.write(`[周报] 已保存到 ${event.path}\n`);
        continue;
      }

      if (event.type === "error") {
        process.stdout.write(`\n[错误] ${event.message}`);
      }
    }
  } finally {
    clearInterval(loadingTimer);
  }

  if (!contentStarted && printedStatus) {
    clearStatusLine();
  }
  process.stdout.write(contentStarted ? "\n" : "");
}

async function handleUserInput(userInput: string) {
  const trimmed = userInput.trim();

  if (trimmed === "exit") {
    return false;
  }

  if (trimmed === "/" || trimmed === "/help") {
    printCommandHelp();
    return true;
  }

  if (trimmed === "clear" || trimmed === "/clear") {
    await runner.clearMemory();
    console.log("助手：已清空本地记忆。");
    return true;
  }

  if (trimmed === "/memory") {
    renderMemory();
    return true;
  }

  if (trimmed === "/summary") {
    process.stdout.write("\n助手：");
    await renderRunnerEvents(runner.runSummary());
    return true;
  }

  if (parseWeeklyCommand(trimmed) !== undefined) {
    try {
      const weeklyPath = parseWeeklyCommand(trimmed);
      if (weeklyPath) {
        process.stdout.write(`\n[周报] 正在读取 ${weeklyPath}`);
      }
      process.stdout.write("\n助手：");
      await renderRunnerEvents(runner.runWeekly(trimmed));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`助手：生成周报失败：${message}`);
    }
    return true;
  }

  process.stdout.write("\n助手：");
  await renderRunnerEvents(runner.runPrompt(userInput));
  return true;
}

printPrompt();
for await (const userInput of rl) {
  const shouldContinue = await handleUserInput(userInput);
  if (!shouldContinue) {
    break;
  }
  printPrompt();
}

rl.close();
