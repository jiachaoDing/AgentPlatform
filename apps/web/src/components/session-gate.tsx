import type { ReactNode } from "react";
import { Link } from "react-router";
import { authClient } from "@/lib/auth-client";

export function SessionGate({ children }: { children: ReactNode }) {
  const { data, isPending, error } = authClient.useSession();
  if (isPending)
    return (
      <p className="page" role="status">
        正在确认登录状态…
      </p>
    );
  if (error)
    return (
      <div className="page">
        <p role="alert">暂时无法连接账号服务，请稍后重试。</p>
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <div className="empty-panel">
          <span className="eyebrow">你的能力空间</span>
          <h1>连接专业能力，从这里开始</h1>
          <p>登录后，管理自己的工具、Agent 和服务授权。</p>
          <Link className="primary-link" to="/login">
            登录平台 →
          </Link>
          <small>平台采用邀请制，请联系管理员获取账号。</small>
        </div>
      </div>
    );
  return children;
}
