// 2단계: 어휘 문제 (Part 5·6) — 문제 고르기, 결과 기록, 수준 진단
import * as srs from './srs.js';
import { shuffle, findWordInSentence } from './quiz.js';

export const TYPES = {
  form: { name: '품사 자리', desc: '빈칸에 맞는 품사(명사·형용사·부사…) 고르기' },
  colloc: { name: '어울리는 단어', desc: '뜻과 짝꿍 표현으로 알맞은 단어 고르기' },
  confuse: { name: '헷갈리는 단어', desc: 'rise/raise, by/until처럼 비슷한 단어 구별' },
  para: { name: '바꿔 쓰는 표현', desc: 'Part 7처럼 같은 뜻의 다른 단어 고르기' },
};
// 문법 유형 (3단계)
export const GRAMMAR_TYPES = {
  tense: { name: '시제', desc: '과거·현재완료·미래, 시간 단서 찾기' },
  agree: { name: '수일치', desc: '진짜 주어 찾기, each·the number of' },
  voice: { name: '능동·수동', desc: '목적어가 있나 없나, be + p.p.' },
  verbal: { name: '동명사·to부정사', desc: 'avoid -ing, decide to, 전치사 뒤' },
  participle: { name: '분사', desc: '-ing(하는) vs -ed(된), 분사구문' },
  relative: { name: '관계사', desc: 'who·which·whose·what·where' },
  conj: { name: '전치사 vs 접속사', desc: 'despite / although, because of / because' },
  pronoun: { name: '대명사', desc: '소유격·재귀대명사, that/those, the other' },
  compare: { name: '비교', desc: '비교급 강조, the 비교급, 최상급' },
  cond: { name: '가정법·도치', desc: 'would have p.p., Should you ~' },
};
// 장문 빈칸 (Part 6) 문항 유형
export const PART6_TYPES = {
  p6vocab: { name: '어휘', desc: '문맥에 맞는 단어' },
  p6grammar: { name: '문법', desc: '시제·태·품사 자리' },
  p6conn: { name: '연결어', desc: 'However · Therefore · In addition' },
  p6sent: { name: '문장 넣기', desc: '앞뒤 흐름에 맞는 문장 고르기' },
};
export const P6_TARGET_MS = 30000;
export const ALL_TYPES = { ...TYPES, ...GRAMMAR_TYPES, ...PART6_TYPES };
export const areaOf = (q) => (q.module === 'part6' || PART6_TYPES[q.type] ? 'part6' : q.module === 'grammar' || GRAMMAR_TYPES[q.type] ? 'grammar' : 'vocab');
const typesOf = (area) => (area === 'grammar' ? GRAMMAR_TYPES : area === 'part6' ? PART6_TYPES : TYPES);

export const SPEED = { n: 10, ms: 180000 }; // 스피드 모드: 10문제 3분
export const LEVEL_UP = { window: 20, min: 20 }; // 최근 20문제로 수준 판단
export const TARGET_MS = 20000; // Part 5 한 문제 목표 시간
export const REASONS = [
  ['meaning', '뜻을 몰라서'],
  ['grammar', '문법이 헷갈려서'],
  ['time', '시간이 부족해서'],
  ['mistake', '실수'],
];

const levelRank = (settings) => {
  const start = Math.max(0, srs.LEVEL_ORDER.indexOf(settings?.startLevel || 'basic'));
  return (q) => {
    const li = Math.max(0, srs.LEVEL_ORDER.indexOf(q.level));
    return li >= start ? li - start : 10 + (start - li);
  };
};

// 신고한 문제와 진단 전용 문제는 연습에 내지 않는다
function usable(state, bank) {
  const reported = new Set((state.reports || []).filter((r) => r.kind === 'question').map((r) => r.targetId));
  return bank.filter((q) => !q.test && !reported.has(q.id));
}

