import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vocab from '../../js/vocab.js';
import * as srs from '../../js/srs.js';

const bank = JSON.parse(readFileSync('data/vocab-questions.json', 'utf8'));
const words = ['basic', 'mid', 'adv'].flatMap((f) => JSON.parse(readFileSync(`data/words-${f}.json`, 'utf8')).map((w) => ({ ...w, source: 'builtin', srs: null })));
const T = srs.today();

test('문제 은행: 연습 150개 이상, 수준·유형마다 15개 이상, 진단 전용 15개', () => {
  const practice = bank.filter((q) => !q.test);
  assert.ok(practice.length >= 150);
  for (const type of ['form', 'colloc', 'confuse'])
    for (const level of ['basic', 'mid', 'adv']) assert.ok(practice.filter((q) => q.type === type && q.level === level).length >= 15, `${type}/${level}`);
  assert.equal(bank.filter((q) => q.test).length, 15);
  for (const q of bank) {
    assert.equal(new Set(q.choices).size, 4, q.id);
    assert.ok(q.stem.includes('____'), q.id);
    assert.deepEqual(Object.keys(q.meanings).sort(), [...q.choices].sort(), q.id);
  }
  assert.equal(new Set(bank.map((q) => q.id)).size, bank.length);
});

test('진단은 전용 문제만, 연습에는 진단 문제가 안 나온다', () => {
  const gbank = JSON.parse(readFileSync('data/grammar-questions.json', 'utf8'));
  const t = Vocab.buildTest(bank.concat(gbank));
  assert.equal(t.length, 15);
  assert.ok(t.every((q) => q.test));
  assert.equal(t.filter((q) => Vocab.areaOf(q) === 'grammar').length, 6, '문법 6문제');
  for (const level of ['basic', 'mid', 'adv']) assert.equal(t.filter((q) => q.level === level).length, 5);
  const state = { attempts: [], qprog: {}, reports: [], settings: {} };
  const daily = Vocab.buildDaily(state, bank, { startLevel: 'basic' }, T, 200);
  assert.ok(daily.length > 0 && daily.every((q) => !q.test));
});

test('바꿔 쓰는 표현: 200개 이상, 정답은 syn 첫 단어, 보기 4개가 서로 다름', () => {
  const para = Vocab.buildParaBank(words);
  assert.ok(para.length >= 200, String(para.length));
  for (const q of para) {
    const w = words.find((x) => x.id === q.wordId);
    assert.equal(q.choices[q.answer], w.syn.split(',')[0].trim());
    assert.equal(new Set(q.choices.map((c) => c.toLowerCase())).size, 4, q.id);
    assert.ok(q.stem.includes('[' + q.target + ']'), q.id);
  }
  // 뜻이 겹치는 보기가 섞이지 않음
  const by = Object.fromEntries(para.map((q) => [q.id, q.choices]));
  assert.ok(!by['v-p-b004'].includes('send'), 'submit ≠ send 보기');
  assert.ok(!by['v-p-a076'].includes('upcoming'), 'imminent ≠ upcoming 보기');
  // 같은 단어로 다시 만들어도 같은 문제
  assert.deepEqual(Vocab.buildParaBank(words)[0], para[0]);
});

test('스피드 모드: Part 5 문제 10개, 내 수준 위주', () => {
  const all = bank.concat(Vocab.buildParaBank(words));
  const st = { attempts: [], qprog: {}, reports: [] };
  const s = Vocab.buildSpeed(st, all, { startLevel: 'mid' }, T);
  assert.equal(s.length, 10);
  assert.ok(s.every((q) => q.type !== 'para' && !q.test && q.level === 'mid'));
});

const att = (level, correct, at) => ({ kind: 'question', mode: 'daily', level, correct, at });

test('수준 자동 조정: 20문제 80% 이상이면 올리고, 40% 미만이면 내리기 제안', () => {
  const up = { attempts: [...Array(20)].map((_, i) => att('basic', i < 17, i + 1)) };
  assert.deepEqual(Vocab.levelCheck(up, { startLevel: 'basic' })?.to, 'mid');
  assert.equal(Vocab.levelCheck(up, { startLevel: 'basic', levelChangedAt: 5 }), null, '바꾼 뒤 기록만 셈');
  const few = { attempts: up.attempts.slice(0, 10) };
  assert.equal(Vocab.levelCheck(few, { startLevel: 'basic' }), null);
  const down = { attempts: [...Array(20)].map((_, i) => att('mid', i < 6, i + 1)) };
  assert.deepEqual(Vocab.levelCheck(down, { startLevel: 'mid' })?.dir, 'down');
  const top = { attempts: [...Array(20)].map((_, i) => att('adv', true, i + 1)) };
  assert.equal(Vocab.levelCheck(top, { startLevel: 'adv' }), null);
});
