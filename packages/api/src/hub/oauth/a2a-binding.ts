import { randomUUID } from "node:crypto";
import { AgentCard } from "@a2a-js/sdk";

export async function verifyA2aOAuth(
  endpoint: URL,
  metadataUrl: URL,
  authorization: URL,
  token: URL,
  scopes: readonly string[],
  fetchImpl: typeof fetch,
) {
  const response = await fetchImpl(
    new URL("/.well-known/agent-card.json", endpoint),
    {
      headers: { accept: "application/json" },
    },
  );
  if (!response.ok) throw new Error("Agent Card unavailable");
  const card = AgentCard.fromJSON(await response.json());
  if (
    !card.supportedInterfaces.some(
      ({ url, protocolBinding, protocolVersion }) =>
        new URL(url).href === endpoint.href &&
        protocolBinding === "JSONRPC" &&
        protocolVersion === "1.0",
    )
  ) {
    throw new Error("Agent Card endpoint mismatch");
  }
  const supported = card.securityRequirements.some(({ schemes }) => {
    const entries = Object.entries(schemes);
    if (entries.length !== 1) return false;
    const [name, required] = entries[0]!;
    const scheme = Object.hasOwn(card.securitySchemes, name)
      ? card.securitySchemes[name]?.scheme
      : undefined;
    if (scheme?.$case !== "oauth2SecurityScheme") return false;
    const flow = scheme.value.flows?.flow;
    if (flow?.$case !== "authorizationCode") return false;
    return (
      new URL(flow.value.authorizationUrl).href === authorization.href &&
      new URL(flow.value.tokenUrl).href === token.href &&
      (!scheme.value.oauth2MetadataUrl ||
        new URL(scheme.value.oauth2MetadataUrl).href === metadataUrl.href) &&
      required.list.every((scope) => scopes.includes(scope))
    );
  });
  if (!supported) throw new Error("Agent Card OAuth scheme mismatch");

  // A read on a nonexistent task cannot create work. Verify the actual server
  // challenges anonymous traffic before trusting the public Card declaration.
  const probe = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "a2a-version": "1.0" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "GetTask",
      params: { id: randomUUID() },
    }),
  });
  const challenged =
    probe.status === 401 &&
    /^Bearer(?:\s|$)/i.test(probe.headers.get("www-authenticate") ?? "");
  await probe.body?.cancel();
  if (!challenged)
    throw new Error("Agent endpoint does not require bearer authentication");
}
