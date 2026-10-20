import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { workoutAppLink, workoutPreview } from "./workout.mjs";

function share(blocks, extra = {}) {
  return "#" + Buffer.from(JSON.stringify({ formatVersion: 9,
    plan: { id: "shared", name: "Long hold practice", kind: "training", cooldownBlocks: true,
      createdAt: "1970-01-01T00:00:00Z", updatedAt: "1970-01-01T00:00:00Z", blocks }, ...extra
  })).toString("base64url");
}

test("preview shows authored groups, own-best targets and spoken notes without a priced total", () => {
  const preview = workoutPreview(share([
    { type: "breathe", duration: 180, notes: "Calm breathing" },
    { type: "group", label: "CO₂ rounds", repeats: 3, blocks: [
      { type: "hold", target: { type: "percentOfMax", percent: .6 }, style: "frc" },
      { type: "rest", duration: 60, notes: "Easy breathing, stand up slowly." }
    ], roundNotes: [{ pass: 1, target: [0], text: "Let the shoulders soften" }] }
  ]));
  assert.equal(preview.state, "ready");
  assert.equal(preview.holds, 3);
  assert.equal(preview.percent, true);
  assert.equal(preview.rows[0].timing, "3:00");
  assert.equal(preview.rows[1].timing, "3 rounds");
  assert.equal(preview.rows[1].children[0].timing, "60% of your FRC best");
  assert.equal(preview.rows[1].children[1].notes, "Easy breathing, stand up slowly.");
  assert.match(preview.rows[1].notes, /Round 2: Let the shoulders soften/);
  assert.equal(preview.total, undefined);
});

test("hold routines stay compact and retain packing and instructions", () => {
  const preview = workoutPreview(share([{ type: "sequence", role: "holdRoutine", blocks: [
    { type: "finalBreath", style: "packed", duration: 10, packCount: 8, notes: "Prepare gently" },
    { type: "hold", style: "packed", target: { type: "untilTap" }, notes: "Release the shoulders" },
    { type: "breathe", style: "recovery", duration: 0, pacing: { type: "count", breaths: 5 } }
  ] }]));
  assert.equal(preview.state, "ready");
  assert.equal(preview.holds, 1);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].title, "Packed hold");
  assert.equal(preview.rows[0].timing, "until tap");
  assert.deepEqual(preview.rows[0].children, []);
  for (const fact of ["8 packs", "Prepare gently", "Release the shoulders", "5 breaths"])
    assert.ok(preview.rows[0].notes.includes(fact));
});

test("patterned breath counts derive from their saved window and complete cycle", () => {
  const pattern = { type: "pattern", pattern: { inhale: 4, holdIn: 1, exhale: 6, holdOut: 1 } };
  const preview = workoutPreview(share([
    { type: "breathe", style: "full", duration: 60, lengthIn: "breaths", pacing: pattern },
    { type: "breathe", style: "full", duration: 60, lengthIn: "time", pacing: pattern },
    { type: "breathe", duration: 60, lengthIn: "breaths", untilTap: true, pacing: { type: "free" } },
    { type: "breathe", duration: 60, pacing: { type: "count", breaths: 6 } },
    { type: "breathe", style: "packing", duration: 16, lengthIn: "breaths", pacing: pattern },
    { type: "breathe", style: "recovery", duration: 60, lengthIn: "breaths", pacing: pattern }
  ]));
  assert.equal(preview.state, "ready");
  assert.deepEqual(preview.rows.map(row => row.timing), ["5 breaths", "1:00", "until tap", "6 breaths", "4 breaths", "1:00"]);
  assert.ok(preview.rows[0].notes.includes("0:01 pause"));
});

test("measured and continuing targets remain targets rather than estimated durations", () => {
  const preview = workoutPreview(share([
    { type: "hold", target: { type: "fixed", seconds: 90 }, continuePastTarget: true },
    { type: "hold", target: { type: "afterFirstContraction", seconds: 30 } },
    { type: "hold", target: { type: "untilSpO2", percent: 85 } },
    { type: "rest", untilSpO2: 95 }
  ]));
  assert.equal(preview.state, "ready");
  assert.deepEqual(preview.rows.map(row => row.timing), ["1:30 · continue until tap", "first contraction + 0:30", "SpO₂ 85% target", "until SpO₂ returns to 95%"]);
  assert.equal(workoutPreview(share([{ type: "hold", target: { type: "untilSpO2", percent: 85 }, continuePastTarget: true }])).state, "invalid");
});

test("format12 keeps the target independent from manual ending", () => {
  for (const target of [{ type: "afterFirstContraction", seconds: 30 }, { type: "untilSpO2", percent: 85 }]) {
    const blocks = [{ type: "hold", target, continuePastTarget: true }];
    const preview = workoutPreview(share(blocks, { formatVersion: 12 }));
    assert.equal(preview.state, "ready");
    assert.ok(preview.rows[0].timing.endsWith(" · continue until tap"));
    assert.equal(workoutPreview(share(blocks)).state, "invalid");
  }
  assert.equal(workoutPreview(share([{ type: "hold", target: { type: "untilTap" }, continuePastTarget: true }], { formatVersion: 12 })).state, "invalid");
  assert.equal(workoutPreview(share([{ type: "hold", target: { type: "fixed", seconds: 30 }, continuePastTarget: "false" }], { formatVersion: 12 })).state, "invalid");
});

