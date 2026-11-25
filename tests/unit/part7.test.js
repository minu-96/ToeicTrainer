import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vocab from '../../js/vocab.js';
import * as E from '../../js/engine.js';
import * as srs from '../../js/srs.js';

const { sets, questions } = JSON.parse(readFileSync('data/part7.json', 'utf8'));
const T = srs.today();

test('독해 데이터: 13지문 44문제, 수준별 지문, 이중 지문 3개, 8가지 유형 모두', () => {
  assert.equal(sets.length, 13);
  assert.equal(questions.length, 44);
  for (const lv of ['basic', 'mid', 'adv']) assert.ok(sets.filter((s) => s.level === lv).length >= 3, lv);
  assert.equal(sets.filter((s) => s.double).length, 3);
  for (const type of Object.keys(Vocab.PART7_TYPES)) assert.ok(questions.some((q) => q.type === type), type);
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const s of sets) {
    for (const id of s.questions) assert.ok(byId.has(id), id);
    assert.equal(s.double, s.docs.length === 2);
  }
});

test('독해 문항: 보기 4개 중복 없음, 근거 문장이 실제로 있음, 연계 문제는 두 지문 근거', () => {
  for (const q of questions) {
    assert.equal(q.part, 7);
    assert.equal(Vocab.areaOf(q), 'part7');
    assert.equal(new Set(q.choices).size, 4, q.id);
    assert.ok(q.answer >= 0 && q.answer < 4);
    assert.ok(q.ev.length >= 1, q.id);
    const set = sets.find((s) => s.id === q.set);
    for (const e of q.ev) {
      const [d, i] = e.split('-').map(Number);
      const sent = set.docs[d]?.sents[i];
      assert.ok(sent && !/^\[\d\]$/.test(sent), q.id + ' 근거 ' + e);
    }
    if (q.qtype === 'link') assert.equal(new Set(q.ev.map((e) => e.split('-')[0])).size, 2, q.id + ' 연계');
    if (q.qtype === 'syn') {
      const [d, i] = q.ev[0].split('-').map(Number);
      assert.ok(new RegExp(`\\b${q.word}\\b`, 'i').test(set.docs[d].sents[i]), q.id + ' 동의어 단어가 근거 문장에');
    }
    if (q.qtype === 'insert') {
      assert.deepEqual(q.choices, ['[1]', '[2]', '[3]', '[4]']);
      const v = Vocab.view(q);
      assert.deepEqual(v.choices, q.choices, '문장 위치 보기는 섞지 않음');
      const set2 = sets.find((s) => s.id === q.set);
      for (let n = 1; n <= 4; n++) assert.ok(set2.docs.some((d) => d.sents.includes(`[${n}]`)));
    }
  }
  // 정답이 한 위치에 몰리지 않음
  const pos = [0, 1, 2, 3].map((k) => questions.filter((q) => q.qtype !== 'insert' && q.answer === k).length);
  assert.ok(Math.min(...pos) >= 5, '정답 위치가 한쪽에 몰리지 않음');
});

test('독해 지문 고르기와 점수 반영', () => {
  const st = { attempts: [], qprog: {}, reports: [], studyDays: [] };
  const first = Vocab.buildP7(st, sets, questions, { startLevel: 'mid' }, T);
  assert.ok(first.length >= 2);
  assert.ok(new Set(first.map((q) => q.set)).size === 1, '한 지문씩');
  assert.equal(first[0].level, 'mid');
  for (const q of first) Vocab.record(st, q, false, 50000, T, 'p7');
  assert.equal(st.attempts[0].module, 'part7');
  assert.equal(st.attempts[0].part, 7);
  const again = Vocab.buildP7(st, sets, questions, { startLevel: 'mid' }, srs.addDays(T, 1));
  assert.equal(again[0].set, first[0].set, '틀린 지문이 다음 날 다시');
  // 연습 문제·진단에 섞이지 않음
  assert.equal(Vocab.buildDaily(st, questions, {}, T, 10).length, 0);
  assert.ok(Vocab.buildTest(questions).every((q) => q.part !== 7));
  const ab = E.abilities(st);
  assert.ok(ab.skills.reading.weight > 0, '독해 기록이 reading 능력에 반영');
  assert.ok(ab.skills.reading.mean < 0, '다 틀리면 독해 능력이 낮게');
});
