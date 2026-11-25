import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../js/engine.js';
import { simulatedUser, day } from './helpers.js';

test('실력을 아는 가상 사용자: 문제를 많이 풀면(영역당 약 200개) θ를 ±0.25 안으로 맞힌다', () => {
  for (const theta of [-1, 0, 1]) {
    const est = E.estimate(simulatedUser(theta, { nQ: 600 }), null, { range: false });
    assert.ok(Math.abs(est.skills.vocab.mean - theta) < 0.25, `vocab ${est.skills.vocab.mean} vs ${theta}`);
    assert.ok(Math.abs(est.skills.grammar.mean - theta) < 0.25, `grammar ${est.skills.grammar.mean} vs ${theta}`);
  }
});

test('실력이 높을수록 예상 점수가 높다 (단조 증가)', () => {
  const scores = [-1.5, -0.5, 0.5, 1.5].map((t) => E.estimate(simulatedUser(t, { nQ: 300 }), null, { range: false }).total);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] > scores[i - 1], scores.join(','));
});

test('몇 문제로 점수가 크게 튀지 않는다 (고급 3개 정답 → 60점 이하 상승)', () => {
  const base = { attempts: [], mocks: [], settings: { level: 'low' } };
  const before = E.estimate(base, null, { range: false }).total;
  const st = { ...base, attempts: [0, 1, 2].map((i) => ({ kind: 'question', type: 'colloc', level: 'adv', correct: true, timeMs: 15000, targetId: 'a' + i, date: day(0) })) };
  const after = E.estimate(st, null, { range: false }).total;
  assert.ok(after - before <= 60, `${before} → ${after}`);
});

test('단어 학습도 RC 점수에 반영된다', () => {
  const base = E.estimate({ attempts: [], mocks: [], settings: { level: 'low' } }, null, { range: false });
  const words = E.estimate(simulatedUser(0, { nW: 600, level: 'low' }), null, { range: false });
  assert.ok(words.rc.score > base.rc.score);
});

test('교재 모의고사를 넣으면 그 결과 쪽으로 이동하고, 공식 성적은 그대로 맞춘다', () => {
  const st = { attempts: [], settings: { level: 'low' }, mocks: [{ date: day(3), source: 'book', parts: { 1: { k: 4, n: 6 }, 2: { k: 14, n: 25 }, 3: { k: 20, n: 39 }, 4: { k: 14, n: 30 }, 5: { k: 15, n: 30 }, 6: { k: 8, n: 16 }, 7: { k: 22, n: 54 } } }] };
  const e = E.estimate(st, null, { range: false });
  assert.ok(e.lc.raw > 44 && e.lc.raw < 56, 'LC 맞힌 개수 52 근처: ' + e.lc.raw);
  assert.ok(e.lc.measured);
  st.mocks.push({ date: day(1), source: 'official', lc: 300, rc: 220 });
  const e2 = E.estimate(st, null, { range: false });
  assert.ok(Math.abs(e2.lc.score - 300) <= 5 && Math.abs(e2.rc.score - 220) <= 5, `${e2.lc.score}/${e2.rc.score}`);
});

test('신고한 문제는 점수 계산에서 빠진다', () => {
  const st = simulatedUser(0, { nQ: 30 });
  const before = E.estimate(st, null, { range: false }).total;
  st.reports = st.attempts.map((a) => ({ kind: 'question', targetId: a.targetId }));
  const after = E.estimate(st, null, { range: false });
  assert.equal(after.evCount, 0);
  assert.notEqual(before, after.total);
});

test('범위는 점수를 감싸고, 문제를 많이 풀수록 좁아진다', () => {
  const small = E.estimate(simulatedUser(0, { nQ: 20 }));
  const big = E.estimate(simulatedUser(0, { nQ: 400 }));
  assert.ok(small.low <= small.total && small.total <= small.high);
  assert.ok(big.high - big.low < small.high - small.low);
});
