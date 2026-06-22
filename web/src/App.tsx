import { useCallback, useMemo, useRef, useState } from "react";
import { ApolloAIChat, CommonAIChatRefProps, themes } from "@apollo/AIChat";
import "antd/dist/antd.css";

type StartResponse = {
  sessionId: string;
  streamUrl: string;
};

const quickPrompts = [
  "/weekly notes/this-week.md",
  "/weather 杭州",
  "搜索一下 LangChain.js Agent 的最新用法，总结三点",
  "/memory",
  "/summary",
];

export default function App() {
  const chatRef = useRef<CommonAIChatRefProps>(null);
  const [groupId, setGroupId] = useState(() => `personal-agent-${Date.now()}`);
  const [progressing, setProgressing] = useState(false);

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

  const noQuestion = useMemo(
    () => (
      <section className="welcome-panel">
        <p className="eyebrow">Personal Agent</p>
        <h1>把命令行助手搬到一个更顺手的工作台。</h1>
        <p className="welcome-copy">
          继续使用现有的 /weekly、/memory、/summary 和搜索能力，所有模型请求仍由本地 Node 后端代理。
        </p>
        <div className="quick-grid">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => {
                chatRef.current?.set?.({ prompt });
                chatRef.current?.send?.();
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      </section>
    ),
    [],
  );

  return (
    <main className="app-shell">
      <aside className="side-rail">
        <div>
          <span className="brand-mark">PA</span>
          <h2>Personal Agent</h2>
          <p>CLI core, web surface.</p>
        </div>
        <button
          type="button"
          className="new-session"
          onClick={() => {
            chatRef.current?.reset?.();
            setGroupId(`personal-agent-${Date.now()}`);
          }}
        >
          新会话
        </button>
      </aside>
      <section className="chat-stage">
        <ApolloAIChat
          ref={chatRef}
          scene="web"
          businessScene="base"
          groupId={groupId}
          placeholder="输入问题，或试试 /weekly notes/this-week.md"
          themeVars={{
            ...themes.light,
            "--chat-primary-color": "#245b47",
            "--chat-question-bg": "#e8f1ec",
          } as any}
          hasErrorTip
          enableAnswerCopy
          loadText={progressing ? "Personal Agent 正在处理..." : "准备中..."}
          AIChatNoQuestion={noQuestion}
          sendQuestionCallback={(isProgressing) => {
            setProgressing(isProgressing);
          }}
          initBeforeStart={initBeforeStart}
        />
      </section>
    </main>
  );
}
