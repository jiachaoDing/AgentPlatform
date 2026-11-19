import { SessionGate } from "@/components/session-gate";
import { ModuleGate } from "@/components/module-gate";
export default function Market() {
  return (
    <SessionGate>
      <ModuleGate name="market">
        <main className="page">
          <div className="page-heading">
            <div>
              <span className="eyebrow">CAPABILITY MARKET</span>
              <h1>发现专业能力</h1>
              <p>寻找适合你的工具与 Agent。</p>
            </div>
          </div>
          <div className="empty-panel">
            <h2>能力市场即将开放</h2>
            <p>你将在这里发现经过审核的能力，并安装到个人工作空间。</p>
          </div>
        </main>
      </ModuleGate>
    </SessionGate>
  );
}
