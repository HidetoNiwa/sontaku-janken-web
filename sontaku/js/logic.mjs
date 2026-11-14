/** こちらの勝敗。lose は忖度成功（相手の勝ち）。 */

export const HANDS = ["rock", "scissors", "paper"];

export const HAND_LABEL = {
  rock: "グー",
  scissors: "チョキ",
  paper: "パー",
};

const LOSING = {
  rock: "scissors",
  scissors: "paper",
  paper: "rock",
};

const BEATS = {
  rock: "scissors",
  scissors: "paper",
  paper: "rock",
};

export function losingHand(opponent) {
  return LOSING[opponent] ?? null;
}

export function judge(self, opponent) {
  if (!self || !opponent) return "unread";
  if (self === opponent) return "draw";
  return BEATS[self] === opponent ? "win" : "lose";
}

export function outcomeLabel(outcome) {
  switch (outcome) {
    case "lose":
      return "あなたの勝ち";
    case "win":
      return "あなたの負け";
    case "draw":
      return "あいこ";
    case "unread":
      return "読み取れず";
    default:
      return "";
  }
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function fingerExtended(landmarks, tip, pip, mcp) {
  const wrist = landmarks[0];
  const tipReach = dist(landmarks[tip], wrist);
  const pipReach = dist(landmarks[pip], wrist);
  if (tipReach < pipReach * 1.12) return false;
  const span = dist(landmarks[tip], landmarks[mcp]);
  const segment = dist(landmarks[pip], landmarks[mcp]);
  return span > segment * 1.45;
}

/**
 * 21点の手ランドマークからグー / チョキ / パーを返す。
 * 曖昧な形は null。誤読のまま手を出すと勝ってしまうため、捨てる。
 */
export function classifyHand(landmarks) {
  if (!landmarks || landmarks.length < 21) return null;

  const index = fingerExtended(landmarks, 8, 6, 5);
  const middle = fingerExtended(landmarks, 12, 10, 9);
  const ring = fingerExtended(landmarks, 16, 14, 13);
  const pinky = fingerExtended(landmarks, 20, 18, 17);

  if (index && middle && !ring && !pinky) return "scissors";
  if (index && middle && ring) return "paper";
  if (!index && !middle && !ring && !pinky) return "rock";
  return null;
}

/**
 * 直近フレームが同じ手で揃っていれば、その手を確定する。
 * samples は { t, g } の古い順。
 */
export function lockGesture(samples, now) {
  const tail = samples.filter((sample) => now - sample.t <= 280).slice(-5);
  if (tail.length < 4) return null;
  const gesture = tail[tail.length - 1].g;
  if (!gesture) return null;
  const same = tail.filter((sample) => sample.g === gesture).length;
  return same >= 4 ? gesture : null;
}

export function summarize(logs) {
  const hands = { rock: 0, scissors: 0, paper: 0 };
  let lose = 0;
  let win = 0;
  let draw = 0;
  let unread = 0;
  let streak = 0;
  let running = 0;
  const cumulative = [];

  for (const log of logs) {
    if (log.opponent && hands[log.opponent] != null) hands[log.opponent] += 1;
    if (log.outcome === "lose") {
      lose += 1;
      running += 1;
      streak += 1;
    } else if (log.outcome === "win") {
      win += 1;
      streak = 0;
    } else if (log.outcome === "draw") {
      draw += 1;
      streak = 0;
    } else {
      unread += 1;
      streak = 0;
    }
    cumulative.push(running);
  }

  const decided = lose + win + draw;
  return {
    total: logs.length,
    lose,
    win,
    draw,
    unread,
    hands,
    streak,
    sontakuRate: decided ? lose / decided : null,
    cumulative,
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(logs) {
  const rows = ["日時,相手の手,こちらの手,結果"];
  for (const log of logs) {
    const when = new Date(log.t).toLocaleString("ja-JP");
    rows.push(
      [
        when,
        HAND_LABEL[log.opponent] ?? "",
        HAND_LABEL[log.self] ?? "",
        outcomeLabel(log.outcome),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return rows.join("\r\n");
}

export function sanitizeLogs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry) =>
        entry &&
        typeof entry.t === "number" &&
        ["lose", "win", "draw", "unread"].includes(entry.outcome),
    )
    .slice(-200);
}
