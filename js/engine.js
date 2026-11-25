// v2.2 예상 점수 엔진
// 1) 기술별 능력 θ를 문항 반응 이론(IRT)으로 추정 (격자 EAP, 최근 기록일수록 무겁게)
// 2) 실제 토익 파트별 문항 수 × 난이도 분포로 기대 정답 수 계산
// 3) RC는 75분 안에 다 푸는지 확인 (못 푼 문항은 찍기 25%)
// 4) LC·RC 맞힌 개수를 5~495점으로 환산, 범위는 θ 분포에서 뽑아서 계산
// 5) 실제 성적을 입력하면 영역별 보정
import * as srs from './srs.js';

// ---------- 기본값 ----------
export const SKILLS = {
  vocab: { name: '어휘', sec: 'rc' },
  grammar: { name: '문법', sec: 'rc' },
  reading: { name: '독해', sec: 'rc' },
  lc_photo: { name: '사진 묘사', sec: 'lc' },
  lc_qr: { name: '질의 응답', sec: 'lc' },
  lc_conv: { name: '짧은 대화', sec: 'lc' },
  lc_talk: { name: '짧은 담화', sec: 'lc' },
};

export const PARTS = [
  { p: 1, sec: 'lc', n: 6, mix: { lc_photo: 1 }, mu: -1.0, c: 0.25 },
  { p: 2, sec: 'lc', n: 25, mix: { lc_qr: 1 }, mu: 0.0, c: 1 / 3 },
  { p: 3, sec: 'lc', n: 39, mix: { lc_conv: 1 }, mu: 0.3, c: 0.25 },
  { p: 4, sec: 'lc', n: 30, mix: { lc_talk: 1 }, mu: 0.4, c: 0.25 },
  { p: 5, sec: 'rc', n: 30, mix: { vocab: 0.5, grammar: 0.5 }, mu: 0.0, c: 0.25, targetMs: 20000 },
  { p: 6, sec: 'rc', n: 16, mix: { vocab: 0.35, grammar: 0.35, reading: 0.3 }, mu: 0.0, c: 0.25, targetMs: 30000 },
  { p: 7, sec: 'rc', n: 54, mix: { vocab: 0.2, reading: 0.8 }, mu: 0.35, c: 0.25, targetMs: 60000 },
];
const RC_LIMIT_MS = 75 * 60 * 1000;

// 문항 난이도 초기값 (기획서 5장)
export const LEVEL_B = { basic: -1.0, mid: 0.0, adv: 1.2 };
const VOCAB_SKILLS = {
  form: { grammar: 0.6, vocab: 0.4 }, // 품사 자리
  colloc: { vocab: 1 }, // 어울리는 단어
  confuse: { vocab: 0.5, grammar: 0.5 }, // 헷갈리는 단어
  para: { vocab: 0.5, reading: 0.5 }, // 바꿔 쓰는 표현 (Part 7 패러프레이즈)
  p6vocab: { vocab: 1 }, // 장문 빈칸 어휘
  p6grammar: { grammar: 1 }, // 장문 빈칸 문법
  p6conn: { grammar: 0.5, reading: 0.5 }, // 연결어 (문맥)
  p6sent: { reading: 1 }, // 문장 넣기
  lc2: { lc_qr: 1 }, // 듣기 Part 2
  lc3: { lc_conv: 1 }, // 듣기 Part 3
  lc4: { lc_talk: 1 }, // 듣기 Part 4
};
// 문법 문제는 문법 영역 하나로 반영
const GRAMMAR_TYPE_SET = new Set(['tense', 'agree', 'voice', 'verbal', 'participle', 'relative', 'conj', 'pronoun', 'compare', 'cond']);
// 브라우저 음성(TTS)은 실제 성우보다 쉬워서 듣기 증거는 무게를 낮춤 (기획서 위험 요소)
const TTS_WEIGHT = 0.6;
const LC_TYPES = new Set(['lc2', 'lc3', 'lc4']);
const WORD_ADJ = { meaning: -0.5, cloze: 0, word: 0.3, recall: 0.5 };
const WORD_WEIGHT = 0.3; // 같은 단어를 반복하는 학습이라 증거 무게를 낮춤
const HALF_LIFE = 30; // 일
const PRIOR_MU = { low: -1.0, mid: 0.0, high: 1.0 };
const LEVEL_ALIAS = { 200: 'low', 400: 'low', 600: 'mid', 800: 'high' };
const MEASURED_MIN = 10; // 영역 증거가 이만큼 있어야 '측정됨'
const MODEL_SEM = 25; // 영역별 모델 오차

