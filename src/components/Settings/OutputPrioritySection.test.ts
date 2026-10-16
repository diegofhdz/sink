import { describe, expect, it } from "vitest";
import { moveRank, priorityRows } from "./OutputPrioritySection";

describe("moveRank", () => {
  it("moves an entry and clamps at the ends", () => {
    expect(moveRank(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveRank(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    const order = ["a", "b"];
    expect(moveRank(order, 0, -1)).toBe(order);
    expect(moveRank(order, 1, 1)).toBe(order);
    expect(moveRank(order, 5, -1)).toBe(order);
  });
});

describe("priorityRows", () => {
  const priority = {
    order: ["dac", "headset"],
    known: [
      { name: "headset", description: "Headset", last_seen: 300 },
      { name: "dac", description: "DAC", last_seen: 100 },
      { name: "hdmi", description: "HDMI", last_seen: 50 },
      { name: "bt", description: "Earbuds", last_seen: 200 },
    ],
  };

  it("keeps the ranking order and marks what is connected", () => {
    const { ranked } = priorityRows(priority, new Map([["headset", "Headset"]]));
    expect(ranked.map((r) => [r.name, r.connected])).toEqual([
      ["dac", false],
      ["headset", true],
    ]);
  });

  it("lists the rest connected first, then most recently seen", () => {
    const live = new Map([
      ["hdmi", "HDMI"],
      ["new", "Brand new"],
    ]);
    const { others } = priorityRows(priority, live);
    expect(others.map((r) => r.name)).toEqual(["hdmi", "new", "bt"]);
    // A live device not saved yet still shows, with its live name.
    expect(others[1]).toMatchObject({ description: "Brand new", lastSeen: null });
  });

  it("falls back to the node name for a ranked device it never saw", () => {
    const { ranked } = priorityRows({ order: ["ghost"], known: [] }, new Map());
    expect(ranked[0]).toMatchObject({ name: "ghost", description: "ghost", lastSeen: null });
  });
});
