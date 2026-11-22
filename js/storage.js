// 저장소 접근은 이 파일에서만 한다.
// 나중에 Capacitor(Preferences/SQLite)나 IndexedDB로 바꿀 때 이 파일만 고치면 된다.

const KEY = 'toeic-trainer:v1';
export const APP_ID = 'toeic-trainer';

export const DEFAULT_SETTINGS = {
  targetScore: 800,
  examDate: '',
  dailyNewWords: 20,
  levelUpRate: 0.8,
  voice: '',
  speechRate: 0.9,
  autoSpeak: true,
  clozeHint: true, // 빈칸 문제에서 해석을 바로 보여줄지
  startLevel: 'basic', // 새 단어 시작 수준: basic | mid
  level: '', // 시작 화면에서 고른 현재 점수대
  onboarded: false,
};

export function emptyState() {
  return {
    version: 1,
    words: [],
    attempts: [], // 모든 풀이 기록 (약점 분석의 재료)
    studyDays: [],
    newIntroduced: { date: '', count: 0 },
    settings: { ...DEFAULT_SETTINGS },
  };
}

function validWord(w) {
  return w && typeof w.id === 'string' && typeof w.word === 'string' && typeof w.meaning === 'string';
}

export function normalize(s) {
  const base = emptyState();
  if (!s || typeof s !== 'object') return base;
  return {
    version: 1,
    words: Array.isArray(s.words) ? s.words.filter(validWord) : [],
    attempts: Array.isArray(s.attempts) ? s.attempts : [],
    studyDays: Array.isArray(s.studyDays) ? s.studyDays.filter((d) => typeof d === 'string') : [],
    newIntroduced:
      s.newIntroduced && typeof s.newIntroduced.date === 'string'
        ? { date: s.newIntroduced.date, count: Number(s.newIntroduced.count) || 0 }
        : base.newIntroduced,
    settings: { ...base.settings, ...(s.settings && typeof s.settings === 'object' ? s.settings : {}) },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : emptyState();
  } catch (e) {
    console.warn('저장된 데이터를 읽지 못했어요', e);
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('저장 실패', e);
    return false;
  }
}

export function clearAll() {
  localStorage.removeItem(KEY);
}

// 브라우저가 저장 공간을 임의로 비우지 않도록 요청 (지원하는 경우만)
export async function requestPersist() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* 지원 안 하면 무시 */
  }
}

// 내장 단어 합치기: 새 단어는 추가, 기존 단어는 학습 기록(srs)을 유지한 채 내용만 갱신
export function mergeBuiltin(state, list, offset = 0) {
  const byId = new Map(state.words.map((w) => [w.id, w]));
  let changed = 0;
  list.forEach((w, i) => {
    const cur = byId.get(w.id);
    if (!cur) {
      state.words.push({ ...w, source: 'builtin', order: offset + i, srs: null });
      changed++;
    } else if (cur.source === 'builtin') {
      const fields = ['word', 'meaning', 'pos', 'example', 'exampleKo', 'level', 'tags'];
      if (fields.some((f) => JSON.stringify(cur[f]) !== JSON.stringify(w[f])) || cur.order !== offset + i) {
        fields.forEach((f) => (cur[f] = w[f]));
        cur.order = offset + i;
        changed++;
      }
    }
  });
  return changed;
}

export function exportJSON(state) {
  return JSON.stringify({ app: APP_ID, exportedAt: new Date().toISOString(), state });
}

export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON 형식의 파일이 아니에요');
  }
  if (!data || data.app !== APP_ID || !data.state) throw new Error('토익 트레이너 백업 파일이 아니에요');
  return normalize(data.state);
}
