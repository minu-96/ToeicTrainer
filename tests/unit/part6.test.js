import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vocab from '../../js/vocab.js';
import * as E from '../../js/engine.js';
import * as srs from '../../js/srs.js';

const { sets, questions } = JSON.parse(readFileSync('data/part6.json', 'utf8'));
const T = srs.today();

test('장문 빈칸: 지문 12개 × 빈칸 4개, 수준별 4지문, 유형 4가지 모두', () => {
  assert.equal(sets.length, 12);
  assert.equal(questions.length, 48);
  for (const level of ['basic', 'mid', 'adv']) assert.equal(sets.filter((s) => s.level === level).length, 4);
  for (const set of sets) {
    assert.equal(set.questions.length, 4);
    for (let n = 1; n <= 4; n++) assert.ok(set.passage.includes(`{${n}}`), set.id);
    assert.ok(set.ko.length > 20);
  }
  for (const type of Object.keys(Vocab.PART6_TYPES)) assert.ok(questions.filter((q) => q.type === type).length >= 8, type);
  for (const q of questions) {
    assert.equal(q.part, 6);
    assert.ok(q.stem.includes('____'), q.id);
    assert.equal(new Set(q.choices).size, 4);
    assert.equal(q.ko, '', '해석은 지문을 다 푼 뒤에만');
  }
});

test('지문 고르기: 다시 풀 지문 → 안 푼 지문(내 수준부터)', () => {
  const st = { attempts: [], qprog: {}, reports: [], studyDays: [] };
  const first = Vocab.buildP6(st, sets, questions, { startLevel: 'mid' }, T);
  assert.equal(first.length, 4);
  assert.ok(first.every((q) => q.set === first[0].set && q.level === 'mid'));
  assert.deepEqual(first.map((q) => q.n), [1, 2, 3, 4], '빈칸 순서대로');
  // 하나 틀린 지문은 다음 날 먼저
  for (const q of first) Vocab.record(st, q, q.n !== 2, 20000, T, 'p6');
  const next = Vocab.buildP6(st, sets, questions, { startLevel: 'mid' }, srs.addDays(T, 1));
  assert.equal(next[0].set, first[0].set);
  const same = Vocab.buildP6(st, sets, questions, { startLevel: 'mid' }, T);
  assert.notEqual(same[0].set, first[0].set, '오늘은 다른 지문');
});

test('장문 빈칸 기록: part 6, 목표 30초, 점수 영역 반영', () => {
  const st = { attempts: [], qprog: {}, reports: [], studyDays: [], words: [], mocks: [], settings: { level: 'low' } };
  const q = questions.find((x) => x.type === 'p6sent');
  const a = Vocab.record(st, q, true, 25000, T, 'p6');
  assert.equal(a.part, 6);
  assert.equal(a.targetMs, 30000);
  assert.equal(a.slow, false);
  assert.equal(a.module, 'part6');
  assert.equal(Vocab.addAnswerWord(st, questions[0]), null);
  for (const x of questions.filter((x) => x.type === 'p6sent')) Vocab.record(st, x, true, 20000, T, 'p6');
  const base = E.estimate({ attempts: [], mocks: [], settings: { level: 'low' } }, null, { range: false });
  const e = E.estimate(st, null, { range: false });
  assert.ok(e.skills.reading.mean > base.skills.reading.mean, '문장 넣기는 독해 영역');
});
