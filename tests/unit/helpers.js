// 테스트용 가상 사용자 만들기 (고정 시드 난수)
import * as E from '../../js/engine.js';
import * as srs from '../../js/srs.js';

export function rand(seed = 3) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

export const day = (i, base = srs.today()) => srs.addDays(base, -i);

// 실력 theta인 사람이 어휘 문제 nQ개, 단어 문제 nW개를 푼 기록
export function simulatedUser(theta, { nQ = 0, nW = 0, level = 'mid', seed = 3 } = {}) {
  const r = rand(seed);
  const st = { attempts: [], mocks: [], reports: [], settings: { level } };
  const types = ['form', 'colloc', 'confuse'];
  const levels = ['basic', 'mid', 'adv'];
  for (let i = 0; i < nQ; i++) {
    const lv = levels[i % 3];
    const ok = r() < E.pCorrect(theta, E.LEVEL_B[lv]);
    st.attempts.push({ kind: 'question', type: types[i % 3], level: lv, correct: ok, timeMs: 15000, targetMs: 20000, targetId: 'q' + i, date: day(Math.floor(i / 10)) });
  }
  for (let i = 0; i < nW; i++) {
    const lv = levels[i % 3];
    const ok = r() < E.pCorrect(theta, E.LEVEL_B[lv] - 0.5);
    st.attempts.push({ kind: 'word', type: 'meaning', level: lv, correct: ok, timeMs: 4000, targetId: 'w' + i, date: day(Math.floor(i / 30)) });
  }
  return st;
}
