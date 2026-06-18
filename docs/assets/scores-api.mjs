// 365Scores Predictions Cup API client.
// Uses the global `fetch`, so it runs UNCHANGED in Node 18+ (build.mjs) and in
// the browser (live on-demand refresh). The API sends permissive CORS
// (`access-control-allow-origin: *`, allows the `authorization` header), so the
// browser can call it directly. We therefore send ONLY the Authorization header
// — adding others (Accept/Referer) would fail the CORS preflight in the browser.

export const API = "https://wcg-il.365scores.com";
export const LANG = 2;

const bearer = (token) => (/^Bearer\s/i.test(token) ? token : `Bearer ${token}`);

// GET an API path, returning parsed JSON. Throws on HTTP error or `{ ok:false }`.
export async function apiGet(token, path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: bearer(token) } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  const body = await res.json();
  if (body.ok === false) throw new Error(`API not ok for ${path}: ${body.errorMessage || body.errorCode}`);
  return body;
}

// All groups the token's user belongs to: [{ groupID, name, membersCount, userRank, invitationLink, ... }]
export async function fetchUserGroups(token) {
  const r = await apiGet(token, `/Groups/GetUserGroups?lang=${LANG}`);
  return r.groups || [];
}

// Consolidated snapshot for ONE group, in the exact shape analyze() consumes.
// Pass `meta` (a row from fetchUserGroups) to skip the extra GetUserGroups call
// — build.mjs fetches the user's groups once and reuses the metadata per group.
export async function fetchGroupSnapshot(token, groupId, meta = null) {
  if (!meta) {
    const groups = await fetchUserGroups(token);
    meta = groups.find((g) => String(g.groupID) === String(groupId)) || null;
  }

  const tableResp = await apiGet(token, `/Groups/GetGroupTable?lang=${LANG}&groupID=${groupId}`);
  const members = tableResp.table?.members || [];

  const tournament = await apiGet(token, `/Tournament/GetTournamentInfo?lang=${LANG}`).catch(() => null);

  // Each member's full prediction history (in parallel — groups are small).
  const predictions = {};
  await Promise.all(
    members.map(async (m) => {
      try {
        const r = await apiGet(token, `/Games/GetAllGamesForOtherUser?lang=${LANG}&otherUserId=${m.userID}`);
        predictions[m.userID] = {
          userID: m.userID,
          name: m.name,
          winnerTeamID: r.winnerTeamID,
          winnerTeamName: r.winnerTeamName,
          topScorerID: r.topScorerID,
          topScorerName: r.topScorerName,
          games: r.games || [],
        };
      } catch { /* skip a member that fails — partial snapshot is fine */ }
    })
  );

  return {
    pulledAt: new Date().toISOString(),
    api: API,
    group: {
      groupID: meta?.groupID ?? Number(groupId),
      name: meta?.name ?? `Group ${groupId}`,
      membersCount: meta?.membersCount ?? members.length,
      invitationLink: meta?.invitationLink ?? null,
      userRank: meta?.userRank ?? null,
    },
    leaderboard: members,
    predictions,
    tournament,
  };
}
