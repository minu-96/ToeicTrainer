import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as LC from '../../js/listening.js';
import * as Vocab from '../../js/vocab.js';
import * as E from '../../js/engine.js';
import * as srs from '../../js/srs.js';

const { part2, sets } = JSON.parse(readFileSync('data/listening.json', 'utf8'));
const T = srs.today();

test('듣기 데이터: Part 2 30문제(수준별 10), Part 3 6세트·Part 4 4세트, 세트마다 3문제', () => {
  assert.equal(part2.length, 30);
  for (const lv of ['basic', 'mid', 'adv']) assert.equal(part2.filter((q) => q.level === lv).length, 10);
  for (const q of part2) {
    assert.equal(q.choices.length, 3);
    assert.equal(new Set(q.choices).size, 3);
    for (const k of Object.keys(q.traps)) assert.notEqual(Number(k), q.answer, q.id + ' 정답에 함정 표시');
  }
  assert.equal(sets.filter((s) => s.part === 3).length, 6);
  assert.equal(sets.filter((s) => s.part === 4).length, 4);
  for (const s of sets) {
    assert.equal(s.questions.length, 3);
    assert.ok(s.lines.length >= 1 && s.ko.length > 20);
    if (s.part === 4) assert.ok(s.lines.every((l) => l.who === 'N'));
  }
});

test('Part 2 고르기: 다시 들을 문제 → 내 수준 새 문제', () => {
  const st = { attempts: [], qprog: {}, reports: [], studyDays: [] };
  const first = LC.buildPart2(st, part2, { startLevel: 'mid' }, T);
  assert.equal(first.length, 10);
  assert.ok(first.every((q) => q.level === 'mid'));
  Vocab.record(st, { ...first[0], targetMs: LC.LC_TARGET_MS }, false, 5000, T, 'lc2');
  const next = LC.buildPart2(st, part2, { startLevel: 'mid' }, srs.addDays(T, 1));
  assert.equal(next[0].id, first[0].id);
  assert.equal(st.attempts[0].module, 'listening');
});

test('세트 고르기와 진행', () => {
  const st = { attempts: [], qprog: {}, reports: [], studyDays: [] };
  const s3 = LC.buildSet(st, sets, 3, { startLevel: 'basic' }, T);
  assert.equal(s3.part, 3);
  assert.equal(s3.level, 'basic');
  for (const q of s3.questions) Vocab.record(st, { ...q, targetMs: LC.LC_TARGET_MS }, true, 5000, T, 'lc3');
  assert.equal(LC.setProgress(st, sets, 3).done, 1);
  assert.notEqual(LC.buildSet(st, sets, 3, { startLevel: 'basic' }, T).id, s3.id);
});

test('받아쓰기 채점: 낱말 단위, 대소문자·구두점 무시', () => {
  const r = LC.dictCompare('Where is the nearest bank?', 'where is nearest bank');
  assert.deepEqual(r.marks.map((m) => m.ok), [true, true, false, true, true]);
  assert.equal(r.score, 0.8);
  assert.equal(LC.dictCompare("I'll check the schedule.", "I'll check the schedule").score, 1);
});

test('듣기 점수: LC 영역에 반영되지만 무게는 낮고, 대본 보고 푼 건 빠짐', () => {
  const st = { attempts: [], qprog: {}, reports: [], studyDays: [], mocks: [], settings: { level: 'low' } };
  const base = E.estimate(st, null, { range: false });
  for (const q of part2) Vocab.record(st, { ...q, targetMs: LC.LC_TARGET_MS }, true, 4000, T, 'lc2');
  const e = E.estimate(st, null, { range: false });
  assert.ok(e.skills.lc_qr.mean > base.skills.lc_qr.mean + 0.3);
  assert.ok(e.lc.score > base.lc.score);
  const st2 = { attempts: [], qprog: {}, reports: [], studyDays: [], mocks: [], settings: { level: 'low' } };
  for (const q of part2) Vocab.record(st2, { ...q, targetMs: LC.LC_TARGET_MS }, true, 4000, T, 'lc2', { scripted: true });
  assert.equal(E.estimate(st2, null, { range: false }).lc.score, base.lc.score);
});
