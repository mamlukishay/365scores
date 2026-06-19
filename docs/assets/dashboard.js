/* 365Scores Predictions Cup — interactive dashboard client (module).
   Fetches data/{slug}.json (a map of groupId -> metrics) and renders one group
   at a time via mount(). Supports group switching. To stay "almost live" the
   page polls every 30s: it re-fetches the snapshot and re-renders on change,
   and pings the refresh Worker (which throttles builds to ~1/min globally). */

// Cloudflare Worker that triggers a fresh server build (see /worker). Leave ""
// to disable build-triggering — the 30s snapshot re-fetch still works without it.
const REFRESH_ENDPOINT = "https://scores-refresh.mamlukishay.workers.dev";
const POLL_MS = 30_000;

const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const pct = (x) => Math.round(x * 100) + "%";

// ---- palettes / theme ----
const WONG = ["#56B4E9", "#E69F00", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#22d3ee", "#a3e635", "#f472b6"];
const ACCENT = "#a855f7", ACCENT2 = "#d946ef", MUTED = "rgba(154,163,196,.22)", GOOD = "#34d399", WARN = "#fbbf24", BAD = "#5b6385";
const colorFor = (i) => WONG[i % WONG.length];

if (window.ChartDataLabels) Chart.register(window.ChartDataLabels);
Chart.defaults.color = "#9aa3c4";
Chart.defaults.font.family = "Inter,system-ui,sans-serif";
Chart.defaults.borderColor = "rgba(255,255,255,.06)";
Chart.defaults.animation = { duration: 650, easing: "easeOutQuart" };
// Don't animate color properties — gradient/array fills can't be interpolated
// and throw "this._fn is not a function", which blanks every canvas chart.
Chart.defaults.animations = { colors: false };
Chart.defaults.plugins.datalabels = { display: false };
// Merge styling — DON'T reassign, or the built-in enabled/mode/callbacks defaults are lost.
Object.assign(Chart.defaults.plugins.tooltip, {
  backgroundColor: "rgba(16,19,42,.96)", borderColor: "rgba(255,255,255,.12)", borderWidth: 1,
  cornerRadius: 10, padding: 12, titleColor: "#eef1fb", bodyColor: "#cdd3ee", usePointStyle: true,
  titleFont: { weight: 700, size: 13 }, bodyFont: { size: 12 },
});

// vertical gradient helper (cached per chart)
function grad(ctx, area, from, to) {
  const g = ctx.createLinearGradient(0, area.bottom, 0, area.top);
  g.addColorStop(0, from); g.addColorStop(1, to); return g;
}
const accentBar = (c) => { const a = c.chart.chartArea; return a ? grad(c.chart.ctx, a, "rgba(168,85,247,.35)", "#d946ef") : ACCENT; };

// ---- per-mount state (reset on every mount) ----
let M, byName, names, selected, charts;
const SEL_KEY = "selectedPlayer";
const isSel = (n) => n === selected;
// re-rendered toggle metrics (reset per mount so a fresh group starts clean)
let perfMetric, raceMode, regionMetric, styleMode;

// ============ count-up helper ============
function countUp(node, value, opts) {
  if (window.countUp && window.countUp.CountUp) {
    const c = new window.countUp.CountUp(node, value, Object.assign({ duration: 1.1, useGrouping: false }, opts));
    if (!c.error) { c.start(); return; }
  }
  node.textContent = (opts && opts.suffix ? value + opts.suffix : value);
}

// ============ podium ============
function renderPodium() {
  const box = $("#podium"); box.innerHTML = "";
  const top = M.standings.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean); // 2,1,3 visual order
  order.forEach((s) => {
    const place = s.rank;
    const p = el("div", `pod p${place}` + (isSel(s.name) ? " sel" : ""));
    p.innerHTML =
      `<div class="medal">${place === 1 ? "🥇" : place === 2 ? "🥈" : "🥉"}</div>` +
      `<div class="ava" style="background-image:url('');"></div>` +
      `<div class="nm">${s.name}</div>` +
      `<div class="pts num">${s.totalScore}<small style="color:var(--muted);font-size:13px"> pts</small></div>` +
      `<div class="stand num">${place}</div>`;
    box.appendChild(p);
  });
}

