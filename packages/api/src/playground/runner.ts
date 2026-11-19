import {
  generateText,
  streamText,
  tool,
  jsonSchema,
  isStepCount,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type JSONSchema7,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { compileToolSchema } from "../hub/tool-schema";

export type ExecutionResult = {
  executionId: string;
  status:
    | "succeeded"
    | "failed"
    | "waiting_confirmation"
    | "remote_running"
    | "input_required"
    | "unknown";
  summary: string;
};
export type AuthorizedTool = {
  name: string;
  capabilityId: string;
  version: string;
  description: string;
  inputSchema: JSONSchema7;
};
export type ExecutionGateway = {
  listAuthorizedTools(
    userId: string,
    capabilityIds: string[],
  ): Promise<AuthorizedTool[]>;
  execute(request: {
    userId: string;
    sessionId: string;
    capabilityId: string;
    version: string;
    toolName: string;
    toolCallId: string;
    args: unknown;
  }): Promise<ExecutionResult>;
};
export type RunOptions = {
  model: LanguageModel;
  hub: ExecutionGateway;
  userId: string;
  sessionId: string;
  capabilityIds: string[];
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
};

async function prepareRun(options: RunOptions) {
  const descriptors = await options.hub.listAuthorizedTools(
    options.userId,
    options.capabilityIds,
  );
  if (descriptors.length > 32) throw new Error("本次启用的工具过多");
  const tools: ToolSet = Object.create(null);
  let calls = 0;
  let awaitingUserOrRemote = false;
  for (const descriptor of descriptors) {
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(descriptor.name) ||
      tools[descriptor.name]
    )
      throw new Error("工具名称映射无效");
    if (!options.capabilityIds.includes(descriptor.capabilityId))
      throw new Error("工具不属于本次启用范围");
    const validate = compileToolSchema(descriptor.inputSchema);
    tools[descriptor.name] = tool({
      description: descriptor.description,
      inputSchema: jsonSchema(descriptor.inputSchema),
      execute: async (args, { toolCallId }) => {
        if (awaitingUserOrRemote || ++calls > 8)
          throw new Error("执行已暂停或达到调用上限");
        if (!validate(args)) throw new Error("参数不符合工具要求");
        let result: ExecutionResult;
        try {
          result = await options.hub.execute({
            userId: options.userId,
            sessionId: options.sessionId,
            capabilityId: descriptor.capabilityId,
            version: descriptor.version,
            toolName: descriptor.name,
            toolCallId,
            args,
          });
        } catch {
          awaitingUserOrRemote = true;
          throw new Error(
            "能力执行未完成，请查询执行记录。结果核实前请勿重新提交。",
          );
        }
        awaitingUserOrRemote = !["succeeded", "failed"].includes(result.status);
        return result;
      },
    });
  }
  return {
    model: options.model,
    messages: options.messages,
    tools,
    maxRetries: 0,
    maxOutputTokens: 2_048,
    toolCallConcurrency: 1,
    stopWhen: [isStepCount(5), () => awaitingUserOrRemote],
    abortSignal: options.abortSignal
      ? AbortSignal.any([options.abortSignal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000),
  };
}

export async function runPlayground(options: RunOptions) {
  return generateText(await prepareRun(options));
}

export async function streamPlayground(options: RunOptions) {
  const result = streamText(await prepareRun(options));
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendReasoning: false,
      onError: () => "生成中断，请查看调用记录后重试。",
      redactToolErrors: true,
    }),
  });
}
