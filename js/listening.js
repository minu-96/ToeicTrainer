// 듣기 (Part 2 응답, Part 3 대화, Part 4 담화, 받아쓰기)
import * as srs from './srs.js';

export const LC_TARGET_MS = 60000; // 음성 길이가 달라서 시간 감점은 거의 안 함
export const DAILY_P2 = 10;
export const DICT_N = 5;
export const REASONS = [
  ['listen', '못 알아들음'],
  ['trap', '함정에 걸림'],
  ['meaning', '뜻 몰라서'],
  ['mistake', '실수'],
];
export const TYPE_NAMES = { lc2: 'Part 2 응답', lc3: 'Part 3 대화', lc4: 'Part 4 담화' };

function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
const ORDER = ['basic', 'mid', 'adv'];
// 시작 수준 → 위 수준 → 아래 수준
function rankOf(settings) {
  const start = ORDER.indexOf(settings?.startLevel || 'basic');
  return (x) => {
    const i = ORDER.indexOf(x.level);
    return i >= start ? i - start : 10 + (start - i);
  };
}
const usable = (state, list) => {
  const reported = new Set((state.reports || []).map((r) => r.targetId));
  return list.filter((q) => !reported.has(q.id));
};

// Part 2 오늘의 문제: 다시 들을 문제 → 안 들은 문제(내 수준부터) → 오래전에 푼 문제
export function buildPart2(state, items, settings, t, n = DAILY_P2) {
  const pool = usable(state, items);
  const due = shuffle(pool.filter((q) => state.qprog[q.id]?.srs?.due <= t));
  const rank = rankOf(settings);
  const fresh = shuffle(pool.filter((q) => !state.qprog[q.id])).sort((a, b) => rank(a) - rank(b));
  const old = pool
    .filter((q) => state.qprog[q.id] && !due.includes(q))
    .sort((a, b) => (state.qprog[a.id].last || '').localeCompare(state.qprog[b.id].last || ''));
  return [...due, ...fresh, ...old].slice(0, n);
}

// Part 3·4: 세트 하나 고르기 (다시 풀 문제가 있는 세트 → 안 푼 세트 → 오래된 세트)
export function buildSet(state, sets, part, settings, t) {
  const pool = sets.filter((s) => s.part === part);
  const prog = (s) => s.questions.map((q) => state.qprog[q.id]);
  const due = pool.filter((s) => prog(s).some((p) => p?.srs?.due <= t));
  if (due.length) return due[0];
  const rank = rankOf(settings);
  const fresh = shuffle(pool.filter((s) => prog(s).every((p) => !p))).sort((a, b) => rank(a) - rank(b));
  if (fresh.length) return fresh[0];
  const last = (s) => prog(s).map((p) => p?.last || '').sort().pop() || '';
  return [...pool].sort((a, b) => last(a).localeCompare(last(b)))[0] || null;
}

export function setProgress(state, sets, part) {
  const pool = sets.filter((s) => s.part === part);
  return { done: pool.filter((s) => s.questions.every((q) => state.qprog[q.id])).length, total: pool.length };
}

// 받아쓰기: Part 2 질문 문장 중에서
export function buildDict(items, settings, n = DICT_N) {
  const rank = rankOf(settings);
  return shuffle(items).sort((a, b) => rank(a) - rank(b)).slice(0, n * 2).sort(() => Math.random() - 0.5).slice(0, n);
}

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

// 받아쓰기 채점: 정답 낱말마다 맞혔는지 (순서를 지킨 가장 긴 일치)
export function dictCompare(answer, typed) {
  const A = norm(answer);
  const B = norm(typed);
  const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ok = new Array(A.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      ok[i] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const words = answer.split(/\s+/).filter(Boolean);
  // 원문 낱말(구두점 포함)에 결과 붙이기
  let k = 0;
  const marks = words.map((w) => {
    const n = norm(w);
    if (!n.length) return { w, ok: true };
    const r = ok[k] ?? false;
    k += n.length;
    return { w, ok: r };
  });
  return { marks, score: A.length ? ok.filter(Boolean).length / A.length : 0 };
}

export function todayCount(state, t = srs.today()) {
  return state.attempts.filter((a) => a.kind === 'question' && a.type === 'lc2' && a.date === t).length;
}
