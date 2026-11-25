import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Plan from '../../js/plan.js';

const base = { newWords: 10, lc: 10, vocab: 10, grammar: 10 };

test('하루 학습 시간을 안 정하면 기존 숫자 그대로', () => {
  assert.deepEqual(Plan.quotas({ minutes: null, base }), base);
});

test('정한 시간 안에 들어오도록 나눔 (복습 없음)', () => {
  for (const m of [15, 25, 40, 60]) {
    const q = Plan.quotas({ minutes: m, group: 'low', maxNew: 20, base });
    const sec = Plan.totalSeconds(q);
    assert.ok(sec <= m * 60 * 1.15, `${m}분 → ${Math.round(sec / 60)}분`);
    assert.ok(sec >= m * 60 * 0.6, `${m}분인데 너무 적음 ${Math.round(sec / 60)}분`);
    assert.ok(q.lc >= 5 && q.vocab >= 5 && q.grammar >= 5 && q.newWords >= 5);
  }
});

test('시간이 길수록 분량이 늘고, 새 단어는 설정한 최대를 넘지 않음', () => {
  const a = Plan.quotas({ minutes: 15, group: 'mid', maxNew: 15, base });
  const b = Plan.quotas({ minutes: 60, group: 'mid', maxNew: 15, base });
  assert.ok(b.lc > a.lc && b.vocab > a.vocab);
  assert.ok(b.newWords <= 15);
});

test('복습이 많으면 다른 학습이 줄지만 40%는 남김', () => {
  const none = Plan.quotas({ minutes: 25, totalReviews: 0, group: 'mid', base });
  const many = Plan.quotas({ minutes: 25, totalReviews: 150, group: 'mid', base });
  assert.ok(many.vocab < none.vocab);
  assert.ok(many.vocab >= 5);
});

test('저득점은 듣기 비중이 고득점보다 큼', () => {
  const low = Plan.quotas({ minutes: 40, group: 'low', base });
  const high = Plan.quotas({ minutes: 40, group: 'high', base });
  assert.ok(low.lc > high.lc);
  assert.ok(high.grammar > low.grammar);
});