// ---------- 바꿔 쓰는 표현 (내장 단어의 syn으로 만들기) ----------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
// 뜻이 겹쳐서 서로 오답 보기로 쓰면 안 되는 묶음
const SIMILAR = [
  ['send', 'submit', 'hand in', 'deliver', 'delivered', 'remit', 'send payment', 'pay out'],
  ['reduce', 'relieve', 'drop', 'drop sharply', 'cut back', 'decrease', 'decreased', 'mitigate', 'alleviate', 'curtail', 'plummet', 'plummeted', 'waive'],
  ['rise', 'rise sharply', 'increase', 'increased', 'exceed', 'augment', 'strengthen', 'bolster', 'soar', 'soared', 'enhance', 'improve'],
  ['upcoming', 'about to happen', 'forthcoming', 'imminent', 'expected', 'due'],
  ['target', 'requirement', 'standard', 'quota', 'benchmark', 'prerequisite', 'required', 'mandatory'],
  ['now', 'right away', 'immediately', 'currently', 'lately', 'recently', 'promptly', 'quick', 'prompt', 'for now'],
  ['essential', 'required', 'indispensable', 'integral', 'imperative', 'mandatory'],
  ['skilled', 'proficient', 'adept', 'qualified', 'eligible', 'hardworking'],
  ['temporary', 'provisional', 'tentative', 'for now', 'temporarily'],
  ['free', 'complimentary', 'free from', 'exempt', 'inexpensive', 'affordable'],
  ['considerable', 'significant', 'substantial', 'greatly', 'significantly'],
  ['verify', 'confirm', 'check'],
  ['approve', 'authorize', 'approve formally', 'ratify', 'ratified', 'approved'],
  ['ask', 'ask for', 'request', 'solicit', 'consult', 'inquiries', 'question'],
  ['buy', 'purchase', 'obtain', 'acquire', 'procure'],
  ['careful', 'thorough', 'meticulous', 'carefully', 'thoroughly', 'comprehensive'],
  ['cancel', 'call off', 'rescind', 'drop', 'waive'],
  ['combine', 'consolidate', 'merger', 'combination of companies', 'work together'],
  ['possible', 'potential', 'feasible', 'workable', 'viable', 'prospective'],
];
const simKey = (x) => x.toLowerCase().trim();
function tooClose(a, b) {
  const A = simKey(a);
  const B = simKey(b);
  return A === B || SIMILAR.some((g) => g.includes(A) && g.includes(B));
}
const firstSyn = (w) => (w.syn || '').split(',')[0].trim();
const synOk = (x) => x && x.split(' ').length <= 3;

export function buildParaBank(words) {
  const pool = words.filter((w) => w.source === 'builtin' && synOk(firstSyn(w)) && findWordInSentence(w.word, w.example));
  const out = [];
  for (const w of pool) {
    const ans = firstSyn(w);
    const own = new Set([w.word.toLowerCase(), ...(w.syn || '').split(',').map((x) => x.trim().toLowerCase())]);
    // 같은 품사·가까운 수준의 다른 단어 syn을 오답 보기로 (단어마다 고정)
    const cands = pool
      .filter((o) => o !== w && o.pos === w.pos && !own.has(firstSyn(o).toLowerCase()) && !own.has(o.word.toLowerCase()))
      .filter((o) => ![ans, w.word].some((x) => tooClose(x, firstSyn(o)) || tooClose(x, o.word)))
      .sort((a, b) => (a.level === w.level ? 0 : 1) - (b.level === w.level ? 0 : 1) || hash(w.id + a.id) - hash(w.id + b.id));
    const picked = [];
    for (const o of cands) {
      const s = firstSyn(o);
      if (!picked.some((p) => firstSyn(p).toLowerCase() === s.toLowerCase())) picked.push(o);
      if (picked.length === 3) break;
    }
    if (picked.length < 3) continue;
    const span = findWordInSentence(w.word, w.example);
    const surface = w.example.slice(span.start, span.end);
    const choices = [ans, ...picked.map(firstSyn)];
    const meanings = { [ans]: w.meaning };
    for (const o of picked) meanings[firstSyn(o)] = o.meaning + ` (= ${o.word})`;
    out.push({
      id: 'v-p-' + w.id,
      part: 7,
      type: 'para',
      level: w.level,
      wordId: w.id,
      target: surface,
      stem: w.example.slice(0, span.start) + '[' + surface + ']' + w.example.slice(span.end),
      choices,
      answer: 0,
      clue: `${w.word} ≈ ${ans} (${w.meaning})`,
      explanation: `Part 7에서는 지문의 ${w.word}가 문제나 보기에서 ${ans}처럼 다른 말로 바뀌어 나와요. 뜻이 같은 짝으로 함께 외워 두세요.`,
      ko: w.exampleKo || '',
      meanings,
    });
  }
  return out;
}

