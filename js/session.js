// 학습 세션: 어떤 순서로 어떤 문제를 낼지, 답에 따라 복습 일정을 어떻게 바꿀지
import * as srs from './srs.js';
import { shuffle, canCloze } from './quiz.js';

export const BATCH = 5; // 새 단어는 5개씩 묶어서 외우기
const RETRY_GAP = 3; // 틀린 문제는 3문제 뒤에 다시
const MAX_FAILS = 3; // 한 학습에서 같은 단어를 3번 틀리면 오늘은 그만 (내일 다시)

// 복습 문제 유형: 외울수록 어렵게
export function reviewStep(w) {
  const box = w.srs?.box || 1;
  if (box <= 2) return 'meaning';
  if (box === 3) return canCloze(w) ? 'cloze' : 'word';
  return 'recall';
}

function newTasks(words) {
  const tasks = [];
  for (let i = 0; i < words.length; i += BATCH) {
    const batch = words.slice(i, i + BATCH);
    batch.forEach((w) => tasks.push({ id: w.id, step: 'intro', phase: 'new' }));
    shuffle(batch).forEach((w) => tasks.push({ id: w.id, step: 'meaning', phase: 'new' }));
    shuffle(batch).forEach((w) => tasks.push({ id: w.id, step: canCloze(w) ? 'cloze' : 'word', phase: 'new' }));
  }
  return tasks;
}

// kind: 'daily' | 'extra' | 'practice'
export function create(kind, { reviews = [], fresh = [], practice = [] }) {
  const tasks = [
    ...shuffle(reviews).map((w) => ({ id: w.id, step: reviewStep(w), phase: 'review' })),
    ...newTasks(fresh),
    ...shuffle(practice).map((w) => ({
      id: w.id,
      step: (w.srs?.box || 1) <= 2 || !canCloze(w) ? 'meaning' : 'cloze',
      phase: 'practice',
    })),
  ];
  return {
    kind,
    tasks,
    i: 0,
    total: new Set(tasks.map((t) => t.id)).size,
    done: new Set(),
    failed: new Set(),
    fails: new Map(), // 단어별 틀린 횟수
    givenUp: 0,
    firstResult: new Map(), // 단어별 첫 결과 (요약용)
    learned: 0,
    reviewed: 0,
    skipped: 0,
    question: null, // 지금 문제(보기 순서 고정용)
    answered: null, // { choice, ok }
    revealed: false, // 떠올리기 카드에서 뜻을 봤는지
    shownAt: performance.now(),
  };
}

export const current = (s) => s.tasks[s.i];
export const finished = (s) => s.i >= s.tasks.length;

function hasLater(s, id) {
  for (let k = s.i + 1; k < s.tasks.length; k++) if (s.tasks[k].id === id) return true;
  return false;
}

function insertRetry(s, task) {
  const step = task.step === 'recall' ? 'meaning' : task.step;
  s.tasks.splice(Math.min(s.i + 1 + RETRY_GAP, s.tasks.length), 0, { ...task, step, retry: true });
}

function graduateNew(state, w, t) {
  w.srs = { box: 1, due: srs.addDays(t, srs.INTERVALS[0]) };
  if (w.source === 'builtin') {
    if (state.newIntroduced.date !== t) state.newIntroduced = { date: t, count: 0 };
    state.newIntroduced.count++;
  }
}

// result: intro → 'seen' | 'known' / 보기 문제 → 'correct' | 'wrong' / 떠올리기 → 'know' | 'unsure' | 'forgot'
export function submit(s, state, w, result, t) {
  const task = current(s);
  const ok = ['seen', 'correct', 'know', 'unsure'].includes(result);
  const timeMs = Math.round(performance.now() - s.shownAt);

  if (task.step !== 'intro') {
    state.attempts.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: t,
      at: Date.now(),
      kind: 'word',
      type: task.step, // meaning | cloze | word | recall
      phase: task.phase,
      targetId: w.id,
      level: w.level || 'basic',
      correct: ok,
      grade: result,
      timeMs,
      timedOut: false,
    });
    if (!s.firstResult.has(w.id)) s.firstResult.set(w.id, ok);
  }
  if (!state.studyDays.includes(t)) state.studyDays.push(t);

  // 이미 아는 단어: 3칸으로 올리고 남은 문제 제거 (하루 새 단어 수에는 안 셈)
  if (result === 'known') {
    w.srs = { box: 3, due: srs.addDays(t, srs.INTERVALS[2]) };
    s.tasks = s.tasks.filter((x, k) => k <= s.i || x.id !== w.id);
    s.skipped++;
    s.done.add(w.id);
    return advance(s);
  }

  if (!ok) {
    s.failed.add(w.id);
    const fails = (s.fails.get(w.id) || 0) + 1;
    s.fails.set(w.id, fails);
    if (task.phase === 'review' && !task.retry) w.srs = { box: 1, due: t }; // 오늘 다시 맞혀야 함
    if (task.phase === 'practice') w.srs = { box: 1, due: srs.addDays(t, 1) };
    if (fails < MAX_FAILS) {
      insertRetry(s, task);
      return advance(s);
    }
    // 너무 많이 틀린 단어는 붙잡고 있지 않고 내일 다시 (지치지 않게)
    s.tasks = s.tasks.filter((x, k) => k <= s.i || x.id !== w.id);
    if (task.phase === 'new') graduateNew(state, w, t);
    else w.srs = { box: 1, due: srs.addDays(t, srs.INTERVALS[0]) };
    s.givenUp++;
    s.done.add(w.id);
    return advance(s);
  }

  if (!hasLater(s, w.id)) {
    // 이 단어의 마지막 문제를 맞힘
    if (task.phase === 'new') {
      graduateNew(state, w, t);
      s.learned++;
    } else if (task.phase === 'review') {
      if (s.failed.has(w.id)) w.srs = { box: 1, due: srs.addDays(t, srs.INTERVALS[0]) };
      else if (result === 'unsure') {
        const box = Math.max(1, w.srs.box - 1);
        w.srs = { box, due: srs.addDays(t, srs.INTERVALS[box - 1]) };
      } else w.srs = srs.next(w.srs, true, t);
      s.reviewed++;
    }
    // practice: 맞히면 일정 변화 없음
    s.done.add(w.id);
  }
  return advance(s);
}

function advance(s) {
  s.i++;
  s.question = null;
  s.answered = null;
  s.revealed = false;
  s.hint = false;
  s.shownAt = performance.now();
}