// 맞힌 개수 → 점수 (공식 환산표는 없음: 공개 근사표를 참고한 구간 선형, 실제 성적으로 보정)
const CURVE = {
  lc: [[0, 5], [10, 30], [20, 80], [30, 135], [40, 190], [50, 245], [60, 300], [70, 360], [80, 420], [90, 475], [95, 495], [100, 495]],
  rc: [[0, 5], [10, 25], [20, 65], [30, 115], [40, 170], [50, 225], [60, 280], [70, 335], [80, 390], [90, 445], [95, 475], [100, 495]],
};

// 난이도 분포(평균 μ, 표준편차 1) 위 7점 근사
const B_OFFSETS = [-1.6, -1.0, -0.5, 0, 0.5, 1.0, 1.6];
const B_WEIGHTS = [0.08, 0.14, 0.18, 0.2, 0.18, 0.14, 0.08];

const GRID = Array.from({ length: 81 }, (_, i) => -4 + i * 0.1);

// ---------- 수학 ----------
export function pCorrect(theta, b, c = 0.25, a = 1) {
  return c + (1 - c) / (1 + Math.exp(-1.7 * a * (theta - b)));
}

function interp(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    const [x0, y0] = curve[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return curve.at(-1)[1];
}
const round5 = (x) => Math.round(x / 5) * 5;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 정규분포 난수 (범위 계산용, 같은 결과가 나오도록 고정 시드)
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gauss(r) {
  const u = Math.max(1e-9, r());
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- 증거 모으기 ----------
// 반환: [{ skills, b, c, s(0~1 득점), w(무게), date }]
export function evidence(state, upto = null) {
  const today = upto || srs.today();
  const ev = [];
  const recency = (d) => 0.5 ** (Math.max(0, srs.diffDays(d, today)) / HALF_LIFE);
  const seenWordDay = new Set();
  // '이 문제 이상해요'로 신고한 문제·단어는 점수 계산에서 뺀다
  const reported = new Set((state.reports || []).map((r) => r.targetId));

  for (const a of state.attempts) {
    if (upto && a.date > upto) continue;
    if (reported.has(a.targetId)) continue;
    if (a.kind === 'question') {
      if (a.scripted) continue; // 대본을 보고 푼 듣기 문제는 빼기
      const skills = a.skills || VOCAB_SKILLS[a.type] || (a.module === 'grammar' || GRAMMAR_TYPE_SET.has(a.type) ? { grammar: 1 } : { vocab: 1 });
      const target = a.targetMs || 20000;
      const s = a.correct ? (a.timeMs > 2 * target ? 0.8 : 1) : 0;
      const lc = LC_TYPES.has(a.type);
      ev.push({ skills, b: a.b ?? LEVEL_B[a.level] ?? 0, c: a.c ?? (a.type === 'lc2' ? 1 / 3 : 0.25), s, w: recency(a.date) * (lc ? TTS_WEIGHT : 1), date: a.date });
    } else if (a.kind === 'word') {
      const key = a.targetId + '|' + a.date; // 하루 첫 답만 인정
      if (seenWordDay.has(key)) continue;
      seenWordDay.add(key);
      const recall = a.type === 'recall';
      let s = a.correct ? 1 : 0;
      if (recall) s = a.grade === 'know' ? 1 : a.grade === 'unsure' ? 0.5 : 0;
      else if (a.grade === 'slow') s = 0.8;
      ev.push({
        skills: { vocab: 1 },
        b: (LEVEL_B[a.level] ?? -1) + (WORD_ADJ[a.type] ?? 0),
        c: recall ? 0 : 0.25,
        s,
        w: WORD_WEIGHT * recency(a.date),
        date: a.date,
      });
    }
  }

  // 교재 모의고사: 파트별 맞힌 개수를 그 파트 난이도 분포의 문항들로 펼쳐서 강한 증거로
  for (const m of state.mocks || []) {
    if (upto && m.date > upto) continue;
    if (m.source !== 'book' || !m.parts) continue;
    for (const part of PARTS) {
      const r = m.parts[part.p];
      if (!r || !r.n) continue;
      // 맞힌 비율을 모든 문항에 똑같이 주면 쉬운 문항 오답이 과하게 벌점이 되므로,
      // 파트 전체 정답 확률(난이도 분포 평균)에 대한 이항 우도로 넣는다
      ev.push({ skills: part.mix, agg: { mu: part.mu, c: part.c, k: clamp(r.k, 0, r.n), n: r.n }, w: recency(m.date), date: m.date });
    }
  }
  return ev;
}

// ---------- 기술별 능력 ----------
function posterior(evs, skill, mu0, sd0 = 1) {
  const logp = GRID.map((t) => -0.5 * ((t - mu0) / sd0) ** 2);
  let weight = 0;
  for (const e of evs) {
    const ws = e.skills[skill];
    if (!ws) continue;
    const w = e.w * ws;
    if (e.agg) {
      weight += w * e.agg.n;
      GRID.forEach((t, i) => {
        let pb = 0;
        B_OFFSETS.forEach((off, j) => (pb += B_WEIGHTS[j] * pCorrect(t, e.agg.mu + off, e.agg.c)));
        pb = clamp(pb, 1e-6, 1 - 1e-6);
        logp[i] += w * (e.agg.k * Math.log(pb) + (e.agg.n - e.agg.k) * Math.log(1 - pb));
      });
      continue;
    }
    weight += w;
    GRID.forEach((t, i) => {
      const p = clamp(pCorrect(t, e.b, e.c), 1e-6, 1 - 1e-6);
      logp[i] += w * (e.s * Math.log(p) + (1 - e.s) * Math.log(1 - p));
    });
  }
  const mx = Math.max(...logp);
  const pr = logp.map((l) => Math.exp(l - mx));
  const z = pr.reduce((a, b) => a + b, 0);
  const mean = GRID.reduce((s, t, i) => s + t * pr[i], 0) / z;
  const sd = Math.sqrt(GRID.reduce((s, t, i) => s + (t - mean) ** 2 * pr[i], 0) / z);
  return { mean, sd, weight };
}

export function abilities(state, upto = null) {
  const ev = evidence(state, upto);
  const lvl = LEVEL_ALIAS[state.settings?.level] || state.settings?.level;
  const mu0 = PRIOR_MU[lvl] ?? 0;
  const out = {};
  // RC: 어휘·문법 먼저
  out.vocab = posterior(ev, 'vocab', mu0);
  out.grammar = posterior(ev, 'grammar', mu0);
  const rcMean = (out.vocab.mean + out.grammar.mean) / 2;
  // 독해 증거가 적으면 어휘·문법 실력과 비슷하다고 보고 출발 (기술끼리 상관이 있음)
  const readEv = ev.reduce((s, e) => s + (e.skills.reading ? e.w * e.skills.reading * (e.agg ? e.agg.n : 1) : 0), 0);
  out.reading = posterior(ev, 'reading', readEv < 3 ? 0.5 * mu0 + 0.5 * rcMean : mu0);
  // LC: 시작 수준에서 출발하고 RC 실력을 조금 반영
  const lcMu = mu0 + 0.3 * (rcMean - mu0);
  for (const k of ['lc_photo', 'lc_qr', 'lc_conv', 'lc_talk']) out[k] = posterior(ev, k, lcMu);
  return { skills: out, evCount: ev.length, mu0 };
}

// ---------- 파트별 기대 정답 ----------
function partTheta(part, thetas) {
  let t = 0;
  for (const [k, w] of Object.entries(part.mix)) t += w * thetas[k];
  return t;
}

function expectedCorrect(part, theta) {
  let p = 0;
  B_OFFSETS.forEach((off, i) => (p += B_WEIGHTS[i] * pCorrect(theta, part.mu + off, part.c)));
  return p; // 한 문항당 정답 확률
}

// 파트별 풀이 시간 비율(실제 시간 / 목표 시간)의 중앙값
export function timeRatios(state) {
  const out = {};
  for (const part of PARTS.filter((x) => x.sec === 'rc')) {
    const xs = state.attempts
      .filter((a) => a.kind === 'question' && (a.part || 5) === part.p && a.timeMs)
      .slice(-30)
      .map((a) => a.timeMs / (a.targetMs || part.targetMs));
    out[part.p] = median(xs);
  }
  return out;
}

function project(thetas, ratios) {
  const parts = PARTS.map((part) => ({ part, prob: expectedCorrect(part, partTheta(part, thetas)) }));
  // RC 시간: 모르는 파트는 Part 5 비율을 쓰고, 그것도 없으면 1.0
  const base = ratios[5] ?? 1;
  let used = 0;
  for (const x of parts.filter((q) => q.part.sec === 'rc')) used += x.part.n * x.part.targetMs * (ratios[x.part.p] ?? base);
  const over = Math.max(0, used - RC_LIMIT_MS);
  const p7 = parts.find((x) => x.part.p === 7);
  const unanswered = Math.min(p7.part.n, over / (p7.part.targetMs * (ratios[7] ?? base)));
  for (const x of parts) {
    x.expected = x.part.n * x.prob;
    if (x.part.p === 7 && unanswered > 0) x.expected = (x.part.n - unanswered) * x.prob + unanswered * 0.25;
  }
  const raw = { lc: 0, rc: 0 };
  for (const x of parts) raw[x.part.sec] += x.expected;
  return { parts, raw, unanswered };
}

// ---------- 예상 점수 ----------
// opts.range: 범위 계산 여부 (그래프용 과거 값은 생략해서 빠르게)
export function estimate(state, upto = null, opts = { range: true }) {
  const ab = abilities(state, upto);
  const thetas = Object.fromEntries(Object.entries(ab.skills).map(([k, v]) => [k, v.mean]));
  const ratios = timeRatios(state);
  const proj = project(thetas, ratios);
  const calib = calibration(state, upto);
  const sec = (k) => clamp(round5(interp(CURVE[k], proj.raw[k]) + (calib[k] || 0)), 5, 495);

  const lcW = ['lc_photo', 'lc_qr', 'lc_conv', 'lc_talk'].reduce((s, k) => s + ab.skills[k].weight, 0);
  const rcW = ['vocab', 'grammar', 'reading'].reduce((s, k) => s + ab.skills[k].weight, 0);
  const hasBookLc = (state.mocks || []).some((m) => (!upto || m.date <= upto) && (m.source === 'official' || [1, 2, 3, 4].some((p) => m.parts?.[p]?.n)));
  const out = {
    lc: { score: sec('lc'), raw: proj.raw.lc, measured: lcW >= MEASURED_MIN || hasBookLc, evidence: lcW },
    rc: { score: sec('rc'), raw: proj.raw.rc, measured: rcW >= MEASURED_MIN, evidence: rcW },
    parts: proj.parts.map((x) => ({ p: x.part.p, sec: x.part.sec, n: x.part.n, expected: x.expected })),
    skills: ab.skills,
    unanswered: proj.unanswered,
    evCount: ab.evCount,
    calib,
  };
  out.total = out.lc.score + out.rc.score;

  if (opts.range) {
    const r = rng(7);
    const tot = [];
    const lcs = [];
    const rcs = [];
    for (let i = 0; i < 300; i++) {
      const th = Object.fromEntries(Object.entries(ab.skills).map(([k, v]) => [k, v.mean + v.sd * gauss(r)]));
      const pj = project(th, ratios);
      const l = interp(CURVE.lc, pj.raw.lc) + (calib.lc || 0);
      const c = interp(CURVE.rc, pj.raw.rc) + (calib.rc || 0);
      lcs.push(l);
      rcs.push(c);
      tot.push(l + c);
    }
    const band = (arr, center, extra) => {
      const s = [...arr].sort((a, b) => a - b);
      const half = (s[Math.floor(s.length * 0.9)] - s[Math.floor(s.length * 0.1)]) / 2;
      const h = round5(Math.sqrt(half ** 2 + extra ** 2));
      return [center - h, center + h];
    };
    [out.lc.low, out.lc.high] = band(lcs, out.lc.score, MODEL_SEM).map((x) => clamp(x, 5, 495));
    [out.rc.low, out.rc.high] = band(rcs, out.rc.score, MODEL_SEM).map((x) => clamp(x, 5, 495));
    [out.low, out.high] = band(tot, out.total, MODEL_SEM * Math.SQRT2).map((x) => clamp(x, 10, 990));
  }
  return out;
}

// ---------- 실제 성적 보정 ----------
// 공식 성적과 그날 기준 예측의 차이를 영역별로 평균 (보정 전 예측과 비교)
export function calibration(state, upto = null) {
  const offs = { lc: [], rc: [] };
  for (const m of state.mocks || []) {
    if (m.source !== 'official' || (upto && m.date > upto)) continue;
    const ab = abilities({ ...state, mocks: (state.mocks || []).filter((x) => x.source === 'book') }, m.date);
    const thetas = Object.fromEntries(Object.entries(ab.skills).map(([k, v]) => [k, v.mean]));
    const pj = project(thetas, timeRatios(state));
    if (m.lc) offs.lc.push(m.lc - interp(CURVE.lc, pj.raw.lc));
    if (m.rc) offs.rc.push(m.rc - interp(CURVE.rc, pj.raw.rc));
  }
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  return { lc: avg(offs.lc), rc: avg(offs.rc), n: offs.lc.length + offs.rc.length };
}

// ---------- 점수가 바뀐 이유 ----------
// 지금과 비교 시점의 파트별 기대 정답 차이를 환산 점수로 바꿔 큰 순서대로
export function changeReasons(now, before) {
  if (!now || !before) return [];
  const out = [];
  for (const x of now.parts) {
    const y = before.parts.find((q) => q.p === x.p);
    if (!y) continue;
    const curve = CURVE[x.sec];
    const raw = now[x.sec].raw;
    const pts = interp(curve, raw) - interp(curve, raw - (x.expected - y.expected));
    if (Math.abs(pts) >= 2) out.push({ p: x.p, pts: Math.round(pts) });
  }
  return out.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)).slice(0, 3);
}

// 정답률을 10%p 올리면 몇 점 오르는지 (점수를 가장 많이 올릴 파트 찾기)
export function partLeverage(est) {
  return est.parts
    .map((x) => {
      const curve = CURVE[x.sec];
      const raw = est[x.sec].raw;
      const gain = Math.min(x.n - x.expected, x.n * 0.1);
      return { p: x.p, pts: Math.round(interp(curve, raw + gain) - interp(curve, raw)) };
    })
    .sort((a, b) => b.pts - a.pts);
}
