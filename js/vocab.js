// 2단계: 어휘 문제 (Part 5·6) — 문제 고르기, 결과 기록, 수준 진단
import * as srs from './srs.js';
import { shuffle, findWordInSentence } from './quiz.js';

export const TYPES = {
  form: { name: '품사 자리', desc: '빈칸에 맞는 품사(명사·형용사·부사…) 고르기' },
  colloc: { name: '어울리는 단어', desc: '뜻과 짝꿍 표현으로 알맞은 단어 고르기' },
  confuse: { name: '헷갈리는 단어', desc: 'rise/raise, by/until처럼 비슷한 단어 구별' },
};
export const TARGET_MS = 20000; // Part 5 한 문제 목표 시간
export const REASONS = [
  ['meaning', '단어 뜻을 몰라서'],
  ['grammar', '품사·문법이 헷갈려서'],
  ['time', '시간에 쫓겨서'],
  ['mistake', '실수'],
];

const levelRank = (settings) => {
  const start = Math.max(0, srs.LEVEL_ORDER.indexOf(settings?.startLevel || 'basic'));
  return (q) => {
    const li = Math.max(0, srs.LEVEL_ORDER.indexOf(q.level));
    return li >= start ? li - start : 10 + (start - li);
  };
};

// 신고한 문제는 출제하지 않는다
function usable(state, bank) {
  const reported = new Set((state.reports || []).filter((r) => r.kind === 'question').map((r) => r.targetId));
  return bank.filter((q) => !reported.has(q.id));
}

export function prog(state, id) {
  return state.qprog[id];
}

export function dueList(state, bank, t) {
  return bank.filter((q) => {
    const p = state.qprog[q.id];
    return p?.srs && p.srs.due <= t;
  });
}

// 유형별 정답률 (수준 진단 제외)
export function typeStats(state) {
  const out = {};
  for (const k of Object.keys(TYPES)) out[k] = { n: 0, correct: 0, rate: null };
  for (const a of state.attempts) {
    if (a.kind !== 'question' || a.mode === 'test' || !out[a.type]) continue;
    out[a.type].n++;
    if (a.correct) out[a.type].correct++;
  }
  for (const k of Object.keys(out)) out[k].rate = out[k].n ? out[k].correct / out[k].n : null;
  return out;
}

function weakestType(state) {
  const st = typeStats(state);
  const rated = Object.entries(st).filter(([, v]) => v.n >= 3);
  if (!rated.length) return null;
  return rated.sort((a, b) => a[1].rate - b[1].rate)[0][0];
}

// 오늘의 어휘 문제: 다시 풀 문제(틀렸던 문제) → 내 수준의 새 문제, 약한 유형은 더 자주
export function buildDaily(state, allBank, settings, t, n) {
  const bank = usable(state, allBank);
  const due = shuffle(dueList(state, bank, t)).slice(0, n);
  const rank = levelRank(settings);
  const unseen = shuffle(bank.filter((q) => !state.qprog[q.id])).sort((a, b) => rank(a) - rank(b));
  const weak = weakestType(state);
  const rotation = weak ? [weak, ...Object.keys(TYPES), weak] : Object.keys(TYPES);
  const picked = [];
  let guard = 0;
  while (due.length + picked.length < n && unseen.length && guard++ < 200) {
    for (const type of rotation) {
      if (due.length + picked.length >= n) break;
      const idx = unseen.findIndex((q) => q.type === type);
      if (idx >= 0) picked.push(unseen.splice(idx, 1)[0]);
    }
    if (!rotation.some((type) => unseen.some((q) => q.type === type))) break;
  }
  // 새 문제를 다 풀었으면 예전에 푼 문제 중 오래된 것부터
  if (due.length + picked.length < n) {
    const old = bank
      .filter((q) => state.qprog[q.id] && !due.includes(q) && !picked.includes(q))
      .sort((a, b) => (state.qprog[a.id].last || '').localeCompare(state.qprog[b.id].last || ''));
    picked.push(...old.slice(0, n - due.length - picked.length));
  }
  return shuffle([...due, ...picked]);
}

// 유형별 연습: 그 유형의 다시 풀 문제 → 안 푼 문제(내 수준부터) → 틀린 적 있는 문제 → 나머지
export function buildType(state, allBank, type, settings, t, n = 10) {
  const bank = usable(state, allBank);
  const rank = levelRank(settings);
  const pool = bank.filter((q) => q.type === type);
  const due = pool.filter((q) => state.qprog[q.id]?.srs?.due <= t);
  const unseen = shuffle(pool.filter((q) => !state.qprog[q.id])).sort((a, b) => rank(a) - rank(b));
  const wrong = shuffle(pool.filter((q) => state.qprog[q.id]?.wrong && !due.includes(q)));
  const rest = shuffle(pool.filter((q) => !due.includes(q) && !unseen.includes(q) && !wrong.includes(q)));
  return [...new Set([...due, ...unseen, ...wrong, ...rest])].slice(0, n);
}

// 수준 진단: 수준마다 5문제씩, 유형을 섞어서
export function buildTest(bank) {
  const out = [];
  for (const level of srs.LEVEL_ORDER) {
    const pool = bank.filter((q) => q.level === level);
    const byType = Object.keys(TYPES).map((tp) => shuffle(pool.filter((q) => q.type === tp)));
    const pick = [];
    let k = 0;
    while (pick.length < 5 && byType.some((l) => l.length)) {
      const l = byType[k++ % byType.length];
      if (l.length) pick.push(l.pop());
    }
    out.push(...pick);
  }
  return out; // 쉬운 것부터
}

