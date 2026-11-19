import { useState } from "react";
import { Chat } from "@/components/chat";
import { ToolParameterForm } from "@/components/tool-parameter-form";
export default function Lab() {
  const [value, setValue] = useState<unknown>();
  if (!import.meta.env.DEV)
    return (
      <main className="page">
        <h1>页面不存在</h1>
      </main>
    );
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">LOCAL DEVELOPMENT</span>
          <h1>组件验证</h1>
          <p>
            仅本地开发可用。表单使用示例
            Schema，提交只回显参数；对话沿用平台接口。
          </p>
        </div>
      </div>
      <div className="lab-grid">
        <section className="panel">
          <h2>MCP 参数表单</h2>
          <ToolParameterForm
            schema={{
              type: "object",
              required: ["text", "mode"],
              properties: {
                text: { type: "string", title: "待处理文本", minLength: 1 },
                mode: {
                  type: "string",
                  title: "处理方式",
                  enum: ["摘要", "关键词"],
                  default: "摘要",
                },
                options: {
                  type: "object",
                  title: "输出选项",
                  properties: {
                    maxItems: {
                      type: "integer",
                      title: "最大条数",
                      minimum: 1,
                      maximum: 10,
                      default: 3,
                    },
                  },
                },
              },
              additionalProperties: false,
            }}
            onSubmit={async (data) => setValue(data)}
          />
          {value !== undefined && (
            <pre data-testid="parameter-result">
              {JSON.stringify(value, null, 2)}
            </pre>
          )}
        </section>
        <section className="panel">
          <h2>对话组件</h2>
          <Chat enabled />
        </section>
      </div>
    </main>
  );
}
