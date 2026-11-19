import { Chat } from "@/components/chat";
import { SessionGate } from "@/components/session-gate";
import { ModuleGate } from "@/components/module-gate";
export default function Playground() {
  return (
    <SessionGate>
      <ModuleGate name="playground">
        <main className="page">
          <div className="page-heading">
            <div>
              <span className="eyebrow">AI PLAYGROUND</span>
              <h1>AI 工作台</h1>
              <p>把工具与 Agent 带入同一段对话。</p>
            </div>
          </div>
          <div className="workbench">
            <aside>
              <h2>本次对话</h2>
              <label>模型</label>
              <p className="subtle-note">尚无可用模型</p>
              <hr />
              <h3>启用的能力</h3>
              <p className="subtle-note">仅使用你已连接并选择的能力。</p>
            </aside>
            <Chat />
          </div>
        </main>
      </ModuleGate>
    </SessionGate>
  );
}
