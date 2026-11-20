import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import type { LanguageModel } from "ai";

const modelConfigSchema = z.object({
  baseURL: z.url(),
  modelId: z.string().min(1),
  apiKey: z.string().min(1),
});

// Production callers must provide the platform-controlled outbound transport.
export function createCompatibleModel(
  config: z.infer<typeof modelConfigSchema>,
  fetchImpl: typeof fetch,
): LanguageModel {
  const parsed = modelConfigSchema.parse(config);
  return createOpenAICompatible({
    name: "platform",
    baseURL: parsed.baseURL,
    apiKey: parsed.apiKey,
    fetch: fetchImpl,
  }).chatModel(parsed.modelId);
}
