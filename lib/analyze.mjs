// Turn a consolidated group snapshot into the metrics the dashboard renders.
// Pure functions — no IO beyond reading the snapshot file.

import { readFile } from "node:fs/promises";
import { CONTINENTS, continentOf } from "./continents.mjs";

const num = (v) => (v == null ? 0 : Number(v));
const STATUS_FINISHED = 3;
const EXACT = 3, PARTIAL = 2; // betOutcome: 3 = exact score, 2 = right result, 0 = miss
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export async function loadSnapshot(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function analyze(snap) {
  const members = snap.leaderboard || [];
  const preds = snap.predictions || {};
  const highlightRank = snap.group?.userRank ?? null;

  // ---------- Standings ----------
  const standings = members
    .map((m) => ({
      userID: m.userID,
      name: m.name.trim(),
      rank: num(m.rank),
      totalScore: num(m.totalScore),
      winner: m.winnerTeamName,
      topScorer: m.topScorerName,
      isMe: highlightRank != null && num(m.rank) === num(highlightRank),
    }))
    .sort((a, b) => a.rank - b.rank);

  const order = standings.map((s) => s.userID);
  const nameOf = Object.fromEntries(standings.map((s) => [s.userID, s.name]));

  // ---------- Normalised per-player finished bets ----------
  // bets[userID] = [{gameID,date,sel,outcome,points,a,b,contA,contB,actual,predGoals,predMargin}]
  const bets = {};
  for (const id of order) {
    const arr = [];
    for (const g of preds[id]?.games || []) {
      if (g.status !== STATUS_FINISHED || !g.gameBet?.selection) continue;
      const a = g.competitors?.[0], b = g.competitors?.[1];
      const sel = g.gameBet.selection;
      arr.push({
        gameID: g.gameID,
        date: g.startTime.slice(0, 10),
        sel: `${sel.team1}-${sel.team2}`,
        t1: sel.team1, t2: sel.team2,
        outcome: g.gameBet.betOutcome,
        points: num(g.gameBet.gainedPoints),
        a: a?.nameForUrl, b: b?.nameForUrl,
        aName: a?.name, bName: b?.name,
        contA: continentOf(a?.nameForUrl), contB: continentOf(b?.nameForUrl),
        actual: g.scores ? `${g.scores.team1}-${g.scores.team2}` : null,
        s1: g.scores?.team1, s2: g.scores?.team2,
        predGoals: sel.team1 + sel.team2,
        predMargin: Math.abs(sel.team1 - sel.team2),
      });
    }
    bets[id] = arr;
  }
  const playedCount = bets[order[0]]?.length || 0;

  // ---------- Accuracy ----------
  const accuracy = standings.map((s) => {
    let exact = 0, partial = 0, miss = 0, points = 0;
    for (const x of bets[s.userID]) {
      points += x.points;
      if (x.outcome === EXACT) exact++; else if (x.outcome === PARTIAL) partial++; else miss++;
    }
    const played = bets[s.userID].length || 1;
    return {
      name: s.name, isMe: s.isMe, exact, partial, miss, points, played,
      hitRate: round((exact + partial) / played, 3),
      exactRate: round(exact / played, 3),
      sharpness: round(exact / Math.max(1, exact + partial), 3), // of correct calls, share that were exact
    };
  });

  // ---------- Cumulative points race (by match day) ----------
  const dates = [...new Set(Object.values(bets).flat().map((x) => x.date))].sort();
  const race = {
    dates,
    series: standings.map((s) => {
      const perDate = Object.fromEntries(dates.map((d) => [d, 0]));
      for (const x of bets[s.userID]) perDate[x.date] += x.points;
      let acc = 0;
      return { name: s.name, isMe: s.isMe, data: dates.map((d) => (acc += perDate[d])) };
    }),
  };

  // ---------- Best days (per player: points + contributing matches per date) ----------
  const bestDays = standings.map((s) => {
    const perDate = Object.fromEntries(dates.map((d) => [d, 0]));
    const matchesByDate = {};
    for (const x of bets[s.userID]) {
      perDate[x.date] += x.points;
      (matchesByDate[x.date] ||= []).push({
        aName: x.aName, bName: x.bName, s1: x.s1, s2: x.s2,
        pa: x.t1, pb: x.t2, outcome: x.outcome, points: x.points,
      });
    }
    let best = { date: null, points: -1 };
    for (const d of dates) if (perDate[d] > best.points) best = { date: d, points: perDate[d] };
    return { name: s.name, isMe: s.isMe, perDate, matchesByDate, best };
  });

  // ---------- Performance by continent (matches involving each region) ----------
  // region[userID][continent] = {games, points, hits, exact}
  const region = {};
  for (const id of order) {
    const r = Object.fromEntries(CONTINENTS.map((c) => [c, { games: 0, points: 0, hits: 0, exact: 0 }]));
    for (const x of bets[id]) {
      for (const c of new Set([x.contA, x.contB])) {
        if (!r[c]) continue;
        r[c].games++; r[c].points += x.points;
        if (x.outcome !== 0) r[c].hits++;
        if (x.outcome === EXACT) r[c].exact++;
      }
    }
    region[id] = r;
  }
  // Per-player derived ppg/hitRate per continent + best/worst.
  const regionByPlayer = standings.map((s) => {
    const r = region[s.userID];
    const cells = CONTINENTS.map((c) => ({
      continent: c, ...r[c],
      ppg: r[c].games ? round(r[c].points / r[c].games, 2) : 0,
      hitRate: r[c].games ? round(r[c].hits / r[c].games, 3) : 0,
    }));
    const ranked = cells.filter((c) => c.games >= 3).sort((a, b) => b.ppg - a.ppg);
    return {
      name: s.name, isMe: s.isMe, cells,
      best: ranked[0] || null, worst: ranked[ranked.length - 1] || null,
    };
  });

  // ---------- Cross-player game index (for consensus / nemesis / banker) ----------
  const games = new Map();
  for (const id of order) {
    for (const x of bets[id]) {
      if (!games.has(x.gameID)) {
        games.set(x.gameID, {
          gameID: x.gameID, date: x.date, aName: x.aName, bName: x.bName,
          a: x.a, b: x.b, actual: x.actual, s1: x.s1, s2: x.s2,
          continents: [...new Set([x.contA, x.contB])], picks: {}, sels: [],
        });
      }
      const gi = games.get(x.gameID);
      gi.picks[id] = { sel: x.sel, outcome: x.outcome };
      gi.sels.push(x.sel);
    }
  }
  for (const gi of games.values()) {
    const n = Object.keys(gi.picks).length || 1;
    let hits = 0, exact = 0;
    for (const p of Object.values(gi.picks)) { if (p.outcome !== 0) hits++; if (p.outcome === EXACT) exact++; }
    gi.groupHitRate = round(hits / n, 3);
    gi.groupExactRate = round(exact / n, 3);
    // Modal exact selection (the consensus pick).
    const tally = {};
    for (const sel of gi.sels) tally[sel] = (tally[sel] || 0) + 1;
    gi.modalSel = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    gi.modalShare = round((tally[gi.modalSel] || 0) / n, 3);
  }
  const gameList = [...games.values()];

  // ---------- Contrarian index ----------
  const contrarian = standings.map((s) => {
    let diff = 0, tot = 0, contrarianPoints = 0, contrarianHits = 0;
    for (const x of bets[s.userID]) {
      const gi = games.get(x.gameID);
      tot++;
      if (gi.modalSel && x.sel !== gi.modalSel) { diff++; contrarianPoints += x.points; if (x.outcome !== 0) contrarianHits++; }
    }
    return {
      name: s.name, isMe: s.isMe,
      contrarianShare: round(diff / Math.max(1, tot), 3),
      contrarianHits, contrarianPicks: diff,
      points: accuracy.find((a) => a.name === s.name).points,
      hitRate: accuracy.find((a) => a.name === s.name).hitRate,
    };
  });

  // ---------- Bravery / risk index ----------
  const bravery = standings.map((s) => {
    const arr = bets[s.userID];
    const n = arr.length || 1;
    const avgGoals = round(arr.reduce((a, x) => a + x.predGoals, 0) / n, 2);
    const bold = arr.filter((x) => x.predMargin >= 2).length;
    const draws = arr.filter((x) => x.t1 === x.t2).length;
    const acc = accuracy.find((a) => a.name === s.name);
    return {
      name: s.name, isMe: s.isMe, avgGoals,
      boldShare: round(bold / n, 3), drawShare: round(draws / n, 3),
      points: acc.points, hitRate: acc.hitRate, exact: acc.exact,
    };
  });

  // ---------- Nemesis & banker matches (with per-player breakdown) ----------
  const enrich = (gi) => ({
    gameID: gi.gameID, date: gi.date, actual: gi.actual, s1: gi.s1, s2: gi.s2,
    aName: gi.aName, bName: gi.bName, continents: gi.continents,
    groupHitRate: gi.groupHitRate, groupExactRate: gi.groupExactRate,
    // Players who scored on this match (exact first, then right-result).
    scorers: order
      .filter((id) => gi.picks[id] && gi.picks[id].outcome !== 0)
      .map((id) => {
        const [pa, pb] = gi.picks[id].sel.split("-").map(Number);
        return { name: nameOf[id], pa, pb, outcome: gi.picks[id].outcome };
      })
      .sort((x, y) => y.outcome - x.outcome),
  });
  const nemesis = [...gameList].sort((a, b) => a.groupHitRate - b.groupHitRate).slice(0, 6).map(enrich);
  const bankers = [...gameList].sort((a, b) => b.groupExactRate - a.groupExactRate).slice(0, 6).map(enrich);

  // Per-player signature call: exact hit where fewest others were exact.
  const labelMatch = (gi) => `${gi.aName} ${gi.actual?.replace("-", "–")} ${gi.bName}`;
  const signature = {};
  for (const id of order) {
    let best = null;
    for (const x of bets[id]) {
      if (x.outcome !== EXACT) continue;
      const gi = games.get(x.gameID);
      if (!best || gi.groupExactRate < best.rate)
        best = { rate: gi.groupExactRate, match: labelMatch(gi), sel: x.sel, date: x.date };
    }
    signature[nameOf[id]] = best;
  }

  // ---------- Champion & top-scorer pick distributions ----------
  const tally = (key) => {
    const map = new Map();
    for (const s of standings) {
      const v = s[key] || "—";
      if (!map.has(v)) map.set(v, []);
      map.get(v).push(s.name);
    }
    return [...map.entries()].map(([label, names]) => ({ label, count: names.length, members: names }))
      .sort((a, b) => b.count - a.count);
  };
  const winners = tally("winner");
  const topScorers = tally("topScorer");

  // ---------- Similarity matrix ----------
  const names = standings.map((s) => s.name);
  const pickMaps = order.map((id) => new Map(bets[id].map((x) => [x.gameID, x.sel])));
  const matrix = pickMaps.map((pi) =>
    pickMaps.map((pj) => {
      let same = 0, tot = 0;
      for (const [gid, v] of pi) if (pj.has(gid)) { tot++; if (pj.get(gid) === v) same++; }
      return tot ? Math.round((same / tot) * 100) : 0;
    })
  );

  // ---------- Per-player bundle (for dropdown stat cards) ----------
  const players = standings.map((s) => {
    const acc = accuracy.find((a) => a.name === s.name);
    const reg = regionByPlayer.find((r) => r.name === s.name);
    const bd = bestDays.find((b) => b.name === s.name);
    const br = bravery.find((b) => b.name === s.name);
    const co = contrarian.find((c) => c.name === s.name);
    return {
      name: s.name, userID: s.userID, rank: s.rank, totalScore: s.totalScore,
      winner: s.winner, topScorer: s.topScorer,
      played: acc.played, exact: acc.exact, partial: acc.partial, miss: acc.miss,
      points: acc.points, hitRate: acc.hitRate, exactRate: acc.exactRate, sharpness: acc.sharpness,
      bestDay: bd.best, bestRegion: reg.best, worstRegion: reg.worst,
      avgGoals: br.avgGoals, boldShare: br.boldShare, contrarianShare: co.contrarianShare,
      signature: signature[s.name],
    };
  });

  return {
    group: snap.group,
    pulledAt: snap.pulledAt,
    finishedCount: playedCount,
    totalGames: (preds[order[0]]?.games || []).length,
    continents: CONTINENTS,
    standings, accuracy, race, bestDays, regionByPlayer,
    contrarian, bravery, nemesis, bankers, signature,
    winners, topScorers,
    similarity: { names, matrix },
    players,
  };
}
