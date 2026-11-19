import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from "@a2a-js/sdk/client";

// The supplied fetch owns authorization and egress policy for every request.
export async function connectMcp(url: URL, fetchImpl: typeof fetch) {
  const client = new Client({ name: "agent-platform", version: "0.1.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(url, { fetch: fetchImpl }),
    );
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}

export function createA2aClientFactory(fetchImpl: typeof fetch) {
  return new ClientFactory({
    cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
    transports: [new JsonRpcTransportFactory({ fetchImpl })],
    preferredTransports: ["JSONRPC"],
  });
}
