// 간격 반복: 암기 단계 5개 (외우는 중 → 완벽)
// 단계별 복습 간격(일). 맞히면 한 단계 위, 틀리면 외우는 중으로.
export const INTERVALS = [1, 3, 7, 14, 30];
export const MAX_BOX = INTERVALS.length;

// 암기 단계 이름 (0 = 아직 안 본 단어)
export const STAGES = ['새 단어', '외우는 중', '익히는 중', '익숙함', '거의 외움', '완벽'];
export function stageName(box) {
  return STAGES[box || 0] || STAGES[0];
}

// 단어 수준 3단계
export const LEVEL_ORDER = ['basic', 'mid', 'adv'];
export const LEVEL_NAMES = { basic: '기초', mid: '중급', adv: '고급' };

// 새 단어가 나오는 순서: 직접 추가 → '몰라요'로 고른 단어 → 시작 수준 → 그보다 높은 수준 → 낮은 수준
export function newWordOrder(settings) {
  const start = Math.max(0, LEVEL_ORDER.indexOf(settings?.startLevel || 'basic'));
  const rank = (w) => {
    if (w.source !== 'builtin') return 0;
    if (w.flagged) return 1;
    const li = Math.max(0, LEVEL_ORDER.indexOf(w.level));
    return 2 + (li >= start ? li - start : 10 + (start - li));
  };
  return (a, b) => rank(a) - rank(b) || (a.order ?? a.addedAt ?? 0) - (b.order ?? b.addedAt ?? 0);
}

// 기기 현지 시간 기준 YYYY-MM-DD (UTC로 계산하면 한국에서는 오전 9시 전에 날짜가 어긋남)
export function today(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return today(new Date(y, m - 1, d + n));
}

// b - a (일)
export function diffDays(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function isDue(word, t) {
  return !!word.srs && word.srs.due <= t;
}

// 답한 결과로 다음 srs 상태 계산
// failedThisSession: 이번 학습에서 이미 틀렸던 카드면, 다시 맞혀도 박스 1에서 내일 복습
export function next(prev, correct, t, failedThisSession = false) {
  if (!correct) return { box: 1, due: t };
  if (failedThisSession) return { box: 1, due: addDays(t, INTERVALS[0]) };
  const box = Math.min((prev?.box || 0) + 1, MAX_BOX);
  return { box, due: addDays(t, INTERVALS[box - 1]) };
}

// 오늘 학습할 카드 순서: 복습할 단어(오래 밀린 순) → 직접 추가한 새 단어 → 내장 새 단어
// 복습 상한: 하루에 복습하는 단어 수를 제한하고, 밀린 복습이 많으면 새 단어를 줄인다
// reviewedToday = 오늘 이미 복습한 단어 수
export function reviewPlan(words, settings, introduced, t, reviewedToday = 0) {
  const due = words
    .filter((w) => isDue(w, t))
    .sort((a, b) => a.srs.due.localeCompare(b.srs.due) || a.srs.box - b.srs.box);
  const cap = Math.max(0, Number(settings.dailyReviewMax ?? 60));
  const capLeft = Math.max(0, cap - reviewedToday);
  const backlog = due.length;
  const base = builtinRoom(settings, introduced, t);
  // 밀린 복습이 상한을 넘으면 새 단어 0개, 상한의 절반을 넘으면 절반으로
  let room = base;
  if (backlog > cap) room = 0;
  else if (backlog > cap / 2) room = Math.floor(base / 2);
  return { due, reviews: due.slice(0, capLeft), backlog, cap, capLeft, newRoom: room, newCut: base - room };
}

export function buildQueue(words, settings, introduced, t, reviewedToday = 0) {
  const plan = reviewPlan(words, settings, introduced, t, reviewedToday);
  // 직접 추가한 단어는 하루 한도와 상관없이 바로 나온다 (한도는 내장 단어에만 적용)
  const order = newWordOrder(settings);
  const mine = words.filter((w) => !w.srs && w.source !== 'builtin').sort(order);
  const builtin = words
    .filter((w) => !w.srs && w.source === 'builtin')
    .sort(order)
    .slice(0, plan.newRoom);
  return [...plan.reviews, ...mine, ...builtin].map((w) => w.id);
}

function builtinRoom(settings, introduced, t) {
  const usedToday = introduced?.date === t ? introduced.count : 0;
  return Math.max(0, (settings.dailyNewWords || 0) - usedToday);
}

export function newRemainingToday(words, settings, introduced, t, reviewedToday = 0) {
  const plan = reviewPlan(words, settings, introduced, t, reviewedToday);
  const mine = words.filter((w) => !w.srs && w.source !== 'builtin').length;
  const builtin = words.filter((w) => !w.srs && w.source === 'builtin').length;
  return mine + Math.min(builtin, plan.newRoom);
}

// 오늘 또는 어제까지 이어진 연속 학습일
export function streak(days, t) {
  const set = new Set(days);
  let d = set.has(t) ? t : addDays(t, -1);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}
