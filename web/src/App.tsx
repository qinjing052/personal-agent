import { useCallback, useMemo, useRef, useState } from "react";
import { ApolloAIChat, CommonAIChatRefProps, themes } from "@apollo/AIChat";
import "antd/dist/antd.css";

type StartResponse = {
  sessionId: string;
  streamUrl: string;
};

type CommandItem = {
  label: string;
  prompt: string;
  description: string;
};

const quickPrompts = [
  "/weekly notes/this-week.md",
  "/weather 杭州",
  "搜索一下 LangChain.js Agent 的最新用法，总结三点",
  "/memory",
  "/summary",
];

const commandItems: CommandItem[] = [
  {
    label: "生成周报",
    prompt: "/weekly notes/this-week.md",
    description: "读取本地 notes 素材并保存到 outputs",
  },
  {
    label: "查询天气",
    prompt: "/weather 杭州",
    description: "查询当前天气和未来 3 天预报",
  },
  {
    label: "网页搜索",
    prompt: "搜索一下 LangChain.js Agent 的最新用法，总结三点",
    description: "使用搜索结果辅助回答最新问题",
  },
  {
    label: "查看记忆",
    prompt: "/memory",
    description: "查看最近 20 条本地对话记忆",
  },
  {
    label: "总结上下文",
    prompt: "/summary",
    description: "总结最近对话中的目标和待办",
  },
];

export default function App() {
  const pageRootRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<CommonAIChatRefProps>(null);
  const [groupId, setGroupId] = useState(() => `personal-agent-${Date.now()}`);
  const [progressing, setProgressing] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  const initBeforeStart = useCallback(async (prompt: string): Promise<any> => {
    const response = await fetch("/api/chat/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
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
  }, []);

  const sendPrompt = useCallback((prompt: string) => {
    chatRef.current?.set?.({ prompt });
    chatRef.current?.send?.();
  }, []);

  const handleNewSession = useCallback(() => {
    chatRef.current?.reset?.();
    setGroupId(`personal-agent-${Date.now()}`);
    setProgressing(false);
  }, []);

  const noQuestion = useMemo(
    () => (
      <section className="welcome-panel">
        <p className="eyebrow">Personal Agent</p>
        <h1>一个能读文件、查天气、搜网页、写周报的个人助手。</h1>
        <p className="welcome-copy">
          左侧是常用能力入口，右侧保留 ApolloAIChat 对话体验；所有模型请求仍由本地 Node 服务代理，API Key 不进入浏览器。
        </p>
        <div className="quick-grid">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendPrompt(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
      </section>
    ),
    [sendPrompt],
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
          <button
            type="button"
            className="shelf-entry"
            onClick={() => sendPrompt("/")}
          >
            <span className="nav-icon">⌘</span>
            <span>查看全部命令</span>
          </button>

          <div className="nav-section">
            <div className="section-title">常用能力</div>
            {commandItems.map((item) => (
              <button
                key={item.prompt}
                type="button"
                className="nav-item"
                onClick={() => sendPrompt(item.prompt)}
              >
                <span className="nav-item-main">{item.label}</span>
                <span className="nav-item-desc">{item.description}</span>
              </button>
            ))}
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
          placeholder="输入问题，或试试 /weekly notes/this-week.md"
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
            setProgressing(isProgressing);
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
