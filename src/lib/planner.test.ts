import { describe, expect, it } from "vitest";
import { distanceM, loopWalkM, walkOrder } from "./geo";
import { thin, toCandidates, type Candidate } from "./osm";
import { checkPick, findLeaks, hint, inventedWords, leakTerms, nearby, planSpots, spreadPick, type Ask, type PlanInput } from "./planner";

const center = { lat: 43.05, lon: -76.15 };
// ~0.0005 deg latitude is about 55 m
const at = (n: number, id = `node/${n}`, kind = "bench"): Candidate => ({
  id,
  kind,
  lat: center.lat + n * 0.0005,
  lon: center.lon + (n % 2) * 0.0007,
});
const pool = [1, 2, 3, 4, 5, 6].map((n) => at(n));
const secrets = { venue: "Pavilion B", address: "123 Example Rd", title: "Garden party" };
const input = (over: Partial<PlanInput> = {}): PlanInput => ({ center, count: 3, maxWalkM: 2000, secrets, ...over });

describe("geo", () => {
  it("measures distance and loop length sensibly", () => {
    const d = distanceM(center, { lat: center.lat + 0.001, lon: center.lon });
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(117);
    const order = walkOrder(center, [at(3), at(1), at(2)]);
    expect(order.map((c) => c.id)).toEqual(["node/1", "node/2", "node/3"]);
    expect(loopWalkM(center, order, 1)).toBeGreaterThan(300);
  });
});

describe("osm", () => {
  it("drops private things, reads area centers, and thins crowds", () => {
    const els: Parameters<typeof toCandidates>[0] = [
      { type: "node", id: 1, lat: 1, lon: 1, tags: { amenity: "bench" } },
      { type: "node", id: 2, lat: 1, lon: 1, tags: { amenity: "bench", access: "private" } },
      { type: "node", id: 3, lat: 1, lon: 1, tags: { tourism: "information", information: "board", name: "Trail Map" } },
      { type: "way", id: 4, center: { lat: 2, lon: 2 }, tags: { amenity: "shelter", shelter_type: "picnic_shelter" } },
      { type: "way", id: 5, tags: { leisure: "playground" } }, // no center: skipped
    ];
    const c = toCandidates(els);
    expect(c.map((x) => x.id)).toEqual(["node/1", "node/3", "way/4"]);
    expect(c[1]).toMatchObject({ kind: "information board", name: "Trail Map" });
    expect(c[2]).toMatchObject({ kind: "picnic shelter", lat: 2, lon: 2 });
    const crowd = [at(1, "a"), { ...at(1, "b"), lat: at(1).lat + 0.00005 }, at(5, "c")];
    expect(thin(crowd, center, 40, 10).map((x) => x.id)).toEqual(["a", "c"]);
  });
});

describe("leak and grounding checks", () => {
  it("catches the venue, address parts and the title", () => {
    const terms = leakTerms(secrets);
    expect(findLeaks("Meet by the pavilion", terms)).toEqual(["pavilion"]);
    expect(findLeaks("Number 123 is the one", terms)).toContain("123");
    expect(findLeaks("Where the ducks hold court", terms)).toEqual([]);
  });
  it("flags invented scenery unless it is in the real data", () => {
    expect(inventedWords("Past the old oak, by the valley", "bench")).toEqual(["oak", "valley"]);
    expect(inventedWords("A seat near the river", 'bench "River Walk"')).toEqual([]);
  });
  it("builds the factual hint in code", () => {
    expect(hint({ ...at(2), name: "Duck Pond" }, center)).toMatch(/^bench "Duck Pond", about \d+ m [a-z-]+ of the start$/);
    expect(nearby(at(1, "a"), [at(1, "a"), { ...at(1, "p", "playground"), lat: at(1).lat + 0.0002 }])).toBe("playground");
    expect(nearby(at(1, "a"), [at(1, "a"), at(5, "far", "playground")])).toBeUndefined();
  });
});