export function testResult(results) {
  const rate = {};
  for (const level of srs.LEVEL_ORDER) {
    const r = results.filter((x) => x.q.level === level);
    rate[level] = r.length ? r.filter((x) => x.ok).length / r.length : 0;
  }
  let rec = 'low';
  if (rate.mid >= 0.6 && rate.adv >= 0.6) rec = 'high';
  else if (rate.mid >= 0.6 || (rate.basic >= 0.8 && rate.mid >= 0.4)) rec = 'mid';
  return { rate, rec };
}

// 보기 순서 섞기
export function view(q) {
  const order = shuffle([0, 1, 2, 3]);
  return { choices: order.map((i) => q.choices[i]), answer: order.indexOf(q.answer) };
}

// 결과 기록: 틀린 문제는 내일 다시, 맞힌 문제는 단어와 같은 간격으로 점점 늦게
export function record(state, q, ok, timeMs, t, mode) {
  const p = state.qprog[q.id] || { seen: 0, wrong: 0, srs: null };
  p.seen++;
  p.last = t;
  if (!ok) {
    p.wrong++;
    p.srs = { box: 1, due: srs.addDays(t, 1) };
  } else if (p.srs) {
    p.srs = srs.next(p.srs, true, t);
  } else {
    p.srs = null; // 처음에 바로 맞힌 문제는 다시 안 내도 됨 (연습에서만)
  }
  state.qprog[q.id] = p;
  const attempt = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: t,
    at: Date.now(),
    kind: 'question',
    part: q.part || 5,
    type: q.type,
    targetMs: TARGET_MS,
    mode,
    targetId: q.id,
    level: q.level,
    correct: ok,
    timeMs,
    timedOut: false,
    slow: timeMs > TARGET_MS,
  };
  state.attempts.push(attempt);
  if (!state.studyDays.includes(t)) state.studyDays.push(t);
  return attempt;
}

// 틀린 문제의 정답 단어를 단어장에 추가 (한 단어짜리만, 이미 있으면 건너뜀)
export function addAnswerWord(state, q) {
  const raw = q.choices[q.answer];
  if (!/^[A-Za-z-]+$/.test(raw)) return null;
  const word = raw.toLowerCase();
  if (state.words.some((w) => w.word.toLowerCase() === word)) return null;
  const example = q.stem.replace('____', raw);
  const w = {
    id: 'q-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    word,
    meaning: (q.meanings?.[raw] || '').replace(/\((형|부|명|동|과거분사)\)/g, '').trim() || q.meanings?.[raw] || '',
    pos: '',
    example: findWordInSentence(word, example) ? example : '',
    exampleKo: q.ko || '',
    level: q.level,
    tags: ['오답'],
    source: 'wrong',
    addedAt: Date.now(),
    srs: null,
  };
  state.words.push(w);
  return w;
}

// ---------- 오답 ----------
// 문제별 풀이 기록을 모아서: 틀린 적 있음 + 마지막 두 번을 연속으로 맞히면 '해결'
export function wrongQuestions(state, allBank) {
  const bank = usable(state, allBank);
  const byId = new Map(bank.map((q) => [q.id, q]));
  const hist = new Map();
  for (const a of state.attempts) {
    if (a.kind !== 'question' || !byId.has(a.targetId)) continue;
    if (!hist.has(a.targetId)) hist.set(a.targetId, []);
    hist.get(a.targetId).push(a);
  }
  const out = [];
  for (const [id, list] of hist) {
    const wrong = list.filter((a) => !a.correct);
    if (!wrong.length) continue;
    const last2 = list.slice(-2);
    const resolved = last2.length === 2 && last2.every((a) => a.correct) && list.indexOf(wrong.at(-1)) < list.length - 2;
    out.push({
      q: byId.get(id),
      wrong: wrong.length,
      tries: list.length,
      lastDate: list.at(-1).date,
      lastWrongDate: wrong.at(-1).date,
      reason: wrong.at(-1).reasonTag || null,
      resolved,
    });
  }
  return out.sort((a, b) => b.lastWrongDate.localeCompare(a.lastWrongDate) || b.wrong - a.wrong);
}

// 오답만 다시 풀기: 해결 안 된 문제, 많이 틀린 것·오래된 것 먼저
export function buildWrong(state, bank, n = 10) {
  return shuffle(
    wrongQuestions(state, bank)
      .filter((x) => !x.resolved)
      .sort((a, b) => b.wrong - a.wrong || a.lastDate.localeCompare(b.lastDate))
      .slice(0, n)
      .map((x) => x.q),
  );
}

// 틀린 이유 집계 (최근 days일, 수준 진단 제외)
export function reasonStats(state, t, days = 30) {
  const since = srs.addDays(t, -days);
  const counts = { meaning: 0, grammar: 0, time: 0, mistake: 0, none: 0 };
  for (const a of state.attempts) {
    if (a.kind !== 'question' || a.correct || a.mode === 'test' || a.date < since) continue;
    counts[a.reasonTag && counts[a.reasonTag] !== undefined ? a.reasonTag : 'none']++;
  }
  return counts;
}
