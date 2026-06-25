import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApolloAIChat, CommonAIChatRefProps, themes } from "@apollo/AIChat";
import "antd/dist/antd.css";

type StartResponse = {
  sessionId: string;
  streamUrl: string;
};

type CommandItem = {
  label: string;
  prompt: string;
  serverPrompt: string;
  description: string;
};

type ChatHistoryMessage = {
  prompt: string;
  analysis: string;
  conclusion: string;
  sessionId?: string;
};

type ChatHistorySession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatHistoryMessage[];
};

const HISTORY_STORAGE_KEY = "personal-agent-web-history-v1";
const HISTORY_LIMIT = 100;

const commandItems: CommandItem[] = [
  {
    label: "生成周报",
    prompt: "请根据 notes/this-week.md 生成一份本周周报，包含本周完成、进行中、问题风险、下周计划，并保存结果。",
    serverPrompt: "/weekly notes/this-week.md",
    description: "读取本地周报素材并保存结果",
  },
  {
    label: "总结上下文",
    prompt: "请总结一下我们最近的对话上下文，包括当前目标、已完成、待处理和注意事项。",
    serverPrompt: "/summary",
    description: "总结最近对话，方便继续工作",
  },
];

function createSessionId() {
  return `personal-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatHistoryTime(timestamp: number) {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${month}-${day} ${hour}:${minute}`;
}

function createHistoryTitle(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "新会话";
  }

  return normalized.length > 28 ? `${normalized.slice(0, 28)}...` : normalized;
}

function loadHistorySessions(): ChatHistorySession[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as ChatHistorySession[];
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveHistorySessions(sessions: ChatHistorySession[]) {
  if (typeof window === "undefined") {
    return sessions.slice(0, HISTORY_LIMIT);
  }

  let next = sessions.slice(0, HISTORY_LIMIT);
  while (next.length > 0) {
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
      return next;
    } catch {
      // localStorage 有容量限制；写满时优先保留最新会话，裁掉最旧一条后重试。
      next = next.slice(0, -1);
    }
  }

  try {
    window.localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // 忽略清理失败，避免影响当前对话。
  }
  return [];
}

function toServerPrompt(prompt: string) {
  return commandItems.find((item) => item.prompt === prompt)?.serverPrompt ?? prompt;
}

