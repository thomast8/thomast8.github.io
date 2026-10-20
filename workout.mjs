export function workoutAppLink(hash) {
  const token = hash.startsWith("#") ? hash.slice(1) : "";
  if (!token || !/^[A-Za-z0-9_-]+$/.test(token) ||
      ("https://thomast8.github.io/w#" + token).length > 2000) return null;
  return "nadir://workout#" + token;
}

// These are authored facts, never a workout executor or a personal-best estimate.
export function workoutPreview(hash) {
  const appLink = workoutAppLink(hash);
  if (!appLink) return { state: "invalid" };
  if (typeof TextDecoder === "undefined") return { state: "browser", appLink };
  try {
    const token = hash.slice(1).replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(token + "=".repeat((4 - token.length % 4) % 4)), c => c.charCodeAt(0));
    const document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!Number.isSafeInteger(document.formatVersion) || document.formatVersion < 1) throw Error();
    if (document.formatVersion > 12) return { state: "newer", appLink };
    const plan = document.plan;
    if (!plan || (plan.kind !== undefined && plan.kind !== "training")) throw Error();
    const name = text(plan.name);
    if (!name.trim()) throw Error();
    let holds = 0, percent = false, visited = 0;
    let required = plan.cooldownBlocks === true ? 9 : 1;
    function blocks(values, depth = 0, repeats = 1) {
      if (!Array.isArray(values) || values.length === 0 || depth > 8) throw Error();
      return values.map(block => {
        if (!block || ++visited > 50000) throw Error();
        const label = text(block.label, ""), notes = text(block.notes, "");
        const row = { title: label, timing: "", notes, children: [] };
        switch (block.type) {
          case "breathe":
            row.title ||= { calm: "Breathe-up", full: "Deep breathing", recovery: "Recovery breaths", packing: "Packing", tidal: "Breathe", hyperventilation: "Fast breathing" }[block.style ?? "calm"];
            if (!row.title) throw Error();
            row.timing = block.untilTap ? "until tap" : block.pacing?.type === "count"
              ? `${integer(block.pacing.breaths, 1, 500)} breaths` : clock(block.duration);
            if (block.untilTap || block.style === "tidal") required = Math.max(required, 2);
            if (block.lengthIn === "breaths") required = Math.max(required, block.pacing?.type === "free" ? 4 : 3);
            if (block.pacing?.type === "pattern") {
              const pattern = block.pacing.pattern;
              if (block.lengthIn === "breaths" && !block.untilTap && !["recovery", "tidal"].includes(block.style)) {
                const cycle = block.style === "packing" ? 4 : ["inhale", "holdIn", "exhale", "holdOut"]
                  .reduce((sum, key) => sum + integer(pattern[key] ?? 0, 0, 366 * 86400), 0);
                if (cycle <= 0) throw Error();
                const count = block.duration / cycle;
                if (Number.isSafeInteger(count) && count > 0) row.timing = `${count} breaths`;
              }
              row.notes = [pattern.inhale > 0 ? `${clock(pattern.inhale)} in` : "", pattern.holdIn > 0 ? `${clock(pattern.holdIn)} pause` : "",
                pattern.exhale > 0 ? `${clock(pattern.exhale)} out` : "", pattern.holdOut > 0 ? `${clock(pattern.holdOut)} pause` : "", row.notes].filter(Boolean).join(" · ");
            }
            break;
          case "hold": {
            holds += repeats;
            if (holds > 50000) throw Error();
            row.title ||= { full: "Hold", frc: "FRC hold", rv: "RV hold", packed: "Packed hold" }[block.style ?? "full"];
            if (!row.title) throw Error();
            const target = block.target;
            switch (target?.type) {
              case "fixed": row.timing = clock(target.seconds); break;
              case "untilTap": row.timing = "until tap"; break;
              case "percentOfMax": {
                const value = number(target.percent, 0, 1000);
                if (value === 0) throw Error();
                const volume = { full: "full-lung", frc: "FRC", rv: "RV", packed: "full-lung" }[block.style ?? "full"];
                if (!volume) throw Error();
                row.timing = `${+(value * 100).toFixed(4)}% of your ${volume} best`;
                percent = true;
                break;
              }
              case "afterFirstContraction":
                row.timing = `first contraction + ${clock(target.seconds)}`;
                required = Math.max(required, 5);
                break;
              case "untilSpO2":
                row.timing = `SpO₂ ${number(target.percent, 1, 100)}% target`;
                required = Math.max(required, 9);
                break;
              default: throw Error();
            }
            if (block.continuePastTarget !== undefined && typeof block.continuePastTarget !== "boolean") throw Error();
            if (block.continuePastTarget) {
              if (!["fixed", "percentOfMax", "afterFirstContraction", "untilSpO2"].includes(target.type)) throw Error();
              row.timing += " · continue until tap";
              required = Math.max(required, ["afterFirstContraction", "untilSpO2"].includes(target.type) ? 12 : 9);
            }
            if (block.maxAttempt) required = Math.max(required, 3);
            break;
          }
          case "rest":
            row.title ||= "Rest";
            if (block.untilSpO2 !== undefined) {
              if (block.duration !== undefined) throw Error();
              row.timing = `until SpO₂ returns to ${number(block.untilSpO2, 1, 100)}%`;
              required = Math.max(required, 9);
            } else row.timing = clock(block.duration);
            break;
          case "activity": row.title ||= "Activity"; row.timing = clock(block.duration); break;
          case "finalBreath":
            row.title ||= "Final breath";
            row.timing = clock(block.duration ?? 10);
            if (block.style === "packed") row.timing += ` · ${integer(block.packCount ?? 8, 1, 500)} packs`;
            break;
          case "group":
          case "sequence": {
            if (depth >= 8) throw Error();
            const count = block.type === "group" ? integer(block.repeats, 1, 50000) : 1;
            if (repeats * count > 50000) throw Error();
            row.title ||= block.type === "group" ? "Rounds" : "Sequence";
            row.timing = block.type === "group" ? `${count} ${count === 1 ? "round" : "rounds"}` : "";
            row.children = blocks(block.blocks, depth + 1, repeats * count);
            if (block.progressions?.length) row.notes += "\nStarting targets are shown. Targets change between rounds; review them in Nadir.";
            if (block.roundNotes?.length) {
              required = Math.max(required, 8);
              for (const note of block.roundNotes) {
                row.notes += `\nRound ${integer(note.pass, 0, count - 1) + 1}: ${text(note.text)}`;
              }
            }
            if (block.type === "sequence" && block.role === "holdRoutine") {
              const index = block.blocks.findIndex(value => value.type === "hold");
              if (index < 0 || block.blocks.filter(value => value.type === "hold").length !== 1) throw Error();
              const hold = row.children[index];
              row.title = label || hold.title;
              row.timing = hold.timing;
              row.notes = row.children.map((child, i) => [i === index ? "" : `${child.title}: ${child.timing}`, child.notes].filter(Boolean).join("\n")).filter(Boolean).join("\n");
              row.children = [];
            }
            break;
          }
          default: throw Error();
        }
        return row;
      });
    }
    const rows = blocks(plan.blocks);
    if (document.formatVersion < required) throw Error();
    return { state: "ready", appLink, name, holds, percent, rows };
  } catch { return { state: "invalid" }; }
}

