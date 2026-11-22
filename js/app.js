import * as store from './storage.js';
import * as srs from './srs.js';
import * as tts from './tts.js';

let state = store.load();
let view = 'home';
let session = null;
const ui = { search: '', filter: 'all', openId: null, addOpen: false };

const $view = document.getElementById('view');
const $title = document.getElementById('title');

const SOON = {
  quiz: { title: '문제', desc: '어휘(2단계) · 문법(3단계) · 독해(4단계) · 듣기(5단계) 문제가 여기에 들어올 예정이에요.' },
  notes: { title: '오답노트', desc: '앱에서 틀린 문제와 교재 오답을 기록하는 곳이에요. 6단계에서 만들어요.' },
  stats: { title: '분석', desc: '유형별 정답률과 실수 유형 TOP 3를 보여줄 곳이에요. 풀이 기록은 지금부터 쌓이고 있어요.' },
};

// ---------- 공통 ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function persist() {
  if (!store.save(state)) toast('저장 공간이 부족해서 저장하지 못했어요. 백업을 먼저 해 주세요.');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function wordById(id) {
  return state.words.find((w) => w.id === id);
}

function say(text) {
  if (!tts.speak(text, { voice: state.settings.voice, rate: Number(state.settings.speechRate) || 0.9 })) {
    toast('이 브라우저는 음성 읽기를 지원하지 않아요');
  }
}

function go(next) {
  view = next;
  render();
  window.scrollTo(0, 0);
}

// ---------- 화면 ----------
function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => {
    const tab = b.dataset.tab;
    const active = tab === view || (tab === 'words' && view === 'study');
    b.classList.toggle('active', active);
  });
  document.body.classList.toggle('studying', view === 'study');

  const titles = { home: '토익 트레이너', words: '단어', study: '단어 학습', settings: '설정' };
  $title.textContent = titles[view] || SOON[view]?.title || '토익 트레이너';

  if (view === 'home') renderHome();
  else if (view === 'words') renderWords();
  else if (view === 'study') renderStudy();
  else if (view === 'settings') renderSettings();
  else renderSoon(view);
}

function boxCounts() {
  const counts = [0, 0, 0, 0, 0, 0]; // 0 = 아직 안 본 단어
  state.words.forEach((w) => counts[w.srs ? w.srs.box : 0]++);
  return counts;
}

function renderHome() {
  const t = srs.today();
  const due = state.words.filter((w) => srs.isDue(w, t)).length;
  const fresh = srs.newRemainingToday(state.words, state.settings, state.newIntroduced, t);
  const streak = srs.streak(state.studyDays, t);
  const counts = boxCounts();
  const total = state.words.length || 1;
  const exam = state.settings.examDate;
  const dday = exam ? srs.diffDays(t, exam) : null;
  const todayAttempts = state.attempts.filter((a) => a.date === t).length;

  const ddayText = dday === null ? '' : dday > 0 ? `D-${dday}` : dday === 0 ? 'D-DAY' : `D+${-dday}`;
  const segs = [
    ['새 단어', counts[0], 'seg0'],
    ['1칸', counts[1], 'seg1'],
    ['2칸', counts[2], 'seg2'],
    ['3칸', counts[3], 'seg3'],
    ['4칸', counts[4], 'seg4'],
    ['5칸', counts[5], 'seg5'],
  ];

  $view.innerHTML = `
    <section class="hero">
      <div class="hero-top">
        <span class="goal">목표 ${esc(state.settings.targetScore)}점</span>
        ${ddayText ? `<span class="dday">${ddayText}</span>` : ''}
      </div>
      <p class="hero-title">${due + fresh > 0 ? '오늘 할 단어' : '오늘 단어는 끝!'}</p>
      <div class="today-grid">
        <div><strong>${due}</strong><span>복습</span></div>
        <div><strong>${fresh}</strong><span>새 단어</span></div>
        <div><strong>${streak}</strong><span>연속 학습일</span></div>
      </div>
      <button class="btn primary big" id="start" ${due + fresh === 0 ? 'disabled' : ''}>
        ${due + fresh > 0 ? `학습 시작 (${due + fresh}개)` : '내일 다시 만나요'}
      </button>
      ${todayAttempts ? `<p class="hint">오늘 ${todayAttempts}번 답했어요</p>` : ''}
    </section>

    <section class="card">
      <h2>단어 진행 상황 <small>${state.words.length}개</small></h2>
      <div class="bar">${segs.map(([, n, c]) => (n ? `<i class="${c}" style="flex:${n / total}"></i>` : '')).join('')}</div>
      <ul class="legend">${segs.map(([label, n, c]) => `<li><b class="${c}"></b>${label} ${n}</li>`).join('')}</ul>
      <p class="hint">5칸까지 올라간 단어는 30일 뒤에 다시 확인해요.</p>
    </section>

    ${!exam ? `<button class="card link" data-go="settings">시험 날짜를 정하면 D-day가 표시돼요 →</button>` : ''}
  `;
  $view.querySelector('#start')?.addEventListener('click', startStudy);
  $view.querySelector('[data-go]')?.addEventListener('click', () => go('settings'));
}