export default function App() {
  const pageRootRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<CommonAIChatRefProps>(null);
  const historyRef = useRef<ChatHistorySession[]>([]);
  const activeHistoryIdRef = useRef<string | undefined>();
  const [groupId, setGroupId] = useState(() => createSessionId());
  const [progressing, setProgressing] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [historySessions, setHistorySessions] = useState<ChatHistorySession[]>(() => loadHistorySessions());
  const [activeHistoryId, setActiveHistoryId] = useState<string | undefined>();

  useEffect(() => {
    historyRef.current = historySessions;
  }, [historySessions]);

  const commitHistory = useCallback((nextSessions: ChatHistorySession[]) => {
    const limited = nextSessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, HISTORY_LIMIT);

    const persisted = saveHistorySessions(limited);
    historyRef.current = persisted;
    setHistorySessions(persisted);
  }, []);

  const ensureHistorySession = useCallback((prompt: string) => {
    const now = Date.now();
    const currentId = activeHistoryIdRef.current;
    const current = currentId
      ? historyRef.current.find((session) => session.id === currentId)
      : undefined;

    if (current) {
      const next = historyRef.current.map((session) => (
        session.id === current.id
          ? {
              ...session,
              title: session.messages.length === 0 ? createHistoryTitle(prompt) : session.title,
              updatedAt: now,
            }
          : session
      ));
      commitHistory(next);
      setActiveHistoryId(current.id);
      return current.id;
    }

    const id = createSessionId();
    const nextSession: ChatHistorySession = {
      id,
      title: createHistoryTitle(prompt),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    activeHistoryIdRef.current = id;
    setActiveHistoryId(id);
    commitHistory([nextSession, ...historyRef.current]);
    return id;
  }, [commitHistory]);

  const appendHistoryMessage = useCallback((message: ChatHistoryMessage) => {
    const historyId = activeHistoryIdRef.current;
    if (!historyId || !message.prompt.trim()) {
      return;
    }

    const now = Date.now();
    const next = historyRef.current.map((session) => (
      session.id === historyId
        ? {
            ...session,
            title: session.messages.length === 0 ? createHistoryTitle(message.prompt) : session.title,
            updatedAt: now,
            messages: [...session.messages, message],
          }
        : session
    ));

    commitHistory(next);
  }, [commitHistory]);

  const initBeforeStart = useCallback(async (prompt: string): Promise<any> => {
    ensureHistorySession(prompt);

    const response = await fetch("/api/chat/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: toServerPrompt(prompt) }),
    });

    if (!response.ok) {
      return {
        sessionId: "",
        url: "",
        preValid: false,
      };
    }

    const data = await response.json() as StartResponse;
    return {
      sessionId: data.sessionId,
      url: data.streamUrl,
      method: "GET" as const,
      preValid: true,
    };
  }, [ensureHistorySession]);

  const sendPrompt = useCallback((prompt: string) => {
    chatRef.current?.set?.({ prompt });
    chatRef.current?.send?.();
  }, []);

  const handleNewSession = useCallback(() => {
    activeHistoryIdRef.current = undefined;
    setActiveHistoryId(undefined);
    chatRef.current?.reset?.();
    setGroupId(createSessionId());
    setProgressing(false);
  }, []);

  const restoreHistorySession = useCallback((session: ChatHistorySession) => {
    activeHistoryIdRef.current = session.id;
    setActiveHistoryId(session.id);
    setGroupId(session.id);
    setProgressing(session.messages.length > 0);
    chatRef.current?.reset?.();

    requestAnimationFrame(() => {
      chatRef.current?.set?.({
        prompt: "",
        showPrompt: false,
        content: session.messages.map((item) => ({
          prompt: item.prompt,
          analysis: item.analysis,
          conclusion: item.conclusion,
          sessionId: item.sessionId,
        })),
      });
    });
  }, []);

  const noQuestion = useMemo(
    () => (
      <section className="welcome-panel">
        <h1>大帅的Agent</h1>
      </section>
    ),
    [],
  );

  return (
    <main
      ref={pageRootRef}
      className={`chat-page-shell${leftCollapsed ? " left-collapsed" : ""}`}
    >
      {leftCollapsed && (
        <div className="edge-hotzone">
          <button
            type="button"
            className="edge-expand-btn"
            onClick={() => setLeftCollapsed(false)}
            title="展开侧栏"
            aria-label="展开侧栏"
          >
            ☰
          </button>
        </div>
      )}

      <aside className={`left-sidebar${leftCollapsed ? " collapsed" : ""}`}>
        <div className="sidebar-header">
          <button
            type="button"
            className="new-session-btn"
            onClick={handleNewSession}
          >
            <span className="btn-icon">✎</span>
            <span>新建会话</span>
          </button>
          <button
            type="button"
            className="collapse-btn"
            onClick={() => setLeftCollapsed(true)}
            title="收起侧栏"
            aria-label="收起侧栏"
          >
            ‹
          </button>
        </div>

        <div className="sidebar-meta">
          <div className="sidebar-meta-title">Personal Agent</div>
          <div className="sidebar-meta-subtitle">本地 Agent 工作台</div>
        </div>

        <div className="sidebar-body">
          <div className="nav-section nav-section-first">
            <div className="section-title">常用能力</div>
            {commandItems.map((item) => (
              <button
                key={item.label}
                type="button"
                className="nav-item"
                onClick={() => sendPrompt(item.prompt)}
              >
                <span className="nav-item-main">{item.label}</span>
                <span className="nav-item-desc">{item.description}</span>
              </button>
            ))}
          </div>

          <div className="nav-section history-section">
            <div className="section-title history-title">
              <span>历史记录</span>
              <span>{historySessions.length}/{HISTORY_LIMIT}</span>
            </div>
            {historySessions.length === 0 ? (
              <div className="history-empty">暂无历史会话</div>
            ) : (
              historySessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`history-item${session.id === activeHistoryId ? " active" : ""}`}
                  onClick={() => restoreHistorySession(session)}
                >
                  <span className="history-item-title">{session.title}</span>
                  <span className="history-item-meta">
                    {formatHistoryTime(session.updatedAt)} · {session.messages.length} 轮
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      <section
        id="main-container"
        className={`main-container${progressing ? " processing" : ""}`}
      >
        <ApolloAIChat
          ref={chatRef}
          scene="web"
          businessScene="base"
          scrollType="external"
          groupId={groupId}
          placeholder="输入问题，或试试让它生成周报"
          themeVars={{
            ...themes.light,
            "--chat-primary-color": "#2f6bff",
            "--chat-question-bg": "#eff6ff",
          } as any}
          hasErrorTip
          enableAnswerCopy
          loadText={progressing ? "Personal Agent 正在处理..." : "准备中..."}
          AIChatNoQuestion={noQuestion}
          sendQuestionCallback={(isProgressing) => {
            if (isProgressing) {
              setProgressing(true);
            }
          }}
          QAPairEndCallback={({ prompt, analysis, conclusion, sessionId, status }) => {
            appendHistoryMessage({
              prompt,
              analysis: analysis ?? "",
              conclusion: conclusion || (status === "error" ? "回答失败，请稍后重试。" : ""),
              sessionId,
            });
          }}
          initBeforeStart={initBeforeStart}
          turnNavigator={{
            getPopupContainer: () => pageRootRef.current,
          } as any}
        />
      </section>
    </main>
  );
}
