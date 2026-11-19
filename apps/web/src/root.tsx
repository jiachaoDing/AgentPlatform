import { Toaster } from "@agent-platform/ui/components/sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import Header from "./components/header";
import { queryClient } from "./utils/orpc";
import "./index.css";
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>AgentPlatform · 能力工作空间</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Header />
      <Outlet />
      <Toaster richColors />
    </QueryClientProvider>
  );
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <main className="page">
      <h1>
        {isRouteErrorResponse(error) && error.status === 404
          ? "页面不存在"
          : "暂时无法打开页面"}
      </h1>
      <p>请返回首页或稍后重试。</p>
      <a href="/">返回首页</a>
    </main>
  );
}
