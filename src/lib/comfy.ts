import { randomUUID } from "node:crypto";

/** Where ComfyUI listens. The address comes from the server's own settings, never from a request. */
export const COMFY_URL = (process.env.COMFYUI_URL ?? "http://localhost:8188").replace(/\/+$/, "");
export const COMFY_CHECKPOINT = process.env.COMFYUI_CHECKPOINT ?? "";

export const ASPECTS = {
  landscape: { width: 1344, height: 768, label: "Landscape banner" },
  portrait: { width: 832, height: 1216, label: "Portrait poster" },
  square: { width: 1024, height: 1024, label: "Square" },
} as const;
export type Aspect = keyof typeof ASPECTS;

/** Keeps invented lettering and watermarks out; image models mangle text and a garbled sign looks bad on an invite. */
export const DEFAULT_NEGATIVE = "text, letters, words, captions, watermark, signature, logo, blurry, low quality, deformed, ugly";

export class ComfyError extends Error {}

export type Preset = { steps: number; cfg: number; sampler: string; scheduler: string };

/** Distilled "lightning/turbo" models need few steps and a low CFG; ordinary SDXL wants the usual settings. */
export function presetFor(checkpoint: string): Preset {
  if (/lightning|hyper/i.test(checkpoint)) return { steps: 6, cfg: 2, sampler: "dpmpp_sde", scheduler: "karras" };
  if (/turbo|lcm|schnell/i.test(checkpoint)) return { steps: 6, cfg: 1.5, sampler: "euler_ancestral", scheduler: "karras" };
  return { steps: 25, cfg: 7, sampler: "dpmpp_2m", scheduler: "karras" };
}

/** A fast model is the sensible default when the GPU is shared with a language model. */
export function pickCheckpoint(available: string[], preferred = COMFY_CHECKPOINT): string {
  if (available.length === 0) throw new ComfyError("ComfyUI has no checkpoints installed.");
  if (preferred && available.includes(preferred)) return preferred;
  return available.find((c) => /lightning|turbo|lcm|hyper|schnell/i.test(c)) ?? available[0];
}

/** The coordinator's pick, if it is a model this ComfyUI really has; otherwise null. No pick means the default. */
export function resolveCheckpoint(requested: string | undefined, status: { checkpoints: string[]; checkpoint: string }): string | null {
  if (requested === undefined || requested === "") return status.checkpoint;
  return status.checkpoints.includes(requested) ? requested : null;
}

export type WorkflowInput = { checkpoint: string; prompt: string; negative: string; width: number; height: number; seed: number; preset?: Preset };

/** A plain text-to-image graph in ComfyUI's API format. Node ids are strings; links are [nodeId, outputIndex]. */
export function buildWorkflow(i: WorkflowInput): Record<string, unknown> {
  const p = i.preset ?? presetFor(i.checkpoint);
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: i.checkpoint } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: i.prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: i.negative, clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: i.width, height: i.height, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: { model: ["1", 0], seed: i.seed, steps: p.steps, cfg: p.cfg, sampler_name: p.sampler, scheduler: p.scheduler, positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], denoise: 1 },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "word-of-mouth" } },
  };
}

type Json = Record<string, unknown>;

async function getJson(path: string, timeoutMs = 10_000, base = COMFY_URL): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new ComfyError(`Couldn't reach ComfyUI at ${base} (${e instanceof Error ? e.message : String(e)}).`);
  }
  if (!res.ok) throw new ComfyError(`ComfyUI answered ${res.status} for ${path}.`);
  return (await res.json()) as Json;
}

export type ComfyStatus =
  | { ok: true; version: string; device: string; vramGb: number | null; checkpoints: string[]; checkpoint: string; fast: boolean }
  | { ok: false; error: string };

export async function comfyStatus(base = COMFY_URL): Promise<ComfyStatus> {
  try {
    const stats = (await getJson("/system_stats", 8000, base)) as { system?: { comfyui_version?: string }; devices?: { name?: string; vram_total?: number }[] };
    const info = (await getJson("/object_info/CheckpointLoaderSimple", 8000, base)) as { CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } } };
    const checkpoints = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
    const checkpoint = pickCheckpoint(checkpoints);
    const dev = stats.devices?.[0];
    return {
      ok: true,
      version: stats.system?.comfyui_version ?? "unknown",
      // ComfyUI reports e.g. "cuda:0 NVIDIA GeForce RTX 3060 : cudaMallocAsync"; keep just the card's name.
      device: dev?.name?.replace(/^cuda:\d+\s*/, "").split(" : ")[0].trim() || "unknown device",
      vramGb: dev?.vram_total ? Math.round((dev.vram_total / 1e9) * 10) / 10 : null,
      checkpoints,
      checkpoint,
      fast: presetFor(checkpoint).steps <= 8,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function describeValidation(body: unknown): string {
  const b = body as { error?: { message?: string; details?: string }; node_errors?: Record<string, { errors?: { message?: string; details?: string }[] }> };
  const parts = [b?.error?.message, b?.error?.details];
  for (const n of Object.values(b?.node_errors ?? {})) for (const e of n.errors ?? []) parts.push([e.message, e.details].filter(Boolean).join(": "));
  return parts.filter(Boolean).join(" ").slice(0, 400) || "ComfyUI rejected the request.";
}

/**
 * Submit a workflow, wait for it, and return the first PNG it saved. Throws a ComfyError with a readable
 * reason for an unreachable server, a rejected workflow, a failed run, or a timeout.
 */
export async function runWorkflow(workflow: Record<string, unknown>, opts: { timeoutMs?: number; pollMs?: number; base?: string } = {}): Promise<Buffer> {
  const base = opts.base ?? COMFY_URL;
  const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
  const pollMs = opts.pollMs ?? 1000;

  let submit: Response;
  try {
    submit = await fetch(`${base}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new ComfyError(`Couldn't reach ComfyUI at ${base} (${e instanceof Error ? e.message : String(e)}).`);
  }
  const submitted = (await submit.json().catch(() => null)) as { prompt_id?: string } | null;
  if (!submit.ok || !submitted?.prompt_id) throw new ComfyError(describeValidation(submitted));
  const id = submitted.prompt_id;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const history = (await getJson(`/history/${id}`, 10_000, base)) as Record<string, { status?: { status_str?: string; messages?: [string, Record<string, unknown>][] }; outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }>;
    const entry = history[id];
    if (!entry) continue; // still queued or running
    if (entry.status?.status_str === "error") {
      const failure = entry.status.messages?.find((m) => m[0] === "execution_error")?.[1] as { exception_message?: string } | undefined;
      throw new ComfyError(`ComfyUI failed: ${(failure?.exception_message ?? "unknown error").slice(0, 300)}`);
    }
    const image = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])[0];
    if (!image) {
      if (entry.status?.status_str === "success") throw new ComfyError("ComfyUI finished but saved no image.");
      continue;
    }
    const q = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type });
    const res = await fetch(`${base}/view?${q}`, { signal: AbortSignal.timeout(30_000) }).catch((e) => {
      throw new ComfyError(`Couldn't download the image (${e instanceof Error ? e.message : String(e)}).`);
    });
    if (!res.ok) throw new ComfyError(`ComfyUI answered ${res.status} when fetching the image.`);
    return Buffer.from(await res.arrayBuffer());
  }

  // Don't leave our job waiting in someone's queue. (Only our own queued job: we never interrupt a running one.)
  await fetch(`${base}/queue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: [id] }), signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  throw new ComfyError("ComfyUI took too long. It may be busy with something else.");
}
