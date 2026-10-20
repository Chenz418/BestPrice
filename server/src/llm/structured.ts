import type { ZodType } from "zod";
import {
  createResponse,
  LlmError,
  type InputPart,
  type JsonSchemaFormat,
  type ResponsesRequest,
} from "./responsesClient.ts";

/** The LLM call our agents depend on — overridable for testing. */
export type CreateResponseFn = (req: ResponsesRequest) => Promise<string>;

/** Strip a ```json code fence if the model wrapped its output in one. */
export function unfence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fence?.[1] ?? trimmed;
}

/**
 * Run one structured LLM call and return output validated against `schema`.
 * Centralises: forcing a json_schema format, unfencing, JSON.parse, and zod
 * validation — so every agent fails loudly and consistently on bad output.
 */
export async function callStructured<T>(opts: {
  instructions: string;
  input: InputPart[];
  format: JsonSchemaFormat;
  schema: ZodType<T>;
  model?: string;
  createResponse?: CreateResponseFn;
}): Promise<T> {
  const call = opts.createResponse ?? createResponse;
  const raw = await call({
    instructions: opts.instructions,
    input: opts.input,
    format: opts.format,
    ...(opts.model ? { model: opts.model } : {}),
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(raw));
  } catch {
    throw new LlmError(
      `Model did not return valid JSON. First 500 chars: ${raw.slice(0, 500)}`,
    );
  }

  const result = opts.schema.safeParse(parsed);
  if (!result.success) {
    throw new LlmError(
      `Model output failed schema validation: ${result.error.message}`,
    );
  }
  return result.data;
}
