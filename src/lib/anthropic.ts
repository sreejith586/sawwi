import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";

/**
 * The one place an Anthropic client is made (D-50). The SDK reads ANTHROPIC_API_KEY itself.
 * A key that isn't scoped to a workspace is refused unless every request names one, so when
 * ANTHROPIC_WORKSPACE_ID is set it goes out as the anthropic-workspace-id header.
 */
export function anthropicClient(options: ClientOptions = {}): Anthropic {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  if (!workspace) return new Anthropic(options);
  return new Anthropic({ ...options, defaultHeaders: { "anthropic-workspace-id": workspace, ...options.defaultHeaders } });
}
