// Build the self-contained interactive HTML shell. All logic lives in
// assets/dashboard.js; metrics are injected as window.METRICS.

export function renderHTML(m, { assets = "./assets" } = {}) {
  const data = JSON.stringify(m).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.group?.name || "Predictions")} — Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${assets}/dashboard.css">
</head>
<body>
<header>
  <div class="brand"><h1 id="groupName"></h1><div class="meta" id="meta"></div></div>
  <div class="viewer">
    <label for="playerSelect">Viewing&nbsp;as</label>
    <select id="playerSelect"></select><span class="chev">▾</span>
  </div>
</header>

<div class="wrap">
  <div class="section-title">🏆 Podium</div>
  <div class="card col12"><div class="podium" id="podium"></div></div>

  <div class="section-title">⭐ Your card <span style="color:var(--muted2);text-transform:none;letter-spacing:0">— changes with the dropdown</span></div>
  <div class="stats" id="statCards"></div>

  <div class="section-title">🥇 Group awards</div>
  <div class="awards" id="awards"></div>

  <div class="section-title">📊 Performance</div>
  <div class="grid">
    <div class="card col8" id="card-perf"><h2>Leaderboard</h2><div id="perfToggle"></div><div class="hint">Switch the metric — points, correct picks, exact scores, or a normalized blend.</div><div class="chartbox xl"><canvas id="perfChart"></canvas></div></div>
    <div class="card col4" id="card-region"><h2>By region 🌍</h2><div id="regionToggle"></div><div class="hint">Selected player vs group average across continents.</div><div class="chartbox" style="height:430px"><canvas id="regionChart"></canvas></div></div>

    <div class="card col8" id="card-race"><h2>The race</h2><div id="raceToggle"></div><div class="hint">Cumulative points, or rank position, over each match day.</div><div class="chartbox tall"><canvas id="raceChart"></canvas></div></div>
    <div class="card col4" id="card-style"><h2>Playing style</h2><div id="styleToggle"></div><div class="hint">Does boldness or going against the crowd pay off?</div><div class="chartbox tall"><canvas id="styleChart"></canvas></div></div>

    <div class="card col12" id="card-acc"><h2>Accuracy breakdown</h2><div class="hint">Exact = 3 pts · right result = 1 pt · miss = 0, over ${m.finishedCount} matches.</div><div class="chartbox xl"><canvas id="accChart"></canvas></div></div>
  </div>

  <div class="section-title">🗓️ Best days</div>
  <div class="card col12" id="card-bestdays"><h2>Points by match day</h2><div class="hint">Brighter = bigger haul that day. Your row is highlighted.</div><div class="hm" id="bestDaysHeat"></div></div>

  <div class="section-title">😈 Nemesis &amp; bankers</div>
  <div class="grid">
    <div class="card col6" id="card-nemesis"><h2>Nemesis matches</h2><div class="hint">The chaos games — fewest players got the result.</div><div class="matchlist" id="nemesisList"></div></div>
    <div class="card col6" id="card-banker"><h2>Banker matches</h2><div class="hint">The obvious ones — most players nailed the exact score.</div><div class="matchlist" id="bankerList"></div></div>
  </div>

  <div class="section-title">🧬 Similarity</div>
  <div class="card col12" id="card-sim"><h2>Who predicts alike</h2><div class="hint">% of identical exact picks between every pair of players.</div><div class="hm" id="simHeat"></div></div>
</div>

<footer>Generated from 365Scores Predictions Cup · group ${m.group?.groupID} · snapshot ${esc((m.pulledAt || "").slice(0, 10))}</footer>

<script>window.METRICS = ${data};</script>
<script src="${assets}/chart.umd.min.js"></script>
<script src="${assets}/chartjs-plugin-datalabels.min.js"></script>
<script src="${assets}/countUp.umd.js"></script>
<script src="${assets}/confetti.browser.js"></script>
<script src="${assets}/dashboard.js"></script>
</body>
</html>`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
