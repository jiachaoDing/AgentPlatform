import { Link, NavLink } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Boxes, FlaskConical } from "lucide-react";
import { orpc, queryClient } from "@/utils/orpc";
import { authClient } from "@/lib/auth-client";

export default function Header() {
  const { data: modules } = useQuery(orpc.system.queryOptions());
  const { data: session } = authClient.useSession();
  const links = [
    { to: "/", label: "我的能力" },
    ...(modules?.market ? [{ to: "/market", label: "能力市场" }] : []),
    ...(modules?.playground ? [{ to: "/playground", label: "AI 工作台" }] : []),
  ];
  return (
    <header className="site-header">
      <Link to="/" className="brand">
        <span className="brand-mark">
          <Boxes size={20} />
        </span>
        <span>
          Agent<span className="brand-light">Platform</span>
        </span>
      </Link>
      <nav aria-label="主导航">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="account-actions">
        {import.meta.env.DEV && (
          <Link to="/lab" className="lab-link" title="组件验证">
            <FlaskConical size={16} />
            <span>组件验证</span>
          </Link>
        )}
        {session ? (
          <>
            <span>{session.user.name}</span>
            <button
              onClick={async () => {
                await authClient.signOut();
                queryClient.clear();
                window.location.assign("/login");
              }}
            >
              退出
            </button>
          </>
        ) : (
          <Link to="/login" className="login-link">
            登录
          </Link>
        )}
      </div>
    </header>
  );
}
