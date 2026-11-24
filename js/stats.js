// 예상 점수와 성장 기록 계산
import * as srs from './srs.js';

// ---------- 예상 점수 ----------
// v2.2부터 engine.js가 계산한다 (기술별 능력 → 파트별 기대 정답 → 환산)
import * as Engine from './engine.js';

// ---------- 기간 나누기 ----------
const MD = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function mondayOf(d) {
  const [y, m, day] = d.split('-').map(Number);
  const wd = (new Date(y, m - 1, day).getDay() + 6) % 7; // 월=0
  return srs.addDays(d, -wd);
}

export const MODES = {
  day: { name: '일', count: 14, prevLabel: '어제', curLabel: '오늘' },
  week: { name: '주', count: 8, prevLabel: '지난주', curLabel: '이번 주' },
  month: { name: '월', count: 6, prevLabel: '지난달', curLabel: '이번 달' },
};

export function buckets(mode, t) {
  const out = [];
  if (mode === 'day') {
    for (let i = MODES.day.count - 1; i >= 0; i--) {
      const d = srs.addDays(t, -i);
      out.push({ start: d, end: d, label: MD(d) });
    }
  } else if (mode === 'week') {
    const mon = mondayOf(t);
    for (let i = MODES.week.count - 1; i >= 0; i--) {
      const s = srs.addDays(mon, -7 * i);
      const e = srs.addDays(s, 6);
      out.push({ start: s, end: e > t ? t : e, label: MD(s) + '~' });
    }
  } else {
    const [y, m] = t.split('-').map(Number);
    for (let i = MODES.month.count - 1; i >= 0; i--) {
      const dt = new Date(y, m - 1 - i, 1);
      const s = srs.today(dt);
      const e = srs.today(new Date(dt.getFullYear(), dt.getMonth() + 1, 0));
      out.push({ start: s, end: e > t ? t : e, label: `${dt.getMonth() + 1}월` });
    }
  }
  return out;
}

// ---------- 기간별 지표 ----------
// 새로 배운 단어 = 새 단어 학습(phase new)에서 처음 답한 날 기준
function firstNewDates(attempts) {
  const first = new Map();
  for (const a of attempts) {
    if (a.kind === 'word' && a.phase === 'new' && !first.has(a.targetId)) first.set(a.targetId, a.date);
  }
  return [...first.values()];
}

// 날짜별 스냅숏에서 기간 끝 시점 값 (없으면 그 전 마지막 값)
function snapAt(snapshots, end, key) {
  let best = null;
  for (const [d, v] of Object.entries(snapshots || {})) {
    if (d <= end && (!best || d > best[0])) best = [d, v];
  }
  return best ? best[1][key] ?? null : null;
}

export function series(state, mode, t) {
  const bs = buckets(mode, t);
  const firsts = firstNewDates(state.attempts);
  const days = new Set(state.studyDays);
  return bs.map((b) => {
    const in_ = (d) => d >= b.start && d <= b.end;
    const as = state.attempts.filter((a) => in_(a.date));
    const w = as.filter((a) => a.kind === 'word');
    const q = as.filter((a) => a.kind === 'question' && a.mode !== 'test');
    let studyDays = 0;
    for (let d = b.start; d <= b.end; d = srs.addDays(d, 1)) if (days.has(d)) studyDays++;
    const hasEv = state.attempts.some((a) => a.date <= b.end) || (state.mocks || []).some((m) => m.date <= b.end);
    const est = hasEv ? Engine.estimate(state, b.end, { range: false }) : null;
    return {
      ...b,
      studyDays,
      wordAnswers: w.length,
      questionAnswers: q.length,
      wordAcc: w.length ? w.filter((a) => a.correct).length / w.length : null,
      qAcc: q.length ? q.filter((a) => a.correct).length / q.length : null,
      learned: firsts.filter(in_).length,
      mastered: snapAt(state.snapshots, b.end, 'mastered'),
      score: est ? est.total : null,
      lc: est ? est.lc.score : null,
      rc: est ? est.rc.score : null,
      timeMs: as.reduce((s, a) => s + (a.timeMs || 0), 0),
    };
  });
}

// ---------- 기록 ----------
export function longestStreak(daysArr) {
  const days = [...new Set(daysArr)].sort();
  let best = 0;
  let cur = 0;
  let prev = null;
  for (const d of days) {
    cur = prev && srs.addDays(prev, 1) === d ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

export function masteredCount(words) {
  return words.filter((w) => w.srs && w.srs.box >= 3).length;
}

// 하루 한 번 단어 상태를 남겨서 '익숙함 이상 단어'가 늘어나는 걸 볼 수 있게
export function takeSnapshot(state, t) {
  state.snapshots = state.snapshots || {};
  const mastered = masteredCount(state.words);
  const learned = state.words.filter((w) => w.srs).length;
  const prev = state.snapshots[t];
  if (prev && prev.mastered === mastered && prev.learned === learned) return false;
  state.snapshots[t] = { mastered, learned };
  return true;
}

// 최근 n주 날짜별 활동량 (달력용)
export function activityMap(attempts) {
  const m = new Map();
  for (const a of attempts) m.set(a.date, (m.get(a.date) || 0) + 1);
  return m;
}
