import { crc32 } from "node:zlib";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nearestColorName } from "./color";
import { buildWorkflow, comfyStatus, ComfyError, pickCheckpoint, presetFor, resolveCheckpoint, runWorkflow } from "./comfy";
import { pngChunks, stripPngMetadata } from "./png";

// ---- a PNG shaped like ComfyUI's: pixels plus text chunks holding the prompt and the workflow
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0);
  return Buffer.concat([head, data, crc]);
}
function comfyLikePng(): Buffer {
  const png = new PNG({ width: 3, height: 2 });
  png.data.fill(200);
  const plain = PNG.sync.write(png);
  const idat = plain.indexOf("IDAT") - 4;
  const secret = chunk("tEXt", Buffer.from("prompt\0" + JSON.stringify({ text: "SECRET PROMPT about Freddy's Pizza" })));
  const flow = chunk("tEXt", Buffer.from("workflow\0{}"));
  const exif = chunk("eXIf", Buffer.from("II*\0"));
  const when = chunk("tIME", Buffer.alloc(7));
  return Buffer.concat([plain.subarray(0, idat), secret, flow, exif, when, plain.subarray(idat)]);
}

describe("stripPngMetadata", () => {
  it("removes the prompt and workflow but leaves the picture identical", () => {
    const src = comfyLikePng();
    expect(pngChunks(src)).toEqual(expect.arrayContaining(["tEXt", "eXIf", "tIME"]));
    expect(src.toString("latin1")).toContain("SECRET PROMPT");

    const clean = stripPngMetadata(src);
    expect(clean.toString("latin1")).not.toContain("SECRET PROMPT");
    expect(clean.toString("latin1")).not.toContain("workflow");
    expect(pngChunks(clean)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(PNG.sync.read(clean).data.equals(PNG.sync.read(src).data)).toBe(true);
  });
  it("keeps color-critical chunks", () => {
    const png = new PNG({ width: 1, height: 1 });
    const plain = PNG.sync.write(png);
    const idat = plain.indexOf("IDAT") - 4;
    const withSrgb = Buffer.concat([plain.subarray(0, idat), chunk("sRGB", Buffer.from([0])), chunk("gAMA", Buffer.alloc(4)), plain.subarray(idat)]);
    expect(pngChunks(stripPngMetadata(withSrgb))).toEqual(["IHDR", "sRGB", "gAMA", "IDAT", "IEND"]);
  });
  it("rejects things that aren't a whole PNG", () => {
    expect(() => stripPngMetadata(Buffer.from("not a png at all"))).toThrow("Not a PNG");
    const good = comfyLikePng();
    expect(() => stripPngMetadata(good.subarray(0, good.length - 20))).toThrow();
    expect(() => stripPngMetadata(good.subarray(0, 8))).toThrow();
  });
});

describe("settings for the model", () => {
  it("uses few steps and low CFG for lightning/turbo models, and normal settings otherwise", () => {
    expect(presetFor("dreamshaperXL_lightningDPMSDE.safetensors")).toMatchObject({ steps: 6, cfg: 2, sampler: "dpmpp_sde" });
    expect(presetFor("sdxl_turbo.safetensors").steps).toBe(6);
    expect(presetFor("sd_xl_base_1.0.safetensors")).toMatchObject({ steps: 25, cfg: 7 });
  });
  it("prefers the named checkpoint, then a fast one, then the first", () => {
    const list = ["sd_xl_base_1.0.safetensors", "dreamshaperXL_lightningDPMSDE.safetensors"];
    expect(pickCheckpoint(list, "sd_xl_base_1.0.safetensors")).toBe("sd_xl_base_1.0.safetensors");
    expect(pickCheckpoint(list, "")).toBe("dreamshaperXL_lightningDPMSDE.safetensors");
    expect(pickCheckpoint(list, "missing.safetensors")).toBe("dreamshaperXL_lightningDPMSDE.safetensors");
    expect(pickCheckpoint(["a.safetensors", "b.safetensors"], "")).toBe("a.safetensors");
    expect(() => pickCheckpoint([], "")).toThrow(ComfyError);
  });
  it("builds a workflow whose links all point at real nodes", () => {
    const w = buildWorkflow({ checkpoint: "m.safetensors", prompt: "a spooky lantern", negative: "text", width: 1344, height: 768, seed: 7 }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    expect(Object.values(w).map((n) => n.class_type)).toEqual(["CheckpointLoaderSimple", "CLIPTextEncode", "CLIPTextEncode", "EmptyLatentImage", "KSampler", "VAEDecode", "SaveImage"]);
    for (const node of Object.values(w)) {
      for (const v of Object.values(node.inputs)) if (Array.isArray(v)) expect(w[v[0] as string], `link to ${v[0]}`).toBeDefined();
    }
    expect(w["2"].inputs.text).toBe("a spooky lantern");
    expect(w["4"].inputs).toMatchObject({ width: 1344, height: 768 });
    expect(w["5"].inputs.seed).toBe(7);
  });
  it("names colors in plain words", () => {
    expect(nearestColorName("#000000")).toBe("black");
    expect(nearestColorName("#341c69")).toMatch(/indigo|purple|navy/);
    expect(nearestColorName("#e86814")).toMatch(/orange/);
    expect(nearestColorName("#fdd835")).toBe("yellow");
  });
});

// ---- a stand-in for ComfyUI
type Mode = "ok" | "reject" | "exec-error" | "no-image" | "hang";
let mode: Mode = "ok";
let polls = 0;
const deleted: string[] = [];
let server: http.Server, base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const send = (code: number, body: unknown, type = "application/json") => {
      res.writeHead(code, { "content-type": type });
      res.end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (url.pathname === "/system_stats") return send(200, { system: { comfyui_version: "9.9.9" }, devices: [{ name: "cuda:0 NVIDIA Test GPU : cudaMallocAsync", vram_total: 12_900_000_000 }] });
      if (url.pathname === "/object_info/CheckpointLoaderSimple") return send(200, { CheckpointLoaderSimple: { input: { required: { ckpt_name: [["base.safetensors", "fast_lightning.safetensors"]] } } } });
      if (url.pathname === "/prompt" && req.method === "POST") {
        if (mode === "reject") return send(400, { error: { message: "Prompt outputs failed validation", details: "" }, node_errors: { "1": { errors: [{ message: "Value not in list", details: "ckpt_name: 'nope.safetensors' not in [..]" }] } } });
        return send(200, { prompt_id: "job-1" });
      }
      if (url.pathname === "/history/job-1") {
        polls++;
        if (mode === "hang" || polls < 3) return send(200, {});
        if (mode === "exec-error") return send(200, { "job-1": { status: { status_str: "error", messages: [["execution_error", { exception_message: "CUDA out of memory" }]] }, outputs: {} } });
        if (mode === "no-image") return send(200, { "job-1": { status: { status_str: "success" }, outputs: {} } });
        return send(200, { "job-1": { status: { status_str: "success" }, outputs: { "7": { images: [{ filename: "x_00001_.png", subfolder: "", type: "output" }] } } } });
      }
      if (url.pathname === "/view") return send(200, comfyLikePng(), "image/png");
      if (url.pathname === "/queue" && req.method === "POST") {
        deleted.push(...(JSON.parse(body).delete as string[]));
        return send(200, {});
      }
      send(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const wf = () => buildWorkflow({ checkpoint: "base.safetensors", prompt: "p", negative: "n", width: 64, height: 64, seed: 1 });

describe("comfyStatus", () => {
  it("reports the server, GPU, models and the one it would use", async () => {
    const s = await comfyStatus(base);
    expect(s).toMatchObject({ ok: true, version: "9.9.9", device: "NVIDIA Test GPU", checkpoint: "fast_lightning.safetensors", fast: true });
    if (s.ok) {
      expect(s.checkpoints).toEqual(["base.safetensors", "fast_lightning.safetensors"]);
      expect(s.vramGb).toBe(12.9);
    }
  });
  it("says so plainly when ComfyUI isn't there", async () => {
    const s = await comfyStatus("http://127.0.0.1:1");
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error).toMatch(/Couldn't reach ComfyUI/);
  });
});

describe("runWorkflow", () => {
  it("waits through the queue and returns the picture", async () => {
    mode = "ok"; polls = 0;
    const png = await runWorkflow(wf(), { base, pollMs: 5 });
    expect(pngChunks(png)).toContain("IHDR");
    expect(polls).toBeGreaterThanOrEqual(3); // it kept polling until the job was done
  });
  it("reports a rejected workflow with the reason", async () => {
    mode = "reject";
    await expect(runWorkflow(wf(), { base, pollMs: 5 })).rejects.toThrow(/failed validation.*ckpt_name/);
  });
  it("reports a failed run with ComfyUI's own reason", async () => {
    mode = "exec-error"; polls = 0;
    await expect(runWorkflow(wf(), { base, pollMs: 5 })).rejects.toThrow(/CUDA out of memory/);
  });
  it("notices a run that produced nothing", async () => {
    mode = "no-image"; polls = 0;
    await expect(runWorkflow(wf(), { base, pollMs: 5 })).rejects.toThrow(/saved no image/);
  });
  it("gives up on a hang, and takes its own job out of the queue", async () => {
    mode = "hang"; polls = 0; deleted.length = 0;
    await expect(runWorkflow(wf(), { base, pollMs: 5, timeoutMs: 150 })).rejects.toThrow(/too long/);
    expect(deleted).toEqual(["job-1"]);
  });
  it("explains an unreachable server", async () => {
    await expect(runWorkflow(wf(), { base: "http://127.0.0.1:1", pollMs: 5 })).rejects.toThrow(/Couldn't reach ComfyUI/);
  });
});

describe("resolveCheckpoint", () => {
  const st = { checkpoints: ["a.safetensors", "b.safetensors"], checkpoint: "a.safetensors" };
  it("defaults when nothing is picked", () => {
    expect(resolveCheckpoint(undefined, st)).toBe("a.safetensors");
    expect(resolveCheckpoint("", st)).toBe("a.safetensors");
  });
  it("accepts an installed model and refuses anything else", () => {
    expect(resolveCheckpoint("b.safetensors", st)).toBe("b.safetensors");
    expect(resolveCheckpoint("../../etc/passwd", st)).toBeNull();
    expect(resolveCheckpoint("c.safetensors", st)).toBeNull();
  });
});