// ---------- 학습 ----------
function startStudy() {
  const t = srs.today();
  const queue = srs.buildQueue(state.words, state.settings, state.newIntroduced, t);
  if (!queue.length) return toast('오늘 할 단어가 없어요');
  session = {
    queue,
    i: 0,
    flipped: false,
    shownAt: performance.now(),
    failed: new Set(),
    firstResult: new Map(),
    total: new Set(queue).size,
  };
  go('study');
}

function renderStudy() {
  if (!session) return go('home');
  if (session.i >= session.queue.length) return renderSummary();

  const w = wordById(session.queue[session.i]);
  if (!w) {
    session.i++;
    return renderStudy();
  }
  const doneUnique = session.firstResult.size;
  const isNew = !w.srs;
  const retry = session.failed.has(w.id);

  $view.innerHTML = `
    <div class="study-top">
      <button class="btn ghost small" id="quit">그만하기</button>
      <span class="progress-text">${doneUnique} / ${session.total}</span>
    </div>
    <div class="progress"><i style="width:${(doneUnique / session.total) * 100}%"></i></div>

    <article class="flash ${session.flipped ? 'flipped' : ''}" id="flash" tabindex="0">
      <div class="flash-tags">
        ${isNew ? '<span class="tag new">새 단어</span>' : `<span class="tag">${w.srs.box}칸</span>`}
        ${retry ? '<span class="tag warn">다시</span>' : ''}
      </div>
      <p class="flash-word">${esc(w.word)}</p>
      <button class="icon-btn speak" id="speak" aria-label="발음 듣기">${ICON.speaker}</button>
      ${
        session.flipped
          ? `<div class="flash-back">
              <p class="pos">${esc(w.pos || '')}</p>
              <p class="meaning">${esc(w.meaning)}</p>
              ${w.example ? `<p class="example">${esc(w.example)}</p>` : ''}
              ${w.exampleKo ? `<p class="example-ko">${esc(w.exampleKo)}</p>` : ''}
            </div>`
          : `<p class="tap-hint">뜻을 떠올린 뒤 카드를 눌러 확인하세요</p>`
      }
    </article>

    <div class="answer-row">
      ${
        session.flipped
          ? `<button class="btn danger" id="no">몰랐어요</button>
             <button class="btn success" id="yes">알았어요</button>`
          : `<button class="btn primary wide" id="flip">뜻 보기</button>`
      }
    </div>
  `;

  $view.querySelector('#quit').addEventListener('click', () => {
    session = null;
    go('home');
  });
  $view.querySelector('#speak').addEventListener('click', (e) => {
    e.stopPropagation();
    say(w.word);
  });
  $view.querySelector('#flash').addEventListener('click', flip);
  $view.querySelector('#flip')?.addEventListener('click', flip);
  $view.querySelector('#no')?.addEventListener('click', () => answer(false));
  $view.querySelector('#yes')?.addEventListener('click', () => answer(true));
}