test("new versions are distinguished before unknown blocks and malformed input stays bounded", () => {
  assert.equal(workoutPreview(share([{ type: "future-block" }], { formatVersion: 13 })).state, "newer");
  const invalid = ["#e30", "#_w", "#" + "a".repeat(2000),
    share([{ type: "hold", target: { type: "percentOfMax", percent: "60" } }]),
    share([{ type: "group", repeats: 50001, blocks: [{ type: "rest", duration: 60 }] }]),
    share([{ type: "include", planID: "local-personal-plan" }]),
    share([{ type: "rest", untilSpO2: 95, duration: 60 }]),
    share([{ type: "rest", duration: 60 }], { formatVersion: 1 })];
  for (const hash of invalid) assert.equal(workoutPreview(hash).state, "invalid", hash);
  let blocks = [{ type: "rest", duration: 60 }];
  for (let i = 0; i < 9; i++) blocks = [{ type: "sequence", blocks }];
  assert.equal(workoutPreview(share(blocks)).state, "invalid");
});

test("Unicode and authored text remain text while personal workout metadata is excluded", () => {
  const plan = { id: "shared", name: "Caffè <img onerror=alert(1)>", blocks: [
    { type: "rest", label: "<script>bad()</script>", duration: 60, notes: "<b>Spoken text</b>" }
  ], notes: "private workout", tags: ["private tag"] };
  const preview = workoutPreview(share([], { plan }));
  assert.equal(preview.state, "ready");
  assert.equal(preview.name, plan.name);
  assert.equal(preview.rows[0].title, plan.blocks[0].label);
  assert.equal(preview.rows[0].notes, plan.blocks[0].notes);
  assert.ok(!JSON.stringify(preview.rows).includes("private"));
});

test("only opaque URL-safe fragments become Nadir links", () => {
  assert.equal(workoutAppLink("#aB09-_"), "nadir://workout#aB09-_");
  for (const value of ["", "#", "#<script>", "#a?upload=1", "#a/b", "#%20", "not-a-fragment"])
    assert.equal(workoutAppLink(value), null);
  assert.equal(workoutAppLink("#" + "a".repeat(2000)), null);
});

test("landing page has no payload upload or third-party resources", async () => {
  const html = await readFile(new URL("./w/index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("./workout.mjs", import.meta.url), "utf8");
  assert.ok(html.includes('name="referrer" content="no-referrer"'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|innerHTML|eval)\b/.test(js));
  assert.deepEqual([...html.matchAll(/(?:src|href)="([^"]*)"/g)].map(m => m[1]), ["/workout.css", "/workout.mjs", "https://testflight.apple.com/join/dg3C5UUX"]);
});

test("association authorizes only the workout routes for Nadir", async () => {
  const data = JSON.parse(await readFile(new URL("./.well-known/apple-app-site-association", import.meta.url), "utf8"));
  assert.deepEqual(data.applinks.details, [{ appIDs: ["9W2YL9NTD6.com.thomastiotto.nadir"],
    components: [{"/":"/w"}, {"/":"/w/"}] }]);
});


test("changing a fragment replaces or clears the previously offered workout", async () => {
  const names = ["document", "location", "addEventListener", "navigator"];
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  function element() { return { children: [], setAttribute() {}, removeAttribute(name) { delete this[name]; },
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; } }; }
  const elements = Object.fromEntries(["open-workout", "open-workout-prompt", "share-status", "workout-title", "hold-count", "workout-explanation", "workout-blocks"].map(id => [id, element()]));
  const open = elements["open-workout"], status = elements["share-status"];
  const first = share([{ type: "rest", duration: 60 }]);
  const second = share([{ type: "activity", duration: 30, label: "Stretch" }], {
    plan: { name: "Second", blocks: [{ type: "activity", duration: 30, label: "Stretch" }] }
  });
  let change;
  try {
    globalThis.document = { getElementById: id => elements[id], createElement: element };
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 1 } });
    globalThis.location = { hash: first };
    globalThis.addEventListener = (event, handler) => {
      assert.equal(event, "hashchange"); change = handler;
    };
    await import("./workout.mjs?fragment-update-test");
    assert.equal(open.href, "nadir://workout" + first);
    assert.equal(elements["open-workout-prompt"].hidden, false);
    assert.equal(elements["workout-title"].textContent, "Long hold practice");
    assert.equal(elements["workout-blocks"].children.length, 1);
    globalThis.location.hash = second; change();
    assert.equal(open.href, "nadir://workout" + second);
    assert.equal(elements["workout-title"].textContent, "Second");
    assert.equal(elements["workout-blocks"].children.length, 1);
    globalThis.location.hash = "#invalid!"; change();
    assert.equal(open.hidden, true);
    assert.equal(elements["open-workout-prompt"].hidden, true);
    assert.equal(open.href, undefined);
    assert.match(status.textContent, /incomplete/);
    assert.equal(elements["workout-blocks"].children.length, 0);
    assert.equal(elements["workout-blocks"].hidden, true);
    globalThis.location.hash = share([], { formatVersion: 13 }); change();
    assert.equal(open.hidden, false);
    assert.match(status.textContent, /newer Nadir/);
  } finally {
    names.forEach((name, i) => {
      if (previous[i]) Object.defineProperty(globalThis, name, previous[i]);
      else delete globalThis[name];
    });
  }
});
