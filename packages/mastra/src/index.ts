import { Mastra } from "@mastra/core";

export const mastra = new Mastra({});

export { gateway } from "./provider";
export { chat, type ChatOptions, type CoreMessage } from "./chat";
