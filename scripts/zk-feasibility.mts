import path from "node:path";
import { Group } from "@semaphore-protocol/group";
import { Identity } from "@semaphore-protocol/identity";
import { generateProof, verifyProof } from "@semaphore-protocol/proof";

const dir = path.join(process.cwd(), "public", "zk", "semaphore-4.13.0");
const artifacts = (d: number) => ({ wasm: path.join(dir, `semaphore-${d}.wasm`), zkey: path.join(dir, `semaphore-${d}.zkey`) });
const depthOf = (g: Group) => Math.max(1, g.depth);

for (const size of [1, 2, 3, 5, 9]) {
  const ids = Array.from({ length: size }, () => new Identity());
  const group = new Group(ids.map((i) => i.commitment));
  const t = Date.now();
  const proof = await generateProof(ids[0], group, "challenge-abc", "event:xyz", depthOf(group), artifacts(depthOf(group)));
  const gen = Date.now() - t;
  const t2 = Date.now();
  const ok = await verifyProof(proof);
  console.log(`group of ${size} (depth ${depthOf(group)}): generate ${gen} ms, verify ${Date.now() - t2} ms, valid=${ok}`);
}

// properties we rely on
const ids = Array.from({ length: 4 }, () => new Identity());
const group = new Group(ids.map((i) => i.commitment));
const d = depthOf(group);
const p1 = await generateProof(ids[1], group, "challenge-1", "event:xyz", d, artifacts(d));
const p2 = await generateProof(ids[1], group, "challenge-2", "event:xyz", d, artifacts(d));
const other = await generateProof(ids[2], group, "challenge-1", "event:xyz", d, artifacts(d));
const diffEvent = await generateProof(ids[1], group, "challenge-1", "event:OTHER", d, artifacts(d));
console.log("same person, same event, different challenge -> same nullifier:", p1.nullifier === p2.nullifier);
console.log("different people                              -> different nullifier:", p1.nullifier !== other.nullifier);
console.log("same person, different event                  -> different nullifier:", p1.nullifier !== diffEvent.nullifier);
console.log("proof exposes message/scope as hashes (not raw):", String(p1.message).length > 20, String(p1.scope).length > 20);
console.log("root in proof equals group root:", p1.merkleTreeRoot === String(group.root));

const tamper = { ...p1, nullifier: other.nullifier };
console.log("tampered nullifier verifies:", await verifyProof(tamper));
const outsider = new Identity();
let outsiderOk: string;
try { const bad = await generateProof(outsider, group, "x", "event:xyz", d, artifacts(d)); outsiderOk = String(await verifyProof(bad)); } catch (e) { outsiderOk = `cannot even build a proof (${(e as Error).message.slice(0, 60)})`; }
console.log("someone NOT in the group:", outsiderOk);
process.exit(0);
