import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { workoutAppLink } from "./workout.mjs";

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
  const names = ["document", "location", "addEventListener"];
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const open = { hidden: true, removeAttribute(name) { delete this[name]; } };
  const status = {};
  let change;
  try {
    globalThis.document = { getElementById: id => id === "open-workout" ? open : status };
    globalThis.location = { hash: "#first" };
    globalThis.addEventListener = (event, handler) => {
      assert.equal(event, "hashchange"); change = handler;
    };
    await import("./workout.mjs?fragment-update-test");
    assert.equal(open.href, "nadir://workout#first");
    globalThis.location.hash = "#second"; change();
    assert.equal(open.href, "nadir://workout#second");
    globalThis.location.hash = "#invalid!"; change();
    assert.equal(open.hidden, true);
    assert.equal(open.href, undefined);
    assert.match(status.textContent, /no readable workout/);
  } finally {
    names.forEach((name, i) => {
      if (previous[i]) Object.defineProperty(globalThis, name, previous[i]);
      else delete globalThis[name];
    });
  }
});
