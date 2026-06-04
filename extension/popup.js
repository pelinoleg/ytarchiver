/* YT Archiver — popup logic.
   Reads the current YouTube tab, then offers "download this video" and
   "subscribe to channel" with the same options as the in-app Add dialogs. */

const DEFAULT_SERVER = "http://pi5.local:8080";

const QUALITY_OPTIONS = [
  ["", "Default"], ["best", "Best"],
  ["1080", "1080p"], ["720", "720p"], ["480", "480p"], ["360", "360p"],
];

const POLICY_OPTIONS = [
  { value: "new-only", short: "Only new",   hint: "Только видео, опубликованные после подписки" },
  { value: "latest",   short: "Last N",     hint: "Просто последние N штук, без учёта дат" },
  { value: "last-7",   short: "7 days",     hint: "За последнюю неделю + всё новое" },
  { value: "last-30",  short: "30 days",    hint: "За последний месяц + всё новое" },
  { value: "last-90",  short: "3 months",   hint: "За последние 3 месяца + всё новое" },
  { value: "last-365", short: "1 year",     hint: "За последний год + всё новое" },
  { value: "all",      short: "Everything", hint: "Всё с канала (может быть много)" },
];

const RETENTION_OPTIONS = [
  [null, "Default"], [7, "7d"], [30, "30d"], [90, "90d"], [365, "1y"], [0, "Forever"],
];

