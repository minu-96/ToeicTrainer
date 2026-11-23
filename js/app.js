import * as store from './storage.js';
import * as srs from './srs.js';
import * as tts from './tts.js';
import * as quiz from './quiz.js';
import * as Session from './session.js';
import * as Vocab from './vocab.js';

let state = store.load();
let view = 'home';
let session = null;
let advanceTimer = null;
let filter = null; // 아는 단어 거르기 진행 상태
let bank = []; // 어휘 문제 은행
let vqs = null; // 어휘 문제 풀이 진행 상태
let vqTimer = null;
const ui = { search: '', filter: 'all', openId: null, addOpen: false };

const EXTRA_NEW = 10; // "새 단어 더" 한 번에 추가할 수
const PRACTICE_MAX = 15;

const $view = document.getElementById('view');
const $title = document.getElementById('title');

const SOON = {
  notes: { title: '오답노트', desc: '앱에서 틀린 문제와 교재 오답을 기록하는 곳이에요. 6단계에서 만들어요.' },
  stats: { title: '분석', desc: '유형별 정답률과 실수 유형 TOP 3를 보여줄 곳이에요. 풀이 기록은 지금부터 쌓이고 있어요.' },
};

// 시작 화면 점수대: 못하는 사람 / 적당한 사람 / 잘하는 사람
const LEVELS = [
  { id: 'low', label: '500점 이하', who: '아직 시험 전이거나 기초가 부족해요', daily: 10, start: 'basic', hint: true, target: 700 },
  { id: 'mid', label: '500~750점', who: '기본은 되는데 점수를 더 올리고 싶어요', daily: 15, start: 'mid', hint: false, target: 850 },
  { id: 'high', label: '750점 이상', who: '고득점을 굳히고 900점대를 노려요', daily: 20, start: 'adv', hint: false, target: 950 },
];
// 예전 버전에서 저장한 점수대 값 호환
const LEVEL_ALIAS = { 200: 'low', 400: 'low', 600: 'mid', 800: 'high' };
const levelGroup = (id) => LEVEL_ALIAS[id] || id;

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

const POS_NAMES = { 명: '명사', 동: '동사', 형: '형용사', 부: '부사', 전: '전치사', 접: '접속사' };
function posLabel(p) {
  return String(p || '')
    .split('·')
    .map((x) => POS_NAMES[x.trim()] || x.trim())
    .filter(Boolean)
    .join(' · ');
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
    .sort(srs.newWordOrder(state.settings))
    .slice(0, EXTRA_NEW);
}

// 약한 단어: 아직 복습일이 안 된 단어 중 외우는 중·익히는 중, 어려운 단어, 최근 7일 안에 틀린 단어
function weakWords(t = srs.today()) {
  const since = srs.addDays(t, -7);
  const recentWrong = new Set(state.attempts.filter((a) => a.kind === 'word' && !a.correct && a.date >= since).map((a) => a.targetId));
  return state.words
    .filter((w) => w.srs && !srs.isDue(w, t) && (w.srs.box <= 2 || Session.isHard(w) || recentWrong.has(w.id)))
    .sort((a, b) => Session.isHard(b) - Session.isHard(a) || a.srs.box - b.srs.box || Math.random() - 0.5)
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
    b.classList.toggle('active', tab === view || (tab === 'words' && view === 'study') || (tab === 'quiz' && view === 'vq'));
  });
  document.body.classList.toggle('studying', ['study', 'filter', 'welcome', 'vq'].includes(view));

  const titles = { home: '토익 트레이너', words: '단어', settings: '설정', filter: '아는 단어 거르기', welcome: '토익 트레이너', quiz: '문제', vq: vqs?.mode === 'test' ? '수준 진단' : '어휘 문제' };
  $title.textContent = view === 'study' ? SESSION_TITLE[session?.kind] || '학습' : titles[view] || SOON[view]?.title || '토익 트레이너';

  if (view === 'home') renderHome();
  else if (view === 'words') renderWords();
  else if (view === 'study') renderStudy();
  else if (view === 'settings') renderSettings();
  else if (view === 'welcome') renderWelcome();
  else if (view === 'filter') renderFilter();
  else if (view === 'quiz') renderQuizHome();
  else if (view === 'vq') renderVQ();
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

