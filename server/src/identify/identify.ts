import {
  type Query,
  type ProductCard,
  QuerySchema,
  ProductCardSchema,
} from "@bestprice/shared";
import {
  createResponse,
  LlmError,
  type InputPart,
  type ResponsesRequest,
} from "../llm/responsesClient.ts";
import { PRODUCT_CARD_FORMAT } from "./productCardFormat.ts";
import { IDENTIFY_SYSTEM_PROMPT, buildUserText } from "./prompt.ts";

/** The LLM call `identify` depends on — overridable for testing. */
export type CreateResponseFn = (req: ResponsesRequest) => Promise<string>;

export interface IdentifyDeps {
  /** Defaults to the real Responses API client. */
  createResponse?: CreateResponseFn;
  /** Optional per-call model override (e.g. "gpt-5.6 luna"). */
  model?: string;
}

/** Strip a ```json code fence if the model wrapped its output in one. */
function unfence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fence?.[1] ?? trimmed;
}

/**
 * Identify API (plan step A.1): turn a user Query into a ProductCard using a
 * vision+text LLM. The output is validated against the shared contract before
 * it is returned, so callers always receive a well-formed card or an error.
 */
export async function identify(
  rawQuery: Query,
  deps: IdentifyDeps = {},
): Promise<ProductCard> {
  const call = deps.createResponse ?? createResponse;

  // Validate input against the shared contract (enforces "at least one of ...").
  const query = QuerySchema.parse(rawQuery);

  const input: InputPart[] = [{ type: "input_text", text: buildUserText(query) }];
  if (query.image) {
    input.push({ type: "input_image", image_url: query.image.url });
  }

  const raw = await call({
    instructions: IDENTIFY_SYSTEM_PROMPT,
    input,
    format: PRODUCT_CARD_FORMAT,
    ...(deps.model ? { model: deps.model } : {}),
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(raw));
  } catch {
    throw new LlmError(
      `Model did not return valid JSON. First 500 chars: ${raw.slice(0, 500)}`,
    );
  }

  const result = ProductCardSchema.safeParse(parsed);
  if (!result.success) {
    throw new LlmError(
      `Model output failed ProductCard validation: ${result.error.message}`,
    );
  }
  return result.data;
}
