import { config } from "../config.ts";

/**
 * Minimal client for an OpenAI-compatible **Responses API** proxy
 * (deployed with `wire_api = "responses"`, `requires_openai_auth = true`).
 *
 * We call the wire endpoint directly with `fetch` rather than pulling in the
 * OpenAI SDK, so the request/response shape stays explicit and debuggable and
 * does not drift with SDK versions.
 */

/** A single piece of user content: text or an image reference. */
export type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

export interface JsonSchemaFormat {
  type: "json_schema";
  name: string;
  strict: true;
  schema: Record<string, unknown>;
}

export interface ResponsesRequest {
  /** System / developer instructions. */
  instructions: string;
  /** User content parts (text and/or images). */
  input: InputPart[];
  /** Forces the model to emit JSON matching this schema. */
  format: JsonSchemaFormat;
  /** Optional per-call model override. */
  model?: string;
}

/** Raw shape of the pieces of the Responses API payload we actually read. */
interface RawResponse {
  output_text?: string;
  output?: Array<{
    type: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
  error?: { message?: string } | string;
}

export class LlmError extends Error {}

/** Pull the assistant's text out of a Responses API payload. */
function extractOutputText(body: RawResponse): string {
  if (typeof body.output_text === "string" && body.output_text.length > 0) {
    return body.output_text;
  }
  const parts: string[] = [];
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.join("");
}

/**
 * Send one Responses API request and return the raw assistant text (expected to
 * be JSON because a json_schema format is enforced).
 */
export async function createResponse(req: ResponsesRequest): Promise<string> {
  const url = `${config.openaiBaseUrl}/responses`;
  const payload = {
    model: req.model ?? config.identifyModel,
    instructions: req.instructions,
    input: [{ role: "user", content: req.input }],
    text: { format: req.format },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openaiApiKey()}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new LlmError(`Network error calling ${url}: ${String(cause)}`);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new LlmError(
      `Responses API returned ${res.status} ${res.statusText}: ${text.slice(0, 2000)}`,
    );
  }

  let body: RawResponse;
  try {
    body = JSON.parse(text) as RawResponse;
  } catch {
    throw new LlmError(`Responses API returned non-JSON body: ${text.slice(0, 2000)}`);
  }

  if (body.error) {
    const msg = typeof body.error === "string" ? body.error : body.error.message;
    throw new LlmError(`Responses API error: ${msg ?? "unknown error"}`);
  }

  const output = extractOutputText(body);
  if (!output) {
    throw new LlmError(
      `Responses API returned no text output: ${text.slice(0, 2000)}`,
    );
  }
  return output;
}
