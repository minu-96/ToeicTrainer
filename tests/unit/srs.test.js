import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as srs from '../../js/srs.js';

const T = '2026-11-25';

test('날짜 계산: 월·연 경계', () => {
  assert.equal(srs.addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(srs.diffDays('2026-11-25', '2027-01-10'), 46);
});

test('연속 학습일: 오늘 또는 어제까지 이어진 날', () => {
  assert.equal(srs.streak(['2026-11-23', '2026-11-24'], T), 2);
  assert.equal(srs.streak(['2026-11-22'], T), 0);
});

test('간격 반복: 맞히면 한 단계씩, 5단계에서 멈춤, 틀리면 1단계', () => {
  let s = null;
  const boxes = [];
  for (let i = 0; i < 6; i++) {
    s = srs.next(s, true, T);
    boxes.push(s.box);
  }
  assert.deepEqual(boxes, [1, 2, 3, 4, 5, 5]);
  assert.deepEqual(srs.next({ box: 4, due: T }, false, T), { box: 1, due: T });
  assert.deepEqual(srs.next({ box: 1, due: T }, true, T, true), { box: 1, due: '2026-11-26' });
});

const word = (id, box, due, extra = {}) => ({ id, word: id, meaning: id, source: 'builtin', order: 0, srs: box ? { box, due } : null, ...extra });

test('복습 상한: 상한까지만 복습하고, 밀리면 새 단어를 줄인다', () => {
  const settings = { dailyNewWords: 20, dailyReviewMax: 10 };
  const intro = { date: '', count: 0 };
  const few = [...Array(4)].map((_, i) => word('d' + i, 1, T)).concat([...Array(30)].map((_, i) => word('n' + i, 0)));
  let p = srs.reviewPlan(few, settings, intro, T);
  assert.equal(p.reviews.length, 4);
  assert.equal(p.newRoom, 20);

  const half = [...Array(7)].map((_, i) => word('d' + i, 1, T));
  p = srs.reviewPlan(half, settings, intro, T);
  assert.equal(p.newRoom, 10, '상한의 절반을 넘으면 새 단어 절반');

  const many = [...Array(25)].map((_, i) => word('d' + i, 1, T));
  p = srs.reviewPlan(many, settings, intro, T);
  assert.equal(p.reviews.length, 10);
  assert.equal(p.newRoom, 0, '상한을 넘으면 새 단어 0');

  p = srs.reviewPlan(many, settings, intro, T, 10);
  assert.equal(p.reviews.length, 0, '오늘 이미 상한만큼 복습함');
});

test('새 단어 순서: 직접 추가 → 몰라요 표시 → 시작 수준 → 높은 수준 → 낮은 수준', () => {
  const ws = [
    word('basic1', 0, null, { level: 'basic', order: 1 }),
    word('mid1', 0, null, { level: 'mid', order: 1001 }),
    word('adv1', 0, null, { level: 'adv', order: 2001 }),
    word('flag', 0, null, { level: 'basic', order: 5, flagged: true }),
    word('mine', 0, null, { level: 'basic', source: 'user', addedAt: 1 }),
  ];
  const ids = [...ws].sort(srs.newWordOrder({ startLevel: 'mid' })).map((w) => w.id);
  assert.deepEqual(ids, ['mine', 'flag', 'mid1', 'adv1', 'basic1']);
});
