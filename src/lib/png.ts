/**
 * ComfyUI writes the full prompt and the whole workflow into every PNG it saves (as text chunks). Those would
 * be published with the picture, so before an image is stored, this drops every chunk that isn't needed to
 * show it: text, compressed text, EXIF and the modification time. The pixels are untouched (no re-encoding).
 */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DROP = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]);

export function stripPngMetadata(png: Buffer): Buffer {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG file.");
  const kept: Buffer[] = [SIGNATURE];
  let pos = 8;
  let sawEnd = false;
  while (pos < png.length) {
    if (pos + 12 > png.length) throw new Error("Truncated PNG.");
    const length = png.readUInt32BE(pos);
    const type = png.toString("latin1", pos + 4, pos + 8);
    const end = pos + 12 + length;
    if (end > png.length) throw new Error("Truncated PNG.");
    if (!DROP.has(type)) kept.push(png.subarray(pos, end));
    pos = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new Error("PNG has no end marker.");
  return Buffer.concat(kept);
}

/** Names of the chunks in a PNG, for tests and diagnostics. */
export function pngChunks(png: Buffer): string[] {
  const out: string[] = [];
  for (let pos = 8; pos + 12 <= png.length; ) {
    out.push(png.toString("latin1", pos + 4, pos + 8));
    pos += 12 + png.readUInt32BE(pos);
  }
  return out;
}