// ============ personalized stat cards ============
function statCard(k, icon, value, sub, opts) {
  const c = el("div", "stat");
  c.innerHTML = `<div class="k">${icon ? icon + " " : ""}${k}</div><div class="v num"></div><div class="sub">${sub || ""}</div>`;
  const v = c.querySelector(".v");
  if (typeof value === "number") countUp(v, value, opts);
  else v.innerHTML = value;
  return c;
}
function renderStats() {
  const p = byName[selected]; const box = $("#statCards"); box.innerHTML = "";
  const title = $("#statCardsTitle"); if (title) title.textContent = `⭐ Stats related to ${selected}`;
  box.appendChild(statCard("Rank", "🏅", p.rank, `of ${names.length} · ${p.totalScore} pts`, { prefix: "#" }));
  const hit = statCard("Hit rate", "🎯", Math.round(p.hitRate * 100), `${p.exact + p.partial}/${p.played} correct results`, { suffix: "%" });
  box.appendChild(hit);
  box.appendChild(statCard("Exact scores", "🔮", p.exact, `${pct(p.exactRate)} of matches · 3 pts each`));
  box.appendChild(statCard("Best day", "🔥", p.bestDay ? p.bestDay.points : 0, p.bestDay ? `pts on ${p.bestDay.date.slice(5)}` : "—"));
  box.appendChild(statCard("Best region", "🌍", p.bestRegion ? p.bestRegion.continent : "—", p.bestRegion ? `${p.bestRegion.ppg} pts/game` : ""));
  box.appendChild(statCard("Bravery", "⚡", p.avgGoals, `goals/match predicted · ${pct(p.boldShare)} bold`));
  box.appendChild(statCard("Contrarian", "🦓", Math.round(p.contrarianShare * 100), "of picks vs the crowd", { suffix: "%" }));
  box.appendChild(statCard("Signature call", "✍️", p.signature ? p.signature.match : "—",
    p.signature ? `you ${p.signature.sel} · only ${pct(p.signature.rate)} nailed it` : "no exact hits yet"));
}

// ============ group awards (superlatives) ============
function renderAwards() {
  const box = $("#awards"); box.innerHTML = "";
  const max = (arr, f) => arr.reduce((a, b) => (f(b) > f(a) ? b : a));
  const acc = M.accuracy;
  const mostAcc = max(acc, (a) => a.hitRate);
  const sharp = max(acc, (a) => a.exact);
  const brave = max(M.bravery, (b) => b.avgGoals);
  const contra = max(M.contrarian, (c) => c.contrarianShare);
  const bestDay = M.bestDays.map((b) => b.best && { name: b.name, ...b.best }).filter(Boolean).reduce((a, b) => (b.points > a.points ? b : a));
  const spoon = M.standings[M.standings.length - 1];
  const awards = [
    ["🎯", "Most accurate", mostAcc.name, pct(mostAcc.hitRate) + " correct results"],
    ["🔮", "Sniper (exact)", sharp.name, sharp.exact + " exact scores"],
    ["⚡", "Bravest", brave.name, brave.avgGoals + " goals/match"],
    ["🦓", "Most contrarian", contra.name, pct(contra.contrarianShare) + " vs crowd"],
    ["🔥", "Best single day", bestDay.name, bestDay.points + " pts on " + bestDay.date.slice(5)],
    ["🐢", "Wooden spoon", spoon.name, spoon.totalScore + " pts"],
  ];
  awards.forEach(([ico, t, w, d]) => {
    const a = el("div", "award");
    a.innerHTML = `<div class="ico">${ico}</div><div><div class="t">${t}</div><div class="w">${w}</div><div class="d">${d}</div></div>`;
    box.appendChild(a);
  });
}

