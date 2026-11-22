import * as store from './storage.js';
import * as srs from './srs.js';
import * as tts from './tts.js';
import * as quiz from './quiz.js';
import * as Session from './session.js';

let state = store.load();
let view = 'home';
let session = null;
let advanceTimer = null;
const ui = { search: '', filter: 'all', openId: null, addOpen: false };

const EXTRA_NEW = 10; // "새 단어 더" 한 번에 추가할 수
const PRACTICE_MAX = 15;

const $view = document.getElementById('view');
const $title = document.getElementById('title');

const SOON = {
  quiz: { title: '문제', desc: '어휘(2단계) · 문법(3단계) · 독해(4단계) · 듣기(5단계) 문제가 여기에 들어올 예정이에요.' },
  notes: { title: '오답노트', desc: '앱에서 틀린 문제와 교재 오답을 기록하는 곳이에요. 6단계에서 만들어요.' },
  stats: { title: '분석', desc: '유형별 정답률과 실수 유형 TOP 3를 보여줄 곳이에요. 풀이 기록은 지금부터 쌓이고 있어요.' },
};

const SESSION_TITLE = { daily: '오늘 학습', extra: '새 단어 추가 학습', practice: '약한 단어 연습' };

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

function say(text, quiet = false) {
  const ok = tts.speak(text, { voice: state.settings.voice, rate: Number(state.settings.speechRate) || 0.9 });
  if (!ok && !quiet) toast('이 브라우저는 음성 읽기를 지원하지 않아요');
}

function go(next) {
  clearTimeout(advanceTimer);
  view = next;
  render();
  window.scrollTo(0, 0);
}

// ---------- 학습 대상 계산 ----------
function dailyPlan(t = srs.today()) {
  const ids = srs.buildQueue(state.words, state.settings, state.newIntroduced, t);
  const words = ids.map(wordById).filter(Boolean);
  return { reviews: words.filter((w) => w.srs), fresh: words.filter((w) => !w.srs) };
}

function extraFresh() {
  return state.words
    .filter((w) => !w.srs)
    .sort((a, b) => (a.source === 'builtin') - (b.source === 'builtin') || (a.order ?? a.addedAt ?? 0) - (b.order ?? b.addedAt ?? 0))
    .slice(0, EXTRA_NEW);
}

// 약한 단어: 아직 복습일이 안 된 단어 중 1~2칸이거나 최근 7일 안에 틀린 단어
function weakWords(t = srs.today()) {
  const since = srs.addDays(t, -7);
  const recentWrong = new Set(state.attempts.filter((a) => a.kind === 'word' && !a.correct && a.date >= since).map((a) => a.targetId));
  return state.words
    .filter((w) => w.srs && !srs.isDue(w, t) && (w.srs.box <= 2 || recentWrong.has(w.id)))
    .sort((a, b) => a.srs.box - b.srs.box || Math.random() - 0.5)
    .slice(0, PRACTICE_MAX);
}

function startSession(kind) {
  const t = srs.today();
  let parts;
  if (kind === 'daily') parts = dailyPlan(t);
  else if (kind === 'extra') parts = { fresh: extraFresh() };
  else parts = { practice: weakWords(t) };

  const s = Session.create(kind, parts);
  if (!s.tasks.length) return toast(kind === 'practice' ? '연습할 약한 단어가 없어요' : '학습할 단어가 없어요');
  session = s;
  go('study');
}

// ---------- 화면 ----------
function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => {
    const tab = b.dataset.tab;
    b.classList.toggle('active', tab === view || (tab === 'words' && view === 'study'));
  });
  document.body.classList.toggle('studying', view === 'study');

  const titles = { home: '토익 트레이너', words: '단어', settings: '설정' };
  $title.textContent = view === 'study' ? SESSION_TITLE[session?.kind] || '학습' : titles[view] || SOON[view]?.title || '토익 트레이너';

  if (view === 'home') renderHome();
  else if (view === 'words') renderWords();
  else if (view === 'study') renderStudy();
  else if (view === 'settings') renderSettings();
  else renderSoon(view);
}

