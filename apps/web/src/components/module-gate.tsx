import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { orpc } from "@/utils/orpc";
export function ModuleGate({
  name,
  children,
}: {
  name: "market" | "playground";
  children: ReactNode;
}) {
  const query = useQuery(orpc.system.queryOptions());
  if (query.isPending)
    return (
      <p className="page" role="status">
        正在加载…
      </p>
    );
  if (query.isError)
    return (
      <p className="page" role="alert">
        暂时无法读取平台配置。
      </p>
    );
  if (!query.data?.[name]) return <p className="page">此模块尚未启用。</p>;
  return children;
}
