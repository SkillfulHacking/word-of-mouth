// Downloads the Semaphore circuit files once, so proofs are made from files this app serves itself
// instead of a third-party CDN. Depth d supports groups of up to 2^d members.
// Usage: pnpm fetch-zk [maxDepth]   (default 8 => up to 256 guests, about 27 MB)
import fs from "node:fs/promises";
import path from "node:path";

const VERSION = "4.13.0"; // must match the version pinned inside @semaphore-protocol/proof
const maxDepth = Number(process.argv[2] ?? 8);
const dir = path.join(process.cwd(), "public", "zk", `semaphore-${VERSION}`);
await fs.mkdir(dir, { recursive: true });

for (let d = 1; d <= maxDepth; d++) {
  for (const ext of ["wasm", "zkey"]) {
    const file = path.join(dir, `semaphore-${d}.${ext}`);
    try {
      if ((await fs.stat(file)).size > 0) continue;
    } catch { /* not downloaded yet */ }
    const res = await fetch(`https://snark-artifacts.pse.dev/semaphore/${VERSION}/semaphore-${d}.${ext}`);
    if (!res.ok) throw new Error(`depth ${d} ${ext}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 100_000) throw new Error(`depth ${d} ${ext}: suspiciously small (${bytes.length} bytes)`);
    await fs.writeFile(file, bytes);
    console.log(`depth ${d} ${ext}: ${(bytes.length / 1e6).toFixed(2)} MB`);
  }
}
console.log("done:", dir);
