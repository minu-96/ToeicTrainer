// 간격 반복 (라이트너 박스 5칸)
// 박스 1~5의 복습 간격(일). 맞히면 다음 칸, 틀리면 1칸으로.
export const INTERVALS = [1, 3, 7, 14, 30];
export const MAX_BOX = INTERVALS.length;

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
export function buildQueue(words, settings, introduced, t) {
  const due = words
    .filter((w) => isDue(w, t))
    .sort((a, b) => a.srs.due.localeCompare(b.srs.due) || a.srs.box - b.srs.box);

  // 직접 추가한 단어는 하루 한도와 상관없이 바로 나온다 (한도는 내장 단어에만 적용)
  const mine = words.filter((w) => !w.srs && w.source !== 'builtin').sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
  const builtin = words
    .filter((w) => !w.srs && w.source === 'builtin')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, builtinRoom(settings, introduced, t));

  return [...due, ...mine, ...builtin].map((w) => w.id);
}

function builtinRoom(settings, introduced, t) {
  const usedToday = introduced?.date === t ? introduced.count : 0;
  return Math.max(0, (settings.dailyNewWords || 0) - usedToday);
}

export function newRemainingToday(words, settings, introduced, t) {
  const mine = words.filter((w) => !w.srs && w.source !== 'builtin').length;
  const builtin = words.filter((w) => !w.srs && w.source === 'builtin').length;
  return mine + Math.min(builtin, builtinRoom(settings, introduced, t));
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
