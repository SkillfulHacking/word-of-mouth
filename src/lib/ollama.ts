import { z } from "zod";

export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma3:4b";
/**
 * How long Ollama keeps the model loaded after each request. Ollama's own default is 5 minutes and every request
 * resets it, so a pause between uses means a cold start (about a minute for Gemma 3 4B). 30 minutes by default.
 */
export const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE ?? "30m";

/**
 * Ask a local Ollama model for JSON matching `schema`. Ollama constrains decoding to the
 * JSON schema, then zod re-checks it, so malformed output throws instead of leaking through.
 */
export async function chatJson<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  timeoutMs = 120_000,
): Promise<T> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      keep_alive: OLLAMA_KEEP_ALIVE,
      format: z.toJSONSchema(schema),
      options: { temperature: 0.6 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const body = (await res.json()) as { message?: { content?: string } };
  return schema.parse(JSON.parse(body.message?.content ?? ""));
}