// ============ toggles ============
function makeToggle(host, options, initial, onChange) {
  host.innerHTML = ""; // idempotent: clear any prior toggle from a previous mount
  const box = el("div", "toggle");
  options.forEach((o) => {
    const b = el("button", o.key === initial ? "on" : null, o.label);
    b.addEventListener("click", () => { box.querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); onChange(o.key); });
    box.appendChild(b);
  });
  host.appendChild(box);
}

// ============ Performance bar (metric toggle) ============
const PERF = {
  points: { label: "Points", val: (a) => a.points },
  correct: { label: "Correct picks", val: (a) => a.exact + a.partial },
  exact: { label: "Exact scores", val: (a) => a.exact },
};
function perfData() {
  const val = PERF[perfMetric].val;
  return M.accuracy.map((a) => ({ name: a.name, v: val(a) })).sort((x, y) => y.v - x.v);
}
function renderPerf() {
  const rows = perfData();
  charts.perf && charts.perf.destroy();
  charts.perf = new Chart($("#perfChart"), {
    type: "bar",
    data: { labels: rows.map((r) => r.name), datasets: [{
      data: rows.map((r) => r.v),
      backgroundColor: (c) => isSel(rows[c.dataIndex]?.name) ? accentBar(c) : MUTED,
      hoverBackgroundColor: (c) => isSel(rows[c.dataIndex]?.name) ? ACCENT2 : "#7dd3fc",
      borderColor: (c) => isSel(rows[c.dataIndex]?.name) ? ACCENT2 : "transparent",
      borderWidth: 1.5, borderRadius: 8, borderSkipped: false,
    }]},
    options: {
      indexAxis: "y", maintainAspectRatio: false,
      layout: { padding: { right: 34 } }, // room for end-aligned value labels
      plugins: { legend: { display: false },
        tooltip: { callbacks: {
          title: (items) => rows[items[0].dataIndex]?.name || "",
          label: (item) => `${PERF[perfMetric].label}: ${item.formattedValue}` } },
        datalabels: { display: true, anchor: "end", align: "end", color: "#cdd3ee", font: { weight: 700, size: 11 }, formatter: (v) => v } },
      animation: { delay: (c) => c.type === "data" && c.mode === "default" ? c.dataIndex * 35 : 0 },
      scales: { x: { beginAtZero: true, grid: { color: "rgba(255,255,255,.05)" } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } },
    },
  });
}

// ============ Race / Bump (points vs rank) ============
function rankSeries() {
  // cumulative values per date -> ranks
  const cum = M.race.series.map((s) => s.data);
  return M.race.series.map((s, i) => ({
    name: s.name,
    data: M.race.dates.map((_, d) => {
      const v = cum[i][d];
      return 1 + cum.filter((c) => c[d] > v).length; // 1 = best
    }),
  }));
}
function renderRace() {
  const series = raceMode === "points" ? M.race.series : rankSeries();
  const unit = raceMode === "points" ? " pts" : "";
  const prefix = raceMode === "points" ? "" : "rank #";
  charts.race && charts.race.destroy();
  charts.race = new Chart($("#raceChart"), {
    type: "line",
    data: { labels: M.race.dates.map((d) => d.slice(5)),
      datasets: series.map((s) => {
        const me = isSel(s.name);
        return { label: s.name, data: s.data,
          borderColor: me ? ACCENT2 : MUTED, backgroundColor: "transparent",
          borderWidth: me ? 4 : 1.5, pointRadius: 0, pointHoverRadius: me ? 7 : 6,
          pointHoverBackgroundColor: me ? ACCENT2 : "#7dd3fc", pointHoverBorderColor: "#0b0e1f", pointHoverBorderWidth: 2,
          hoverBorderWidth: me ? 5 : 3.5, hoverBorderColor: me ? ACCENT2 : "#7dd3fc",
          tension: raceMode === "points" ? 0.3 : 0.25, order: me ? 0 : 1,
          datalabels: me ? { display: (c) => c.dataIndex === s.data.length - 1, align: "left", anchor: "start",
            color: ACCENT2, font: { weight: 700, size: 11 }, formatter: () => s.name } : { display: false } };
      }) },
    options: { maintainAspectRatio: false, interaction: { mode: "nearest", intersect: false, axis: "xy" },
      hoverBorderWidth: 4,
      plugins: { legend: { display: false },
        tooltip: { displayColors: false, filter: (item, index) => index === 0, callbacks: {
          title: (items) => items[0]?.dataset.label || "",
          label: (item) => `${M.race.dates[item.dataIndex]} · ${prefix}${item.formattedValue}${unit}` } } },
      scales: { x: { grid: { display: false } },
        y: raceMode === "points" ? { beginAtZero: true, grid: { color: "rgba(255,255,255,.05)" } }
          : { reverse: true, min: 1, max: names.length, ticks: { stepSize: 1 }, grid: { color: "rgba(255,255,255,.05)" }, title: { display: true, text: "rank" } } },
    },
  });
}