function flip() {
  if (!session || session.flipped) return;
  session.flipped = true;
  renderStudy();
}

function answer(correct) {
  const id = session.queue[session.i];
  const w = wordById(id);
  const t = srs.today();
  const wasNew = !w.srs;

  w.srs = srs.next(w.srs, correct, t, session.failed.has(id));

  if (wasNew && w.source === 'builtin') {
    if (state.newIntroduced.date !== t) state.newIntroduced = { date: t, count: 0 };
    state.newIntroduced.count++;
  }

  state.attempts.push({
    id: uid(),
    date: t,
    at: Date.now(),
    kind: 'word',
    targetId: id,
    level: w.level || 'basic',
    correct,
    timeMs: Math.round(performance.now() - session.shownAt),
    timedOut: false,
  });
  if (!state.studyDays.includes(t)) state.studyDays.push(t);

  if (!session.firstResult.has(id)) session.firstResult.set(id, correct);
  if (!correct) {
    session.failed.add(id);
    session.queue.push(id); // 이번 학습 끝에 한 번 더
  }

  session.i++;
  session.flipped = false;
  session.shownAt = performance.now();
  persist();
  renderStudy();
}

function renderSummary() {
  const first = [...session.firstResult.values()];
  const known = first.filter(Boolean).length;
  const missed = first.length - known;
  const missedWords = [...session.firstResult.entries()].filter(([, ok]) => !ok).map(([id]) => wordById(id)).filter(Boolean);

  $view.innerHTML = `
    <section class="hero done">
      <p class="hero-title">학습 완료!</p>
      <div class="today-grid two">
        <div><strong>${known}</strong><span>한 번에 맞힘</span></div>
        <div><strong>${missed}</strong><span>다시 본 단어</span></div>
      </div>
      <button class="btn primary big" id="home">홈으로</button>
    </section>
    ${
      missedWords.length
        ? `<section class="card"><h2>오늘 헷갈린 단어</h2><ul class="mini-list">
            ${missedWords.map((w) => `<li><b>${esc(w.word)}</b><span>${esc(w.meaning)}</span></li>`).join('')}
          </ul><p class="hint">내일 다시 나와요.</p></section>`
        : ''
    }
  `;
  session = null;
  $view.querySelector('#home').addEventListener('click', () => go('home'));
}

// ---------- 단어장 ----------
function statusOf(w, t) {
  if (!w.srs) return { label: '새 단어', cls: 'seg0' };
  if (w.srs.due <= t) return { label: `${w.srs.box}칸 · 오늘 복습`, cls: `seg${w.srs.box}` };
  return { label: `${w.srs.box}칸 · ${w.srs.due.slice(5).replace('-', '/')}`, cls: `seg${w.srs.box}` };
}

function filteredWords() {
  const t = srs.today();
  const q = ui.search.trim().toLowerCase();
  return state.words.filter((w) => {
    if (q && !w.word.toLowerCase().includes(q) && !w.meaning.includes(q)) return false;
    switch (ui.filter) {
      case 'new': return !w.srs;
      case 'due': return srs.isDue(w, t);
      case 'weak': return w.srs && w.srs.box <= 2;
      case 'done': return w.srs && w.srs.box === srs.MAX_BOX;
      case 'mine': return w.source !== 'builtin';
      default: return true;
    }
  });
}