// ---------- 수준 자동 조정 ----------
// 지금 수준 문제(진단 제외) 최근 20개 정답률이 기준 이상이면 한 단계 위로, 40% 미만이면 한 단계 아래를 제안
export function levelCheck(state, settings) {
  const cur = settings.startLevel || 'basic';
  const since = settings.levelChangedAt || 0;
  const recent = state.attempts
    .filter((a) => a.kind === 'question' && a.mode !== 'test' && a.level === cur && (a.at || 0) > since)
    .slice(-LEVEL_UP.window);
  if (recent.length < LEVEL_UP.min) return null;
  const rate = recent.filter((a) => a.correct).length / recent.length;
  const i = srs.LEVEL_ORDER.indexOf(cur);
  const up = Number(settings.levelUpRate ?? 0.8);
  if (rate >= up && i < srs.LEVEL_ORDER.length - 1) return { dir: 'up', from: cur, to: srs.LEVEL_ORDER[i + 1], rate, n: recent.length };
  if (rate < 0.4 && i > 0) return { dir: 'down', from: cur, to: srs.LEVEL_ORDER[i - 1], rate, n: recent.length };
  return null;
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
export function typeStats(state, area = 'vocab') {
  const out = {};
  for (const k of Object.keys(typesOf(area))) out[k] = { n: 0, correct: 0, rate: null };
  for (const a of state.attempts) {
    if (a.kind !== 'question' || a.mode === 'test' || !out[a.type]) continue;
    out[a.type].n++;
    if (a.correct) out[a.type].correct++;
  }
  for (const k of Object.keys(out)) out[k].rate = out[k].n ? out[k].correct / out[k].n : null;
  return out;
}

function weakestType(state, area) {
  const st = typeStats(state, area);
  const rated = Object.entries(st).filter(([, v]) => v.n >= 3);
  if (!rated.length) return null;
  return rated.sort((a, b) => a[1].rate - b[1].rate)[0][0];
}

// 오늘의 어휘 문제: 다시 풀 문제(틀렸던 문제) → 내 수준의 새 문제, 약한 유형은 더 자주
export function buildDaily(state, allBank, settings, t, n, area = 'vocab') {
  const bank = usable(state, allBank).filter((q) => areaOf(q) === area);
  const due = shuffle(dueList(state, bank, t)).slice(0, n);
  const rank = levelRank(settings);
  const unseen = shuffle(bank.filter((q) => !state.qprog[q.id])).sort((a, b) => rank(a) - rank(b));
  const weak = weakestType(state, area);
  const keys = Object.keys(typesOf(area));
  const rotation = weak ? [weak, ...keys, weak] : keys;
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

// 스피드 모드: 내 수준 문제를 유형 섞어 10개 (다시 풀 문제는 빼고 실전처럼)
export function buildSpeed(state, allBank, settings, t, n = SPEED.n) {
  const bank = usable(state, allBank).filter((q) => q.part === 5 || !q.part);
  const cur = settings?.startLevel || 'basic';
  const near = bank.filter((q) => q.level === cur);
  const pool = near.length >= n ? near : bank;
  const fresh = shuffle(pool.filter((q) => !state.qprog[q.id]));
  const old = shuffle(pool.filter((q) => state.qprog[q.id]));
  return [...fresh, ...old].slice(0, n);
}

// 장문 빈칸: 지문 단위로. 다시 풀 문제가 있는 지문 → 안 푼 지문(내 수준부터) → 오래전에 푼 지문
export function buildP6(state, sets, allBank, settings, t, nSets = 1) {
  const bank = usable(state, allBank);
  const qsOf = (set) => set.questions.map((id) => bank.find((q) => q.id === id)).filter(Boolean);
  const rank = levelRank(settings);
  const pool = sets.map((set) => ({ set, qs: qsOf(set) })).filter((x) => x.qs.length);
  const due = pool.filter((x) => x.qs.some((q) => state.qprog[q.id]?.srs?.due <= t));
  const fresh = shuffle(pool.filter((x) => !due.includes(x) && x.qs.every((q) => !state.qprog[q.id]))).sort((a, b) => rank(a.set) - rank(b.set));
  const old = pool
    .filter((x) => !due.includes(x) && !fresh.includes(x))
    .sort((a, b) => (lastOf(state, a.qs) || '').localeCompare(lastOf(state, b.qs) || ''));
  return [...due, ...fresh, ...old].slice(0, nSets).flatMap((x) => x.qs);
}
const lastOf = (state, qs) => qs.map((q) => state.qprog[q.id]?.last || '').sort().pop();

// 수준 진단: 수준마다 5문제씩, 유형을 섞어서
export function buildTest(allBank) {
  const only = allBank.filter((q) => q.test);
  const vocab = only.filter((q) => areaOf(q) === 'vocab');
  const grammar = only.filter((q) => areaOf(q) === 'grammar');
  const out = [];
  for (const level of srs.LEVEL_ORDER) {
    // 수준마다 어휘 3 (품사·어울림·헷갈림) + 문법 2
    const v = vocab.filter((q) => q.level === level);
    const pickV = ['form', 'colloc', 'confuse'].map((tp) => shuffle(v.filter((q) => q.type === tp))[0]).filter(Boolean);
    const pickG = shuffle(grammar.filter((q) => q.level === level)).slice(0, 2);
    const pick = [...pickV, ...pickG];
    // 전용 문제가 모자라면 연습 문제로 채움
    if (pick.length < 5) pick.push(...shuffle(allBank.filter((q) => !q.test && q.type !== 'para' && q.level === level && !pick.includes(q))).slice(0, 5 - pick.length));
    out.push(...shuffle(pick));
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
export function record(state, q, ok, timeMs, t, mode, extra = {}) {
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
    module: areaOf(q),
    type: q.type,
    targetMs: q.targetMs || TARGET_MS,
    mode,
    targetId: q.id,
    level: q.level,
    correct: ok,
    timeMs,
    timedOut: !!extra.timedOut,
    slow: timeMs > (q.targetMs || TARGET_MS),
  };
  state.attempts.push(attempt);
  if (!state.studyDays.includes(t)) state.studyDays.push(t);
  return attempt;
}

// 틀린 문제의 정답 단어를 단어장에 추가 (한 단어짜리만, 이미 있으면 건너뜀)
export function addAnswerWord(state, q) {
  if (q.type === 'para' || areaOf(q) !== 'vocab') return null;
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