// Inline lucide-style icons (stroke = currentColor) — same visual language as the app.
const svg = (d, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}${extra}</svg>`;
const ICON = {
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'),
  channel:  svg('<path d="M22 8.6a4 4 0 0 0-2.8-2.8C17.5 5.3 12 5.3 12 5.3s-5.5 0-7.2.5A4 4 0 0 0 2 8.6 41 41 0 0 0 1.7 12 41 41 0 0 0 2 15.4a4 4 0 0 0 2.8 2.8c1.7.5 7.2.5 7.2.5s5.5 0 7.2-.5a4 4 0 0 0 2.8-2.8c.3-1.1.3-3.4.3-3.4s0-2.3-.3-3.4Z"/><path d="m10 15 5-3-5-3z" fill="currentColor"/>'),
  playlist: svg('<path d="M3 6h13M3 12h9M3 18h9"/><path d="M16 12v7a2 2 0 1 0 2-2 2 2 0 0 0-2 2"/>'),
  chev:     svg('<path d="m9 18 6-6-6-6"/>'),
  check:    svg('<path d="M20 6 9 17l-5-5"/>'),
  gear:     svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>'),
  external: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  play:     svg('<path d="m7 4 13 8-13 8z" fill="currentColor"/>'),
};

// ---- helpers ---------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) if (kid) n.append(kid);
  return n;
};

function normalizeServer(raw) {
  let s = (raw || "").trim();
  if (!s) s = DEFAULT_SERVER;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  return s.replace(/\/+$/, "");
}

async function getServer() {
  const { server } = await chrome.storage.sync.get("server");
  return normalizeServer(server || DEFAULT_SERVER);
}

async function api(path, { method = "GET", body } = {}) {
  const server = await getServer();
  const res = await fetch(server + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

const safe = async (fn) => { try { return await fn(); } catch { return null; } };

// Existing-state lookups so we don't silently re-add things.
const VIDEO_STATE = {
  done:        ["Уже скачано", "done", "blocked"],
  downloading: ["Качается…",   "busy", "blocked"],
  queued:      ["В очереди",   "busy", "blocked"],
  pending:     ["В очереди",   "busy", "blocked"],
  error:       ["Была ошибка", "gone", "retry"],
  skipped:     ["Пропущено",   "gone", "retry"],
  deleted:     ["Был удалён",  "gone", "retry"],
};

async function findVideo(videoId) {
  return videoId ? safe(() => api("/api/videos/" + videoId)) : null;
}
async function findChannel(ctx) {
  const ucid = (String(ctx.channelUrl || "").match(/\/channel\/(UC[\w-]+)/) || [])[1];
  const list = await safe(() => api("/api/channels"));
  if (!list) return null;
  if (ucid) { const m = list.find((c) => c.yt_channel_id === ucid); if (m) return m; }
  const norm = (s) => String(s || "").replace(/\/(videos|featured|streams)?\/?$/, "").toLowerCase();
  return list.find((c) => norm(c.url) && norm(c.url) === norm(ctx.channelUrl)) || null;
}
async function findPlaylist(ctx) {
  const list = await safe(() => api("/api/playlists"));
  return list ? list.find((p) => p.yt_playlist_id === ctx.playlistId) || null : null;
}

function setBadge(badge, text, kind) {
  badge.textContent = text;
  badge.className = `badge ${kind}`;
  badge.style.display = "";
}
function block(btn, text) { btn.disabled = true; btn.textContent = text; btn.classList.add("sub"); }

let toastTimer;
function toast(msg, kind = "ok") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 2600);
}

function chipRow(options, selected, onPick, { ghostLast = false } = {}) {
  const row = el("div", { class: "chips" });
  options.forEach(([value, label], i) => {
    const ghost = ghostLast && i === options.length - 1;
    const c = el("button", {
      class: `chip ${ghost ? "ghost" : ""} ${value === selected ? "on" : ""}`,
      text: label,
      onclick: () => onPick(value, c),
    });
    row.append(c);
  });
  return row;
}

// ---- read the current tab --------------------------------------------------

function extractFromPage() {
  // Runs in the page's MAIN world — can read YouTube's globals.
  const u = new URL(location.href);
  let videoId = u.searchParams.get("v");
  if (!videoId && u.pathname.startsWith("/shorts/")) videoId = u.pathname.split("/")[2];

  let channelUrl = null, channelName = null;
  let title = document.title.replace(/ - YouTube$/, "").trim();
  let thumb = null;

  try {
    const pr = window.ytInitialPlayerResponse;
    const vd = pr && pr.videoDetails;
    if (vd) {
      videoId = videoId || vd.videoId;
      channelName = vd.author || channelName;
      title = vd.title || title;
      if (vd.channelId) channelUrl = "https://www.youtube.com/channel/" + vd.channelId;
      const th = vd.thumbnail && vd.thumbnail.thumbnails;
      if (th && th.length) thumb = th[th.length - 1].url;
    }
  } catch { /* ignore */ }

  try {
    const meta = window.ytInitialData &&
      window.ytInitialData.metadata &&
      window.ytInitialData.metadata.channelMetadataRenderer;
    if (meta && meta.externalId) {
      channelUrl = channelUrl || "https://www.youtube.com/channel/" + meta.externalId;
      channelName = channelName || meta.title;
    }
  } catch { /* ignore */ }

  if (!channelUrl) {
    const a = document.querySelector(
      "ytd-video-owner-renderer a.yt-simple-endpoint, #owner ytd-channel-name a, ytd-channel-name a"
    );
    if (a && a.href) channelUrl = a.href;
    if (a && !channelName) channelName = a.textContent.trim();
  }

  // Playlist context — a real playlist we can subscribe to (not a radio/mix,
  // not the private Watch Later / Liked lists).
  let playlistId = u.searchParams.get("list");
  if (playlistId && /^(RD|WL|LL)/.test(playlistId)) playlistId = null;
  let playlistTitle = null;
  if (playlistId) {
    try {
      const d = window.ytInitialData;
      playlistTitle =
        (d && d.metadata && d.metadata.playlistMetadataRenderer && d.metadata.playlistMetadataRenderer.title) ||
        (d && d.header && d.header.playlistHeaderRenderer && d.header.playlistHeaderRenderer.title &&
          d.header.playlistHeaderRenderer.title.simpleText) ||
        (d && d.contents && d.contents.twoColumnWatchNextResults &&
          d.contents.twoColumnWatchNextResults.playlist &&
          d.contents.twoColumnWatchNextResults.playlist.playlist &&
          d.contents.twoColumnWatchNextResults.playlist.playlist.title) ||
        null;
    } catch { /* ignore */ }
  }

  let pageType = "other";
  if (videoId) pageType = "watch";
  else if (u.pathname === "/playlist" && playlistId) pageType = "playlist";
  else if (/^\/(@|channel\/|c\/|user\/)/.test(u.pathname)) {
    pageType = "channel";
    channelUrl = channelUrl || location.href.split("?")[0];
    channelName = channelName || title;
  }

  if (videoId && !thumb) thumb = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

  return {
    pageType,
    videoId,
    videoUrl: videoId ? "https://www.youtube.com/watch?v=" + videoId : null,
    channelUrl,
    channelName,
    playlistId,
    playlistUrl: playlistId ? "https://www.youtube.com/playlist?list=" + playlistId : null,
    playlistTitle,
    title,
    thumb,
  };
}

async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !/^https?:\/\/(www\.|m\.)?youtube\.com\//.test(tab.url)) {
    return { pageType: "not-youtube", tabUrl: tab && tab.url };
  }
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: extractFromPage,
    });
    return res.result;
  } catch (e) {
    return { pageType: "error", error: String(e) };
  }
}

// ---- cards ------------------------------------------------------------------

function videoCard(ctx) {
  let quality = "";
  let isMusic = false;

  const qChips = chipRow(QUALITY_OPTIONS, quality, (v, btn) => {
    quality = v;
    [...qChips.children].forEach((c) => c.classList.toggle("on", c === btn));
  });

  const musicLabel = el("label", { class: "check" }, [
    el("input", { type: "checkbox", onchange: (e) => (isMusic = e.target.checked) }),
    el("span", { class: "t", html: "Это музыка<small>показывать в разделе Music</small>" }),
  ]);

  const btn = el("button", { class: "btn", text: "Скачать видео" });
  const badge = el("span", { class: "badge", style: "display:none" });

  const card = el("details", { class: "card", open: "" }, [
    el("summary", {}, [
      el("span", { class: "ic", html: ICON.download }),
      el("span", { text: "Скачать это видео" }),
      badge,
      el("span", { class: "chev", html: ICON.chev }),
    ]),
    el("div", { class: "body" }, [
      el("span", { class: "label", text: "Качество (опц.)" }),
      qChips,
      musicLabel,
    ]),
    el("div", { class: "actions" }, [btn]),
  ]);

  findVideo(ctx.videoId).then((v) => {
    if (!v) return;
    const [label, kind, mode] = VIDEO_STATE[v.status] || ["Уже в базе", "busy", "blocked"];
    setBadge(badge, label, kind);
    if (mode === "blocked") block(btn, v.status === "done" ? "Уже скачано" : "Уже в очереди");
  });

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Добавляю…';
    try {
      await api("/api/videos/download", {
        method: "POST",
        body: { url: ctx.videoUrl, quality: quality || null, is_music: isMusic },
      });
      toast("Добавлено в очередь загрузки");
      btn.innerHTML = ICON.check + " В очереди";
    } catch (e) {
      toast("Не удалось: " + e.message, "err");
      btn.disabled = false;
      btn.textContent = "Скачать видео";
    }
  });

  return card;
}

async function channelCard(ctx, { open }) {
  let policy = "new-only";
  let latestCount = 10;
  let quality = "";
  let retention = null;
  let folderId = null;
  let showOnHome = true;

  // body parts that need to react to state
  const hint = el("p", { class: "hint", text: POLICY_OPTIONS[0].hint });
  const latestRow = el("div", { class: "row", style: "display:none" }, [
    el("input", {
      type: "number", min: "1", max: "500", value: "10",
      onchange: (e) => (latestCount = Math.max(1, Number(e.target.value) || 1)),
    }),
    el("span", { class: "hint", text: "видео" }),
  ]);

  const policyChips = chipRow(
    POLICY_OPTIONS.map((p) => [p.value, p.short]),
    policy,
    (v, btn) => {
      policy = v;
      [...policyChips.children].forEach((c) => c.classList.toggle("on", c === btn));
      hint.textContent = POLICY_OPTIONS.find((p) => p.value === v).hint;
      latestRow.style.display = v === "latest" ? "flex" : "none";
    }
  );

  const qChips = chipRow(QUALITY_OPTIONS, quality, (v, btn) => {
    quality = v;
    [...qChips.children].forEach((c) => c.classList.toggle("on", c === btn));
  });

  const retChips = chipRow(RETENTION_OPTIONS, retention, (v, btn) => {
    retention = v;
    [...retChips.children].forEach((c) => c.classList.toggle("on", c === btn));
  });

  // folder picker — fetched from the server
  const folderChips = el("div", { class: "chips" });
  function paintFolders(folders) {
    folderChips.innerHTML = "";
    const mk = (id, label, ghost) => {
      const c = el("button", {
        class: `chip ${ghost ? "ghost" : ""} ${id === folderId ? "on" : ""}`,
        text: label,
        onclick: () => {
          if (ghost) return startNewFolder();
          folderId = id;
          [...folderChips.children].forEach((x) => x.classList.toggle("on", x === c));
        },
      });
      return c;
    };
    folderChips.append(mk(null, "Ungrouped"));
    folders.forEach((f) => folderChips.append(mk(f.id, f.name)));
    folderChips.append(mk("__new__", "+ New", true));
  }
  function startNewFolder() {
    const input = el("input", { class: "txt", placeholder: "Название папки" });
    const create = el("button", { class: "chip on", text: "Создать" });
    const cancel = el("button", { class: "chip", text: "✕" });
    const row = el("div", { class: "row" }, [input, create, cancel]);
    folderChips.replaceWith(row);
    input.focus();
    const done = async () => {
      const name = input.value.trim();
      if (!name) return;
      try {
        const f = await api("/api/channel-folders", { method: "POST", body: { name } });
        folderId = f.id;
        await loadFolders();
        row.replaceWith(folderChips);
      } catch (e) { toast("Папка: " + e.message, "err"); }
    };
    create.addEventListener("click", done);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done();
      if (e.key === "Escape") row.replaceWith(folderChips);
    });
    cancel.addEventListener("click", () => row.replaceWith(folderChips));
  }
  async function loadFolders() {
    try { paintFolders(await api("/api/channel-folders")); }
    catch { paintFolders([]); }
  }

  const homeLabel = el("label", { class: "check" }, [
    el("input", { type: "checkbox", checked: "", onchange: (e) => (showOnHome = e.target.checked) }),
    el("span", { class: "t", html: "Показывать на Home<small>иначе видео только на странице канала</small>" }),
  ]);

  const btn = el("button", { class: "btn sub", text: "Подписаться на канал" });
  const badge = el("span", { class: "badge", style: "display:none" });

  const card = el("details", { class: "card", ...(open ? { open: "" } : {}) }, [
    el("summary", {}, [
      el("span", { class: "ic", html: ICON.channel }),
      el("span", { text: "Подписаться на канал" }),
      badge,
      el("span", { class: "chev", html: ICON.chev }),
    ]),
    el("div", { class: "body" }, [
      el("span", { class: "label", text: "Что качать" }),
      policyChips, hint, latestRow,
      el("span", { class: "label", text: "Качество" }), qChips,
      el("span", { class: "label", text: "Папка" }), folderChips,
      el("span", { class: "label", text: "Retention" }), retChips,
      homeLabel,
    ]),
    el("div", { class: "actions" }, [btn]),
  ]);

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Подписываюсь…';
    try {
      await api("/api/channels", {
        method: "POST",
        body: {
          url: ctx.channelUrl,
          download_policy: policy,
          quality: quality || null,
          retention_days: retention,
          show_on_home: showOnHome,
          folder_id: folderId,
          latest_count: policy === "latest" ? latestCount : null,
        },
      });
      toast("Подписка оформлена");
      btn.innerHTML = ICON.check + " Подписан";
    } catch (e) {
      toast("Не удалось: " + e.message, "err");
      btn.disabled = false;
      btn.textContent = "Подписаться на канал";
    }
  });

  // fetch folders only when the card is first opened (saves a request on watch pages)
  if (open) loadFolders();
  else card.addEventListener("toggle", () => { if (card.open) loadFolders(); }, { once: true });

  findChannel(ctx).then((ch) => {
    if (ch) { setBadge(badge, "Уже подписан", "done"); block(btn, "Уже подписан"); }
  });

  return card;
}

function playlistCard(ctx, { open }) {
  let quality = "";
  let isMusic = false;

  const qChips = chipRow(QUALITY_OPTIONS, quality, (v, btn) => {
    quality = v;
    [...qChips.children].forEach((c) => c.classList.toggle("on", c === btn));
  });
  const musicLabel = el("label", { class: "check" }, [
    el("input", { type: "checkbox", onchange: (e) => (isMusic = e.target.checked) }),
    el("span", { class: "t", html: "Это музыка<small>показывать в разделе Music</small>" }),
  ]);

  const btn = el("button", { class: "btn sub", text: "Подписаться на плейлист" });
  const badge = el("span", { class: "badge", style: "display:none" });

  const card = el("details", { class: "card", ...(open ? { open: "" } : {}) }, [
    el("summary", {}, [
      el("span", { class: "ic", html: ICON.playlist }),
      el("span", { text: "Подписаться на плейлист" }),
      badge,
      el("span", { class: "chev", html: ICON.chev }),
    ]),
    el("div", { class: "body" }, [
      ctx.playlistTitle ? el("p", { class: "hint", text: ctx.playlistTitle }) : null,
      el("span", { class: "label", text: "Качество" }), qChips,
      musicLabel,
    ]),
    el("div", { class: "actions" }, [btn]),
  ]);

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Подписываюсь…';
    try {
      await api("/api/playlists", {
        method: "POST",
        body: {
          url: ctx.playlistUrl,
          quality: quality || null,
          is_music: isMusic,
        },
      });
      toast("Плейлист добавлен");
      btn.innerHTML = ICON.check + " Добавлен";
    } catch (e) {
      toast("Не удалось: " + e.message, "err");
      btn.disabled = false;
      btn.textContent = "Подписаться на плейлист";
    }
  });

  findPlaylist(ctx).then((pl) => {
    if (pl) { setBadge(badge, "Уже добавлен", "done"); block(btn, "Уже добавлен"); }
  });

  return card;
}

// ---- render ----------------------------------------------------------------

function contextStrip(ctx) {
  return el("div", { class: "context" }, [
    ctx.thumb ? el("img", { src: ctx.thumb, onerror: (e) => (e.target.style.display = "none") }) : null,
    el("div", { class: "meta" }, [
      el("div", { class: "ttl", text: ctx.title || (ctx.pageType === "channel" ? ctx.channelName : "YouTube") }),
      ctx.channelName ? el("div", { class: "sub", text: ctx.channelName }) : null,
    ]),
  ]);
}

async function render() {
  const content = $("#content");
  content.innerHTML = "";
  const ctx = await readActiveTab();

  if (ctx.pageType === "not-youtube") {
    content.append(el("div", { class: "empty", html:
      "Открой страницу <b>YouTube</b> — видео, канал или плейлист,<br>и нажми расширение снова." }));
    return;
  }
  const hasAction = ctx.videoUrl || ctx.channelUrl || ctx.playlistUrl;
  if (ctx.pageType === "error" || !hasAction) {
    content.append(el("div", { class: "empty", text:
      "Не нашёл видео, канал или плейлист на этой странице. Открой watch-, channel- или playlist-страницу." }));
    return;
  }

  content.append(contextStrip(ctx));

  if (ctx.pageType === "watch" && ctx.videoUrl) {
    content.append(videoCard(ctx));
  }
  if (ctx.playlistUrl) {
    content.append(playlistCard(ctx, { open: ctx.pageType === "playlist" }));
  }
  if (ctx.channelUrl) {
    content.append(await channelCard(ctx, { open: ctx.pageType === "channel" }));
  }
}

// ---- server status ---------------------------------------------------------

async function pingServer() {
  const line = $("#server-line");
  const text = $("#server-text");
  const server = await getServer();
  text.textContent = server.replace(/^https?:\/\//, "");
  try {
    await api("/api/stats");
    line.className = "server ok";
  } catch {
    line.className = "server err";
    text.textContent = server.replace(/^https?:\/\//, "") + " — недоступен";
  }
}

// ---- boot ------------------------------------------------------------------

$("#open-server").innerHTML = ICON.external;
$("#open-options").innerHTML = ICON.gear;
$("#open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#open-server").addEventListener("click", async () => {
  chrome.tabs.create({ url: await getServer() });
});

render();
pingServer();
