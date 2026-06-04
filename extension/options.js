const DEFAULT_SERVER = "http://pi5.local:8080";
const $ = (s) => document.querySelector(s);

function normalize(raw) {
  let s = (raw || "").trim();
  if (!s) s = DEFAULT_SERVER;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  return s.replace(/\/+$/, "");
}

function setStatus(msg, kind) {
  const n = $("#status");
  n.textContent = msg;
  n.className = kind || "";
}

async function load() {
  const { server } = await chrome.storage.sync.get("server");
  $("#server").value = server || DEFAULT_SERVER;
}

async function save() {
  const server = normalize($("#server").value);
  $("#server").value = server;
  await chrome.storage.sync.set({ server });
  setStatus("Сохранено ✓", "ok");
  setTimeout(() => setStatus(""), 1800);
}

async function test() {
  const server = normalize($("#server").value);
  setStatus("Проверяю…");
  try {
    const res = await fetch(server + "/api/stats");
    if (!res.ok) throw new Error("HTTP " + res.status);
    setStatus("Сервер на связи ✓", "ok");
  } catch (e) {
    setStatus("Нет связи: " + e.message, "err");
  }
}

$("#save").addEventListener("click", save);
$("#test").addEventListener("click", test);
$("#server").addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
load();
