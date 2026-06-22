import http from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { assertConfig } from "./config.js";
import { parseWeeklyCommand } from "./core/commands.js";
import { PersonalAgentRunner, type RunnerEvent } from "./core/agentRunner.js";
import { configureNetwork } from "./network.js";

assertConfig();
configureNetwork();

const port = Number(process.env.PORT ?? 5174);
const runner = await PersonalAgentRunner.create();
const pendingPrompts = new Map<string, string>();

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: http.IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) as Record<string, unknown> : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function writeSse(res: http.ServerResponse, data: unknown) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function toConclusionEvent(sessionId: string, text: string) {
  return {
    success: true,
    code: 0,
    message: "ok",
    sessionId,
    data: {
      responseType: "CONCLUSION",
      conclusion: text,
    },
  };
}

function toFinishEvent(sessionId: string) {
  return {
    success: true,
    code: 0,
    message: "ok",
    sessionId,
    finish: true,
    data: {
      responseType: "CONCLUSION",
    },
  };
}

function toErrorEvent(sessionId: string, message: string) {
  return {
    success: false,
    code: 500,
    message,
    sessionId,
    data: {
      responseType: "CONCLUSION",
      conclusion: message,
    },
  };
}

async function streamRunnerEvents(
  res: http.ServerResponse,
  sessionId: string,
  events: AsyncGenerator<RunnerEvent>,
) {
  for await (const event of events) {
    if (event.type === "text") {
      writeSse(res, toConclusionEvent(sessionId, event.text));
      continue;
    }

    if (event.type === "status" || event.type === "tool") {
      writeSse(res, toConclusionEvent(sessionId, `\n\n> ${event.message}\n\n`));
      continue;
    }

    if (event.type === "saved") {
      writeSse(res, toConclusionEvent(sessionId, `\n\n> 已保存到 ${event.path}\n`));
      continue;
    }

    if (event.type === "error") {
      writeSse(res, toErrorEvent(sessionId, event.message));
      continue;
    }
  }

  writeSse(res, toFinishEvent(sessionId));
  res.end();
}

async function handleStream(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("id");

  if (!sessionId || !pendingPrompts.has(sessionId)) {
    sendJson(res, 404, { message: "session not found" });
    return;
  }

  const prompt = pendingPrompts.get(sessionId) ?? "";
  pendingPrompts.delete(sessionId);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  if (prompt === "/memory") {
    const items = runner.getMemoryItems();
    const text = items.length
      ? [
          `当前记忆共 ${items.length} 条，最近对话如下：`,
          ...items.slice(-10).map((item) => `${item.index}. ${item.role === "user" ? "你" : "助手"}：${item.preview}`),
        ].join("\n")
      : "当前还没有对话记忆。";
    writeSse(res, toConclusionEvent(sessionId, text));
    writeSse(res, toFinishEvent(sessionId));
    res.end();
    return;
  }

  if (prompt === "/clear" || prompt === "clear") {
    await runner.clearMemory();
    writeSse(res, toConclusionEvent(sessionId, "已清空本地记忆。"));
    writeSse(res, toFinishEvent(sessionId));
    res.end();
    return;
  }

  if (prompt === "/summary") {
    await streamRunnerEvents(res, sessionId, runner.runSummary());
    return;
  }

  if (parseWeeklyCommand(prompt) !== undefined) {
    await streamRunnerEvents(res, sessionId, runner.runWeekly(prompt));
    return;
  }

  await streamRunnerEvents(res, sessionId, runner.runPrompt(prompt));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat/start") {
    try {
      const body = await readJsonBody(req);
      const prompt = String(body.prompt ?? "");
      const sessionId = randomUUID();
      pendingPrompts.set(sessionId, prompt);
      sendJson(res, 200, {
        sessionId,
        streamUrl: `/api/chat/stream?id=${sessionId}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 400, { message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/chat/stream") {
    await handleStream(req, res);
    return;
  }

  sendJson(res, 404, { message: "not found" });
});

server.listen(port, () => {
  console.log(`Personal Agent server listening on http://localhost:${port}`);
});
