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
  dailyQuestions: 10, // 오늘의 어휘 문제 수
  dailyReviewMax: 60, // 하루 복습 상한 (밀리면 새 단어 자동 감소)
  lastBackup: '', // 마지막으로 백업 파일을 저장한 날
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
    qprog: {}, // 문제별 진행 상황 { 문제id: { seen, wrong, last, srs } }
    snapshots: {}, // 날짜별 단어 상태 { 날짜: { mastered, learned } }
    reports: [], // '이 문제 이상해요' 신고 { id, kind, targetId, reason, memo, date }
    mocks: [], // 성적 기록: 교재 모의고사(파트별 맞힌 개수) · 공식 시험(LC·RC)
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
    qprog: s.qprog && typeof s.qprog === 'object' ? s.qprog : {},
    snapshots: s.snapshots && typeof s.snapshots === 'object' ? s.snapshots : {},
    reports: Array.isArray(s.reports) ? s.reports.filter((r) => r && r.targetId) : [],
    mocks: Array.isArray(s.mocks) ? s.mocks.filter((m) => m && typeof m.date === 'string') : [],
    studyDays: Array.isArray(s.studyDays) ? s.studyDays.filter((d) => typeof d === 'string') : [],
    newIntroduced:
      s.newIntroduced && typeof s.newIntroduced.date === 'string'
        ? { date: s.newIntroduced.date, count: Number(s.newIntroduced.count) || 0 }
        : base.newIntroduced,
    settings: { ...base.settings, ...(s.settings && typeof s.settings === 'object' ? s.settings : {}) },
  };
}

// ---------- IndexedDB (v2.2~) ----------
// 풀이 기록이 쌓이면 localStorage(약 5MB)를 넘기 때문에 IndexedDB에 저장한다.
// IndexedDB를 못 쓰는 환경에서는 예전처럼 localStorage를 쓴다.
const DB_NAME = 'toeic-trainer';
const STORE = 'kv';
let dbPromise = null;
let onError = () => {};

export function setErrorHandler(fn) {
  onError = fn;
}

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function idb(mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const r = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(r?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

let useIDB = true;

export async function load() {
  try {
    const v = await idb('readonly', (st) => st.get('state'));
    if (v) return normalize(v);
    // 예전 버전(localStorage) 기록을 옮겨 오기
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = normalize(JSON.parse(raw));
      await idb('readwrite', (st) => st.put(s, 'state'));
      localStorage.removeItem(KEY);
      return s;
    }
    return emptyState();
  } catch (e) {
    console.warn('IndexedDB를 쓸 수 없어 localStorage를 사용해요', e);
    useIDB = false;
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? normalize(JSON.parse(raw)) : emptyState();
    } catch (e2) {
      console.warn('저장된 데이터를 읽지 못했어요', e2);
      return emptyState();
    }
  }
}

// 저장은 기다리지 않는다 (IndexedDB는 put을 부르는 순간 데이터를 복사해 둠)
export function save(state) {
  if (useIDB) {
    idb('readwrite', (st) => st.put(state, 'state')).catch((e) => {
      console.error('저장 실패', e);
      onError(e);
    });
    return true;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('저장 실패', e);
    return false;
  }
}

export async function clearAll() {
  localStorage.removeItem(KEY);
  if (useIDB) {
    try {
      await idb('readwrite', (st) => st.delete('state'));
    } catch (e) {
      console.warn(e);
    }
  }
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
      const fields = ['word', 'meaning', 'pos', 'example', 'exampleKo', 'level', 'tags', 'syn'];
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