function text(value, fallback) {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw Error();
  }
  if (typeof value !== "string") throw Error();
  return value;
}
function number(value, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw Error();
  return value;
}
function integer(value, minimum, maximum) {
  number(value, minimum, maximum);
  if (!Number.isSafeInteger(value)) throw Error();
  return value;
}
function clock(value) {
  const seconds = integer(value, 0, 366 * 86400);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

if (typeof document !== "undefined") {
  const open = document.getElementById("open-workout");
  const status = document.getElementById("share-status");
  const title = document.getElementById("workout-title");
  const count = document.getElementById("hold-count");
  const explanation = document.getElementById("workout-explanation");
  const list = document.getElementById("workout-blocks");
  const mobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function render(rows, parent) {
    for (const row of rows) {
      const item = document.createElement("li");
      const line = document.createElement("div");
      line.className = "block-line";
      for (const value of [row.title, row.timing]) {
        const span = document.createElement("span"); span.textContent = value; line.append(span);
      }
      item.append(line);
      if (row.notes.trim()) {
        const note = document.createElement("p"); note.className = "block-note"; note.textContent = row.notes.trim(); item.append(note);
      }
      if (row.children.length) {
        const children = document.createElement("ul"); children.setAttribute("role", "list"); render(row.children, children); item.append(children);
      }
      parent.append(item);
    }
  }
  function update() {
    const preview = workoutPreview(location.hash);
    title.textContent = preview.state === "ready" ? preview.name : "A workout shared with you";
    count.textContent = preview.state === "ready" ? `${preview.holds} ${preview.holds === 1 ? "hold" : "holds"}` : "";
    explanation.textContent = preview.state === "ready"
      ? preview.percent ? "Holds are set as a share of your best, so Nadir times them for you." : "Review these blocks in Nadir before adding the workout to Train."
      : "";
    list.replaceChildren();
    if (preview.state === "ready") render(preview.rows, list);
    list.hidden = preview.state !== "ready";
    open.hidden = !preview.appLink || !mobile;
    document.getElementById("open-workout-prompt").hidden = open.hidden;
    if (preview.appLink && mobile) open.href = preview.appLink;
    else open.removeAttribute("href");
    status.textContent = {
      invalid: "This link is incomplete. Ask for it to be sent again.",
      newer: "This workout was made with a newer Nadir.",
      browser: "This browser can’t open Nadir links. Open it on your iPhone.",
      ready: mobile ? "Nothing is added until you choose Add to Train in Nadir." : "Open this link on your iPhone to add it to Nadir."
    }[preview.state];
  }
  addEventListener("hashchange", update);
  update();
}