function bindGoButtons(root = $view) {
  root.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => (b.dataset.go === 'filter' ? startFilter() : go(b.dataset.go))),
  );
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

  const segs = srs.STAGES.map((label, i) => [label, counts[i], 'seg' + i]);

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

    ${vocabTodayCard()}

    <section class="card">
      <h2>단어 진행 상황 <small>${state.words.length}개</small></h2>
      <div class="bar">${segs.map(([, n, c]) => (n ? `<i class="${c}" style="flex:${n / total}"></i>` : '')).join('')}</div>
      <ol class="stage-guide">
        <li><b class="seg0"></b>새 단어<em>${counts[0]}</em><span>아직 안 본 단어</span></li>
        ${srs.STAGES.slice(1).map((n, i) => `<li><b class="seg${i + 1}"></b>${n}<em>${counts[i + 1]}</em><span>${srs.INTERVALS[i]}일 뒤 복습</span></li>`).join('')}
      </ol>
      <p class="hint">맞힐수록 한 단계씩 올라가고 복습 간격이 길어져요. 틀리면 '외우는 중'으로 돌아가요.</p>
    </section>

    ${
      ['mid', 'high'].includes(levelGroup(state.settings.level)) && !state.settings.filterUsed && filterCandidates().length
        ? `<button class="card link" data-go="filter"><b>아는 단어 빠르게 거르기 →</b><small>${
            state.settings.startLevel === 'adv' ? '기초·중급' : '기초'
          } 단어 중 이미 아는 건 건너뛰고 모르는 단어만 학습해요</small></button>`
        : ''
    }
    ${!exam ? `<button class="card link" data-go="settings">시험 날짜를 정하면 D-day가 표시돼요 →</button>` : ''}
  `;
  bindStartButtons();
  bindGoButtons();
  bindVqButtons();
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
    Session.isHard(w) ? '<span class="tag warn">어려운 단어</span>' : '',
    task.phase === 'review' && w.srs ? `<span class="tag stage s${w.srs.box}">${srs.stageName(w.srs.box)}</span>` : '',
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
  const pos = w.pos ? `<p class="pos">${esc(posLabel(w.pos))}</p>` : '';
  switch (task.step) {
    case 'intro':
      return `
        <p class="q-label">${task.relearn ? '자주 틀리는 단어예요. 한 번 더 보고 가요' : '새 단어를 외워 보세요'}</p>
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
        ${
          w.exampleKo
            ? a || state.settings.clozeHint || session.hint
              ? `<p class="example-ko">${esc(w.exampleKo)}</p>`
              : `<button class="link-btn small" data-act="hint">해석 보기</button>`
            : ''
        }
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
  if (task.step === 'intro' && task.relearn) {
    return `<button class="btn primary big" data-act="seen">다시 봤어요</button>`;
  }
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
          ? a.slow
            ? `<p class="feedback ok">정답! <small>10초 넘게 걸려서 단계는 그대로예요</small></p>`
            : `<p class="feedback ok">정답!</p>`
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
  const timeMs = Math.round(performance.now() - session.shownAt);
  const task = Session.current(session);
  const slow = ok && task.phase === 'review' && timeMs > Session.SLOW_MS;
  session.answered = { choice: idx, ok, timeMs, slow };
  renderStudy();
  if (ok) {
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => submit('correct'), slow ? 1600 : 700);
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
    case 'hint':
      session.hint = true;
      return renderStudy();
    case 'dontknow':
      if (session.answered) return;
      session.answered = { choice: -1, ok: false, timeMs: Math.round(performance.now() - session.shownAt) };
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
  if (s.newPerfect + s.newShaky) stats.push([s.newPerfect + s.newShaky, '새로 배운 단어']);
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
      ${stageMoves(s)}
      ${todoLeft ? `<button class="btn primary big" data-start="daily">남은 오늘 학습 이어하기 (${todoLeft}개)</button>` : extraButtons()}
      <button class="btn ghost wide home-btn" id="home">홈으로</button>
    </section>
    ${
      missed.length
        ? `<section class="card"><h2>헷갈린 단어</h2><ul class="mini-list">
            ${missed.map((w) => `<li><b>${esc(w.word)}</b><span>${esc(w.meaning)}</span></li>`).join('')}
          </ul><p class="hint">${s.kind === 'practice' ? "'외우는 중'으로 돌아가서 내일 다시 나와요." : '내일 다시 나와요.'}</p></section>`
        : ''
    }
  `;
  session = null;
  bindStartButtons();
  $view.querySelector('#home').addEventListener('click', () => go('home'));
}

// 이번 학습에서 단어들이 어느 단계로 갔는지
function stageMoves(s) {
  const rows = [
    [s.newPerfect, '새 단어 → 익히는 중', '한 번도 안 틀림 · 3일 뒤 복습', 's2'],
    [s.newShaky, '새 단어 → 외우는 중', '틀린 적 있음 · 내일 복습', 's1'],
    [s.reviewUp, '복습 → 한 단계 위', '빠르고 정확하게 맞힘', 's4'],
    [s.reviewKeep, '복습 → 단계 유지·한 단계 아래', '느렸거나 헷갈림', 's3'],
    [s.reviewDown, '복습 → 외우는 중', '틀림 · 내일 다시', 's1'],
  ].filter(([n]) => n);
  if (!rows.length) return '';
  return `<ul class="moves">${rows
    .map(([n, label, sub, c]) => `<li><span class="tag stage ${c}">${n}개</span><div><b>${label}</b><small>${sub}</small></div></li>`)
    .join('')}</ul>`;
}

// ---------- 단어장 ----------
function statusOf(w, t) {
  if (!w.srs) return { label: w.flagged ? '새 단어 · 먼저 학습' : '새 단어', cls: 'seg0' };
  const name = (Session.isHard(w) ? '어려운 단어 · ' : '') + srs.stageName(w.srs.box);
  if (w.srs.due <= t) return { label: `${name} · 오늘 복습`, cls: `seg${w.srs.box}` };
  return { label: `${name} · ${w.srs.due.slice(5).replace('-', '/')}`, cls: `seg${w.srs.box}` };
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
      case 'hard': return Session.isHard(w);
      case 'done': return w.srs && w.srs.box === srs.MAX_BOX;
      case 'mine': return w.source !== 'builtin';
      case 'basic': return w.source === 'builtin' && w.level === 'basic';
      case 'mid': return w.source === 'builtin' && w.level === 'mid';
      case 'adv': return w.source === 'builtin' && w.level === 'adv';
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
    ${
      filterCandidates().length
        ? `<button class="btn ghost wide filter-btn" data-go="filter">아는 단어 빠르게 거르기 (${filterCandidates().length}개)</button>`
        : ''
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
                  ${['명', '동', '형', '부', '전', '접', '명·동'].map((p) => `<option value="${p}">${posLabel(p)}</option>`).join('')}
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
          ['weak', '약한 단어 (외우는 중·익히는 중)'],
          ['hard', '어려운 단어 (자주 틀림)'],
          ['done', '완벽'],
          ['basic', '기초 단어'],
          ['mid', '중급 단어'],
          ['adv', '고급 단어'],
          ['mine', '내가 추가'],
        ].map(([v, l]) => `<option value="${v}" ${ui.filter === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <ul class="word-list" id="word-list"></ul>
  `;

  renderWordList();
  bindStartButtons();
  bindGoButtons();
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
                ${w.pos ? `<p class="pos">${esc(posLabel(w.pos))}</p>` : ''}
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
      <label class="field">오늘의 어휘 문제 수
        <input type="number" id="dailyQuestions" min="1" max="50" value="${esc(s.dailyQuestions)}" inputmode="numeric">
      </label>
      <label class="field">하루 새 단어 수
        <input type="number" id="dailyNewWords" min="0" max="200" value="${esc(s.dailyNewWords)}" inputmode="numeric">
      </label>
      <p class="hint">목표를 채운 뒤에도 '새 단어 ${EXTRA_NEW}개 더'로 추가 학습할 수 있어요.</p>
      <label class="field">새 단어 시작 수준
        <select id="startLevel">
          <option value="basic" ${s.startLevel === 'basic' ? 'selected' : ''}>기초 단어부터</option>
          <option value="mid" ${s.startLevel === 'mid' ? 'selected' : ''}>중급 단어부터</option>
          <option value="adv" ${s.startLevel === 'adv' ? 'selected' : ''}>고급 단어부터</option>
        </select>
      </label>
      <label class="switch"><span>빈칸 문제 해석 바로 보기</span><input type="checkbox" id="clozeHint" ${s.clozeHint ? 'checked' : ''}></label>
    </section>

    <section class="card">
      <h2>수준</h2>
      <p class="hint">지금 설정: ${esc(srs.LEVEL_NAMES[s.startLevel] || '기초')} 단어부터 · 하루 새 단어 ${esc(s.dailyNewWords)}개</p>
      <button class="btn ghost wide" id="retest" style="margin-top:10px">3분 수준 진단 다시 받기</button>
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

    <p class="version">토익 트레이너 · 2단계 (단어 + 어휘) v2.0</p>
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
  num('dailyQuestions', 1, 50);
  $view.querySelector('#retest').addEventListener('click', () => startVQ('test'));

  $view.querySelector('#startLevel').addEventListener('change', (e) => {
    state.settings.startLevel = e.target.value;
    persist();
    toast('저장했어요');
  });
  $view.querySelector('#clozeHint').addEventListener('change', (e) => {
    state.settings.clozeHint = e.target.checked;
    persist();
  });

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
    go('welcome');
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

// ---------- 2단계: 어휘 문제 ----------
function questionsToday(t = srs.today()) {
  return state.attempts.filter((a) => a.kind === 'question' && a.mode !== 'test' && a.date === t).length;
}

function vocabTodayCard() {
  if (!bank.length) return '';
  const goal = Number(state.settings.dailyQuestions) || 10;
  const done = questionsToday();
  const due = Vocab.dueList(state, bank, srs.today()).length;
  const pct = Math.min(1, done / goal);
  return `
    <section class="card vcard">
      <div class="vcard-top">
        <h2>오늘의 어휘 문제 <small>Part 5</small></h2>
        <span class="count">${Math.min(done, goal)}/${goal}</span>
      </div>
      <div class="progress"><i style="width:${pct * 100}%"></i></div>
      <p class="hint">${
        done >= goal ? '오늘 목표를 채웠어요. 더 풀고 싶으면 이어서 풀 수 있어요.' : due ? `틀렸던 문제 ${due}개가 다시 나와요.` : '품사 자리 · 어울리는 단어 · 헷갈리는 단어를 섞어서 내요.'
      }</p>
      <button class="btn ${done >= goal ? 'ghost' : 'primary'} wide" data-vq="daily">${done >= goal ? `${goal}문제 더 풀기` : `풀기 · 약 ${Math.max(1, Math.round(((goal - done) * 30) / 60))}분`}</button>
    </section>`;
}

function bindVqButtons(root = $view) {
  root.querySelectorAll('[data-vq]').forEach((b) => b.addEventListener('click', () => startVQ(b.dataset.vq, b.dataset.type)));
}

function renderQuizHome() {
  const st = Vocab.typeStats(state);
  const answered = Object.keys(state.qprog).length;
  $view.innerHTML = `
    ${vocabTodayCard()}
    <section class="card">
      <h2>유형별 연습 <small>푼 문제 ${answered}/${bank.length}</small></h2>
      <ul class="type-list">
        ${Object.entries(Vocab.TYPES)
          .map(([k, v]) => {
            const r = st[k];
            const rate = r.rate === null ? '' : Math.round(r.rate * 100);
            return `<li>
              <button data-vq="type" data-type="${k}">
                <div><b>${v.name}</b><small>${v.desc}</small></div>
                <span class="rate ${rate === '' ? '' : rate < 60 ? 'low' : rate < 80 ? 'mid' : 'high'}">${rate === '' ? '시작 전' : `${rate}%<small>${r.n}문제</small>`}</span>
              </button>
            </li>`;
          })
          .join('')}
      </ul>
      <p class="hint">정답률이 낮은 유형은 오늘의 어휘 문제에 더 자주 나와요.</p>
    </section>
    <button class="card link" data-vq="test"><b>3분 수준 진단 →</b><small>기초·중급·고급 문제 15개로 지금 수준을 확인하고 학습 설정을 맞춰요</small></button>
    <section class="card soon-list">
      <h2>준비 중</h2>
      <ul><li>문법 · Part 5 <span>3단계</span></li><li>독해 · Part 7 <span>4단계</span></li><li>듣기 · Part 1~4 <span>5단계</span></li></ul>
    </section>`;
  bindVqButtons();
}

function startVQ(mode, type, opts = {}) {
  if (!bank.length) return toast('문제를 불러오지 못했어요');
  const t = srs.today();
  let items;
  if (mode === 'daily') items = Vocab.buildDaily(state, bank, state.settings, t, Number(state.settings.dailyQuestions) || 10);
  else if (mode === 'type') items = Vocab.buildType(state, bank, type, state.settings, t);
  else items = Vocab.buildTest(bank);
  if (!items.length) return toast('풀 문제가 없어요');
  vqs = { mode, type, items, i: 0, results: [], added: [], fromWelcome: !!opts.fromWelcome, origin: view === 'vq' ? 'quiz' : view };
  vqPrepare();
  go('vq');
}

function vqPrepare() {
  const q = vqs.items[vqs.i];
  vqs.view = q ? Vocab.view(q) : null;
  vqs.answered = null;
  vqs.reason = null;
  vqs.shownAt = performance.now();
}

function renderVQ() {
  clearInterval(vqTimer);
  if (!vqs) return go('quiz');
  if (vqs.i >= vqs.items.length) return vqs.mode === 'test' ? renderTestResult() : renderVQSummary();
  const q = vqs.items[vqs.i];
  const v = vqs.view;
  const a = vqs.answered;
  const isTest = vqs.mode === 'test';
  const [before, after] = q.stem.split('____');
  const answerText = q.choices[q.answer];

  const options = v.choices
    .map((c, idx) => {
      let cls = '';
      if (a) cls = idx === v.answer ? 'correct' : idx === a.choice ? 'wrong' : 'dim';
      return `<button class="option ${cls}" data-choice="${idx}" ${a ? 'disabled' : ''}><span class="num">${idx + 1}</span>${esc(c)}</button>`;
    })
    .join('');

  $view.innerHTML = `
    <div class="study-top">
      <button class="icon-btn" id="quit" aria-label="그만하기">${ICON.close}</button>
      <div class="progress"><i style="width:${(vqs.i / vqs.items.length) * 100}%"></i></div>
      <span class="progress-text">${vqs.i + 1}/${vqs.items.length}</span>
    </div>
    <article class="qcard vq ${a ? (a.ok ? 'is-ok' : 'is-wrong') : ''}">
      <div class="flash-tags">
        <span class="tag">${Vocab.TYPES[q.type].name}</span>
        <span class="tag">${srs.LEVEL_NAMES[q.level]}</span>
      </div>
      <span class="timer ${a && a.timeMs > Vocab.TARGET_MS ? 'over' : ''}" id="vq-timer">${a ? Math.round(a.timeMs / 1000) : 0}초</span>
      <p class="q-label">빈칸에 알맞은 것을 고르세요</p>
      <p class="cloze left">${esc(before)}${a ? `<mark>${esc(answerText)}</mark>` : '<span class="blank">&nbsp;</span>'}${esc(after)}</p>
    </article>
    <div class="answer-area">
      <div class="options">${options}</div>
      ${!a ? `<button class="link-btn" data-act="dontknow">모르겠어요</button>` : isTest ? '' : explainBlock(q, v, a)}
    </div>`;

  $view.querySelector('#quit').addEventListener('click', () => {
    const back = vqs.fromWelcome ? 'welcome' : ['home', 'quiz', 'settings'].includes(vqs.origin) ? vqs.origin : 'quiz';
    vqs = null;
    clearInterval(vqTimer);
    go(back);
    toast('여기까지 저장했어요');
  });
  $view.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', () => vqChoose(Number(b.dataset.choice))));
  $view.querySelector('[data-act=dontknow]')?.addEventListener('click', () => vqChoose(-1));
  $view.querySelector('#vq-next')?.addEventListener('click', vqNext);
  $view.querySelectorAll('[data-reason]').forEach((b) =>
    b.addEventListener('click', () => {
      vqs.reason = vqs.reason === b.dataset.reason ? null : b.dataset.reason;
      if (vqs.attempt) vqs.attempt.reasonTag = vqs.reason || undefined;
      persist();
      $view.querySelectorAll('[data-reason]').forEach((x) => x.classList.toggle('on', x.dataset.reason === vqs.reason));
    }),
  );

  if (!a) {
    const el = $view.querySelector('#vq-timer');
    vqTimer = setInterval(() => {
      const sec = Math.floor((performance.now() - vqs.shownAt) / 1000);
      el.textContent = sec + '초';
      el.classList.toggle('over', sec * 1000 > Vocab.TARGET_MS);
    }, 1000);
  }
}

function explainBlock(q, v, a) {
  const sec = Math.round(a.timeMs / 1000);
  return `
    <section class="explain ${a.ok ? 'ok' : 'ng'}">
      <p class="explain-head">${a.ok ? '정답!' : a.choice < 0 ? '정답을 확인하세요' : '아쉬워요'}
        <small>${sec}초${a.timeMs > Vocab.TARGET_MS ? ' · 목표 20초보다 오래 걸렸어요' : ''}</small></p>
      <p class="clue"><b>단서</b>${esc(q.clue)}</p>
      <p class="exp">${esc(q.explanation)}</p>
      <p class="ko">${esc(q.ko)}</p>
      <ul class="choice-means">
        ${v.choices
          .map((c, idx) => `<li class="${idx === v.answer ? 'ans' : idx === a.choice ? 'picked' : ''}"><b>${esc(c)}</b><span>${esc(q.meanings?.[c] || '')}</span></li>`)
          .join('')}
      </ul>
      ${
        !a.ok
          ? `<p class="reason-label">왜 틀렸나요? <small>(선택 · 약점 분석에 쓰여요)</small></p>
             <div class="reasons">${Vocab.REASONS.map(([k, l]) => `<button class="chip ${vqs.reason === k ? 'on' : ''}" data-reason="${k}">${l}</button>`).join('')}</div>`
          : ''
      }
      ${a.addedWord ? `<p class="added">'${esc(a.addedWord)}'를 단어장에 추가했어요. 단어 학습에 먼저 나와요.</p>` : ''}
    </section>
    <button class="btn primary big" id="vq-next">${vqs.i + 1 >= vqs.items.length ? '결과 보기' : '다음 문제'}</button>`;
}

function vqChoose(idx) {
  if (!vqs || vqs.answered) return;
  clearInterval(vqTimer);
  const q = vqs.items[vqs.i];
  const ok = idx === vqs.view.answer;
  const timeMs = Math.round(performance.now() - vqs.shownAt);
  const t = srs.today();
  const attempt = Vocab.record(state, q, ok, timeMs, t, vqs.mode);
  let addedWord = null;
  if (!ok && vqs.mode !== 'test') {
    const w = Vocab.addAnswerWord(state, q);
    if (w) {
      addedWord = w.word;
      vqs.added.push(w);
    }
  }
  vqs.attempt = attempt;
  vqs.answered = { choice: idx, ok, timeMs, addedWord };
  vqs.results.push({ q, ok, timeMs });
  persist();
  renderVQ();
  if (vqs.mode === 'test') setTimeout(vqNext, 600);
  else $view.querySelector('.explain')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function vqNext() {
  if (!vqs || !vqs.answered) return;
  vqs.i++;
  vqPrepare();
  renderVQ();
  window.scrollTo(0, 0);
}

function renderVQSummary() {
  const r = vqs.results;
  const correct = r.filter((x) => x.ok).length;
  const avg = r.length ? Math.round(r.reduce((s, x) => s + x.timeMs, 0) / r.length / 1000) : 0;
  const slow = r.filter((x) => x.timeMs > Vocab.TARGET_MS).length;
  const byType = Object.keys(Vocab.TYPES)
    .map((k) => [k, r.filter((x) => x.q.type === k)])
    .filter(([, l]) => l.length);
  const wrong = r.filter((x) => !x.ok);
  const mode = vqs.mode;
  const type = vqs.type;
  const added = vqs.added.length;
  vqs = null;

  $view.innerHTML = `
    <section class="hero done">
      <p class="hero-title">${correct === r.length ? '전부 맞혔어요!' : '풀이 완료!'}</p>
      <div class="today-grid">
        <div><strong>${correct}/${r.length}</strong><span>정답</span></div>
        <div><strong>${avg}초</strong><span>평균 시간</span></div>
        <div><strong>${slow}</strong><span>20초 넘은 문제</span></div>
      </div>
      <ul class="moves">
        ${byType
          .map(([k, l]) => {
            const c = l.filter((x) => x.ok).length;
            return `<li><span class="tag stage ${c === l.length ? 's4' : c / l.length >= 0.5 ? 's2' : 's1'}">${c}/${l.length}</span><div><b>${Vocab.TYPES[k].name}</b><small>${Vocab.TYPES[k].desc}</small></div></li>`;
          })
          .join('')}
      </ul>
      ${added ? `<p class="hint">틀린 문제의 정답 단어 ${added}개를 단어장에 추가했어요.</p>` : ''}
      <button class="btn primary big" data-vq="${mode}" ${type ? `data-type="${type}"` : ''}>${mode === 'daily' ? '10문제 더 풀기' : '이 유형 더 풀기'}</button>
      <button class="btn ghost wide home-btn" data-go="quiz">문제 홈으로</button>
    </section>
    ${
      wrong.length
        ? `<section class="card"><h2>틀린 문제</h2><ul class="wrong-list">
            ${wrong.map((x) => `<li><p>${esc(x.q.stem.replace('____', '[' + x.q.choices[x.q.answer] + ']'))}</p><small>${esc(x.q.clue)}</small></li>`).join('')}
          </ul><p class="hint">틀린 문제는 내일 오늘의 어휘 문제에 다시 나와요.</p></section>`
        : ''
    }`;
  bindVqButtons();
  bindGoButtons();
}

function renderTestResult() {
  const { rate, rec } = Vocab.testResult(vqs.results);
  const lv = LEVELS.find((l) => l.id === rec);
  const fromWelcome = vqs.fromWelcome;
  vqs = null;
  $view.innerHTML = `
    <section class="hero done">
      <p class="hero-title">진단 결과</p>
      <ul class="level-bars">
        ${srs.LEVEL_ORDER.map((k) => {
          const pct = Math.round(rate[k] * 100);
          return `<li><span>${srs.LEVEL_NAMES[k]}</span><div class="bar"><i class="${pct >= 60 ? 'seg4' : pct >= 40 ? 'seg2' : 'seg1'}" style="flex:${Math.max(pct, 2) / 100}"></i></div><b>${pct}%</b></li>`;
        }).join('')}
      </ul>
      <p class="rec">추천: <b>${esc(lv.label)}</b> 수준<br><small>${srs.LEVEL_NAMES[lv.start]} 단어부터 · 하루 새 단어 ${lv.daily}개</small></p>
      <button class="btn primary big" id="apply">${fromWelcome ? '이 수준으로 시작하기' : '이 수준으로 설정 바꾸기'}</button>
      <button class="btn ghost wide home-btn" id="skip">${fromWelcome ? '직접 고를게요' : '그대로 둘게요'}</button>
    </section>
    <p class="hint center">진단 15문제는 정답률 계산에만 쓰이고, 틀린 문제는 나중에 다시 나와요.</p>`;
  $view.querySelector('#apply').addEventListener('click', () => {
    Object.assign(state.settings, {
      level: lv.id,
      dailyNewWords: lv.daily,
      startLevel: lv.start,
      clozeHint: lv.hint,
      ...(fromWelcome ? { targetScore: lv.target, onboarded: true } : {}),
    });
    persist();
    toast('학습 설정을 맞췄어요');
    go('home');
  });
  $view.querySelector('#skip').addEventListener('click', () => {
    if (fromWelcome) ui.level = rec;
    go(fromWelcome ? 'welcome' : 'quiz');
  });
}

// ---------- 시작 화면 ----------
function renderWelcome() {
  const sel = LEVELS.find((l) => l.id === ui.level);
  $view.innerHTML = `
    <section class="welcome">
      <p class="welcome-badge">처음 오셨네요</p>
      <h2>매일 조금씩, 잊을 때쯤 다시</h2>
      <ol class="how">
        <li><b>새 단어를 5개씩</b> 외우고, 바로 문제로 확인해요.</li>
        <li>맞힐수록 <b>외우는 중 → 완벽</b>으로 올라가고, 잊을 때쯤 다시 나와요.</li>
        <li>오늘 목표를 끝낸 뒤 <b>더 하고 싶으면</b> 추가로 할 수 있어요.</li>
      </ol>
    </section>
    <section class="card">
      <h2>지금 토익 점수는 어느 정도인가요?</h2>
      <div class="level-list">
        ${LEVELS.map(
          (l) => `<button class="level ${ui.level === l.id ? 'on' : ''}" data-level="${l.id}">
            <span class="level-top"><b>${esc(l.label)}</b><em>${srs.LEVEL_NAMES[l.start]}부터</em></span>
            <small>${esc(l.who)}</small>
          </button>`,
        ).join('')}
      </div>
      <p class="hint">${
        sel
          ? `하루 새 단어 ${sel.daily}개 · ${srs.LEVEL_NAMES[sel.start]} 단어부터 시작해요. 나중에 설정에서 바꿀 수 있어요.`
          : '점수대에 맞춰 하루 학습량과 단어 수준을 정해 드려요.'
      }</p>
      ${
        sel
          ? `<label class="field">목표 점수
              <input type="number" id="w-target" min="10" max="990" step="5" value="${esc(ui.target ?? sel.target)}" inputmode="numeric">
            </label>`
          : ''
      }
      <button class="btn primary big" id="begin" ${sel ? '' : 'disabled'}>시작하기</button>
      <button class="link-btn" id="w-test">잘 모르겠다면 3분 진단으로 정하기</button>
    </section>`;
  $view.querySelector('#w-test').addEventListener('click', () => startVQ('test', null, { fromWelcome: true }));
  $view.querySelectorAll('[data-level]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.level = b.dataset.level;
      ui.target = null;
      renderWelcome();
    }),
  );
  $view.querySelector('#w-target')?.addEventListener('input', (e) => (ui.target = e.target.value));
  $view.querySelector('#begin').addEventListener('click', () => {
    if (!sel) return;
    const target = Math.min(990, Math.max(10, Math.round(Number(ui.target ?? sel.target)) || sel.target));
    Object.assign(state.settings, {
      level: sel.id,
      dailyNewWords: sel.daily,
      startLevel: sel.start,
      clozeHint: sel.hint,
      targetScore: target,
      onboarded: true,
    });
    persist();
    go('home');
  });
}

// ---------- 아는 단어 빠르게 거르기 ----------
function filterCandidates() {
  return state.words
    .filter((w) => !w.srs && w.source === 'builtin' && !w.flagged)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); // 기초 → 중급 → 고급 순
}

function startFilter() {
  const ids = filterCandidates().map((w) => w.id);
  if (!ids.length) return toast('거를 새 단어가 없어요');
  filter = { ids, i: 0, known: 0, unknown: 0, reveal: false, history: [] };
  go('filter');
}

function renderFilter() {
  if (!filter) return go('home');
  if (filter.i >= filter.ids.length) return renderFilterDone();
  const w = wordById(filter.ids[filter.i]);
  if (!w) {
    filter.i++;
    return renderFilter();
  }
  $view.innerHTML = `
    <div class="study-top">
      <button class="icon-btn" id="quit" aria-label="그만하기">${ICON.close}</button>
      <div class="progress"><i style="width:${(filter.i / filter.ids.length) * 100}%"></i></div>
      <span class="progress-text">${filter.i}/${filter.ids.length}</span>
    </div>
    <article class="qcard">
      <div class="flash-tags"><span class="tag">${srs.LEVEL_NAMES[w.level] || '기초'}</span></div>
      <button class="icon-btn speak" id="speak" aria-label="발음 듣기">${ICON.speaker}</button>
      <p class="q-label">뜻을 바로 알 수 있는 단어인가요?</p>
      <p class="flash-word">${esc(w.word)}</p>
      ${
        filter.reveal
          ? `<p class="pos">${esc(posLabel(w.pos))}</p><p class="meaning">${esc(w.meaning)}</p>`
          : `<button class="link-btn" id="reveal">뜻 보고 판단하기</button>`
      }
    </article>
    <div class="answer-area">
      <div class="answer-row even">
        <button class="btn ghost" id="unknown">몰라요</button>
        <button class="btn success" id="known">알아요</button>
      </div>
      <p class="hint center">알아요 → '익숙함'으로 올리고 일주일 뒤 빈칸 문제로 확인해요<br>몰라요 → 다음 학습에 먼저 나와요
      ${filter.history.length ? `<br><button class="link-btn small inline" id="undo">방금 선택 되돌리기</button>` : ''}</p>
    </div>`;
  $view.querySelector('#quit').addEventListener('click', () => renderFilterDone());
  $view.querySelector('#speak').addEventListener('click', () => say(w.word));
  $view.querySelector('#reveal')?.addEventListener('click', () => {
    filter.reveal = true;
    renderFilter();
  });
  $view.querySelector('#known').addEventListener('click', () => filterAnswer(true));
  $view.querySelector('#unknown').addEventListener('click', () => filterAnswer(false));
  $view.querySelector('#undo')?.addEventListener('click', filterUndo);
}

function filterAnswer(known) {
  const w = wordById(filter.ids[filter.i]);
  filter.history.push({ id: w.id, srs: w.srs, flagged: w.flagged, known });
  if (known) {
    w.srs = { box: 3, due: srs.addDays(srs.today(), srs.INTERVALS[2]) };
    filter.known++;
  } else {
    w.flagged = true;
    filter.unknown++;
  }
  state.settings.filterUsed = true;
  filter.i++;
  filter.reveal = false;
  persist();
  renderFilter();
}

function filterUndo() {
  const h = filter.history.pop();
  if (!h) return;
  const w = wordById(h.id);
  w.srs = h.srs;
  if (h.flagged) w.flagged = true;
  else delete w.flagged;
  if (h.known) filter.known--;
  else filter.unknown--;
  filter.i--;
  persist();
  renderFilter();
}

function renderFilterDone() {
  const f = filter;
  filter = null;
  if (!f || !f.history.length) return go('home');
  $view.innerHTML = `
    <section class="hero done">
      <p class="hero-title">거르기 완료!</p>
      <div class="today-grid two">
        <div><strong>${f.known}</strong><span>알아요</span></div>
        <div><strong>${f.unknown}</strong><span>몰라요</span></div>
      </div>
      <p class="hint">아는 단어는 일주일 뒤에 빈칸 문제로 한 번 확인해요. 틀리면 다시 학습 대상이 돼요.</p>
      <button class="btn primary big" data-start="daily">모르는 단어 학습 시작</button>
      <button class="btn ghost wide home-btn" id="home">홈으로</button>
    </section>`;
  bindStartButtons();
  $view.querySelector('#home').addEventListener('click', () => go('home'));
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
    const sets = [
      ['./data/words-basic.json', 0],
      ['./data/words-mid.json', 1000],
      ['./data/words-adv.json', 2000],
    ];
    let changed = 0;
    for (const [url, offset] of sets) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(url + ' ' + res.status);
      changed += store.mergeBuiltin(state, await res.json(), offset);
    }
    if (changed) persist();
    const qres = await fetch('./data/vocab-questions.json');
    if (qres.ok) bank = await qres.json();
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
  filter = null;
  vqs = null;
  clearInterval(vqTimer);
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
    if (view === 'vq' && vqs && vqs.i < vqs.items.length && !e.target.matches('input, select, textarea')) {
      const n = Number(e.key);
      if (!vqs.answered && n >= 1 && n <= 4) vqChoose(n - 1);
      else if (vqs.answered && (e.key === 'Enter' || e.key === ' ')) vqNext();
      else return;
      return e.preventDefault();
    }
    if (view === 'filter' && filter && filter.i < filter.ids.length && !e.target.matches('input, select, textarea')) {
      if (e.key === 'ArrowLeft' || e.key === '1') filterAnswer(false);
      else if (e.key === 'ArrowRight' || e.key === '2') filterAnswer(true);
      else if (e.key === ' ') {
        filter.reveal = true;
        renderFilter();
      } else return;
      return e.preventDefault();
    }
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
  // 이미 쓰던 사람은 시작 화면 건너뛰기
  if (!state.settings.onboarded && state.words.some((w) => w.srs)) {
    state.settings.onboarded = true;
    persist();
  }
  view = state.settings.onboarded ? 'home' : 'welcome';
  render();
  registerSW();
  store.requestPersist();
}

init();
