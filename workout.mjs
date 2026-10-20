export function workoutAppLink(hash) {
  const token = hash.startsWith("#") ? hash.slice(1) : "";
  if (!token || !/^[A-Za-z0-9_-]+$/.test(token) ||
      ("https://thomast8.github.io/w#" + token).length > 2000) return null;
  return "nadir://workout#" + token;
}

if (typeof document !== "undefined") {
  const open = document.getElementById("open-workout");
  const status = document.getElementById("share-status");
  function update() {
    const link = workoutAppLink(location.hash);
    open.hidden = !link;
    if (link) open.href = link;
    else open.removeAttribute("href");
    status.textContent = link
      ? "Nothing is added until you choose Add to Train in Nadir."
      : "This link has no readable workout. Ask the sender to share it again.";
  }
  addEventListener("hashchange", update);
  update();
}
