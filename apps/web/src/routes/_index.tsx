import { useQuery } from "@tanstack/react-query";
import { Boxes, PlugZap, ShieldCheck, ArrowUpRight } from "lucide-react";
import { SessionGate } from "@/components/session-gate";
import { orpc } from "@/utils/orpc";
function Capabilities() {
  const query = useQuery(orpc.capabilities.list.queryOptions());
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CAPABILITY HUB</span>
          <h1>我的能力</h1>
          <p>你的工具与 Agent，连接后随时使用。</p>
        </div>
        <span className="status-badge">
          <ShieldCheck size={14} />
          个人工作空间
        </span>
      </div>
      <div className="hub-summary">
        <Boxes size={23} />
        <div>
          <strong>{query.data?.length ?? "—"}</strong>
          <span>已添加的能力</span>
        </div>
        <div className="summary-divider" />
        <p>
          服务连接属于你的个人账号。
          <br />
          每一次调用，都使用你授予的权限。
        </p>
      </div>
      <section className="section-heading">
        <h2>能力目录</h2>
        <span>MCP 工具 · A2A Agent</span>
      </section>
      {query.isPending ? (
        <p role="status">正在读取能力…</p>
      ) : query.isError ? (
        <div className="empty-panel">
          <p role="alert">能力列表暂时无法加载。</p>
          <button onClick={() => void query.refetch()}>重新加载</button>
        </div>
      ) : query.data?.length ? (
        <div className="capability-grid">
          {query.data.map((item) => (
            <article className="capability-card" key={item.id}>
              <span className="protocol-badge">
                {item.protocol.toUpperCase()}
              </span>
              <h3>{item.name}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-panel">
          <span className="empty-icon">
            <PlugZap size={28} />
          </span>
          <h2>这里将汇集你的专业能力</h2>
          <p>
            添加工具或安装 Agent 后，可以在这里管理连接、测试参数和查看结果。
          </p>
          <span className="subtle-note">目前还没有能力记录</span>
        </div>
      )}
      <div className="info-strip">
        <ArrowUpRight size={17} />
        <p>先连接，再使用。服务授权与单次执行确认分别管理。</p>
      </div>
    </main>
  );
}
export default function HubPage() {
  return (
    <SessionGate>
      <Capabilities />
    </SessionGate>
  );
}