function renderWords() {
  const t = srs.today();
  const queueSize = srs.buildQueue(state.words, state.settings, state.newIntroduced, t).length;

  $view.innerHTML = `
    <button class="btn primary big" id="start" ${queueSize ? '' : 'disabled'}>
      ${queueSize ? `오늘 학습 시작 (${queueSize}개)` : '오늘 학습 완료'}
    </button>

    <section class="card add ${ui.addOpen ? 'open' : ''}">
      <button class="add-toggle" id="add-toggle">${ui.addOpen ? '닫기' : '+ 단어 직접 추가'}</button>
      ${
        ui.addOpen
          ? `<form id="add-form" autocomplete="off">
              <label>단어<input name="word" required placeholder="예: negotiate" autocapitalize="off"></label>
              <label>뜻<input name="meaning" required placeholder="예: 협상하다"></label>
              <label>품사
                <select name="pos">
                  <option value="">선택 안 함</option>
                  ${['명', '동', '형', '부', '전', '접', '명·동'].map((p) => `<option>${p}</option>`).join('')}
                </select>
              </label>
              <label>예문 (선택)<input name="example" placeholder="영어 예문" autocapitalize="off"></label>
              <button class="btn primary wide" type="submit">추가하기</button>
            </form>`
          : ''
      }
    </section>

    <div class="search-row">
      <input type="search" id="search" placeholder="단어나 뜻 검색" value="${esc(ui.search)}" autocapitalize="off">
      <select id="filter">
        ${[
          ['all', '전체'],
          ['due', '오늘 복습'],
          ['new', '새 단어'],
          ['weak', '약한 단어 (1~2칸)'],
          ['done', '5칸 완료'],
          ['mine', '내가 추가'],
        ].map(([v, l]) => `<option value="${v}" ${ui.filter === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <ul class="word-list" id="word-list"></ul>
  `;

  renderWordList();

  $view.querySelector('#start').addEventListener('click', startStudy);
  $view.querySelector('#add-toggle').addEventListener('click', () => {
    ui.addOpen = !ui.addOpen;
    renderWords();
    if (ui.addOpen) $view.querySelector('input[name=word]')?.focus();
  });
  $view.querySelector('#add-form')?.addEventListener('submit', addWord);
  $view.querySelector('#search').addEventListener('input', (e) => {
    ui.search = e.target.value;
    renderWordList();
  });
  $view.querySelector('#filter').addEventListener('change', (e) => {
    ui.filter = e.target.value;
    renderWordList();
  });
  $view.querySelector('#word-list').addEventListener('click', onWordListClick);
}

function renderWordList() {
  const t = srs.today();
  const list = filteredWords();
  const $list = $view.querySelector('#word-list');
  if (!list.length) {
    $list.innerHTML = `<li class="empty">해당하는 단어가 없어요</li>`;
    return;
  }
  $list.innerHTML = list
    .map((w) => {
      const st = statusOf(w, t);
      const open = ui.openId === w.id;
      return `
      <li class="${open ? 'open' : ''}" data-id="${esc(w.id)}">
        <div class="row" data-act="toggle">
          <div class="main"><b>${esc(w.word)}</b><span>${esc(w.meaning)}</span></div>
          <span class="status"><i class="${st.cls}"></i>${st.label}</span>
        </div>
        ${
          open
            ? `<div class="detail">
                ${w.pos ? `<p class="pos">${esc(w.pos)}</p>` : ''}
                ${w.example ? `<p class="example">${esc(w.example)}</p>` : ''}
                ${w.exampleKo ? `<p class="example-ko">${esc(w.exampleKo)}</p>` : ''}
                <div class="detail-actions">
                  <button class="btn ghost small" data-act="speak">발음 듣기</button>
                  ${w.srs ? `<button class="btn ghost small" data-act="reset">처음부터 다시</button>` : ''}
                  ${w.source !== 'builtin' ? `<button class="btn ghost small danger-text" data-act="delete">삭제</button>` : ''}
                </div>
              </div>`
            : ''
        }
      </li>`;
    })
    .join('');
}

function onWordListClick(e) {
  const btn = e.target.closest('[data-act]');
  const li = e.target.closest('li[data-id]');
  if (!btn || !li) return;
  const w = wordById(li.dataset.id);
  if (!w) return;
  const act = btn.dataset.act;
  if (act === 'toggle') {
    ui.openId = ui.openId === w.id ? null : w.id;
  } else if (act === 'speak') {
    return say(w.word);
  } else if (act === 'reset') {
    if (!confirm(`'${w.word}'를 새 단어로 되돌릴까요?`)) return;
    w.srs = null;
    persist();
    toast('새 단어로 되돌렸어요');
  } else if (act === 'delete') {
    if (!confirm(`'${w.word}'를 삭제할까요?`)) return;
    state.words = state.words.filter((x) => x.id !== w.id);
    ui.openId = null;
    persist();
    toast('삭제했어요');
  }
  renderWordList();
}

function addWord(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const word = String(f.get('word') || '').trim();
  const meaning = String(f.get('meaning') || '').trim();
  if (!word || !meaning) return;
  if (state.words.some((w) => w.word.toLowerCase() === word.toLowerCase())) {
    return toast(`'${word}'는 이미 단어장에 있어요`);
  }
  state.words.push({
    id: 'u-' + uid(),
    word,
    meaning,
    pos: String(f.get('pos') || ''),
    example: String(f.get('example') || '').trim(),
    exampleKo: '',
    level: 'basic',
    tags: [],
    source: 'user',
    addedAt: Date.now(),
    srs: null,
  });
  persist();
  toast(`'${word}' 추가! 다음 학습에 먼저 나와요`);
  ui.search = '';
  renderWords();
  $view.querySelector('input[name=word]')?.focus();
}

// ---------- 설정 ----------
function renderSettings() {
  const s = state.settings;
  const voices = tts.englishVoices();

  $view.innerHTML = `
    <section class="card">
      <h2>학습</h2>
      <label class="field">목표 점수
        <input type="number" id="targetScore" min="10" max="990" step="5" value="${esc(s.targetScore)}" inputmode="numeric">
      </label>
      <label class="field">시험 날짜
        <input type="date" id="examDate" value="${esc(s.examDate)}">
      </label>
      <label class="field">하루 새 단어 수
        <input type="number" id="dailyNewWords" min="0" max="200" value="${esc(s.dailyNewWords)}" inputmode="numeric">
      </label>
    </section>

    <section class="card">
      <h2>발음</h2>
      ${
        tts.supported
          ? `<label class="field">음성
              <select id="voice">
                <option value="">기본 (영어)</option>
                ${voices.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === s.voice ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}
              </select>
            </label>
            <label class="field">속도 <span id="rateLabel">${Number(s.speechRate).toFixed(1)}x</span>
              <input type="range" id="speechRate" min="0.5" max="1.3" step="0.1" value="${esc(s.speechRate)}">
            </label>
            <button class="btn ghost small" id="testVoice">들어보기</button>`
          : '<p class="hint">이 브라우저는 음성 읽기를 지원하지 않아요.</p>'
      }
    </section>

    <section class="card">
      <h2>백업</h2>
      <p class="hint">학습 기록은 이 기기의 브라우저에만 저장돼요. 주소가 바뀌거나 브라우저 데이터가 지워지면 사라지니 가끔 백업해 두세요.</p>
      <div class="btn-row">
        <button class="btn primary" id="export">백업 파일 저장</button>
        <label class="btn ghost file-btn">백업 불러오기<input type="file" id="import" accept="application/json,.json"></label>
      </div>
    </section>

    <section class="card">
      <h2>초기화</h2>
      <button class="btn ghost danger-text" id="reset">모든 학습 기록 지우기</button>
    </section>

    <p class="version">토익 트레이너 · 1단계 (단어)</p>
  `;

  const num = (id, min, max) => {
    const el = $view.querySelector('#' + id);
    el.addEventListener('change', () => {
      let v = Math.round(Number(el.value));
      if (!Number.isFinite(v)) v = store.DEFAULT_SETTINGS[id];
      v = Math.min(max, Math.max(min, v));
      el.value = v;
      state.settings[id] = v;
      persist();
      toast('저장했어요');
    });
  };
  num('targetScore', 10, 990);
  num('dailyNewWords', 0, 200);

  $view.querySelector('#examDate').addEventListener('change', (e) => {
    state.settings.examDate = e.target.value;
    persist();
    toast('저장했어요');
  });

  if (tts.supported) {
    $view.querySelector('#voice').addEventListener('change', (e) => {
      state.settings.voice = e.target.value;
      persist();
    });
    const rate = $view.querySelector('#speechRate');
    rate.addEventListener('input', () => {
      $view.querySelector('#rateLabel').textContent = Number(rate.value).toFixed(1) + 'x';
    });
    rate.addEventListener('change', () => {
      state.settings.speechRate = Number(rate.value);
      persist();
    });
    $view.querySelector('#testVoice').addEventListener('click', () => say('The meeting has been postponed until Thursday.'));
  }

  $view.querySelector('#export').addEventListener('click', exportBackup);
  $view.querySelector('#import').addEventListener('change', importBackup);
  $view.querySelector('#reset').addEventListener('click', async () => {
    if (!confirm('모든 학습 기록과 직접 추가한 단어가 지워져요. 계속할까요?')) return;
    if (!confirm('정말 지울까요? 되돌릴 수 없어요.')) return;
    store.clearAll();
    state = store.load();
    await loadBuiltin();
    persist();
    toast('초기화했어요');
    go('home');
  });
}

async function exportBackup() {
  const name = `toeic-trainer-backup-${srs.today()}.json`;
  const file = new File([store.exportJSON(state)], name, { type: 'application/json' });
  // 아이폰: 공유 시트로 '파일에 저장' 가능
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('백업 파일을 저장했어요');
}

async function importBackup(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const next = store.parseImport(await file.text());
    const n = next.words.filter((w) => w.srs).length;
    if (!confirm(`백업을 불러오면 지금 기록을 덮어써요.\n(학습한 단어 ${n}개, 풀이 기록 ${next.attempts.length}개)\n계속할까요?`)) return;
    state = next;
    await loadBuiltin();
    persist();
    toast('백업을 불러왔어요');
    go('home');
  } catch (err) {
    toast(err.message || '불러오지 못했어요');
  }
}

function renderSoon(key) {
  const s = SOON[key];
  $view.innerHTML = `
    <section class="card soon">
      <p class="soon-badge">준비 중</p>
      <h2>${esc(s.title)}</h2>
      <p>${esc(s.desc)}</p>
    </section>`;
}

// ---------- 시작 ----------
async function loadBuiltin() {
  try {
    const res = await fetch('./data/words-basic.json');
    if (!res.ok) throw new Error(res.status);
    const list = await res.json();
    if (store.mergeBuiltin(state, list)) persist();
  } catch (e) {
    console.warn('내장 단어를 불러오지 못했어요', e);
  }
}

const ICON = {
  speaker:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
};

function bindGlobal() {
  document.querySelectorAll('.tabbar button').forEach((b) =>
    b.addEventListener('click', () => {
      if (view === 'study' && session && !confirm('학습을 그만둘까요? 답한 기록은 저장돼요.')) return;
      session = null;
      go(b.dataset.tab);
    }),
  );
  document.getElementById('btn-settings').addEventListener('click', () => {
    if (view === 'study' && session && !confirm('학습을 그만둘까요? 답한 기록은 저장돼요.')) return;
    session = null;
    go('settings');
  });

  // 키보드 (Mac에서 테스트할 때): Space 뒤집기, ← 몰랐어요, → 알았어요
  document.addEventListener('keydown', (e) => {
    if (view !== 'study' || !session || e.target.matches('input, select, textarea')) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      flip();
    } else if (session.flipped && e.key === 'ArrowLeft') answer(false);
    else if (session.flipped && e.key === 'ArrowRight') answer(true);
  });

  // 음성 목록이 늦게 로드되는 브라우저 대응
  tts.onVoicesChanged(() => {
    if (view === 'settings') renderSettings();
  });

  // 자정이 지나 앱으로 돌아왔을 때 홈 숫자 갱신
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && view === 'home') renderHome();
  });
}

function registerSW() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('서비스 워커 등록 실패', e));
  }
}

async function init() {
  bindGlobal();
  await loadBuiltin();
  render();
  registerSW();
  store.requestPersist();
}

init();
