import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Session from '../../js/session.js';
import * as Vocab from '../../js/vocab.js';
import * as srs from '../../js/srs.js';

const T = srs.today();
const mkWord = (id) => ({ id, word: id, meaning: '뜻' + id, pos: '명', example: `The ${id} is here.`, level: 'basic', source: 'builtin', srs: null });

function runNew(failIds) {
  const words = ['alpha', 'bravo', 'charlie'].map(mkWord);
  const state = { words, attempts: [], studyDays: [], newIntroduced: { date: '', count: 0 } };
  const s = Session.create('daily', { fresh: words });
  const fails = new Map(failIds.map((id) => [id, 0]));
  let guard = 0;
  while (!Session.finished(s) && guard++ < 100) {
    const task = Session.current(s);
    const w = words.find((x) => x.id === task.id);
    let result = 'correct';
    if (task.step === 'intro') result = 'seen';
    else if (fails.has(w.id) && fails.get(w.id) < 1) {
      fails.set(w.id, 1);
      result = 'wrong';
    }
    Session.submit(s, state, w, result, T);
  }
  return Object.fromEntries(words.map((w) => [w.id, w.srs.box]));
}

test('새 단어: 한 번도 안 틀리면 익히는 중(2), 틀린 적 있으면 외우는 중(1)', () => {
  assert.deepEqual(runNew(['bravo']), { alpha: 2, bravo: 1, charlie: 2 });
});

test('복습: 10초 넘게 걸려 맞히면 단계 유지', () => {
  const w = { ...mkWord('delta'), srs: { box: 2, due: T } };
  const state = { words: [w], attempts: [], studyDays: [], newIntroduced: { date: '', count: 0 } };
  const s = Session.create('daily', { reviews: [w] });
  s.answered = { choice: 0, ok: true, timeMs: 12000 };
  Session.submit(s, state, w, 'correct', T);
  assert.equal(w.srs.box, 2);
});

const bank = [
  { id: 'q1', type: 'form', level: 'basic', stem: 'a ____ b', choices: ['x', 'y', 'z', 'w'], answer: 0 },
  { id: 'q2', type: 'colloc', level: 'mid', stem: 'c ____ d', choices: ['x', 'y', 'z', 'w'], answer: 0 },
  { id: 'q3', type: 'confuse', level: 'adv', stem: 'e ____ f', choices: ['x', 'y', 'z', 'w'], answer: 0 },
];
const att = (id, correct, date = T) => ({ kind: 'question', targetId: id, correct, date, mode: 'daily' });

test('오답: 마지막 두 번을 연속으로 맞히면 해결', () => {
  const state = { attempts: [att('q1', false), att('q1', true), att('q1', true), att('q2', false), att('q2', true), att('q3', true)], reports: [] };
  const list = Vocab.wrongQuestions(state, bank);
  assert.deepEqual(list.map((x) => [x.q.id, x.resolved]).sort(), [['q1', true], ['q2', false]]);
  assert.deepEqual(Vocab.buildWrong(state, bank).map((q) => q.id), ['q2']);
});

test('신고한 문제는 오답·출제에서 빠진다', () => {
  const state = { attempts: [att('q2', false)], reports: [{ kind: 'question', targetId: 'q2' }], qprog: {}, settings: {} };
  assert.equal(Vocab.wrongQuestions(state, bank).length, 0);
  assert.ok(!Vocab.buildDaily(state, bank, {}, T, 10).some((q) => q.id === 'q2'));
});