// ============ Accuracy stacked ============
function renderAcc() {
  const acc = M.accuracy.slice().sort((a, b) => (b.exact + b.partial) - (a.exact + a.partial));
  charts.acc && charts.acc.destroy();
  charts.acc = new Chart($("#accChart"), {
    type: "bar",
    data: { labels: acc.map((a) => a.name), datasets: [
      { label: "Exact (3)", data: acc.map((a) => a.exact), backgroundColor: GOOD, borderRadius: 4 },
      { label: "Result (1)", data: acc.map((a) => a.partial), backgroundColor: WARN, borderRadius: 4 },
      { label: "Miss (0)", data: acc.map((a) => a.miss), backgroundColor: BAD, borderRadius: 4 },
    ]},
    options: { indexAxis: "y", maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: { callbacks: { afterTitle: (t) => isSel(acc[t[0].dataIndex].name) ? "← you" : "" } } },
      scales: { x: { stacked: true, beginAtZero: true, grid: { color: "rgba(255,255,255,.05)" } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 },
          color: (c) => isSel(acc[c.index]?.name) ? ACCENT2 : "#9aa3c4" } } },
    },
  });
}

// ============ Regional radar ============
function renderRegion() {
  const p = M.regionByPlayer.find((r) => r.name === selected);
  const labels = M.continents;
  const get = (cells, cont) => { const c = cells.find((x) => x.continent === cont); return c ? c[regionMetric] : 0; };
  // group average
  const avg = labels.map((cont) => {
    const vals = M.regionByPlayer.map((r) => get(r.cells, cont));
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  });
  charts.region && charts.region.destroy();
  charts.region = new Chart($("#regionChart"), {
    type: "radar",
    data: { labels, datasets: [
      { label: "Group avg", data: avg, borderColor: "rgba(154,163,196,.5)", backgroundColor: "rgba(154,163,196,.08)", borderWidth: 1.5, pointRadius: 2 },
      { label: selected, data: labels.map((c) => get(p.cells, c)), borderColor: ACCENT2,
        backgroundColor: "rgba(217,70,239,.18)", borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: ACCENT2 },
    ]},
    options: { maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { boxWidth: 12, usePointStyle: true } } },
      scales: { r: { beginAtZero: true, grid: { color: "rgba(255,255,255,.08)" }, angleLines: { color: "rgba(255,255,255,.08)" },
        pointLabels: { color: "#cdd3ee", font: { size: 12 } }, ticks: { backdropColor: "transparent", color: "#6b7299" } } },
    },
  });
}

