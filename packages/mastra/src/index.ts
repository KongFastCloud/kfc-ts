import { Mastra } from "@mastra/core";

export const mastra = new Mastra({});

export { gateway } from "./provider.ts";
export { chat, type ChatOptions, type CoreMessage } from "./chat.ts";
export { generate, type GenerateOptions, type GenerateResult } from "./generate.ts";
export { createAgent, type AgentOptions, type Agent } from "./agent-factory.ts";
