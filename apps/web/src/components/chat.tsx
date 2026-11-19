import { useMemo } from "react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/ai-sdk";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { DefaultChatTransport } from "ai";
import { ArrowUp, Square, Sparkles } from "lucide-react";
import { ExecutionCard } from "./execution-card";

const ToolCard: ToolCallMessagePartComponent = ({
  toolName,
  args,
  result,
  status,
}) => (
  <ExecutionCard
    name={toolName}
    args={args}
    result={result}
    running={status.type === "running"}
  />
);

function Markdown() {
  return <MarkdownTextPrimitive />;
}
function Message() {
  return (
    <MessagePrimitive.Root className="chat-message">
      <MessagePrimitive.Parts
        components={{ Text: Markdown, tools: { Fallback: ToolCard } }}
      />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="chat-error">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  );
}

export function Chat({ enabled = false }: { enabled?: boolean }) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({ api: "/api/chat", credentials: "include" }),
    [],
  );
  const runtime = useChatRuntime({ transport });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="chat-root">
        <ThreadPrimitive.Viewport className="chat-viewport">
          <ThreadPrimitive.Empty>
            <div className="chat-welcome">
              <span className="empty-icon">
                <Sparkles size={27} />
              </span>
              <h2>让专业能力一起工作</h2>
              <p>选择模型和已授权的能力，开始一次可追溯的对话。</p>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages
            components={{ UserMessage: Message, AssistantMessage: Message }}
          />
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className="chat-composer">
          <ComposerPrimitive.Input
            placeholder={enabled ? "描述你希望完成的任务…" : "模型接入尚未就绪"}
            disabled={!enabled}
            aria-label="消息"
          />
          <div className="composer-footer">
            <span>远端操作可能需要你确认</span>
            <ComposerPrimitive.Send disabled={!enabled} aria-label="发送消息">
              <ArrowUp size={19} />
            </ComposerPrimitive.Send>
            <ComposerPrimitive.Cancel aria-label="停止等待">
              <Square size={16} />
            </ComposerPrimitive.Cancel>
          </div>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
