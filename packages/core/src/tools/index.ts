import type { z } from "zod";
import { resize, resizeParams } from "./resize";
import type { ToolOutput } from "./types";

interface Tool<S extends z.ZodType> {
  params: S;
  run(input: Buffer, params: z.infer<S>): Promise<ToolOutput>;
}

function tool<S extends z.ZodType>(t: Tool<S>): Tool<S> {
  return t;
}

// Every tool a job can run. AI tools (background removal, generation, upscaling…) are added here.
export const tools = {
  resize: tool({ params: resizeParams, run: resize }),
};

export type ToolName = keyof typeof tools;
export const toolNames = Object.keys(tools) as [ToolName, ...ToolName[]];
export type { ToolOutput };