function boxCounts() {
  const counts = [0, 0, 0, 0, 0, 0];
  state.words.forEach((w) => counts[w.srs ? w.srs.box : 0]++);
  return counts;
}

function extraButtons() {
  const unseen = state.words.filter((w) => !w.srs).length;
  const weak = weakWords().length;
  return `
    <div class="extra-row">
      <button class="btn ghost" data-start="extra" ${unseen ? '' : 'disabled'}>
        <b>새 단어 ${Math.min(EXTRA_NEW, unseen)}개 더</b><small>${unseen ? `남은 새 단어 ${unseen}개` : '새 단어를 다 봤어요'}</small>
      </button>
      <button class="btn ghost" data-start="practice" ${weak ? '' : 'disabled'}>
        <b>약한 단어 연습</b><small>${weak ? `${weak}개 · 일정은 그대로` : '약한 단어가 없어요'}</small>
      </button>
    </div>`;
}

function bindStartButtons(root = $view) {
  root.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => startSession(b.dataset.start)));
}

function renderHome() {
  const t = srs.today();
  const { reviews, fresh } = dailyPlan(t);
  const todo = reviews.length + fresh.length;
  const streak = srs.streak(state.studyDays, t);
  const counts = boxCounts();
  const total = state.words.length || 1;
  const exam = state.settings.examDate;
  const dday = exam ? srs.diffDays(t, exam) : null;
  const ddayText = dday === null ? '' : dday > 0 ? `D-${dday}` : dday === 0 ? 'D-DAY' : `D+${-dday}`;
  const learnedToday = state.newIntroduced.date === t ? state.newIntroduced.count : 0;
  const answeredToday = state.attempts.filter((a) => a.date === t).length;
  const goal = Number(state.settings.dailyNewWords) || 0;

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
      <p class="hero-title">${todo ? '오늘 할 단어' : '오늘 목표 달성!'}</p>
      <div class="today-grid">
        <div><strong>${todo ? reviews.length : learnedToday}</strong><span>${todo ? '복습' : '오늘 외운 단어'}</span></div>
        <div><strong>${todo ? fresh.length : answeredToday}</strong><span>${todo ? '새 단어' : '오늘 푼 문제'}</span></div>
        <div><strong>${streak}</strong><span>연속 학습일</span></div>
      </div>
      ${
        todo
          ? `<button class="btn primary big" data-start="daily">학습 시작 · 약 ${estimateMinutes(reviews.length, fresh.length)}분</button>
             ${learnedToday ? `<p class="hint">오늘 새 단어 ${learnedToday}/${goal}개 외웠어요</p>` : ''}`
          : `<p class="hint left">더 하고 싶다면 추가로 할 수 있어요.</p>${extraButtons()}`
      }
    </section>

    <section class="card">
      <h2>단어 진행 상황 <small>${state.words.length}개</small></h2>
      <div class="bar">${segs.map(([, n, c]) => (n ? `<i class="${c}" style="flex:${n / total}"></i>` : '')).join('')}</div>
      <ul class="legend">${segs.map(([label, n, c]) => `<li><b class="${c}"></b>${label} ${n}</li>`).join('')}</ul>
      <p class="hint">칸이 올라갈수록 복습 간격이 길어져요 (1일 → 3일 → 7일 → 14일 → 30일).</p>
    </section>

    ${!exam ? `<button class="card link" data-go="settings">시험 날짜를 정하면 D-day가 표시돼요 →</button>` : ''}
  `;
  bindStartButtons();
  $view.querySelector('[data-go]')?.addEventListener('click', () => go('settings'));
}

// 새 단어 1개 ≈ 소개+문제 2개, 복습 1개 ≈ 문제 1개
function estimateMinutes(reviews, fresh) {
  return Math.max(1, Math.round((reviews * 8 + fresh * 25) / 60));
}

// ---------- 학습 ----------
function renderStudy() {
  if (!session) return go('home');
  if (Session.finished(session)) return renderSummary();

  const task = Session.current(session);
  const w = wordById(task.id);
  if (!w) {
    session.i++;
    return renderStudy();
  }
  if (!session.question) session.question = quiz.makeQuestion(task.step, w, state.words);
  const q = session.question;
  const a = session.answered;

  // 발음 자동 재생: 문제당 한 번 (뜻→단어, 빈칸 문제는 답하기 전에 읽으면 정답이 들리므로 답한 뒤)
  const spokenKey = session.i + ':' + (a ? 'a' : 'q');
  if (state.settings.autoSpeak && session.spoken !== spokenKey) {
    const before = ['intro', 'meaning', 'recall'].includes(task.step);
    if ((before && !a) || (!before && a)) {
      session.spoken = spokenKey;
      say(w.word, true);
    }
  }

  const progress = session.i / session.tasks.length; // 틀리면 문제가 늘어나서 바가 살짝 뒤로 갈 수 있음
  const tags = [
    task.phase === 'new' && task.step === 'intro' ? '<span class="tag new">새 단어</span>' : '',
    task.phase === 'review' && w.srs ? `<span class="tag">${w.srs.box}칸</span>` : '',
    task.phase === 'practice' ? '<span class="tag">연습</span>' : '',
    task.retry ? '<span class="tag warn">다시</span>' : '',
  ].join('');

  $view.innerHTML = `
    <div class="study-top">
      <button class="icon-btn" id="quit" aria-label="그만하기">${ICON.close}</button>
      <div class="progress"><i style="width:${progress * 100}%"></i></div>
      <span class="progress-text">${session.done.size}/${session.total}</span>
    </div>
    <article class="qcard ${a ? (a.ok ? 'is-ok' : 'is-wrong') : ''}">
      <div class="flash-tags">${tags}</div>
      <button class="icon-btn speak" id="speak" aria-label="발음 듣기">${ICON.speaker}</button>
      ${cardBody(task, w, q, a)}
    </article>
    <div class="answer-area">${answerArea(task, w, q, a)}</div>
  `;
  bindStudy(task, w, q);
}

function exampleBlock(w) {
  return `${w.example ? `<p class="example">${quiz.highlight(w.example, w.word, esc)}</p>` : ''}
          ${w.exampleKo ? `<p class="example-ko">${esc(w.exampleKo)}</p>` : ''}`;
}

function cardBody(task, w, q, a) {
  const pos = w.pos ? `<p class="pos">${esc(w.pos)}</p>` : '';
  switch (task.step) {
    case 'intro':
      return `
        <p class="q-label">새 단어를 외워 보세요</p>
        <p class="flash-word">${esc(w.word)}</p>
        ${pos}
        <p class="meaning">${esc(w.meaning)}</p>
        <div class="ex-box">${exampleBlock(w)}</div>`;
    case 'meaning':
      return `
        <p class="q-label">뜻을 고르세요</p>
        <p class="flash-word">${esc(w.word)}</p>
        ${a ? `${pos}<div class="ex-box">${exampleBlock(w)}</div>` : ''}`;
    case 'word':
      return `
        <p class="q-label">알맞은 단어를 고르세요</p>
        <p class="meaning big">${esc(w.meaning)}</p>
        ${pos}
        ${a ? `<div class="ex-box">${exampleBlock(w)}</div>` : ''}`;
    case 'cloze':
      if (q.type !== 'cloze') return cardBody({ ...task, step: 'word' }, w, q, a);
      return `
        <p class="q-label">빈칸에 들어갈 단어 <small>(보기는 기본형)</small></p>
        <p class="cloze">${
          a ? quiz.highlight(w.example, w.word, esc) : `${esc(q.before)}<span class="blank">&nbsp;</span>${esc(q.after)}`
        }</p>
        ${w.exampleKo ? `<p class="example-ko">${esc(w.exampleKo)}</p>` : ''}
        ${a ? `<p class="meaning small">${esc(w.word)} · ${esc(w.meaning)}</p>` : ''}`;
    case 'recall':
      return `
        <p class="q-label">뜻을 떠올려 보세요</p>
        <p class="flash-word">${esc(w.word)}</p>
        ${
          session.revealed
            ? `${pos}<p class="meaning">${esc(w.meaning)}</p><div class="ex-box">${exampleBlock(w)}</div>`
            : '<p class="tap-hint">떠올린 뒤 아래 버튼을 눌러 확인하세요</p>'
        }`;
  }
  return '';
}

function answerArea(task, w, q, a) {
  if (task.step === 'intro') {
    return `
      <div class="answer-row">
        <button class="btn ghost" data-act="known">이미 알아요</button>
        <button class="btn primary" data-act="seen">외웠어요</button>
      </div>`;
  }
  if (task.step === 'recall') {
    if (!session.revealed) return `<button class="btn primary big" data-act="reveal">뜻 확인하기</button>`;
    return `
      <div class="answer-row three">
        <button class="btn danger" data-act="forgot">몰랐어요</button>
        <button class="btn warn" data-act="unsure">헷갈렸어요</button>
        <button class="btn success" data-act="know">알았어요</button>
      </div>`;
  }
  // 보기 문제
  const options = q.choices
    .map((c, idx) => {
      let cls = '';
      if (a) {
        if (idx === q.answer) cls = 'correct';
        else if (idx === a.choice) cls = 'wrong';
        else cls = 'dim';
      }
      return `<button class="option ${cls}" data-choice="${idx}" ${a ? 'disabled' : ''}><span class="num">${idx + 1}</span>${esc(c)}</button>`;
    })
    .join('');
  return `
    <div class="options">${options}</div>
    ${
      a
        ? a.ok
          ? `<p class="feedback ok">정답!</p>`
          : `<button class="btn primary big" data-act="next">다음</button>`
        : `<button class="link-btn" data-act="dontknow">모르겠어요</button>`
    }`;
}

function bindStudy(task, w, q) {
  $view.querySelector('#quit').addEventListener('click', () => {
    clearTimeout(advanceTimer);
    session = null;
    go('home');
    toast('여기까지 저장했어요');
  });
  $view.querySelector('#speak').addEventListener('click', () => say(w.word));
  $view.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', () => choose(Number(b.dataset.choice))));
  $view.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
}

function choose(idx) {
  if (!session || session.answered) return;
  const q = session.question;
  const ok = idx === q.answer;
  session.answered = { choice: idx, ok };
  renderStudy();
  if (ok) {
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => submit('correct'), 700);
  }
}

function act(name) {
  if (!session) return;
  const task = Session.current(session);
  switch (name) {
    case 'seen':
    case 'known':
    case 'know':
    case 'unsure':
    case 'forgot':
      return submit(name);
    case 'reveal':
      session.revealed = true;
      return renderStudy();
    case 'dontknow':
      if (session.answered) return;
      session.answered = { choice: -1, ok: false };
      return renderStudy();
    case 'next':
      return submit(session.answered?.ok ? 'correct' : 'wrong');
  }
  return task;
}

function submit(result) {
  clearTimeout(advanceTimer);
  if (!session || Session.finished(session)) return;
  const w = wordById(Session.current(session).id);
  Session.submit(session, state, w, result, srs.today());
  persist();
  renderStudy();
}

function renderSummary() {
  const s = session;
  const first = [...s.firstResult.values()];
  const rate = first.length ? Math.round((first.filter(Boolean).length / first.length) * 100) : null;
  const missed = [...s.failed].map(wordById).filter(Boolean);
  const t = srs.today();
  const stillTodo = dailyPlan(t);
  const todoLeft = stillTodo.reviews.length + stillTodo.fresh.length;

  const stats = [];
  if (s.learned) stats.push([s.learned, '새로 외운 단어']);
  if (s.reviewed) stats.push([s.reviewed, '복습한 단어']);
  if (s.kind === 'practice') stats.push([s.done.size, '연습한 단어']);
  if (s.skipped) stats.push([s.skipped, '이미 아는 단어']);
  if (rate !== null) stats.push([rate + '%', '한 번에 맞힌 비율']);

  $view.innerHTML = `
    <section class="hero done">
      <p class="hero-title">${s.kind === 'daily' && !todoLeft ? '오늘 목표 달성!' : '학습 완료!'}</p>
      <div class="today-grid ${stats.length === 2 ? 'two' : ''}">
        ${stats.slice(0, 3).map(([n, l]) => `<div><strong>${n}</strong><span>${l}</span></div>`).join('')}
      </div>
      ${todoLeft ? `<button class="btn primary big" data-start="daily">남은 오늘 학습 이어하기 (${todoLeft}개)</button>` : extraButtons()}
      <button class="btn ghost wide home-btn" id="home">홈으로</button>
    </section>
    ${
      missed.length
        ? `<section class="card"><h2>헷갈린 단어</h2><ul class="mini-list">
            ${missed.map((w) => `<li><b>${esc(w.word)}</b><span>${esc(w.meaning)}</span></li>`).join('')}
          </ul><p class="hint">${s.kind === 'practice' ? '1칸으로 내려서 내일 다시 나와요.' : '내일 다시 나와요.'}</p></section>`
        : ''
    }
  `;
  session = null;
  bindStartButtons();
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
  const { reviews, fresh } = dailyPlan();
  const todo = reviews.length + fresh.length;

  $view.innerHTML = `
    ${
      todo
        ? `<button class="btn primary big" data-start="daily">오늘 학습 시작 (${todo}개)</button>`
        : extraButtons()
    }

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
              <label>예문 (선택 · 넣으면 빈칸 문제로도 나와요)<input name="example" placeholder="영어 예문" autocapitalize="off"></label>
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
  bindStartButtons();
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
                ${exampleBlock(w)}
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
  const actName = btn.dataset.act;
  if (actName === 'toggle') {
    ui.openId = ui.openId === w.id ? null : w.id;
  } else if (actName === 'speak') {
    return say(w.word);
  } else if (actName === 'reset') {
    if (!confirm(`'${w.word}'를 새 단어로 되돌릴까요?`)) return;
    w.srs = null;
    persist();
    toast('새 단어로 되돌렸어요');
  } else if (actName === 'delete') {
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
      <p class="hint">목표를 채운 뒤에도 '새 단어 ${EXTRA_NEW}개 더'로 추가 학습할 수 있어요.</p>
    </section>

    <section class="card">
      <h2>발음</h2>
      ${
        tts.supported
          ? `<label class="switch"><span>단어 발음 자동 재생</span><input type="checkbox" id="autoSpeak" ${s.autoSpeak ? 'checked' : ''}></label>
            <label class="field">음성
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

    <p class="version">토익 트레이너 · 1단계 (단어) v1.1</p>
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
    $view.querySelector('#autoSpeak').addEventListener('change', (e) => {
      state.settings.autoSpeak = e.target.checked;
      persist();
    });
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
  close:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

function leaveStudyOk() {
  // 답할 때마다 저장되므로 확인 없이 나가도 됨
  clearTimeout(advanceTimer);
  session = null;
  return true;
}

function bindGlobal() {
  document.querySelectorAll('.tabbar button').forEach((b) =>
    b.addEventListener('click', () => {
      leaveStudyOk();
      go(b.dataset.tab);
    }),
  );
  document.getElementById('btn-settings').addEventListener('click', () => {
    if (view === 'study') return; // 학습 중에는 숨김
    go('settings');
  });

  // 키보드 (Mac에서 테스트할 때): 1~4 보기 선택, Enter 다음/확인
  document.addEventListener('keydown', (e) => {
    if (view !== 'study' || !session || Session.finished(session) || e.target.matches('input, select, textarea')) return;
    const task = Session.current(session);
    const n = Number(e.key);
    if (task.step === 'intro') {
      if (e.key === 'Enter' || e.key === ' ') act('seen');
    } else if (task.step === 'recall') {
      if (!session.revealed && (e.key === 'Enter' || e.key === ' ')) act('reveal');
      else if (session.revealed && n >= 1 && n <= 3) act(['forgot', 'unsure', 'know'][n - 1]);
    } else if (!session.answered && n >= 1 && n <= 4) choose(n - 1);
    else if (session.answered && (e.key === 'Enter' || e.key === ' ')) act('next');
    else return;
    e.preventDefault();
  });

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
