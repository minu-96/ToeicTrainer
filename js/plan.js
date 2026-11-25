// 하루 학습 시간(분)에 맞춰 오늘 분량 나누기 (화면과 상관없는 계산만)
export const COST = { review: 8, fresh: 25, lc: 25, q: 30 }; // 한 개당 걸리는 시간(초)
export const MINUTE_OPTIONS = [
  [15, '15분 · 가볍게'],
  [25, '25분 · 보통'],
  [40, '40분 · 충분히'],
  [60, '60분 · 집중'],
];
// 수준별 나눔 비율: 저득점은 듣기·새 단어, 고득점은 문법·어휘 비중을 높임
const SHARE = {
  low: { fresh: 0.3, lc: 0.3, vocab: 0.2, grammar: 0.2 },
  mid: { fresh: 0.3, lc: 0.25, vocab: 0.22, grammar: 0.23 },
  high: { fresh: 0.25, lc: 0.2, vocab: 0.25, grammar: 0.3 },
};

// totalReviews: 오늘 복습할(했던) 단어 수. 복습 시간을 먼저 빼되, 남은 시간이 40%보다 적어지지 않게
export function quotas({ minutes, totalReviews = 0, group = 'mid', maxNew = 999, base }) {
  if (!minutes) return base;
  const left = Math.max(minutes * 60 * 0.4, minutes * 60 - totalReviews * COST.review);
  const W = SHARE[group] || SHARE.mid;
  const r5 = (x) => Math.max(5, Math.round(x / 5) * 5);
  return {
    newWords: Math.min(maxNew || 999, Math.max(5, Math.round((left * W.fresh) / COST.fresh))),
    lc: r5((left * W.lc) / COST.lc),
    vocab: r5((left * W.vocab) / COST.q),
    grammar: r5((left * W.grammar) / COST.q),
  };
}

export const totalSeconds = (q, reviews = 0) => reviews * COST.review + q.newWords * COST.fresh + q.lc * COST.lc + (q.vocab + q.grammar) * COST.q;
