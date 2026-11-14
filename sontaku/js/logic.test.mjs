import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyHand,
  judge,
  lockGesture,
  losingHand,
  sanitizeLogs,
  summarize,
  toCsv,
} from "./logic.mjs";

function hand(openNames) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8 }));
  points[0] = { x: 0.5, y: 0.92 };
  points[1] = { x: 0.72, y: 0.78 };
  points[2] = { x: 0.78, y: 0.68 };
  points[3] = { x: 0.8, y: 0.6 };
  points[4] = { x: 0.78, y: 0.52 };

  const fingers = [
    { name: "index", mcp: 5, pip: 6, dip: 7, tip: 8, x: 0.62 },
    { name: "middle", mcp: 9, pip: 10, dip: 11, tip: 12, x: 0.52 },
    { name: "ring", mcp: 13, pip: 14, dip: 15, tip: 16, x: 0.42 },
    { name: "pinky", mcp: 17, pip: 18, dip: 19, tip: 20, x: 0.34 },
  ];

  for (const finger of fingers) {
    const open = openNames.includes(finger.name);
    points[finger.mcp] = { x: finger.x, y: 0.62 };
    if (open) {
      points[finger.pip] = { x: finger.x + 0.02, y: 0.42 };
      points[finger.dip] = { x: finger.x + 0.03, y: 0.3 };
      points[finger.tip] = { x: finger.x + 0.04, y: 0.16 };
    } else {
      points[finger.pip] = { x: finger.x + 0.03, y: 0.52 };
      points[finger.dip] = { x: finger.x + 0.01, y: 0.64 };
      points[finger.tip] = { x: finger.x - 0.02, y: 0.72 };
    }
  }
  return points;
}

test("losing hand always loses to the recognized hand", () => {
  for (const opponent of ["rock", "scissors", "paper"]) {
    const self = losingHand(opponent);
    assert.equal(judge(self, opponent), "lose");
    assert.notEqual(self, opponent);
  }
});

test("classifies the three janken shapes and rejects ambiguous hands", () => {
  assert.equal(classifyHand(hand([])), "rock");
  assert.equal(classifyHand(hand(["index", "middle"])), "scissors");
  assert.equal(
    classifyHand(hand(["index", "middle", "ring", "pinky"])),
    "paper",
  );
  assert.equal(classifyHand(hand(["index", "middle", "ring"])), "paper");
  assert.equal(classifyHand(hand(["index"])), null);
  assert.equal(classifyHand(hand(["index", "middle", "pinky"])), null);
  assert.equal(classifyHand(null), null);
  assert.equal(classifyHand([]), null);
});

test("locks a gesture only after consecutive agreement", () => {
  const samples = [
    { t: 0, g: "rock" },
    { t: 40, g: "rock" },
    { t: 80, g: "paper" },
    { t: 120, g: "paper" },
    { t: 160, g: "paper" },
    { t: 200, g: "paper" },
  ];
  assert.equal(lockGesture(samples, 200), "paper");
  assert.equal(lockGesture(samples.slice(0, 3), 80), null);
  assert.equal(
    lockGesture(
      [
        { t: 0, g: "rock" },
        { t: 30, g: null },
        { t: 60, g: "rock" },
        { t: 90, g: "rock" },
      ],
      90,
    ),
    null,
  );
});

test("summarizes wins from the human's point of view", () => {
  const logs = [
    { t: 1, opponent: "rock", self: "scissors", outcome: "lose" },
    { t: 2, opponent: "paper", self: "rock", outcome: "lose" },
    { t: 3, opponent: null, self: null, outcome: "unread" },
    { t: 4, opponent: "scissors", self: "paper", outcome: "lose" },
  ];
  const summary = summarize(logs);
  assert.deepEqual(summary.cumulative, [1, 2, 2, 3]);
  assert.equal(summary.lose, 3);
  assert.equal(summary.unread, 1);
  assert.equal(summary.streak, 1);
  assert.equal(summary.sontakuRate, 1);
  assert.deepEqual(summary.hands, { rock: 1, scissors: 1, paper: 1 });
});

test("streak resets when sontaku fails", () => {
  const summary = summarize([
    { t: 1, opponent: "rock", self: "scissors", outcome: "lose" },
    { t: 2, opponent: "rock", self: "paper", outcome: "win" },
    { t: 3, opponent: "paper", self: "rock", outcome: "lose" },
  ]);
  assert.equal(summary.streak, 1);
  assert.equal(summary.win, 1);
  assert.equal(summary.sontakuRate, 2 / 3);
});

test("csv quotes commas and maps labels", () => {
  const csv = toCsv([
    { t: Date.UTC(2026, 0, 2, 3, 4, 5), opponent: "paper", self: "rock", outcome: "lose" },
  ]);
  assert.match(csv.split("\r\n")[0], /^日時,相手の手,こちらの手,結果$/);
  assert.match(csv, /パー,グー,あなたの勝ち/);
});

test("sanitize drops broken rows and caps history", () => {
  const raw = [
    { t: 1, outcome: "nope" },
    null,
    { t: 2, outcome: "lose" },
    ...Array.from({ length: 250 }, (_, i) => ({ t: i + 10, outcome: "draw" })),
  ];
  const clean = sanitizeLogs(raw);
  assert.equal(clean.length, 200);
  assert.equal(clean[0].outcome, "draw");
});