// ============ Style scatter (bravery / contrarian) ============
function renderStyle() {
  const src = styleMode === "bravery"
    ? M.bravery.map((b) => ({ name: b.name, x: b.avgGoals, y: b.points, r: 6 + b.boldShare * 16 }))
    : M.contrarian.map((c) => ({ name: c.name, x: Math.round(c.contrarianShare * 100), y: c.points, r: 9 }));
  charts.style && charts.style.destroy();
  charts.style = new Chart($("#styleChart"), {
    type: "bubble",
    data: { datasets: [{
      data: src.map((d) => ({ x: d.x, y: d.y, r: d.r, name: d.name })),
      backgroundColor: src.map((d) => isSel(d.name) ? "rgba(217,70,239,.85)" : "rgba(86,180,233,.45)"),
      borderColor: src.map((d) => isSel(d.name) ? ACCENT2 : "transparent"), borderWidth: 2,
    }]},
    options: { maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.raw.name}: ${c.raw.x}${styleMode === "contrarian" ? "%" : " g/m"}, ${c.raw.y} pts` } },
        datalabels: { display: (c) => isSel(c.dataset.data[c.dataIndex].name), color: "#fff", font: { weight: 700, size: 10 }, formatter: (v) => v.name } },
      scales: {
        x: { title: { display: true, text: styleMode === "bravery" ? "goals/match predicted (bolder →)" : "contrarian % (vs crowd →)" }, grid: { color: "rgba(255,255,255,.05)" } },
        y: { title: { display: true, text: "points" }, beginAtZero: true, grid: { color: "rgba(255,255,255,.05)" } } },
    },
  });
}

// ============ Best-days heatmap (with rich hover tooltip) ============
let hmTip;
function ensureTip() {
  if (!hmTip) { hmTip = el("div"); hmTip.id = "hmTooltip"; document.body.appendChild(hmTip); }
  return hmTip;
}
// "England 3 [2] - [1] 1 Brazil" — actual scores plain, bets in [brackets].
function dayTipHTML(r, d) {
  const pts = r.perDate[d] || 0;
  const ms = (r.matchesByDate[d] || []).filter((m) => m.outcome !== 0).sort((a, b) => b.outcome - a.outcome);
  let h = `<div class="h">${r.name} · ${d} · ${pts} pts</div>`;
  if (!ms.length) h += `<div class="tsub">No points this day</div>`;
  else h += ms.map((m) =>
    `<div class="mline ${m.outcome === 3 ? "ex" : "pa"}">${m.aName} ${m.s1} [${m.pa}] - [${m.pb}] ${m.s2} ${m.bName}</div>`).join("");
  return h;
}
function placeTip(e) {
  const t = ensureTip(), pad = 16;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + t.offsetWidth > innerWidth) x = e.clientX - t.offsetWidth - pad;
  if (y + t.offsetHeight > innerHeight) y = e.clientY - t.offsetHeight - pad;
  t.style.left = x + "px"; t.style.top = y + "px";
}
function renderBestDays() {
  const hm = $("#bestDaysHeat"); hm.innerHTML = "";
  const dates = M.race.dates;
  const rows = M.bestDays.slice().sort((a, b) => byName[a.name].rank - byName[b.name].rank);
  const maxV = Math.max(1, ...rows.flatMap((r) => dates.map((d) => r.perDate[d] || 0)));
  hm.style.gridTemplateColumns = `150px repeat(${dates.length},1fr)`;
  hm.appendChild(el("div", "lbl"));
  dates.forEach((d) => hm.appendChild(el("div", "lbl col", d.slice(5))));
  rows.forEach((r) => {
    hm.appendChild(el("div", "lbl row" + (isSel(r.name) ? " sel" : ""), r.name));
    dates.forEach((d) => {
      const v = r.perDate[d] || 0, t = v / maxV;
      const c = el("div", "cell", v || "");
      c.style.background = v ? `hsl(${265 - t * 20},80%,${30 + t * 35}%)` : "rgba(255,255,255,.04)";
      c.addEventListener("mouseenter", (e) => { ensureTip().innerHTML = dayTipHTML(r, d); hmTip.style.display = "block"; placeTip(e); });
      c.addEventListener("mousemove", placeTip);
      c.addEventListener("mouseleave", () => { if (hmTip) hmTip.style.display = "none"; });
      hm.appendChild(c);
    });
  });
}

// ============ Similarity heatmap ============
function renderSim() {
  const hm = $("#simHeat"); hm.innerHTML = "";
  const { names: nm, matrix } = M.similarity; const n = nm.length;
  hm.style.gridTemplateColumns = `120px repeat(${n},1fr)`;
  hm.appendChild(el("div", "lbl"));
  nm.forEach((x) => hm.appendChild(el("div", "lbl col" + (isSel(x) ? " sel" : ""), x)));
  matrix.forEach((row, i) => {
    hm.appendChild(el("div", "lbl row" + (isSel(nm[i]) ? " sel" : ""), nm[i]));
    row.forEach((v, j) => {
      const c = el("div", "cell", i === j ? "" : v);
      c.style.background = i === j ? "rgba(255,255,255,.06)" : `hsl(${120 * v / 100},65%,${32 + v * 0.22}%)`;
      c.title = `${nm[i]} vs ${nm[j]}: ${v}%`;
      hm.appendChild(c);
    });
  });
}

// ============ Nemesis / Banker lists (expandable) ============
function scorerLine(s) {
  const d = el("div", "scorer");
  d.innerHTML = `<span class="dot" style="background:${s.outcome === 3 ? GOOD : WARN}"></span>` +
    `<b>${s.name}</b><span class="bet">[${s.pa}]–[${s.pb}]</span>`;
  return d;
}
function matchBox(m, kind) {
  const wrap = el("div", "matchwrap");
  const big = kind === "nemesis" ? Math.round(m.groupHitRate * 100) : Math.round(m.groupExactRate * 100);
  const head = el("div", "match exp");
  head.innerHTML =
    `<div class="score num">${(m.actual || "").replace("-", "–")}</div>` +
    `<div class="info"><div class="teams">${m.aName} vs ${m.bName}</div><div class="sub">${m.date.slice(5)} · ${m.continents.join(" / ")} · ${m.scorers.length} scored</div></div>` +
    `<div class="pct ${kind === "nemesis" ? "bad" : "good"}">${big}%<div class="sub" style="font-weight:500">${kind === "nemesis" ? "got result" : "exact"}</div></div>` +
    `<div class="chev">▸</div>`;
  const panel = el("div", "expand");
  const exact = m.scorers.filter((s) => s.outcome === 3);
  const partial = m.scorers.filter((s) => s.outcome === 2);
  if (!m.scorers.length) panel.appendChild(el("div", "tsub", "Nobody got the result 😬"));
  if (exact.length) { panel.appendChild(el("div", "tsub", `🎯 Exact score (${exact.length})`)); exact.forEach((s) => panel.appendChild(scorerLine(s))); }
  if (partial.length) { panel.appendChild(el("div", "tsub", `✓ Right result (${partial.length})`)); partial.forEach((s) => panel.appendChild(scorerLine(s))); }
  head.addEventListener("click", () => { head.classList.toggle("open"); panel.classList.toggle("show"); });
  wrap.appendChild(head); wrap.appendChild(panel);
  return wrap;
}
function renderMatches() {
  const nb = $("#nemesisList"); nb.innerHTML = ""; M.nemesis.forEach((m) => nb.appendChild(matchBox(m, "nemesis")));
  const bb = $("#bankerList"); bb.innerHTML = ""; M.bankers.forEach((m) => bb.appendChild(matchBox(m, "banker")));
}

// ============ confetti ============
function celebrate() {
  if (!window.confetti) return;
  const p = byName[selected];
  if (p && p.rank === 1) window.confetti({ particleCount: 140, spread: 75, origin: { y: 0.5 }, colors: ["#ffd24a", "#a855f7", "#d946ef", "#22d3ee"] });
}

// ============ orchestrate ============
function rerender() {
  renderPodium(); renderStats();
  renderPerf(); renderRace(); renderAcc(); renderRegion(); renderStyle();
  renderBestDays(); renderSim();
}

// (Re)build the entire dashboard for one group's metrics. Idempotent — safe to
// call repeatedly (group switch / live refresh).
function mount(metrics) {
  M = metrics;
  charts = {};
  perfMetric = "points"; raceMode = "points"; regionMetric = "ppg"; styleMode = "bravery";

  // Destroy any Chart.js instances still bound to our canvases (prevents the
  // "Canvas is already in use" error on a re-mount).
  ["perfChart", "regionChart", "raceChart", "styleChart", "accChart"].forEach((id) => {
    const cv = document.getElementById(id);
    if (cv) Chart.getChart(cv)?.destroy();
  });

  byName = Object.fromEntries(M.players.map((p) => [p.name, p]));
  names = M.standings.map((s) => s.name);
  const savedSel = (() => { try { return localStorage.getItem(SEL_KEY); } catch { return null; } })();
  selected = (names.includes(savedSel) && savedSel)
    || (M.players.find((p) => p.rank === M.group?.userRank)?.name)
    || names[0];

  // header
  $("#groupName").textContent = M.group?.name || "Predictions Cup";
  const pulledAtLocal = (() => {
    if (!M.pulledAt) return "";
    const d = new Date(M.pulledAt);
    if (isNaN(d)) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  $("#meta").textContent = `${M.group?.membersCount ?? names.length} players · ${M.finishedCount}/${M.totalGames} matches played · ${pulledAtLocal}`;

  // "Viewing as" — rebuild fresh each mount (replace node to drop old listeners)
  const oldSel = $("#playerSelect");
  const sel = oldSel.cloneNode(false);
  oldSel.replaceWith(sel);
  M.standings.forEach((s) => {
    const o = el("option", null, `#${s.rank}  ${s.name}`);
    o.value = s.name;
    sel.appendChild(o);
  });
  sel.value = selected;
  sel.addEventListener("change", () => { selected = sel.value; try { localStorage.setItem(SEL_KEY, selected); } catch {} rerender(); celebrate(); });

  renderAwards(); renderMatches();
  makeToggle($("#perfToggle"), Object.keys(PERF).map((k) => ({ key: k, label: PERF[k].label })), perfMetric, (k) => { perfMetric = k; renderPerf(); });
  makeToggle($("#raceToggle"), [{ key: "points", label: "Points" }, { key: "rank", label: "Rank" }], raceMode, (k) => { raceMode = k; renderRace(); });
  makeToggle($("#regionToggle"), [{ key: "ppg", label: "Pts / game" }, { key: "hitRate", label: "Hit rate" }], regionMetric, (k) => { regionMetric = k; renderRegion(); });
  makeToggle($("#styleToggle"), [{ key: "bravery", label: "Bravery" }, { key: "contrarian", label: "Contrarian" }], styleMode, (k) => { styleMode = k; renderStyle(); });
  rerender();
  setTimeout(celebrate, 400);
}

