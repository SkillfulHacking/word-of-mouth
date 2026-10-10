import { describe, expect, it } from "vitest";
import { unlockDetails, type EventDetails } from "./client-crypto";
import { sealDetails } from "./seal";

const details: EventDetails = {
  title: "Garden party",
  startsAt: "2026-10-18T14:00",
  venue: "Pavilion B",
  address: "123 Example Rd",
  notes: "Bring a chair",
};

describe("sealDetails / unlockDetails", () => {
  it("unlocks with exactly the threshold of shares", async () => {
    const { blob, shares } = await sealDetails(details, 5, 3);
    expect(shares).toHaveLength(5);
    expect(await unlockDetails(blob, [shares[4], shares[0], shares[2]])).toEqual(details);
  });

  it("unlocks with any threshold-sized subset", async () => {
    const { blob, shares } = await sealDetails(details, 4, 2);
    for (const pair of [[0, 1], [1, 3], [2, 3], [0, 3]]) {
      expect(await unlockDetails(blob, pair.map((i) => shares[i]))).toEqual(details);
    }
  });

  it("fails with fewer than threshold shares", async () => {
    const { blob, shares } = await sealDetails(details, 5, 3);
    await expect(unlockDetails(blob, [shares[0], shares[1]])).rejects.toThrow();
  });

  it("does not leak the details into the stored blob", async () => {
    const { blob } = await sealDetails(details, 3, 2);
    const raw = Buffer.from(blob, "base64url").toString("latin1");
    expect(raw).not.toContain("Pavilion");
    expect(raw).not.toContain("Example Rd");
  });

  it("threshold 1: any single code opens the event, with 1 to 5 codes", async () => {
    for (const count of [1, 2, 5]) {
      const { blob, shares } = await sealDetails(details, count, 1);
      expect(shares).toHaveLength(count);
      for (const share of shares) expect(await unlockDetails(blob, [share])).toEqual(details);
    }
  });

  it("a code from a different event does not open this one", async () => {
    const a = await sealDetails(details, 3, 1);
    const b = await sealDetails(details, 3, 1);
    await expect(unlockDetails(a.blob, [b.shares[0]])).rejects.toThrow();
  });

  it("works at the largest size: 5 codes, any 3", async () => {
    const { blob, shares } = await sealDetails(details, 5, 3);
    expect(await unlockDetails(blob, [shares[1], shares[3], shares[4]])).toEqual(details);
  });
});
