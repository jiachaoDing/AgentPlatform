import { z } from "zod";

const statuses = {
  waiting_confirmation: "等待你的确认",
  remote_running: "远端处理中",
  input_required: "需要补充输入",
  succeeded: "执行成功",
  failed: "执行失败",
  unknown: "结果尚未确定",
} as const;
const resultSchema = z.object({
  executionId: z.string(),
  status: z.enum(
    Object.keys(statuses) as [
      keyof typeof statuses,
      ...Array<keyof typeof statuses>,
    ],
  ),
  summary: z.string(),
});

export function ExecutionCard({
  name,
  args,
  result,
  running,
}: {
  name: string;
  args: unknown;
  result: unknown;
  running: boolean;
}) {
  const parsed = resultSchema.safeParse(result);
  const label = parsed.success
    ? statuses[parsed.data.status]
    : running
      ? "处理中"
      : result === undefined
        ? "尚无结果"
        : "已返回";
  return (
    <details className="execution-card" open>
      <summary>
        {name}
        <span>{label}</span>
      </summary>
      {parsed.success && (
        <>
          <p>{parsed.data.summary}</p>
          <small>执行记录：{parsed.data.executionId}</small>
        </>
      )}
      <pre>
        {JSON.stringify(
          { parameters: args, ...(parsed.success ? {} : { result }) },
          null,
          2,
        )}
      </pre>
    </details>
  );
}