describe("checkPick", () => {
  const byId = new Map(pool.map((c) => [c.id, c]));
  const terms = leakTerms(secrets);
  const good = { spots: [{ id: "node/1", flavor: "The courier waits for no one." }, { id: "node/4", flavor: "A seat for those who plan ahead." }] };
  const two = input({ count: 2 });

  it("accepts a valid pick", () => expect(checkPick(good, byId, two, terms)).toEqual([]));
  it("rejects invented ids, duplicates, wrong counts, leaks, scenery and crowding", () => {
    const bad = (spots: { id: string; flavor: string }[], inp = two, m = byId) => checkPick({ spots }, m, inp, terms).join();
    expect(bad([{ id: "node/999", flavor: "A perfectly fine line here." }, good.spots[0]])).toMatch(/not in the candidate list/);
    expect(bad([good.spots[0], good.spots[0]])).toMatch(/twice/);
    expect(bad([good.spots[0]])).toMatch(/exactly 2/);
    expect(bad([{ id: "node/1", flavor: "Near Pavilion B, obviously." }, good.spots[1]])).toMatch(/secret text/);
    expect(bad([{ id: "node/1", flavor: "Under the old oak tree." }, good.spots[1]])).toMatch(/not in the data/);
    expect(bad([{ id: "node/1", flavor: "Head just south of the lamp." }, good.spots[1]])).toMatch(/mentions a direction/);
    expect(bad([{ id: "node/1", flavor: "Agent 7 will be waiting." }, good.spots[1]])).toMatch(/contains a number/);
    const close = new Map([["a", at(1, "a")], ["b", { ...at(1, "b"), lat: at(1).lat + 0.0001 }]]);
    expect(bad([{ id: "a", flavor: "A fine line number one." }, { id: "b", flavor: "A fine line number two." }], two, close)).toMatch(/apart/);
  });
  it("enforces the walk budget", () => {
    expect(checkPick(good, byId, input({ count: 2, maxWalkM: 100 }), terms).join()).toMatch(/limit is 100 m/);
  });
});

describe("planSpots", () => {
  const ok: Ask = async () =>
    ({
      spots: [
        { id: "node/6", flavor: "Where the far path ends, sit and wait." },
        { id: "node/1", flavor: "Begin by the nearest resting place." },
        { id: "node/3", flavor: "Halfway round, a seat with company." },
      ],
    }) as never;

  it("uses a valid model answer, orders it as a walk, and appends the code-built hint", async () => {
    const plan = await planSpots(pool, input(), ok);
    expect(plan.source).toBe("model");
    expect(plan.spots.map((s) => s.osmRef)).toEqual(["node/1", "node/3", "node/6"]);
    expect(plan.walkM).toBeGreaterThan(0);
    expect(plan.spots[0].clue).toMatch(/^Begin by the nearest resting place\. \(bench, about \d+ m [a-z-]+ of the start\)$/);
    expect(plan.spots[0].label).toMatch(/bench, \d+ m [a-z-]+ of the start/);
  });

  it("retries once with the problems, then succeeds", async () => {
    const prompts: string[] = [];
    let n = 0;
    const flaky: Ask = async (_s, u) => {
      prompts.push(u);
      return (n++ === 0 ? { spots: [{ id: "node/404", flavor: "An invented place, sadly." }] } : await ok(_s, u, undefined as never)) as never;
    };
    const plan = await planSpots(pool, input(), flaky);
    expect(plan.source).toBe("model");
    expect(prompts[1]).toMatch(/not in the candidate list/);
  });

  it("falls back to plain, in-budget facts when the model is down", async () => {
    const down: Ask = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const plan = await planSpots(pool, input(), down);
    expect(plan.source).toBe("fallback");
    expect(plan.spots).toHaveLength(3);
    expect(plan.walkM).toBeLessThanOrEqual(2000);
    expect(plan.spots[0].clue).toMatch(/^Find the bench, about/);
    expect(plan.warnings.join()).toMatch(/ECONNREFUSED/);
    expect(spreadPick(pool, center, 3, 2000)).toHaveLength(3);
  });

  it("explains when the area is too sparse or the walk too short", async () => {
    await expect(planSpots(pool.slice(0, 2), input({ count: 4 }), ok)).rejects.toThrow(/Only 2 usable/);
    const down: Ask = async () => {
      throw new Error("down");
    };
    await expect(planSpots(pool, input({ maxWalkM: 100 }), down)).rejects.toThrow(/Couldn't fit 3 spots/);
  });
});

describe("public hints never carry secret names", () => {
  it("drops a map feature's name when it matches the event's secrets", async () => {
    const mall = { ...at(1, "node/1", "information board"), name: "Destiny USA Directory" };
    const plain = at(3, "node/3", "bench");
    const down: Ask = async () => {
      throw new Error("down");
    };
    const plan = await planSpots(
      [mall, plain, at(5, "node/5")],
      input({ count: 2, secrets: { venue: "Freddy Fazbear's Pizza", address: "9090 Destiny USA Dr, Syracuse, NY 13204", title: "Costume party" } }),
      down,
    );
    const text = plan.spots.map((s) => s.clue).join(" ").toLowerCase();
    expect(text).not.toContain("destiny");
    expect(text).toContain("information board");
  });
});

