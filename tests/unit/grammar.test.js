import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vocab from '../../js/vocab.js';
import * as E from '../../js/engine.js';
import * as srs from '../../js/srs.js';

const gbank = JSON.parse(readFileSync('data/grammar-questions.json', 'utf8'));
const vbank = JSON.parse(readFileSync('data/vocab-questions.json', 'utf8'));
const concepts = JSON.parse(readFileSync('data/grammar-concepts.json', 'utf8'));
const T = srs.today();

test('문법 문제: 10개 유형 × 수준 3개, 칸마다 4개 이상, 형식 검사', () => {
  for (const type of Object.keys(Vocab.GRAMMAR_TYPES))
    for (const level of ['basic', 'mid', 'adv']) assert.ok(gbank.filter((q) => q.type === type && q.level === level).length >= 4, `${type}/${level}`);
  for (const q of gbank) {
    assert.equal(q.module, 'grammar');
    assert.equal(new Set(q.choices).size, 4, q.id);
    assert.ok(q.stem.includes('____') && q.answer >= 0 && q.answer < 4, q.id);
    assert.deepEqual(Object.keys(q.meanings).sort(), [...q.choices].sort(), q.id);
  }
  assert.equal(new Set(gbank.map((q) => q.id)).size, gbank.length);
});

test('개념 카드: 기초 3장 + 유형마다 1장', () => {
  assert.equal(concepts.filter((c) => c.basic).length, 3);
  for (const type of Object.keys(Vocab.GRAMMAR_TYPES)) assert.ok(concepts.some((c) => c.id === type && c.points.length >= 3), type);
});

test('오늘의 문법 문제는 문법만, 오늘의 어휘 문제는 어휘만', () => {
  const st = { attempts: [], qprog: {}, reports: [] };
  const all = vbank.concat(gbank);
  const g = Vocab.buildDaily(st, all, { startLevel: 'basic' }, T, 10, 'grammar');
  const v = Vocab.buildDaily(st, all, { startLevel: 'basic' }, T, 10);
  assert.equal(g.length, 10);
  assert.ok(g.every((q) => Vocab.areaOf(q) === 'grammar'));
  assert.ok(v.every((q) => Vocab.areaOf(q) === 'vocab'));
  assert.ok(new Set(g.map((q) => q.type)).size >= 5, '여러 유형을 섞음');
});

test('문법 풀이는 문법 영역에만 반영되고 단어장에 추가되지 않는다', () => {
  const st = { attempts: [], qprog: {}, reports: [], studyDays: [], words: [], mocks: [], settings: { level: 'low' } };
  for (const q of gbank.slice(0, 40)) Vocab.record(st, q, true, 12000, T, 'type');
  assert.ok(st.attempts.every((a) => a.module === 'grammar'));
  assert.equal(Vocab.addAnswerWord(st, gbank[0]), null);
  const base = E.estimate({ attempts: [], mocks: [], settings: { level: 'low' } }, null, { range: false });
  const e = E.estimate(st, null, { range: false });
  assert.ok(e.skills.grammar.mean > base.skills.grammar.mean + 0.3);
  assert.ok(Math.abs(e.skills.vocab.mean - base.skills.vocab.mean) < 0.05);
});