// ============ boot: slug → data → group select → mount ============
const SITE_ROOT = new URL('../', import.meta.url);
const GROUP_KEY = (slug) => `selectedGroup:${slug}`;

// Clean "nothing to show" state: hide the (empty) dashboard body and explain.
function emptyState(title, detail) {
  const w = document.querySelector(".wrap"); if (w) w.style.display = "none";
  const f = document.querySelector("footer"); if (f) f.style.display = "none";
  const g = $("#groupName"); if (g) g.textContent = title;
  const m = $("#meta"); if (m) m.textContent = detail || "";
}

function slugFromPath() {
  const segs = location.pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1] || "";
  if (!last || last === "index.html" || last === "404.html") return "";
  return decodeURIComponent(last);
}

function setStatus(html) { const s = $("#refreshStatus"); if (s) s.innerHTML = html; }
const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

async function boot() {
  const slug = slugFromPath();
  const gsel = $("#groupSelect");
  let map = null, currentGid = null, lastJson = null;

  // (Re)build the group <select> options to match the current map.
  function syncGroupOptions(ids) {
    gsel.innerHTML = "";
    ids.forEach((gid) => { const o = el("option", null, (map[gid]?.group?.name) || `Group ${gid}`); o.value = gid; gsel.appendChild(o); });
  }

  // First render: reveal the body, build the switcher, mount the saved/first group.
  function renderMap(m) {
    map = m;
    const ids = Object.keys(map || {});
    if (!ids.length) return false;
    const w = document.querySelector(".wrap"); if (w) w.style.display = "";
    const f = document.querySelector("footer"); if (f) f.style.display = "";
    syncGroupOptions(ids);
    const saved = (() => { try { return localStorage.getItem(GROUP_KEY(slug)); } catch { return null; } })();
    currentGid = ids.includes(saved) ? saved : ids[0];
    gsel.value = currentGid;
    mount(map[currentGid]);
    return true;
  }

  // Poll update: swap in fresh data and re-render the *current* group, keeping
  // the user's group choice (player choice is restored by mount via localStorage).
  // Rebuilds the switcher only if the set of groups actually changed.
  function applyUpdate(m) {
    const oldIds = Object.keys(map || {});
    map = m;
    const ids = Object.keys(map);
    if (!ids.length) return;
    if (ids.length !== oldIds.length || ids.some((id, i) => id !== oldIds[i])) syncGroupOptions(ids);
    if (!ids.includes(currentGid)) currentGid = ids[0];
    gsel.value = currentGid;
    mount(map[currentGid]);
    setStatus(`Updated ${hhmm(new Date())}`);
  }

  gsel.addEventListener("change", () => {
    currentGid = gsel.value;
    try { localStorage.setItem(GROUP_KEY(slug), currentGid); } catch {}
    mount(map[currentGid]);
  });

  if (!slug) { emptyState("Pick a dashboard", "Add a name to the URL, e.g. /your-name"); return; }

  const SNAP_URL = new URL(`data/${encodeURIComponent(slug)}.json`, SITE_ROOT);

  // Fetch the server-built snapshot. Returns { text, map } or null on miss.
  // `text` is kept verbatim for change detection — build.mjs leaves the file
  // byte-for-byte identical when no real data moved, so a text change == new data.
  async function fetchSnapshot() {
    const res = await fetch(SNAP_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text();
    return { text, map: JSON.parse(text) };
  }

  // Ask the Worker to trigger a fresh server build. Fire-and-forget — the Worker
  // throttles to ~1 build/min globally, so it's fine to call on every poll.
  function pingRefresh() {
    if (!REFRESH_ENDPOINT) return;
    fetch(REFRESH_ENDPOINT, { method: "POST", keepalive: true }).catch(() => {});
  }

  // ---- initial load ----
  let snap = null;
  try { snap = await fetchSnapshot(); } catch { /* keep polling below */ }
  if (snap && renderMap(snap.map)) {
    lastJson = snap.text;
    setStatus("Auto-updating");
  } else {
    emptyState(`No data yet for “${slug}”`,
      "This fills in automatically once the owner adds this user’s token and the next refresh runs. Hang tight — the page keeps checking.");
  }

  // ---- 30s poll: nudge a fresh build, pull the latest snapshot, re-render on change ----
  async function tick() {
    if (document.hidden) return; // don't poll a backgrounded tab
    pingRefresh();
    let s = null;
    try { s = await fetchSnapshot(); } catch { return; }
    if (!s || s.text === lastJson) return; // nothing new since last render
    lastJson = s.text;
    if (map) applyUpdate(s.map);
    else if (renderMap(s.map)) setStatus(`Updated ${hhmm(new Date())}`);
  }
  setInterval(tick, POLL_MS);
}

boot();
