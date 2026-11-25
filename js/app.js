import * as store from './storage.js';
import * as srs from './srs.js';
import * as tts from './tts.js';
import * as quiz from './quiz.js';
import * as Session from './session.js';
import * as Vocab from './vocab.js';
import * as Stats from './stats.js';
import * as Charts from './charts.js';
import * as Engine from './engine.js';
import * as LC from './listening.js';
import * as Plan from './plan.js';

let state = store.emptyState(); // init()에서 저장된 기록을 불러옴
let view = 'home';
let session = null;
let advanceTimer = null;
let filter = null; // 아는 단어 거르기 진행 상태
let bank = []; // 문제 은행 (어휘 + 바꿔 쓰는 표현 + 문법)
let concepts = []; // 문법 개념 카드
let p6sets = []; // 장문 빈칸 지문
let lcP2 = []; // 듣기 Part 2
let lcSets = []; // 듣기 Part 3·4
let lcs = null; // 듣기 진행 상태
let lcAudio = null; // 지금 재생 중인 음성
let vqs = null; // 어휘 문제 풀이 진행 상태
let vqTimer = null;
const ui = { search: '', filter: 'all', openId: null, addOpen: false, statMode: 'week' };

const EXTRA_NEW = 10; // "새 단어 더" 한 번에 추가할 수
const PRACTICE_MAX = 15;

const $view = document.getElementById('view');
const $title = document.getElementById('title');

const SOON = {
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

const SESSION_TITLE = { more: '밀린 복습', daily: '오늘 학습', extra: '새 단어 추가 학습', practice: '약한 단어 연습' };

// ---------- 공통 ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function persist() {
  Stats.takeSnapshot(state, srs.today());
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
  if (next !== 'vq' && next !== 'lc') document.body.classList.remove('has-bar');
  if (next !== 'lc') lcStop();
  view = next;
  render();
  window.scrollTo(0, 0);
}

// ---------- 학습 대상 계산 ----------
// 오늘 이미 복습한 단어 수 (하루 복습 상한 계산용)
function reviewedToday(t = srs.today()) {
  return new Set(state.attempts.filter((a) => a.kind === 'word' && a.phase === 'review' && a.date === t).map((a) => a.targetId)).size;
}

// ---------- 하루 학습 시간에 맞춘 분량 (계산은 plan.js) ----------
const { COST, MINUTE_OPTIONS } = Plan;
function goals(t = srs.today()) {
  const s = state.settings;
  const base = { newWords: Number(s.dailyNewWords) || 0, lc: LC.DAILY_P2, vocab: Number(s.dailyQuestions) || 10, grammar: Number(s.dailyQuestions) || 10 };
  if (!Number(s.dailyMinutes)) return base;
  const rt = reviewedToday(t);
  const plan = srs.reviewPlan(state.words, s, state.newIntroduced, t, rt);
  return Plan.quotas({ minutes: Number(s.dailyMinutes), totalReviews: rt + plan.reviews.length, group: levelGroup(s.level), maxNew: base.newWords, base });
}

function dailyPlan(t = srs.today()) {
  const rt = reviewedToday(t);
  const eff = { ...state.settings, dailyNewWords: goals(t).newWords };
  const ids = srs.buildQueue(state.words, eff, state.newIntroduced, t, rt);
  const words = ids.map(wordById).filter(Boolean);
  const plan = srs.reviewPlan(state.words, eff, state.newIntroduced, t, rt);
  return { reviews: words.filter((w) => w.srs), fresh: words.filter((w) => !w.srs), plan };
}

// 상한 때문에 오늘 학습에서 빠진 밀린 복습
function moreReviews(t = srs.today()) {
  const { reviews, plan } = dailyPlan(t);
  const inPlan = new Set(reviews.map((w) => w.id));
  return plan.due.filter((w) => !inPlan.has(w.id)).slice(0, 30);
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
  else if (kind === 'more') parts = { reviews: moreReviews(t) };
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
    b.classList.toggle('active', tab === view || (tab === 'words' && view === 'study') || (tab === 'quiz' && ((view === 'vq' && vqs?.mode !== 'wrong') || view === 'concept' || view === 'lc')) || (tab === 'notes' && view === 'vq' && vqs?.mode === 'wrong') || (tab === 'stats' && view === 'scores'));
  });
  document.body.classList.toggle('studying', ['study', 'filter', 'welcome', 'vq', 'lc'].includes(view));

  const titles = { home: '토익 트레이너', words: '단어', settings: '설정', filter: '아는 단어 거르기', welcome: '토익 트레이너', quiz: '문제', stats: '성장 기록', scores: '성적 기록', notes: '오답노트', vq: vqs?.mode === 'test' ? '수준 진단' : vqs?.mode === 'wrong' ? '오답 다시 풀기' : vqs?.mode === 'speed' ? '스피드 모드' : vqs?.mode === 'gdaily' || Vocab.GRAMMAR_TYPES[vqs?.type] ? '문법 문제' : vqs?.mode === 'p6' || vqs?.items?.[vqs.i]?.part === 6 ? '장문 빈칸' : '어휘 문제', concept: '문법 개념', lc: '듣기' };
  $title.textContent = view === 'study' ? SESSION_TITLE[session?.kind] || '학습' : titles[view] || SOON[view]?.title || '토익 트레이너';

  if (view === 'home') renderHome();
  else if (view === 'words') renderWords();
  else if (view === 'study') renderStudy();
  else if (view === 'settings') renderSettings();
  else if (view === 'welcome') renderWelcome();
  else if (view === 'filter') renderFilter();
  else if (view === 'quiz') renderQuizHome();
  else if (view === 'stats') renderStats();
  else if (view === 'scores') renderScores();
  else if (view === 'vq') renderVQ();
  else if (view === 'notes') renderNotes();
  else if (view === 'concept') renderConcept();
  else if (view === 'lc') renderLC();
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
  const more = moreReviews().length;
  return `
    ${
      more
        ? `<button class="btn ghost wide more-btn" data-start="more"><b>밀린 복습 더 하기 (${more}개)</b><small>오늘 복습 상한(${state.settings.dailyReviewMax ?? 60}개)을 넘은 복습이에요</small></button>`
        : ''
    }
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

function todayCard(t, { todo, streak, learnedToday, goal, cutNote }) {
  const tasks = todayTasks(t);
  const left = tasks.filter((x) => !x.done);
  const mins = left.reduce((a, x) => a + x.min, 0);
  const next = left[0];
  return `<section class="hero today">
      <div class="today-head">
        <p class="hero-title">${left.length ? '오늘 할 일' : '오늘 할 일 끝!'}</p>
        <span class="today-meta">${left.length ? `약 ${mins}분 남음` : ''}${streak ? `${left.length ? ' · ' : ''}연속 ${streak}일` : ''}</span>
      </div>
      <ul class="todo-list">${tasks
        .map(
          (x) => `<li class="${x.done ? 'done' : ''}"><button ${x.attr}>
            <span class="check">${x.done ? '✓' : ''}</span>
            <span class="todo-main"><b>${x.name}</b><small>${x.sub}</small></span>
            <span class="todo-min">${x.done ? '완료' : `${x.min}분`}</span>
          </button></li>`,
        )
        .join('')}</ul>
      ${
        next
          ? `<button class="btn primary big" ${next.attr}>${next.label}${next.min ? ` · 약 ${next.min}분` : ''}</button>`
          : `<p class="hint left">더 하고 싶다면 추가로 할 수 있어요.</p>${extraButtons()}`
      }
      ${todo && learnedToday ? `<p class="hint">오늘 새 단어 ${learnedToday}/${goal}개 외웠어요</p>` : ''}${cutNote}
    </section>`;
}

function renderHome() {
  const t = srs.today();
  const { reviews, fresh, plan } = dailyPlan(t);
  const todo = reviews.length + fresh.length;
  const streak = srs.streak(state.studyDays, t);
  const counts = boxCounts();
  const cutNote = plan.newCut > 0 ? `<p class="hint warn-text">복습이 ${plan.backlog}개 밀려 있어서 오늘은 새 단어를 ${plan.newRoom}개로 줄였어요. 복습을 끝내면 다시 늘어나요.</p>` : '';
  const total = state.words.length || 1;
  const exam = state.settings.examDate;
  const dday = exam ? srs.diffDays(t, exam) : null;
  const ddayText = dday === null ? '' : dday > 0 ? `D-${dday}` : dday === 0 ? 'D-DAY' : `D+${-dday}`;
  const learnedToday = state.newIntroduced.date === t ? state.newIntroduced.count : 0;
  const answeredToday = state.attempts.filter((a) => a.date === t).length;
  const goal = goals(t).newWords;

  const segs = srs.STAGES.map((label, i) => [label, counts[i], 'seg' + i]);

  $view.innerHTML = `
    ${scoreCard(ddayText)}
    ${todayCard(t, { todo, reviews, fresh, streak, learnedToday, goal, cutNote })}

    ${measureCard()}
    ${backupCard(t)}


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
  bindConceptButtons();
  $view.querySelector('#backup-now')?.addEventListener('click', exportBackup);
}

// ---------- 예상 점수 ----------
const PART_NAME = { 1: 'Part 1 사진', 2: 'Part 2 응답', 3: 'Part 3 대화', 4: 'Part 4 담화', 5: 'Part 5 단문', 6: 'Part 6 장문', 7: 'Part 7 독해' };

function reasonsText(reasons) {
  return reasons.map((r) => `Part ${r.p} ${r.pts > 0 ? '+' : '−'}${Math.abs(r.pts)}`).join(' · ');
}

function scoreCard(ddayText) {
  const t = srs.today();
  const target = Number(state.settings.targetScore) || 800;
  const est = Engine.estimate(state);
  const dday = ddayText ? `<span class="dday">${ddayText}</span>` : '';
  const hasData = est.evCount > 0;
  const before = hasData ? Engine.estimate(state, srs.addDays(t, -7), { range: false }) : null;
  const beforeHas = state.attempts.some((a) => a.date <= srs.addDays(t, -7)) || (state.mocks || []).some((m) => m.date <= srs.addDays(t, -7));
  const delta = before && beforeHas ? est.total - before.total : null;
  const reasons = before && beforeHas ? Engine.changeReasons(est, before) : [];
  const pos = (v) => ((v - 10) / 980) * 100;
  const secTag = (x) => (x.measured ? '' : '<small class="unmeasured">미측정</small>');
  return `
    <button class="score-card" data-go="stats">
      <div class="score-top"><span class="score-label">예상 점수 <small>${hasData ? '추정치' : '시작 수준 기준'}</small></span>${dday}</div>
      <div class="score-main">
        <b>${est.total}</b><span class="score-range">${est.low}~${est.high}</span>
        ${
          delta === null || delta === 0
            ? ''
            : `<em class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}<small>지난주보다</small></em>`
        }
      </div>
      <div class="score-secs">
        <span>LC <b>${est.lc.score}</b>${secTag(est.lc)}</span>
        <span>RC <b>${est.rc.score}</b>${secTag(est.rc)}</span>
      </div>
      <div class="score-track" aria-hidden="true">
        <i class="range" style="left:${pos(est.low)}%;width:${pos(est.high) - pos(est.low)}%"></i>
        <i class="now" style="left:${pos(est.total)}%"></i>
        <i class="goal" style="left:${pos(target)}%"></i>
      </div>
      ${reasons.length ? `<p class="score-why">지난주 대비 ${reasonsText(reasons)}</p>` : ''}
      ${!hasData ? `<p class="score-why">문제를 풀거나 교재 모의고사 점수를 넣으면 실력에 맞게 바뀌어요</p>` : ''}
      <p class="score-foot">${est.total >= target ? `목표 ${target}점을 넘었어요!` : `목표 ${target}점까지 <b>${target - est.total}점</b>`}<span>성장 기록 보기 →</span></p>
    </button>`;
}

// 아직 측정 안 된 영역이 있으면 홈에서 눈에 띄게 알림
function measureCard() {
  const est = Engine.estimate(state, null, { range: false });
  const readW = est.skills.reading.weight;
  const missing = [];
  if (!est.lc.measured) missing.push('LC');
  if (readW < 10) missing.push('Part 7 독해');
  if (!missing.length) return '';
  return `<button class="card link notice" data-go="scores"><b>아직 측정 전: ${missing.join(' · ')}</b><small>이 부분은 시작 수준으로 추정 중 · 교재 모의고사 점수를 넣으면 정확해져요 →</small></button>`;
}

// 마지막 백업이 7일 넘었으면 알림
function backupCard(t) {
  if (!state.attempts.length) return '';
  const last = state.settings.lastBackup;
  const first = state.studyDays.length ? [...state.studyDays].sort()[0] : t;
  const days = last ? srs.diffDays(last, t) : srs.diffDays(first, t);
  if (days < 7) return '';
  return `<button class="card link notice" id="backup-now"><b>${last ? `마지막 백업이 ${days}일 전이에요` : '아직 백업한 적이 없어요'}</b><small>기록은 이 휴대폰에만 있어요. 기기를 바꾸거나 Safari 기록을 지우면 사라져요. 눌러서 백업 파일 저장 →</small></button>`;
}

// ---------- 성적 기록 (공식 시험 · 교재 모의고사) ----------
function renderScores() {
  const mocks = [...(state.mocks || [])].sort((a, b) => b.date.localeCompare(a.date));
  const form = ui.scoreForm || 'book';
  const t = srs.today();
  $view.innerHTML = `
    <section class="card">
      <h2>새 기록</h2>
      <div class="seg two" role="tablist">
        <button class="${form === 'book' ? 'on' : ''}" data-form="book">교재 모의고사</button>
        <button class="${form === 'official' ? 'on' : ''}" data-form="official">공식 시험</button>
      </div>
      <form id="score-form" autocomplete="off">
        <label class="field">날짜<input type="date" name="date" value="${t}" max="${t}" required></label>
        ${
          form === 'book'
            ? `<label class="field">교재·회차 (선택)<input name="name" placeholder="예: ○○ 실전 모의고사 3회"></label>
               <p class="hint">파트별로 맞힌 개수를 넣으세요. 안 푼 파트는 비워 두면 돼요.</p>
               <div class="part-inputs">
                 ${Engine.PARTS.map((x) => `<label>${PART_NAME[x.p]}<span><input type="number" name="p${x.p}" min="0" max="${x.n}" inputmode="numeric"> / ${x.n}</span></label>`).join('')}
               </div>`
            : `<div class="part-inputs two">
                 <label>LC 점수<span><input type="number" name="lc" min="5" max="495" step="5" inputmode="numeric" required></span></label>
                 <label>RC 점수<span><input type="number" name="rc" min="5" max="495" step="5" inputmode="numeric" required></span></label>
               </div>
               <p class="hint">공식 성적은 예상 점수를 실제 점수에 맞추는 보정에 쓰여요.</p>`
        }
        <button class="btn primary wide" type="submit">저장하기</button>
      </form>
    </section>
    <section class="card">
      <h2>기록 <small>${mocks.length}개</small></h2>
      ${
        mocks.length
          ? `<ul class="score-list">${mocks
              .map((m) => {
                const sum = (secs) => secs.reduce((acc, p) => acc + (m.parts?.[p]?.k || 0), 0);
                const tot = (secs) => secs.reduce((acc, p) => acc + (m.parts?.[p]?.n || 0), 0);
                const body =
                  m.source === 'official'
                    ? `LC ${m.lc} · RC ${m.rc} · 총점 ${m.lc + m.rc}`
                    : [tot([1, 2, 3, 4]) ? `LC ${sum([1, 2, 3, 4])}/${tot([1, 2, 3, 4])}` : '', tot([5, 6, 7]) ? `RC ${sum([5, 6, 7])}/${tot([5, 6, 7])}` : '']
                        .filter(Boolean)
                        .join(' · ');
                return `<li><div><b>${m.source === 'official' ? '공식 시험' : esc(m.name || '교재 모의고사')}</b><small>${m.date}</small></div><span>${body}</span><button class="link-btn small" data-del="${esc(m.id)}">삭제</button></li>`;
              })
              .join('')}</ul>`
          : '<p class="hint">아직 기록이 없어요. 교재 모의고사 한 회를 넣으면 예상 점수가 훨씬 정확해져요.</p>'
      }
    </section>`;
  $view.querySelectorAll('[data-form]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.scoreForm = b.dataset.form;
      renderScores();
    }),
  );
  $view.querySelector('#score-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const date = String(f.get('date') || t);
    const entry = { id: uid(), date, source: form };
    if (form === 'official') {
      entry.lc = Math.min(495, Math.max(5, Number(f.get('lc')) || 0));
      entry.rc = Math.min(495, Math.max(5, Number(f.get('rc')) || 0));
    } else {
      entry.name = String(f.get('name') || '').trim();
      entry.parts = {};
      for (const x of Engine.PARTS) {
        const v = f.get('p' + x.p);
        if (v !== null && v !== '') entry.parts[x.p] = { k: Math.min(x.n, Math.max(0, Math.round(Number(v)))), n: x.n };
      }
      if (!Object.keys(entry.parts).length) return toast('맞힌 개수를 하나 이상 넣어 주세요');
    }
    const before = Engine.estimate(state, null, { range: false }).total;
    state.mocks = [...(state.mocks || []), entry];
    persist();
    const after = Engine.estimate(state, null, { range: false }).total;
    toast(after === before ? '저장했어요' : `저장했어요 · 예상 점수 ${before} → ${after}`);
    renderScores();
  });
  $view.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!confirm('이 기록을 삭제할까요?')) return;
      state.mocks = state.mocks.filter((m) => m.id !== b.dataset.del);
      persist();
      renderScores();
    }),
  );
}

// ---------- 성장 기록 ----------
function fmtDelta(cur, prev, unit = '', digits = 0) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return '';
  const d = +(cur - prev).toFixed(digits);
  if (d === 0) return `<em class="delta same">변화 없음</em>`;
  return `<em class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${unit}</em>`;
}

// 예상 점수 그래프 세로축: 100점 단위로 데이터와 목표가 다 보이게
function scoreAxis(data, target) {
  const vals = data.map((p) => p.score).filter((v) => v !== null);
  const lo = Math.max(0, Math.floor((Math.min(...vals, target) - 60) / 100) * 100);
  let hi = Math.min(1000, Math.ceil((Math.max(...vals, target) + 60) / 100) * 100);
  let ticks = (hi - lo) / 100;
  if (ticks > 5) {
    ticks = Math.ceil(ticks / 2);
    hi = Math.min(1000, lo + ticks * 200);
    ticks = (hi - lo) / 200;
  }
  return { yMin: lo, yMax: hi, ticks: Math.max(1, Math.round(ticks)) };
}

function renderStats() {
  const t = srs.today();
  const mode = ui.statMode;
  const M = Stats.MODES[mode];
  const data = Stats.series(state, mode, t);
  const cur = data[data.length - 1];
  const prev = data[data.length - 2];
  const target = Number(state.settings.targetScore) || 800;
  const pct = (v) => (v === null ? null : Math.round(v * 100));
  const totalAnswers = state.attempts.filter((a) => a.mode !== 'test').length;

  if (!state.attempts.length && !(state.mocks || []).length) {
    $view.innerHTML = `
      <section class="card soon">
        <h2>아직 기록이 없어요</h2>
        <p>단어나 어휘 문제를 풀면 여기에 일·주·월별로 얼마나 성장했는지 쌓여요.</p>
        <button class="btn primary wide" data-go="home">학습하러 가기</button>
        <button class="btn ghost wide" data-go="scores" style="margin-top:8px">교재 모의고사·공식 성적 넣기</button>
      </section>`;
    return bindGoButtons();
  }

  const answers = (p) => p.wordAnswers + p.questionAnswers;
  const tiles = [
    ['예상 점수', cur.score ?? '—', cur.score !== null ? '점' : '', fmtDelta(cur.score, prev.score, '점')],
    ['학습일', cur.studyDays, '일', fmtDelta(cur.studyDays, prev.studyDays, '일')],
    ['답한 문제·단어', answers(cur), '개', fmtDelta(answers(cur), answers(prev), '개')],
    ['새로 배운 단어', cur.learned, '개', fmtDelta(cur.learned, prev.learned, '개')],
    ['문제 정답률', pct(cur.qAcc) ?? '—', cur.qAcc !== null ? '%' : '', fmtDelta(pct(cur.qAcc), pct(prev.qAcc), '%p')],
    ['단어 정답률', pct(cur.wordAcc) ?? '—', cur.wordAcc !== null ? '%' : '', fmtDelta(pct(cur.wordAcc), pct(prev.wordAcc), '%p')],
  ];

  const scorePts = data.map((p) => ({ label: p.label, values: { s: p.score }, tip: `<b>${p.label}</b><br>${p.score !== null ? `예상 ${p.score}점` : '기록 부족'}` }));
  const volPts = data.map((p) => ({
    label: p.label,
    values: { w: p.wordAnswers, q: p.questionAnswers },
    tip: `<b>${p.label}</b><br>단어 ${p.wordAnswers} · 문제 ${p.questionAnswers}<br>학습 ${Math.round(p.timeMs / 60000)}분`,
  }));
  const accPts = data.map((p) => ({
    label: p.label,
    values: { w: pct(p.wordAcc), q: pct(p.qAcc) },
    tip: `<b>${p.label}</b><br>단어 ${pct(p.wordAcc) ?? '—'}% · 문제 ${pct(p.qAcc) ?? '—'}%`,
  }));
  const masPts = data.map((p) => ({ label: p.label, values: { m: p.mastered }, tip: `<b>${p.label}</b><br>익숙함 이상 ${p.mastered ?? '—'}개` }));
  const hasScore = data.some((p) => p.score !== null);
  const hasMastered = data.some((p) => p.mastered !== null);

  $view.innerHTML = `
    <div class="seg" role="tablist">
      ${Object.entries(Stats.MODES).map(([k, v]) => `<button role="tab" class="${k === mode ? 'on' : ''}" data-mode="${k}">${v.name}</button>`).join('')}
    </div>

    <section class="card">
      <h2>${M.curLabel} <small>${M.prevLabel}와 비교${mode === 'day' ? '' : ` · ${M.curLabel}는 아직 진행 중`}</small></h2>
      <div class="tiles">
        ${tiles.map(([l, v, u, d]) => `<div class="tile"><span>${l}</span><b>${v}<small>${u}</small></b>${d}</div>`).join('')}
      </div>
    </section>

    <section class="card">
      <h2>예상 점수 추이</h2>
      ${hasScore ? Charts.line({ points: scorePts, series: [{ key: 's', name: '예상 점수', cls: 'c1' }], ...scoreAxis(data, target), fmt: (v) => Math.round(v), ref: { value: target, label: `목표 ${target}` }, aria: '기간별 예상 점수' }) : `<p class="hint">기록이 쌓이면 그래프가 그려져요.</p>`}
    </section>

    <section class="card">
      <h2>영역별 정답률 <small>${M.curLabel}</small></h2>
      <ul class="area-acc">${Stats.AREAS.map(([k, l]) => {
        const a = cur.areas[k];
        const pa = prev.areas[k];
        const v = pct(a.acc);
        return `<li><span>${l}</span><div class="pbar"><i style="width:${v ?? 0}%"></i></div><b>${v === null ? '—' : v + '%'} <small>${a.n ? a.n + '개' : ''}</small></b></li>`;
      }).join('')}</ul>
      <p class="hint">정답률이 가장 낮은 영역을 오늘 할 일에서 먼저 해 보세요.</p>
    </section>

    ${partsCard()}

    <button class="card link" data-go="scores"><b>성적 기록 →</b><small>교재 모의고사 ${(state.mocks || []).filter((m) => m.source === 'book').length}회 · 공식 시험 ${(state.mocks || []).filter((m) => m.source === 'official').length}회 · 넣을수록 예상 점수가 정확해져요</small></button>

    <details class="more-charts">
      <summary>그래프 더 보기 <small>학습량 · 정답률 · 단어 · 달력 · 기록</small></summary>
    <section class="card">
      <h2>학습량 <small>답한 수</small></h2>
      ${Charts.bars({ points: volPts, series: [{ key: 'w', name: '단어', cls: 'c1' }, { key: 'q', name: '문제', cls: 'c2' }], fmt: (v) => Math.round(v), aria: '기간별 학습량' })}
    </section>

    <section class="card">
      <h2>정답률</h2>
      ${Charts.line({ points: accPts, series: [{ key: 'w', name: '단어', cls: 'c1' }, { key: 'q', name: '문제', cls: 'c2' }], yMin: 0, yMax: 100, fmt: (v) => Math.round(v) + '%', aria: '기간별 정답률' })}
    </section>

    <section class="card">
      <h2>익숙함 이상 단어 <small>지금 ${Stats.masteredCount(state.words)}개</small></h2>
      ${hasMastered ? Charts.line({ points: masPts, series: [{ key: 'm', name: '익숙함 이상', cls: 'c1' }], fmt: (v) => Math.round(v), aria: '익숙함 이상 단어 수' }) : '<p class="hint">오늘부터 기록돼요.</p>'}
    </section>

    <section class="card">
      <h2>학습 달력 <small>최근 12주</small></h2>
      ${calendarHtml(t)}
    </section>

    <section class="card">
      <h2>기록</h2>
      <ul class="records">
        <li><span>연속 학습</span><b>${srs.streak(state.studyDays, t)}일</b></li>
        <li><span>최장 연속 학습</span><b>${Stats.longestStreak(state.studyDays)}일</b></li>
        <li><span>총 학습일</span><b>${state.studyDays.length}일</b></li>
        <li><span>총 답한 문제·단어</span><b>${totalAnswers}개</b></li>
        <li><span>익숙함 이상 단어</span><b>${Stats.masteredCount(state.words)}개</b></li>
      </ul>
    </section>
    </details>

    <p class="hint center">예상 점수는 문항 난이도·정답·풀이 시간으로 기술별 실력을 추정한 뒤, 실제 토익 파트별 문항 수와 시간(RC 75분)에 맞춰 계산한 추정치예요.<br>공식 환산표가 없어서 근사 환산을 쓰고, 성적 기록으로 보정해요.</p>
  `;
  $view.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.statMode = b.dataset.mode;
      renderStats();
    }),
  );
  Charts.bind($view);
  bindGoButtons();
  $view.querySelectorAll('.cal i[data-d]').forEach((c) =>
    c.addEventListener('click', () => {
      $view.querySelectorAll('.cal i.sel').forEach((x) => x.classList.remove('sel'));
      c.classList.add('sel');
      $view.querySelector('#cal-cap').textContent = `${c.dataset.d.slice(5).replace('-', '/')} · ${c.dataset.n}개 답함`;
    }),
  );
}

// 파트별 예상 정답과 점수를 가장 많이 올릴 파트
function partsCard() {
  const est = Engine.estimate(state);
  const lev = Engine.partLeverage(est);
  const top = lev.slice(0, 2).map((x) => x.p);
  const rel = (keys) => {
    const w = keys.reduce((acc, k) => acc + est.skills[k].weight, 0);
    return w >= 40 ? '높음' : w >= 10 ? '보통' : '낮음';
  };
  const partRel = { 1: rel(['lc_photo']), 2: rel(['lc_qr']), 3: rel(['lc_conv']), 4: rel(['lc_talk']), 5: rel(['vocab', 'grammar']), 6: rel(['vocab', 'grammar', 'reading']), 7: rel(['reading']) };
  const row = (x) => {
    const pct = (x.expected / x.n) * 100;
    return `<li class="${top.includes(x.p) ? 'focus' : ''}"><span>${PART_NAME[x.p]}</span><div class="pbar"><i style="width:${pct}%"></i></div><b>${x.expected.toFixed(0)}/${x.n}</b><small class="rel ${partRel[x.p]}">${partRel[x.p]}</small></li>`;
  };
  return `
    <section class="card">
      <h2>파트별 예상 정답 <small>LC ${est.lc.low}~${est.lc.high} · RC ${est.rc.low}~${est.rc.high}</small></h2>
      <p class="sec-label">LC ${est.lc.score}점${est.lc.measured ? '' : ' · 아직 측정 안 됨'}</p>
      <ul class="parts">${est.parts.filter((x) => x.sec === 'lc').map(row).join('')}</ul>
      <p class="sec-label">RC ${est.rc.score}점${est.unanswered > 0.5 ? ` · 시간 안에 약 ${Math.round(est.unanswered)}문항 못 풂` : ''}</p>
      <ul class="parts">${est.parts.filter((x) => x.sec === 'rc').map(row).join('')}</ul>
      <p class="hint">오른쪽은 측정 신뢰도예요. 강조된 파트는 정답률을 10%p 올렸을 때 점수가 가장 많이 오르는 곳이에요 (${lev
        .slice(0, 2)
        .map((x) => `Part ${x.p} +${x.pts}점`)
        .join(', ')}).</p>
    </section>`;
}

function calendarHtml(t) {
  const act = Stats.activityMap(state.attempts);
  const [y, m, d] = t.split('-').map(Number);
  const wd = (new Date(y, m - 1, d).getDay() + 6) % 7;
  const start = srs.addDays(t, -wd - 7 * 11); // 12주 전 월요일
  const lvl = (n) => (n === 0 ? 0 : n < 20 ? 1 : n < 50 ? 2 : n < 100 ? 3 : 4);
  let cells = '';
  for (let k = 0; k < 84; k++) {
    const day = srs.addDays(start, Math.floor(k % 12) * 7 + Math.floor(k / 12));
    if (day > t) {
      cells += '<i class="future"></i>';
      continue;
    }
    const n = act.get(day) || 0;
    cells += `<i class="l${lvl(n)}" data-d="${day}" data-n="${n}" title="${day} ${n}개"></i>`;
  }
  return `
    <div class="cal-wrap">
      <div class="cal-days"><span>월</span><span></span><span>수</span><span></span><span>금</span><span></span><span>일</span></div>
      <div class="cal">${cells}</div>
    </div>
    <div class="cal-foot"><span id="cal-cap">칸을 누르면 그날 기록이 보여요</span>
      <span class="cal-legend">적음 <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> 많음</span></div>`;
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

// 패러프레이즈 짝: 지문·보기에서 같은 뜻의 다른 표현으로 나올 때를 대비
function synLine(w) {
  return w.syn ? `<p class="syn"><span>바꿔 쓰는 표현</span>${esc(w.syn)}</p>` : '';
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
        ${synLine(w)}
        <div class="ex-box">${exampleBlock(w)}</div>`;
    case 'meaning':
      return `
        <p class="q-label">뜻을 고르세요</p>
        <p class="flash-word">${esc(w.word)}</p>
        ${a ? `${pos}${synLine(w)}<div class="ex-box">${exampleBlock(w)}</div>` : ''}`;
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
            ? `${pos}<p class="meaning">${esc(w.meaning)}</p>${synLine(w)}<div class="ex-box">${exampleBlock(w)}</div>`
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
  // 단어 단위: 이번 학습에서 한 번도 안 틀린 단어 비율 (아래 단계 이동과 같은 기준)
  const studied = [...s.firstResult.keys()];
  const rate = studied.length ? Math.round((studied.filter((id) => !s.failed.has(id)).length / studied.length) * 100) : null;
  const missed = [...s.failed].map(wordById).filter(Boolean);
  const t = srs.today();
  const stillTodo = dailyPlan(t);
  const todoLeft = stillTodo.reviews.length + stillTodo.fresh.length;

  const stats = [];
  if (s.newPerfect + s.newShaky) stats.push([s.newPerfect + s.newShaky, '새로 배운 단어']);
  if (s.reviewed) stats.push([s.reviewed, '복습한 단어']);
  if (s.kind === 'practice') stats.push([s.done.size, '연습한 단어']);
  if (s.skipped) stats.push([s.skipped, '이미 아는 단어']);
  if (rate !== null) stats.push([rate + '%', '안 틀린 단어']);

  $view.innerHTML = `
    <section class="hero done">
      <p class="hero-title">${s.kind === 'daily' && !todoLeft ? '오늘 단어 끝!' : '학습 완료!'}</p>
      <div class="today-grid ${stats.length === 2 ? 'two' : ''}">
        ${stats.slice(0, 3).map(([n, l]) => `<div><strong>${n}</strong><span>${l}</span></div>`).join('')}
      </div>
      ${stageMoves(s)}
      ${todoLeft ? `<button class="btn primary big" data-start="daily">남은 오늘 학습 이어하기 (${todoLeft}개)</button>` : nextTaskButton(t, 'words')}
      ${!todoLeft && nextTask(t, 'words') ? `<p class="hint">${todayLeftText(t)}</p>` : ''}
      ${!todoLeft ? extraButtons() : ''}
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
  bindVqButtons();
  bindConceptButtons();
  $view.querySelector('#home').addEventListener('click', () => go('home'));
}

// ---------- 오늘 할 일 (단어 → 어휘 → 문법) ----------
function todayTasks(t = srs.today()) {
  const { reviews, fresh } = dailyPlan(t);
  const G = goals(t);
  const goal = G.vocab;
  const ggoal = G.grammar;
  const lgoal = G.lc;
  const vDone = questionsToday(t, 'vocab');
  const gDone = questionsToday(t, 'grammar');
  const gFresh = !state.attempts.some((a) => a.module === 'grammar');
  const wordTodo = reviews.length + fresh.length;
  const lcDone = LC.todayCount(state, t);
  return [
    { key: 'words', name: '단어', done: !wordTodo, min: wordTodo ? estimateMinutes(reviews.length, fresh.length) : 0, sub: wordTodo ? `복습 ${reviews.length} · 새 단어 ${fresh.length}` : '완료', attr: 'data-start="daily"', label: '단어 학습 시작' },
    { key: 'listening', name: '듣기', done: lcDone >= lgoal, min: lcDone >= lgoal ? 0 : Math.max(1, Math.round(((lgoal - lcDone) * COST.lc) / 60)), sub: `Part 2 응답 ${Math.min(lcDone, lgoal)}/${lgoal}`, attr: 'data-lc="lc2"', label: '듣기 시작', hidden: !lcP2.length },
    { key: 'vocab', name: '어휘 문제', done: vDone >= goal, min: vDone >= goal ? 0 : Math.max(1, Math.round(((goal - vDone) * 30) / 60)), sub: `${Math.min(vDone, goal)}/${goal}`, attr: 'data-vq="daily"', label: '어휘 문제 풀기' },
    { key: 'grammar', name: '문법 문제', done: gDone >= ggoal, min: gDone >= ggoal ? 0 : Math.max(1, Math.round(((ggoal - gDone) * 30) / 60)) + (gFresh ? 2 : 0), sub: gFresh && !gDone ? '처음이면 기초 3장부터' : `${Math.min(gDone, ggoal)}/${ggoal}`, attr: gFresh ? 'data-concept="basic-structure"' : 'data-vq="gdaily"', label: gFresh ? '문법 기초부터 시작' : '문법 문제 풀기' },
  ].filter((x) => !x.hidden);
}

function nextTask(t, after) {
  const list = todayTasks(t);
  const from = after ? list.findIndex((x) => x.key === after) + 1 : 0;
  return [...list.slice(from), ...list.slice(0, from)].find((x) => !x.done) || null;
}

function todayLeftText(t) {
  const left = todayTasks(t).filter((x) => !x.done);
  return left.length ? `오늘 남은 것: ${left.map((x) => x.name).join(' · ')} (약 ${left.reduce((a, x) => a + x.min, 0)}분)` : '';
}

function nextTaskButton(t, after) {
  const n = nextTask(t, after);
  return n ? `<button class="btn primary big" ${n.attr}>다음: ${n.label}</button>` : `<p class="hint">오늘 할 일을 모두 끝냈어요. 🎉</p>`;
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
  }).sort((a, b) => {
    if (!!a.srs !== !!b.srs) return a.srs ? -1 : 1;
    if (a.srs) return a.srs.due.localeCompare(b.srs.due) || a.srs.box - b.srs.box;
    return srs.newWordOrder(state.settings)(a, b);
  });
}

function wordProgressCard() {
  const counts = boxCounts();
  const total = state.words.length || 1;
  const segs = srs.STAGES.map((label, i) => [label, counts[i], 'seg' + i]);
  const open = ui.progOpen;
  return `<section class="card prog ${open ? 'open' : ''}">
      <button class="prog-head" id="prog-toggle">
        <span><b>단어 ${state.words.length}개</b> <small>익숙함 이상 ${counts[3] + counts[4] + counts[5]}개</small></span>
        <span class="prog-more">${open ? '접기' : '단계 보기'}</span>
      </button>
      <div class="bar">${segs.map(([, n, c]) => (n ? `<i class="${c}" style="flex:${n / total}"></i>` : '')).join('')}</div>
      ${
        open
          ? `<ol class="stage-guide">
              <li><b class="seg0"></b>새 단어<em>${counts[0]}</em><span>아직 안 본 단어</span></li>
              ${srs.STAGES.slice(1).map((n, i) => `<li><b class="seg${i + 1}"></b>${n}<em>${counts[i + 1]}</em><span>${srs.INTERVALS[i]}일 뒤 복습</span></li>`).join('')}
            </ol>
            <p class="hint">맞힐수록 한 단계씩 올라가고 복습 간격이 길어져요. 틀리면 '외우는 중'으로 돌아가요.</p>`
          : ''
      }
    </section>`;
}

function renderWords() {
  const { reviews, fresh } = dailyPlan();
  const todo = reviews.length + fresh.length;

  $view.innerHTML = `
    ${wordProgressCard()}
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
  $view.querySelector('#prog-toggle').addEventListener('click', () => {
    ui.progOpen = !ui.progOpen;
    renderWords();
  });
  $view.querySelector('#add-toggle').addEventListener('click', () => {
    ui.addOpen = !ui.addOpen;
    renderWords();
    if (ui.addOpen) $view.querySelector('input[name=word]')?.focus();
  });
  $view.querySelector('#add-form')?.addEventListener('submit', addWord);
  $view.querySelector('#search').addEventListener('input', (e) => {
    ui.search = e.target.value;
    ui.wordLimit = 40;
    renderWordList();
  });
  $view.querySelector('#filter').addEventListener('change', (e) => {
    ui.filter = e.target.value;
    ui.wordLimit = 40;
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
  // 한 번에 다 그리면 수십 화면이 되므로 40개씩
  const limit = ui.wordLimit || 40;
  const shown = list.slice(0, limit);
  $list.innerHTML = shown
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
                ${synLine(w)}
                ${exampleBlock(w)}
                <div class="detail-actions">
                  <button class="btn ghost small" data-act="speak">발음 듣기</button>
                  ${w.srs ? `<button class="btn ghost small" data-act="reset">처음부터 다시</button>` : ''}
                  ${w.source === 'builtin' ? reportBox('word', w.id) : ''}
                  ${w.source !== 'builtin' ? `<button class="btn ghost small danger-text" data-act="delete">삭제</button>` : ''}
                </div>
              </div>`
            : ''
        }
      </li>`;
    })
    .join('') + (list.length > limit ? `<li class="more-row"><button class="btn ghost wide" id="word-more">더 보기 (${list.length - limit}개 남음)</button></li>` : '');
  $list.querySelector('#word-more')?.addEventListener('click', (e) => {
    e.stopPropagation();
    ui.wordLimit = limit + 40;
    renderWordList();
  });
  bindReportBox($list, renderWordList);
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
      <label class="field">하루 학습 시간
        <select id="dailyMinutes">
          ${MINUTE_OPTIONS.map(([v, l]) => `<option value="${v}" ${Number(s.dailyMinutes) === v ? 'selected' : ''}>${l}</option>`).join('')}
          <option value="" ${!s.dailyMinutes ? 'selected' : ''}>직접 정하기 (아래 숫자대로)</option>
        </select>
      </label>
      ${s.dailyMinutes ? `<p class="hint">복습 시간을 먼저 빼고 남은 시간을 새 단어 · 듣기 · 어휘 · 문법에 나눠요. 오늘: 새 단어 ${goals().newWords} · 듣기 ${goals().lc} · 어휘 ${goals().vocab} · 문법 ${goals().grammar}</p>` : ''}
      <div class="field-grid">
      <label class="field">목표 점수
        <input type="number" id="targetScore" min="10" max="990" step="5" value="${esc(s.targetScore)}" inputmode="numeric">
      </label>
      <label class="field">시험 날짜
        <input type="date" id="examDate" value="${esc(s.examDate)}">
      </label>
      <label class="field">하루 새 단어${s.dailyMinutes ? ' <small class="quiet">최대</small>' : ''}
        <input type="number" id="dailyNewWords" min="0" max="200" value="${esc(s.dailyNewWords)}" inputmode="numeric">
      </label>
      <label class="field">하루 복습 상한
        <input type="number" id="dailyReviewMax" min="10" max="500" value="${esc(s.dailyReviewMax ?? 60)}" inputmode="numeric">
      </label>
      <label class="field">오늘의 문제 수 <small class="quiet">어휘·문법 각각</small>
        <input type="number" id="dailyQuestions" min="1" max="50" value="${esc(s.dailyQuestions)}" inputmode="numeric">
      </label>
      </div>
      <p class="hint">복습이 상한보다 밀리면 새 단어가 자동으로 줄어요. 목표를 채운 뒤에도 '새 단어 ${EXTRA_NEW}개 더'로 추가 학습할 수 있어요.</p>
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
      <button class="btn ghost wide" data-go="scores" style="margin-top:8px">성적 기록 (교재 모의고사 · 공식 시험)</button>
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
            <button class="btn ghost small" id="testVoice">들어보기</button>
            <h3 class="sub-h">듣기 문제</h3>
            <label class="switch"><span>억양 섞기 <small class="quiet">미국·영국·호주 음성 (기기에 있을 때)</small></span><input type="checkbox" id="lcAccentMix" ${s.lcAccentMix !== false ? 'checked' : ''}></label>
            <label class="field">듣기 속도
              <select id="lcRate">${[
                [0.85, '느리게'],
                [1, '보통 (실전에 가까움)'],
                [1.1, '빠르게'],
              ]
                .map(([v, l]) => `<option value="${v}" ${Number(s.lcRate ?? 1) === v ? 'selected' : ''}>${l}</option>`)
                .join('')}</select>
            </label>`
          : '<p class="hint">이 브라우저는 음성 읽기를 지원하지 않아요. 듣기 문제는 대본을 보고 풀 수 있지만 점수에는 들어가지 않아요.</p>'
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

    ${reportsCard()}

    <section class="card">
      <h2>초기화</h2>
      <button class="btn ghost danger-text" id="reset">모든 학습 기록 지우기</button>
    </section>

    <p class="version">토익 트레이너 v4.1 · 단어 · 어휘 · 문법 · 장문 빈칸 · 듣기</p>
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
  num('dailyReviewMax', 10, 500);
  $view.querySelector('#retest').addEventListener('click', () => startVQ('test'));
  bindGoButtons();

  $view.querySelector('#startLevel').addEventListener('change', (e) => {
    state.settings.startLevel = e.target.value;
    state.settings.levelChangedAt = Date.now();
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
  $view.querySelector('#dailyMinutes')?.addEventListener('change', (e) => {
    state.settings.dailyMinutes = e.target.value ? Number(e.target.value) : null;
    persist();
    renderSettings();
  });
  $view.querySelector('#lcAccentMix')?.addEventListener('change', (e) => {
    state.settings.lcAccentMix = e.target.checked;
    persist();
  });
  $view.querySelector('#lcRate')?.addEventListener('change', (e) => {
    state.settings.lcRate = Number(e.target.value);
    persist();
  });
  bindReportBox($view, renderSettings);
  $view.querySelector('#copy-reports')?.addEventListener('click', async () => {
    const text = JSON.stringify(state.reports, null, 1);
    try {
      await navigator.clipboard.writeText(text);
      toast('신고 목록을 복사했어요');
    } catch {
      toast('복사하지 못했어요');
    }
  });
  $view.querySelector('#import').addEventListener('change', importBackup);
  $view.querySelector('#reset').addEventListener('click', async () => {
    if (!confirm('모든 학습 기록과 직접 추가한 단어가 지워져요. 계속할까요?')) return;
    if (!confirm('정말 지울까요? 되돌릴 수 없어요.')) return;
    await store.clearAll();
    state = store.emptyState();
    await loadBuiltin();
    persist();
    toast('초기화했어요');
    go('welcome');
  });
}

function markBackup() {
  state.settings.lastBackup = srs.today();
  persist();
  if (view === 'home') renderHome();
}

function reportsCard() {
  const rs = state.reports || [];
  if (!rs.length) return '';
  const label = (r) => {
    if (r.kind === 'word') return wordById(r.targetId)?.word || r.targetId;
    const q = bank.find((x) => x.id === r.targetId);
    return q ? q.stem : r.targetId;
  };
  return `<section class="card">
    <h2>신고한 문제·단어 <small>${rs.length}개 · 점수와 출제에서 빠짐</small></h2>
    <ul class="score-list">${rs
      .map((r) => `<li><div><b>${esc(label(r))}</b><small>${r.date} · ${esc((REPORT_REASONS.find(([k]) => k === r.reason) || [, '기타'])[1])}${r.memo ? ' · ' + esc(r.memo) : ''}</small></div><button class="link-btn small" data-unreport="${esc(r.targetId)}">취소</button></li>`)
      .join('')}</ul>
    <button class="btn ghost small" id="copy-reports" style="margin-top:10px">신고 목록 복사</button>
  </section>`;
}

async function exportBackup() {
  const name = `toeic-trainer-backup-${srs.today()}.json`;
  const file = new File([store.exportJSON(state)], name, { type: 'application/json' });
  // 아이폰: 공유 시트로 '파일에 저장' 가능
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      markBackup();
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
  markBackup();
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
function questionsToday(t = srs.today(), area = 'vocab') {
  return state.attempts.filter((a) => a.kind === 'question' && a.mode !== 'test' && a.date === t && (a.module || 'vocab') === area).length;
}

function vocabTodayCard() {
  if (!bank.length) return '';
  const goal = goals().vocab;
  const done = questionsToday();
  const due = Vocab.dueList(state, bank.filter((q) => Vocab.areaOf(q) === 'vocab'), srs.today()).length;
  const pct = Math.min(1, done / goal);
  return `
    <section class="card vcard">
      <div class="vcard-top">
        <h2>오늘의 어휘 문제 <small>Part 5</small></h2>
        <span class="count">${Math.min(done, goal)}/${goal}</span>
      </div>
      <div class="progress"><i style="width:${pct * 100}%"></i></div>
      <p class="hint">${
        done >= goal ? '오늘 목표를 채웠어요. 더 풀고 싶으면 이어서 풀 수 있어요.' : due ? `틀렸던 문제 ${due}개가 다시 나와요.` : '품사 자리 · 어울리는 단어 · 헷갈리는 단어 · 바꿔 쓰는 표현을 섞어서 내요.'
      }</p>
      <button class="btn ${done >= goal ? 'ghost' : 'primary'} wide" data-vq="daily">${done >= goal ? `${goal}문제 더 풀기` : `풀기 · 약 ${Math.max(1, Math.round(((goal - done) * 30) / 60))}분`}</button>
    </section>`;
}

function speedBest() {
  const best = state.settings.speedBest;
  return best ? `${best.correct}/${best.n} · ${Math.round(best.ms / 1000)}초` : '';
}

function p6Card() {
  if (!p6sets.length) return '';
  const doneSets = p6sets.filter((set) => set.questions.every((id) => state.qprog[id])).length;
  const st = Vocab.typeStats(state, 'part6');
  const rated = Object.entries(Vocab.PART6_TYPES).map(([k, v]) => {
    const r = st[k];
    return `<li><span>${v.name}</span><b class="rate ${r.rate === null ? '' : r.rate < 0.6 ? 'low' : r.rate < 0.8 ? 'mid' : 'high'}">${r.rate === null ? '-' : Math.round(r.rate * 100) + '%'}</b></li>`;
  });
  return `<section class="card">
      <h2>장문 빈칸 <small>Part 6 · 지문 ${doneSets}/${p6sets.length}</small></h2>
      <p class="hint">지문 하나에 빈칸 4개 · 어휘·문법·연결어·문장 넣기 · 문제당 30초</p>
      <ul class="p6-rates">${rated.join('')}</ul>
      <button class="btn primary wide" data-vq="p6">지문 1개 풀기 · 4문제 약 2분</button>
      <p class="hint">틀린 빈칸이 있는 지문은 다음 날 다시 나와요.</p>
    </section>`;
}

function lcCard() {
  if (!lcP2.length) return '';
  const t = srs.today();
  const done = LC.todayCount(state, t);
  const goal = goals(t).lc;
  const p3 = LC.setProgress(state, lcSets, 3);
  const p4 = LC.setProgress(state, lcSets, 4);
  const st = {};
  for (const k of ['lc2', 'lc3', 'lc4']) {
    const l = state.attempts.filter((a) => a.type === k && !a.scripted);
    st[k] = l.length ? Math.round((l.filter((a) => a.correct).length / l.length) * 100) + '%' : '-';
  }
  return `<section class="card vcard">
      <div class="vcard-top"><h2>오늘의 듣기 <small>Part 2 응답</small></h2><span class="count">${Math.min(done, goal)}/${goal}</span></div>
      <div class="progress"><i style="width:${Math.min(1, done / goal) * 100}%"></i></div>
      <p class="hint">질문을 듣고 응답 A·B·C 중 고르기. 비슷한 발음·같은 단어 반복 함정을 알려 줘요.</p>
      <button class="btn ${done >= goal ? 'ghost' : 'primary'} wide" data-lc="lc2">${done >= goal ? '10문제 더 듣기' : `듣기 시작 · 약 ${Math.max(1, Math.round(((goal - done) * COST.lc) / 60))}분`}</button>
    </section>
    <section class="card">
      <h2>세트 듣기 <small>문제를 먼저 읽고 듣기</small></h2>
      <div class="type-grid">
        <button class="type-tile" data-lc="lc3"><b>Part 3 대화</b><span class="rate">세트 ${p3.done}/${p3.total} · 정답 ${st.lc3}</span></button>
        <button class="type-tile" data-lc="lc4"><b>Part 4 담화</b><span class="rate">세트 ${p4.done}/${p4.total} · 정답 ${st.lc4}</span></button>
        <button class="type-tile" data-lc="dict"><b>받아쓰기</b><span class="rate">5문장</span></button>
        <div class="type-tile muted-tile"><b>Part 2 정답률</b><span class="rate">${st.lc2}</span></div>
      </div>
      <p class="hint">브라우저 음성이라 실제 시험보다 쉬워요. 점수에는 낮은 무게로 반영하고, 교재 음원 모의고사 점수를 넣으면 LC가 더 정확해져요. Part 1(사진 묘사)은 교재로 연습하세요.</p>
    </section>`;
}

function grammarTodayCard() {
  const gbank = bank.filter((q) => Vocab.areaOf(q) === 'grammar');
  if (!gbank.length) return '';
  const goal = goals().grammar;
  const done = questionsToday(srs.today(), 'grammar');
  const due = Vocab.dueList(state, gbank, srs.today()).length;
  const pct = Math.min(1, done / goal);
  const fresh = !state.attempts.some((a) => a.module === 'grammar');
  return `
    <section class="card vcard">
      <div class="vcard-top">
        <h2>오늘의 문법 문제 <small>Part 5</small></h2>
        <span class="count">${Math.min(done, goal)}/${goal}</span>
      </div>
      <div class="progress"><i style="width:${pct * 100}%"></i></div>
      <p class="hint">${
        fresh ? '처음이면 문법 기초 3장을 먼저 읽어 보세요. 2분이면 돼요.' : done >= goal ? '오늘 목표를 채웠어요.' : due ? `틀렸던 문제 ${due}개가 다시 나와요.` : '시제 · 수일치 · 능동·수동 등 10개 유형을 섞어서 내요.'
      }</p>
      ${fresh ? `<button class="btn ghost wide home-btn" data-concept="basic-structure">문법 기초 보기</button>` : ''}
      <button class="btn ${done >= goal ? 'ghost' : 'primary'} wide" data-vq="gdaily">${done >= goal ? `${goal}문제 더 풀기` : `풀기 · 약 ${Math.max(1, Math.round(((goal - done) * 30) / 60))}분`}</button>
    </section>`;
}

function bindConceptButtons(root = $view) {
  root.querySelectorAll('[data-concept]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openConcept(b.dataset.concept);
    }),
  );
}

function openConcept(id, then = null) {
  ui.conceptId = id;
  ui.conceptThen = then;
  ui.conceptFrom = view === 'concept' ? ui.conceptFrom : view;
  go('concept');
}

function renderConcept() {
  const c = concepts.find((x) => x.id === ui.conceptId);
  if (!c) return go('quiz');
  const basics = concepts.filter((x) => x.basic);
  const bi = basics.indexOf(c);
  const seen = new Set(state.settings.conceptsSeen || []);
  if (!seen.has(c.id)) {
    seen.add(c.id);
    state.settings.conceptsSeen = [...seen];
    persist();
  }
  const st = c.type ? Vocab.typeStats(state, 'grammar')[c.type] : null;
  $view.innerHTML = `
    <section class="card concept">
      <p class="eyebrow">${c.basic ? `문법 기초 ${bi + 1}/${basics.length}` : '문법 개념'}${st && st.n ? ` · 정답률 ${Math.round(st.rate * 100)}% (${st.n}문제)` : ''}</p>
      <h2 class="concept-title">${esc(c.title)}</h2>
      <p class="concept-sum">${esc(c.summary)}</p>
      <ul class="concept-points">${c.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      ${c.examples.map((x) => `<div class="concept-ex"><p class="ex">${esc(x.en)}</p><p class="ex-ko">${esc(x.ko)}</p></div>`).join('')}
      <p class="clue"><b>빠른 단서</b>${esc(c.clue)}</p>
    </section>
    ${
      c.basic
        ? bi < basics.length - 1
          ? `<button class="btn primary big" data-concept="${basics[bi + 1].id}">다음: ${esc(basics[bi + 1].title)}</button>`
          : `<button class="btn primary big" data-vq="gdaily">오늘의 문법 문제 풀기</button>`
        : `<button class="btn primary big" data-vq="type" data-type="${c.type}">${ui.conceptThen ? '이해했어요, 문제 풀기' : '이 유형 문제 풀기'}</button>`
    }
    <button class="btn ghost wide home-btn" data-go="${ui.conceptFrom === 'vq' && vqs ? 'vq' : ui.conceptFrom && !['concept', 'vq'].includes(ui.conceptFrom) ? ui.conceptFrom : 'quiz'}">${ui.conceptFrom === 'vq' && vqs ? '문제로 돌아가기' : '돌아가기'}</button>`;
  bindConceptButtons();
  bindVqButtons();
  bindGoButtons();
}

function bindVqButtons(root = $view) {
  root.querySelectorAll('[data-vq]').forEach((b) => b.addEventListener('click', () => startVQ(b.dataset.vq, b.dataset.type, { skipConcept: view === 'concept' })));
  root.querySelectorAll('[data-lc]').forEach((b) => b.addEventListener('click', () => startLC(b.dataset.lc)));
}

// ---------- 듣기 ----------
function lcStop() {
  lcAudio?.stop();
  lcAudio = null;
}

function startLC(mode) {
  const t = srs.today();
  lcStop();
  if (mode === 'lc2') {
    const left = goals(t).lc - LC.todayCount(state, t);
    const items = LC.buildPart2(state, lcP2, state.settings, t, left >= 5 ? left : LC.DAILY_P2);
    if (!items.length) return toast('들을 문제가 없어요');
    lcs = { mode, items, i: 0, results: [], origin: view === 'lc' ? 'quiz' : view };
  } else if (mode === 'lcwrong') {
    const items = Vocab.wrongQuestions(state, lcP2).filter((x) => !x.resolved).map((x) => x.q).slice(0, 10);
    if (!items.length) return toast('틀린 Part 2 문제가 없어요');
    lcs = { mode: 'lc2', items, i: 0, results: [], origin: view === 'lc' ? 'notes' : view };
  } else if (mode.startsWith('set:')) {
    const set = lcSets.find((x) => x.id === mode.slice(4));
    if (!set) return;
    lcs = { mode: set.part === 3 ? 'lc3' : 'lc4', set, phase: 'preview', picks: {}, replays: 0, results: [], origin: view };
  } else if (mode === 'lc3' || mode === 'lc4') {
    const set = LC.buildSet(state, lcSets, mode === 'lc3' ? 3 : 4, state.settings, t);
    if (!set) return toast('들을 세트가 없어요');
    lcs = { mode, set, phase: 'preview', picks: {}, replays: 0, results: [], origin: view === 'lc' ? 'quiz' : view };
  } else if (mode === 'dict') {
    lcs = { mode, items: LC.buildDict(lcP2, state.settings), i: 0, scores: [], origin: view === 'lc' ? 'quiz' : view };
  }
  lcPrepare();
  go('lc');
  if (lcs.mode === 'lc2' || lcs.mode === 'dict') lcPlay(); // 버튼을 누른 흐름 안에서 바로 재생 (iOS)
}

function lcPrepare() {
  if (!lcs) return;
  lcs.answered = null;
  lcs.plays = 0;
  lcs.scripted = false;
  lcs.shownAt = performance.now();
  if (lcs.mode === 'lc2') lcs.order = shuffleIdx(3);
}

function shuffleIdx(n) {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 지금 화면의 음성 만들기
function lcLines() {
  if (lcs.mode === 'lc2') {
    const q = lcs.items[lcs.i];
    const asker = q.id.charCodeAt(q.id.length - 1) % 2 ? 'W' : 'M';
    const other = asker === 'W' ? 'M' : 'W';
    return [{ who: asker, text: q.q }, ...lcs.order.map((k, idx) => ({ who: other, text: `${'ABC'[idx]}. ${q.choices[k]}` }))];
  }
  if (lcs.mode === 'dict') return [{ who: 'N', text: lcs.items[lcs.i].q }];
  return lcs.set.lines.map((l) => ({ who: l.who, text: l.text }));
}

function lcPlay() {
  if (!lcs) return;
  lcStop();
  lcs.plays++;
  lcs.playing = true;
  lcRenderStatus();
  const me = (lcAudio = tts.speakLines(lcLines(), { rate: Number(state.settings.lcRate) || 1, mix: state.settings.lcAccentMix !== false }));
  me.done.then((r) => {
    if (lcAudio !== me || !lcs) return;
    lcs.playing = false;
    lcs.heardAt = performance.now();
    if (r?.completed && !r.spoke) lcs.noVoice = true; // 끝까지 갔는데 소리가 한 번도 안 남
    lcRenderStatus();
  });
}

function lcRenderStatus() {
  const b = $view.querySelector('#lc-play');
  if (!b || !lcs) return;
  b.classList.toggle('playing', !!lcs.playing);
  b.innerHTML = lcs.playing ? '<span class="eq"><i></i><i></i><i></i></span> 재생 중' : lcs.plays ? `▶ 다시 듣기` : '▶ 듣기';
  // 음성이 안 나온 것 같으면 안내 (설정·무음 모드·대본 보기)
  let n = $view.querySelector('.novoice');
  if (lcs.noVoice && !lcs.playing && !lcs.scripted && !lcs.answered && lcs.phase !== 'review') {
    if (!n) {
      n = document.createElement('div');
      n.className = 'novoice';
      n.innerHTML = `<b>소리가 안 들리나요?</b><small>무음 모드(벨 스위치)와 음량을 확인하고 다시 들어 보세요. 그래도 안 되면 대본을 보고 풀 수 있어요. 대본으로 푼 문제는 점수에 들어가지 않아요.</small><button class="btn ghost small" data-novoice-script>대본 보고 풀기</button>`;
      b.insertAdjacentElement('afterend', n);
      n.querySelector('[data-novoice-script]').addEventListener('click', () => {
        lcs.scripted = true;
        lcStop();
        renderLC();
      });
    }
  } else n?.remove();
}

function renderLC() {
  if (!lcs) return go('quiz');
  if (lcs.mode === 'lc2') return renderLC2();
  if (lcs.mode === 'dict') return renderDict();
  return renderLCSet();
}

function lcTop(progress, label) {
  return `<div class="study-top">
      <button class="icon-btn" id="quit" aria-label="그만하기">${ICON.close}</button>
      <div class="progress"><i style="width:${progress * 100}%"></i></div>
      <span class="count">${label}</span>
    </div>`;
}

function bindLcQuit() {
  $view.querySelector('#quit').addEventListener('click', () => {
    const back = ['home', 'quiz', 'notes'].includes(lcs?.origin) ? lcs.origin : 'quiz';
    lcStop();
    lcs = null;
    document.body.classList.remove('has-bar');
    go(back);
  });
  $view.querySelector('#lc-play')?.addEventListener('click', lcPlay);
}

// Part 2: 질문 + 응답 A·B·C를 듣고 고르기
function renderLC2() {
  if (lcs.i >= lcs.items.length) return renderLCSummary();
  const q = lcs.items[lcs.i];
  const a = lcs.answered;
  const show = a || lcs.scripted;
  $view.innerHTML = `
    ${lcTop(lcs.i / lcs.items.length, `${lcs.i + 1}/${lcs.items.length}`)}
    <article class="qcard lc ${a ? (a.ok ? 'is-ok' : 'is-wrong') : ''}">
      <div class="flash-tags"><span class="tag">Part 2 응답</span><span class="tag">${srs.LEVEL_NAMES[q.level]}</span></div>
      <p class="q-label">질문을 듣고 가장 알맞은 응답을 고르세요</p>
      <button class="btn ghost lc-play" id="lc-play"></button>
      ${show ? `<p class="lc-q">${esc(q.q)}</p>` : '<p class="lc-q muted">질문과 응답은 음성으로만 나와요</p>'}
    </article>
    <div class="options lc-options">
      ${lcs.order
        .map((k, idx) => {
          const cls = a ? (k === q.answer ? 'correct' : idx === a.idx ? 'wrong' : 'dim') : '';
          return `<button class="option ${cls}" data-lchoice="${idx}" ${a ? 'disabled' : ''}><span class="num">${'ABC'[idx]}</span><span class="lc-opt">${show ? esc(q.choices[k]) : ''}${a && k !== q.answer && q.traps[k] ? ` <em class="trap">${esc(q.traps[k])}</em>` : ''}</span></button>`;
        })
        .join('')}
    </div>
    ${
      a
        ? `<section class="explain ${a.ok ? 'ok' : 'ng'}">
            <p class="explain-head">${a.ok ? '정답!' : '아쉬워요'}${lcs.scripted ? ' <small>대본을 보고 풀어서 점수에는 안 들어가요</small>' : ''}</p>
            <p class="exp">${esc(q.explanation)}</p>
            <details class="more" ${a.ok ? '' : 'open'}><summary>해석</summary><p class="ko">Q. ${esc(q.qko)}<br>A. ${esc(q.ako)}</p></details>
            ${reportBox('question', q.id)}
          </section>
          <div class="vq-bar">${
            a.ok
              ? `<button class="btn primary big" id="lc-next">${lcs.i + 1 >= lcs.items.length ? '결과 보기' : '다음 문제'}</button>`
              : `<p class="bar-label">왜 틀렸나요? <small>고르면 바로 다음으로</small></p>
                 <div class="bar-reasons">${LC.REASONS.map(([k, l]) => `<button class="chip-btn" data-lreason="${k}">${l}</button>`).join('')}</div>
                 <button class="link-btn small" id="lc-next">이유 없이 넘기기</button>`
          }</div>`
        : `<button class="link-btn" id="lc-script">${lcs.scripted ? '' : '음성이 안 나오면 대본 보기'}</button>`
    }`;
  document.body.classList.toggle('has-bar', !!a);
  lcRenderStatus();
  bindLcQuit();
  bindReportBox($view, renderLC2);
  $view.querySelector('#lc-script')?.addEventListener('click', () => {
    lcs.scripted = true;
    renderLC2();
  });
  $view.querySelectorAll('[data-lchoice]').forEach((b) =>
    b.addEventListener('click', () => {
      if (lcs.answered) return;
      const idx = Number(b.dataset.lchoice);
      const ok = lcs.order[idx] === q.answer;
      const timeMs = Math.round(performance.now() - (lcs.heardAt || lcs.shownAt));
      const attempt = Vocab.record(state, { ...q, targetMs: LC.LC_TARGET_MS }, ok, timeMs, srs.today(), 'lc2', { scripted: lcs.scripted });
      attempt.replays = Math.max(0, lcs.plays - 1);
      lcs.attempt = attempt;
      lcs.answered = { idx, ok };
      lcs.results.push({ q, ok });
      lcStop();
      persist();
      renderLC2();
    }),
  );
  const next = () => {
    lcs.i++;
    lcPrepare();
    const more = lcs.i < lcs.items.length;
    renderLC2();
    window.scrollTo(0, 0);
    if (more) lcPlay();
  };
  $view.querySelector('#lc-next')?.addEventListener('click', next);
  $view.querySelectorAll('[data-lreason]').forEach((b) =>
    b.addEventListener('click', () => {
      if (lcs.attempt) lcs.attempt.lcReason = b.dataset.lreason;
      persist();
      next();
    }),
  );
}

// Part 3·4: 문제 먼저 읽기 → 듣기(들으면서 고르기) → 채점·대본
function renderLCSet() {
  const set = lcs.set;
  const phase = lcs.phase;
  const label = set.part === 3 ? 'Part 3 대화' : 'Part 4 담화';
  const qs = set.questions;
  const review = phase === 'review';
  $view.innerHTML = `
    ${lcTop(review ? 1 : phase === 'listen' ? 0.5 : 0.1, label)}
    <article class="qcard lc">
      <div class="flash-tags"><span class="tag">${label}</span><span class="tag">${srs.LEVEL_NAMES[set.level]}</span></div>
      ${
        phase === 'preview'
          ? `<p class="q-label">듣기 전에 문제와 보기를 먼저 읽어 두세요</p>
             <p class="hint">실제 시험에서도 음성이 나오기 전에 문제를 미리 읽는 게 핵심이에요. 핵심어(누가·왜·언제·무엇을)에 집중하세요.</p>`
          : review
          ? `<p class="q-label">채점 결과 · ${lcs.results.filter((x) => x.ok).length}/${qs.length}</p>`
          : `<p class="q-label">들으면서 답을 고르세요</p><button class="btn ghost lc-play" id="lc-play"></button>`
      }
    </article>
    <ol class="lc-qs">
      ${qs
        .map((q) => {
          const pick = lcs.picks[q.n];
          const res = review ? lcs.results.find((x) => x.q.id === q.id) : null;
          return `<li class="${res ? (res.ok ? 'ok' : 'ng') : ''}">
            <p class="lc-qtext">${q.n}. ${esc(q.stem)}</p>
            <div class="lc-choices">${q.choices
              .map((c, i) => {
                const cls = review ? (i === q.answer ? 'correct' : i === pick ? 'wrong' : 'dim') : pick === i ? 'picked' : '';
                return `<button class="option small ${cls}" data-lq="${q.n}" data-c="${i}" ${review ? 'disabled' : ''}><span class="num">${'ABCD'[i]}</span>${esc(c)}</button>`;
              })
              .join('')}</div>
            ${res ? `<p class="exp">${esc(q.explanation)}</p>` : ''}
          </li>`;
        })
        .join('')}
    </ol>
    ${
      review
        ? `<section class="card">
            <h2>대본</h2>
            <div class="script">${set.lines.map((l) => `<p><b>${{ W: '여', M: '남', M2: '남2', N: '' }[l.who]}</b>${esc(l.text)}</p>`).join('')}</div>
            <details class="more"><summary>해석</summary><p class="ko">${esc(set.ko)}</p></details>
          </section>
          <div class="vq-bar"><button class="btn primary big" id="lc-again">${label} 한 세트 더</button><button class="link-btn small" id="lc-done">그만하기</button></div>`
        : phase === 'preview'
        ? `<div class="vq-bar"><button class="btn primary big" id="lc-start">다 읽었어요, 듣기 시작</button></div>`
        : phase === 'listen'
        ? `<div class="vq-bar"><button class="btn primary big" id="lc-grade" ${Object.keys(lcs.picks).length < qs.length ? 'disabled' : ''}>채점하기</button><button class="link-btn small" id="lc-script">음성이 안 나오면 대본 보고 풀기</button></div>`
        : ''
    }
    ${lcs.scripted && !review ? `<section class="card"><h2>대본</h2><div class="script">${set.lines.map((l) => `<p><b>${{ W: '여', M: '남', M2: '남2', N: '' }[l.who]}</b>${esc(l.text)}</p>`).join('')}</div></section>` : ''}`;
  document.body.classList.add('has-bar');
  lcRenderStatus();
  bindLcQuit();
  $view.querySelector('#lc-start')?.addEventListener('click', () => {
    lcs.phase = 'listen';
    renderLCSet();
    lcPlay();
  });
  $view.querySelectorAll('[data-lq]').forEach((b) =>
    b.addEventListener('click', () => {
      lcs.picks[b.dataset.lq] = Number(b.dataset.c);
      // 재생 중에도 화면을 다시 그리지 않고 표시만 바꿈 (음성 끊김 방지)
      $view.querySelectorAll(`[data-lq="${b.dataset.lq}"]`).forEach((x) => x.classList.toggle('picked', x === b));
      const g = $view.querySelector('#lc-grade');
      if (g) g.disabled = Object.keys(lcs.picks).length < qs.length;
    }),
  );
  $view.querySelector('#lc-script')?.addEventListener('click', () => {
    lcs.scripted = true;
    lcStop();
    renderLCSet();
  });
  $view.querySelector('#lc-grade')?.addEventListener('click', () => {
    lcStop();
    const t = srs.today();
    const timeMs = Math.round(performance.now() - (lcs.heardAt || lcs.shownAt));
    for (const q of qs) {
      const ok = lcs.picks[q.n] === q.answer;
      const at = Vocab.record(state, { ...q, targetMs: LC.LC_TARGET_MS }, ok, timeMs, t, q.type, { scripted: lcs.scripted });
      at.replays = Math.max(0, lcs.plays - 1);
      lcs.results.push({ q, ok });
    }
    persist();
    lcs.phase = 'review';
    renderLCSet();
    window.scrollTo(0, 0);
  });
  $view.querySelector('#lc-again')?.addEventListener('click', () => startLC(lcs.mode));
  $view.querySelector('#lc-done')?.addEventListener('click', () => {
    const back = ['home', 'quiz', 'notes'].includes(lcs.origin) ? lcs.origin : 'quiz';
    lcs = null;
    go(back);
  });
}

// 받아쓰기: 한 문장 듣고 쓰기 → 낱말별 채점
function renderDict() {
  if (lcs.i >= lcs.items.length) {
    const avg = Math.round((lcs.scores.reduce((a, b) => a + b, 0) / (lcs.scores.length || 1)) * 100);
    $view.innerHTML = `<section class="hero done">
        <p class="hero-title">받아쓰기 끝!</p>
        <div class="today-grid two"><div><strong>${lcs.scores.length}</strong><span>문장</span></div><div><strong>${avg}%</strong><span>맞힌 낱말</span></div></div>
        <button class="btn primary big" data-lc="dict">5문장 더</button>
        <button class="btn ghost wide home-btn" data-go="quiz">문제 홈으로</button>
      </section>`;
    lcs = null;
    bindVqButtons();
    bindGoButtons();
    return;
  }
  const q = lcs.items[lcs.i];
  const res = lcs.answered;
  $view.innerHTML = `
    ${lcTop(lcs.i / lcs.items.length, `${lcs.i + 1}/${lcs.items.length}`)}
    <article class="qcard lc">
      <div class="flash-tags"><span class="tag">받아쓰기</span><span class="tag">${srs.LEVEL_NAMES[q.level]}</span></div>
      <p class="q-label">들리는 대로 영어 문장을 쓰세요</p>
      <button class="btn ghost lc-play" id="lc-play"></button>
      ${
        res
          ? `<p class="dict-res">${res.marks.map((m) => `<span class="${m.ok ? 'ok' : 'ng'}">${esc(m.w)}</span>`).join(' ')}</p>
             <p class="hint">빨간 낱말을 놓쳤어요 · ${Math.round(res.score * 100)}%</p>
             <p class="ko">${esc(q.qko)}</p>`
          : `<textarea id="dict-input" rows="3" placeholder="예: Where is the nearest bank?" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>`
      }
    </article>
    <div class="vq-bar">${
      res ? `<button class="btn primary big" id="dict-next">${lcs.i + 1 >= lcs.items.length ? '결과 보기' : '다음 문장'}</button>` : `<button class="btn primary big" id="dict-check">확인</button>`
    }</div>`;
  document.body.classList.add('has-bar');
  lcRenderStatus();
  bindLcQuit();
  $view.querySelector('#dict-check')?.addEventListener('click', () => {
    const typed = $view.querySelector('#dict-input').value;
    lcs.answered = LC.dictCompare(q.q, typed);
    lcs.scores.push(lcs.answered.score);
    lcStop();
    if (!state.studyDays.includes(srs.today())) state.studyDays.push(srs.today());
    persist();
    renderDict();
  });
  $view.querySelector('#dict-next')?.addEventListener('click', () => {
    lcs.i++;
    lcPrepare();
    const more = lcs.i < lcs.items.length;
    renderDict();
    if (more) lcPlay();
  });
}

function renderLCSummary() {
  const r = lcs.results;
  const counted = r.length;
  const correct = r.filter((x) => x.ok).length;
  const wrong = r.filter((x) => !x.ok);
  const origin = lcs.origin;
  lcs = null;
  document.body.classList.remove('has-bar');
  const t = srs.today();
  $view.innerHTML = `
    <section class="hero done">
      <p class="hero-title">듣기 완료!</p>
      <div class="today-grid two"><div><strong>${correct}/${counted}</strong><span>정답</span></div><div><strong>${LC.todayCount(state, t)}</strong><span>오늘 들은 문제</span></div></div>
      ${nextTaskButton(t, 'listening')}
      <p class="hint">${todayLeftText(t)}</p>
      <button class="btn ghost wide" data-lc="lc2">10문제 더 듣기</button>
      <button class="btn ghost wide home-btn" data-go="${['home', 'notes'].includes(origin) ? origin : 'quiz'}">${origin === 'home' ? '홈으로' : origin === 'notes' ? '오답노트로' : '문제 홈으로'}</button>
    </section>
    ${
      wrong.length
        ? `<section class="card"><h2>틀린 문제</h2><ul class="wrong-list">${wrong
            .map((x) => `<li><p class="stem">${esc(x.q.q)}</p><small>정답: ${esc(x.q.choices[x.q.answer])}</small></li>`)
            .join('')}</ul><p class="hint">틀린 문제는 내일 다시 나와요.</p></section>`
        : ''
    }`;
  bindVqButtons();
  bindGoButtons();
  bindStartButtons();
  bindConceptButtons();
}

function typeGrid(types, stats, area) {
  return `<div class="type-grid">${Object.entries(types)
    .map(([k, v]) => {
      const r = stats[k];
      const rate = r.rate === null ? null : Math.round(r.rate * 100);
      return `<button class="type-tile" data-vq="type" data-type="${k}">
        <b>${v.name}</b>
        <span class="rate ${rate === null ? '' : rate < 60 ? 'low' : rate < 80 ? 'mid' : 'high'}">${rate === null ? '시작 전' : `${rate}% · ${r.n}문제`}</span>
      </button>`;
    })
    .join('')}</div>`;
}

// 문제 탭: 영역(어휘·문법·장문 빈칸)을 위에서 고르고, 그 영역만 보여 줌
function renderQuizHome() {
  const tab = ui.quizTab || 'vocab';
  const seg = [
    ['vocab', '어휘'],
    ['grammar', '문법'],
    ['part6', '장문 빈칸'],
    ['lc', '듣기'],
  ];
  let body = '';
  if (tab === 'vocab') {
    body = `${vocabTodayCard()}
      <section class="card">
        <h2>유형별 연습</h2>
        ${typeGrid(Vocab.TYPES, Vocab.typeStats(state), 'vocab')}
        <p class="hint">정답률이 낮은 유형은 오늘의 문제에 더 자주 나와요.</p>
      </section>`;
  } else if (tab === 'grammar') {
    body = `${grammarTodayCard()}
      <section class="card">
        <h2>유형별 연습</h2>
        ${state.attempts.some((a) => a.module === 'grammar') ? `<button class="link-row" data-concept="basic-structure">문법 기초 3장 <small>문장 뼈대 · 품사 자리 · 동사 결정 순서</small></button>` : ''}
        ${typeGrid(Vocab.GRAMMAR_TYPES, Vocab.typeStats(state, 'grammar'), 'grammar')}
        <p class="hint">처음 푸는 유형은 개념 카드를 먼저 보여 줘요.</p>
        <div class="concept-chips"><span>개념 카드</span>${Object.entries(Vocab.GRAMMAR_TYPES)
          .map(([k, v]) => `<button class="mini-chip" data-concept="${k}">${v.name}</button>`)
          .join('')}</div>
      </section>`;
  } else if (tab === 'part6') {
    body = p6Card();
  } else {
    body = lcCard();
  }
  $view.innerHTML = `
    <div class="seg quiz-seg" role="tablist">${seg.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-qtab="${k}">${l}</button>`).join('')}</div>
    ${body}
    <div class="tool-row">
      <button class="tool" data-vq="speed"><b>스피드 모드</b><small>${Vocab.SPEED.n}문제 · ${Vocab.SPEED.ms / 60000}분${speedBest() ? ` · 최고 ${speedBest()}` : ''}</small></button>
      <button class="tool" data-vq="test"><b>3분 수준 진단</b><small>어휘 9 · 문법 6</small></button>
    </div>
    <p class="hint center">독해(Part 7)는 다음 버전에 추가돼요.</p>`;
  $view.querySelectorAll('[data-qtab]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.quizTab = b.dataset.qtab;
      renderQuizHome();
    }),
  );
  bindVqButtons();
  bindConceptButtons();
}

function startVQ(mode, type, opts = {}) {
  if (!bank.length) return toast('문제를 불러오지 못했어요');
  const t = srs.today();
  let items;
  if (mode === 'type' && Vocab.GRAMMAR_TYPES[type] && !opts.skipConcept && !(state.settings.conceptsSeen || []).includes(type) && concepts.some((c) => c.id === type)) return openConcept(type, 'start');
  if (mode === 'daily') items = Vocab.buildDaily(state, bank, state.settings, t, Math.max(5, goals(t).vocab - questionsToday(t, 'vocab')) || goals(t).vocab);
  else if (mode === 'p6') items = Vocab.buildP6(state, p6sets, bank, state.settings, t, 1);
  else if (mode === 'gdaily') items = Vocab.buildDaily(state, bank, state.settings, t, Math.max(5, goals(t).grammar - questionsToday(t, 'grammar')), 'grammar');
  else if (mode === 'type') items = Vocab.buildType(state, bank, type, state.settings, t);
  else if (mode === 'wrong') items = Vocab.buildWrong(state, bank);
  else if (mode === 'speed') items = Vocab.buildSpeed(state, bank, state.settings, t);
  else items = Vocab.buildTest(bank);
  if (!items.length) return toast('풀 문제가 없어요');
  vqs = { mode, type, items, i: 0, results: [], added: [], fromWelcome: !!opts.fromWelcome, origin: view === 'vq' || view === 'concept' ? 'quiz' : view };
  if (mode === 'speed') {
    vqs.startedAt = performance.now();
    vqs.deadline = vqs.startedAt + Vocab.SPEED.ms;
  }
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
  const isSpeed = vqs.mode === 'speed';
  const isPara = q.type === 'para';
  const isP6 = q.part === 6;
  const [before, after] = isPara ? q.stem.split('[' + q.target + ']') : q.stem.split('____');
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
        <span class="tag">${Vocab.ALL_TYPES[q.type].name}</span>
        <span class="tag">${srs.LEVEL_NAMES[q.level]}</span>
      </div>
      ${
        isSpeed
          ? `<span class="timer speed" id="vq-timer">${speedLeft()}</span>`
          : `<span class="timer ${a && a.timeMs > (q.targetMs || Vocab.TARGET_MS) ? 'over' : ''}" id="vq-timer">${a ? Math.round(a.timeMs / 1000) : 0}초</span>`
      }
      ${
        isP6
          ? p6Passage(q, a)
          : isPara
          ? `<p class="q-label">밑줄 친 단어와 뜻이 가장 가까운 것을 고르세요</p>
             <p class="cloze left">${esc(before)}<u class="para-word">${esc(q.target)}</u>${a ? ` <mark>≈ ${esc(answerText)}</mark>` : ''}${esc(after)}</p>`
          : `<p class="q-label">빈칸에 알맞은 것을 고르세요</p>
             <p class="cloze left">${esc(before)}${a ? `<mark>${esc(answerText)}</mark>` : '<span class="blank">&nbsp;</span>'}${esc(after)}</p>`
      }
    </article>
    <div class="answer-area">
      <div class="options">${options}</div>
      ${!a ? `<button class="link-btn" data-act="dontknow">모르겠어요</button>` : isTest || isSpeed ? '' : explainBlock(q, v, a)}
    </div>
    ${a && !isTest && !isSpeed ? vqBar(a) : ''}`;
  document.body.classList.toggle('has-bar', !!(a && !isTest && !isSpeed));
  // 답한 뒤에는 고른 보기와 해설이 보이도록 살짝 내림
  if (a && !isTest && !isSpeed) {
    const opt = $view.querySelector('.options');
    if (opt) window.scrollTo({ top: Math.max(0, opt.getBoundingClientRect().top + window.scrollY - 140), behavior: 'smooth' });
  }
  // 장문 빈칸: 지문 상자 안에서 지금 빈칸이 보이게
  const curBlank = $view.querySelector('.p6-blank.cur, mark.p6-cur');
  const pbox = $view.querySelector('.p6-passage');
  if (curBlank && pbox) pbox.scrollTop = Math.max(0, curBlank.offsetTop - pbox.offsetTop - pbox.clientHeight / 3);

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
  bindReportBox();
  bindConceptButtons();
  $view.querySelectorAll('[data-reason]').forEach((b) =>
    b.addEventListener('click', () => {
      vqs.reason = b.dataset.reason;
      if (vqs.attempt) vqs.attempt.reasonTag = vqs.reason;
      persist();
      $view.querySelectorAll('[data-reason]').forEach((x) => x.classList.toggle('on', x.dataset.reason === vqs.reason));
      setTimeout(vqNext, 180);
    }),
  );

  if (isSpeed) {
    const el = $view.querySelector('#vq-timer');
    vqTimer = setInterval(() => {
      if (!vqs || vqs.mode !== 'speed') return clearInterval(vqTimer);
      el.textContent = speedLeft();
      el.classList.toggle('over', vqs.deadline - performance.now() < 30000);
      if (performance.now() >= vqs.deadline) speedTimeUp();
    }, 250);
  } else if (!a) {
    const el = $view.querySelector('#vq-timer');
    vqTimer = setInterval(() => {
      const sec = Math.floor((performance.now() - vqs.shownAt) / 1000);
      el.textContent = sec + '초';
      el.classList.toggle('over', sec * 1000 > (q.targetMs || Vocab.TARGET_MS));
    }, 1000);
  }
}

// 장문 빈칸: 지문 전체를 보여 주고 지금 빈칸만 강조. 이번에 이미 푼 빈칸은 정답으로 채움
function p6Passage(q, a) {
  const set = p6sets.find((x) => x.id === q.set);
  if (!set) return '';
  const solved = new Set((vqs?.results || []).map((x) => x.q.id));
  const html = esc(set.passage)
    .replace(/\{(\d)\}/g, (_, d) => {
      const n = Number(d);
      const qq = bank.find((x) => x.id === `p6-${set.id}-${n}`);
      if (!qq) return `(${n})`;
      if (n === q.n) return a ? `<mark class="p6-cur">${esc(qq.choices[qq.answer])}</mark>` : `<span class="p6-blank cur">(${n})</span>`;
      if (solved.has(qq.id)) return `<span class="p6-done">${esc(qq.choices[qq.answer])}</span>`;
      return `<span class="p6-blank">(${n})</span>`;
    })
    .replace(/\n/g, '<br>');
  return `<p class="q-label">${esc(set.kind)} · 빈칸 (${q.n})에 ${q.type === 'p6sent' ? '들어갈 문장을' : '알맞은 것을'} 고르세요</p>
    <div class="p6-passage">${html}</div>`;
}

function speedLeft() {
  const ms = Math.max(0, vqs.deadline - performance.now());
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// 테스트에서 마감 시각을 당길 때 쓰는 훅 (화면에는 영향 없음)
window.__forceSpeedEnd = () => {
  if (vqs?.mode === 'speed') vqs.deadline = performance.now();
};

// 시간이 끝나면 남은 문제는 못 푼 문제로 남기고 결과로
function speedTimeUp() {
  clearInterval(vqTimer);
  if (!vqs) return;
  vqs.timedOut = vqs.items.length - vqs.results.length;
  vqs.items = vqs.items.slice(0, vqs.results.length);
  vqs.i = vqs.items.length;
  renderVQ();
}

// ---------- '이 문제 이상해요' 신고 ----------
const REPORT_REASONS = [
  ['answer', '정답이 틀린 것 같아요'],
  ['explain', '해설이 이상해요'],
  ['choices', '보기에 문제가 있어요'],
  ['meaning', '뜻이 틀렸어요'],
  ['etc', '기타'],
];
let reportOpen = null;

function isReported(id) {
  return (state.reports || []).some((r) => r.targetId === id);
}

function reportBox(kind, id) {
  if (isReported(id)) return `<p class="reported">신고한 문제예요. 점수 계산과 출제에서 빠져요. <button class="link-btn small inline" data-unreport="${esc(id)}">신고 취소</button></p>`;
  if (reportOpen !== id) return `<button class="link-btn small report-btn" data-report-open="${esc(kind)}|${esc(id)}">이 ${kind === 'word' ? '단어' : '문제'} 이상해요</button>`;
  const reasons = REPORT_REASONS.filter(([k]) => (kind === 'word' ? ['meaning', 'etc'].includes(k) : k !== 'meaning'));
  return `
    <div class="report-box" data-kind="${esc(kind)}" data-id="${esc(id)}">
      <p class="reason-label">무엇이 이상한가요?</p>
      <div class="reasons">${reasons.map(([k, l], i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-rr="${k}">${l}</button>`).join('')}</div>
      <input class="report-memo" placeholder="메모 (선택)">
      <div class="btn-row"><button class="btn ghost small" data-report-cancel>취소</button><button class="btn primary small" data-report-send>신고하기</button></div>
    </div>`;
}

function bindReportBox(root = $view, rerender = () => render()) {
  root.querySelectorAll('[data-report-open]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      reportOpen = b.dataset.reportOpen.split('|')[1];
      rerender();
    }),
  );
  root.querySelectorAll('.report-box').forEach((box) => {
    box.querySelectorAll('[data-rr]').forEach((c) =>
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        box.querySelectorAll('[data-rr]').forEach((x) => x.classList.toggle('on', x === c));
      }),
    );
    box.querySelector('[data-report-cancel]').addEventListener('click', (e) => {
      e.stopPropagation();
      reportOpen = null;
      rerender();
    });
    box.querySelector('[data-report-send]').addEventListener('click', (e) => {
      e.stopPropagation();
      state.reports = [
        ...(state.reports || []),
        {
          id: uid(),
          kind: box.dataset.kind,
          targetId: box.dataset.id,
          reason: box.querySelector('[data-rr].on')?.dataset.rr || 'etc',
          memo: box.querySelector('.report-memo').value.trim(),
          date: srs.today(),
        },
      ];
      reportOpen = null;
      persist();
      toast('신고했어요. 점수 계산과 출제에서 빠져요');
      rerender();
    });
  });
  root.querySelectorAll('[data-unreport]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      state.reports = state.reports.filter((r) => r.targetId !== b.dataset.unreport);
      persist();
      toast('신고를 취소했어요');
      rerender();
    }),
  );
}

// 해설: 판정 · 단서 · 설명만 바로 보이고, 해석·보기별 뜻은 접어 둠 (틀렸을 때는 펼침)
function explainBlock(q, v, a) {
  const sec = Math.round(a.timeMs / 1000);
  const target = q.targetMs || Vocab.TARGET_MS;
  return `
    <section class="explain ${a.ok ? 'ok' : 'ng'}">
      <p class="explain-head">${a.ok ? '정답!' : a.choice < 0 ? '정답을 확인하세요' : '아쉬워요'}
        <small>${sec}초${a.timeMs > target ? ` · 목표 ${Math.round(target / 1000)}초 넘음` : ''}</small></p>
      <p class="clue"><b>단서</b>${esc(q.clue)}</p>
      <p class="exp">${esc(q.explanation)}</p>
      ${Vocab.GRAMMAR_TYPES[q.type] && concepts.some((c) => c.id === q.type) ? `<button class="link-btn small concept-link" data-concept="${q.type}">${Vocab.GRAMMAR_TYPES[q.type].name} 개념 다시 보기 →</button>` : ''}
      <details class="more" ${a.ok ? '' : 'open'}>
        <summary>${q.ko ? '해석 · ' : ''}보기별 뜻</summary>
        ${q.ko ? `<p class="ko">${esc(q.ko)}</p>` : ''}
        <ul class="choice-means">
          ${v.choices
            .map((c, idx) => `<li class="${idx === v.answer ? 'ans' : idx === a.choice ? 'picked' : ''}"><b>${esc(c)}</b><span>${esc(q.meanings?.[c] || '')}</span></li>`)
            .join('')}
        </ul>
      </details>
      ${a.addedWord ? `<p class="added">'${esc(a.addedWord)}'를 단어장에 추가했어요.</p>` : ''}
      ${reportBox('question', q.id)}
    </section>`;
}

// 화면 아래 고정 버튼: 맞히면 '다음', 틀리면 이유 4개(고르면 바로 다음)
function vqBar(a) {
  const last = vqs.i + 1 >= vqs.items.length;
  return `<div class="vq-bar">${
    a.ok
      ? `<button class="btn primary big" id="vq-next">${last ? '결과 보기' : '다음 문제'}</button>`
      : `<p class="bar-label">왜 틀렸나요? <small>고르면 바로 ${last ? '결과로' : '다음으로'}</small></p>
         <div class="bar-reasons">${Vocab.REASONS.map(([k, l]) => `<button class="chip-btn ${vqs.reason === k ? 'on' : ''}" data-reason="${k}">${l}</button>`).join('')}</div>
         <button class="link-btn small" id="vq-next">이유 없이 넘기기</button>`
  }</div>`;
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
  if (vqs.mode === 'test' || vqs.mode === 'speed') setTimeout(vqNext, vqs.mode === 'speed' ? 350 : 600);
  else $view.querySelector('.explain')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function vqNext() {
  if (!vqs || !vqs.answered || vqs.i >= vqs.items.length) return;
  vqs.i++;
  vqPrepare();
  renderVQ();
  window.scrollTo(0, 0);
}

function renderVQSummary() {
  const r = vqs.results;
  const correct = r.filter((x) => x.ok).length;
  const avg = r.length ? Math.round(r.reduce((s, x) => s + x.timeMs, 0) / r.length / 1000) : 0;
  const slow = r.filter((x) => x.timeMs > (x.q.targetMs || Vocab.TARGET_MS)).length;
  const byType = Object.keys(Vocab.ALL_TYPES)
    .map((k) => [k, r.filter((x) => x.q.type === k)])
    .filter(([, l]) => l.length);
  const wrong = r.filter((x) => !x.ok);
  const mode = vqs.mode;
  const type = vqs.type;
  const added = vqs.added.length;
  const speed = mode === 'speed' ? speedResult(vqs, correct, r.length) : null;
  const doneSets = [...new Set(r.filter((x) => x.q.part === 6).map((x) => x.q.set))].map((id) => p6sets.find((x) => x.id === id)).filter(Boolean);
  vqs = null;
  const lv = mode === 'test' ? null : applyLevelCheck();

  $view.innerHTML = `
    <section class="hero done">
      <p class="hero-title">${speed ? (speed.left ? `시간 종료 · ${speed.left}문제 못 풀었어요` : speed.record ? '최고 기록이에요!' : '스피드 모드 완료!') : correct === r.length ? '전부 맞혔어요!' : '풀이 완료!'}</p>
      <div class="today-grid">
        <div><strong>${correct}/${speed ? speed.n : r.length}</strong><span>정답</span></div>
        <div><strong>${speed ? speed.sec + '초' : avg + '초'}</strong><span>${speed ? '걸린 시간' : '평균 시간'}</span></div>
        <div><strong>${speed ? avg + '초' : slow}</strong><span>${speed ? '문제당 평균' : '20초 넘은 문제'}</span></div>
      </div>
      ${speed ? `<p class="hint">실전 Part 5는 문제당 20초 안팎이에요. ${avg <= 20 ? '시간 안에 풀고 있어요.' : '단서부터 찾고 바로 고르는 연습을 해 보세요.'}${speed.prev ? ` 최고 기록: ${speed.prev}` : ''}</p>` : ''}
      ${lv ? levelNotice(lv) : ''}
      ${mode === 'daily' || mode === 'gdaily' ? `${nextTaskButton(srs.today(), mode === 'daily' ? 'vocab' : 'grammar')}<p class="hint">${todayLeftText(srs.today())}</p>` : ''}
      <ul class="moves">
        ${byType
          .map(([k, l]) => {
            const c = l.filter((x) => x.ok).length;
            return `<li><span class="tag stage ${c === l.length ? 's4' : c / l.length >= 0.5 ? 's2' : 's1'}">${c}/${l.length}</span><div><b>${Vocab.ALL_TYPES[k].name}</b><small>${Vocab.ALL_TYPES[k].desc}</small></div></li>`;
          })
          .join('')}
      </ul>
      ${added ? `<p class="hint">틀린 문제의 정답 단어 ${added}개를 단어장에 추가했어요.</p>` : ''}
      <button class="btn ${(mode === 'daily' || mode === 'gdaily') && nextTask(srs.today(), mode === 'daily' ? 'vocab' : 'grammar') ? 'ghost wide' : 'primary big'}" data-vq="${mode}" ${type ? `data-type="${type}"` : ''}>${mode === 'daily' || mode === 'gdaily' ? '10문제 더 풀기' : mode === 'p6' ? '다음 지문 풀기' : mode === 'wrong' ? '남은 오답 다시 풀기' : mode === 'speed' ? '한 번 더 도전' : '이 유형 더 풀기'}</button>
      <button class="btn ghost wide home-btn" data-go="${mode === 'wrong' ? 'notes' : 'quiz'}">${mode === 'wrong' ? '오답노트로' : '문제 홈으로'}</button>
    </section>
    ${
      wrong.length
        ? `<section class="card"><h2>틀린 문제</h2><ul class="wrong-list">
            ${wrong.map((x) => `<li><p>${esc(x.q.stem.replace('____', '[' + x.q.choices[x.q.answer] + ']'))}</p><small>${esc(x.q.clue)}</small></li>`).join('')}
          </ul><p class="hint">틀린 문제는 내일 오늘의 어휘 문제에 다시 나와요.</p></section>`
        : ''
    }${
      doneSets.length
        ? `<section class="card"><h2>지문 해석</h2>${doneSets.map((set) => `<p class="p6-title"><b>${esc(set.title)}</b> <small>${esc(set.kind)} · ${srs.LEVEL_NAMES[set.level]}</small></p><p class="p6-ko">${esc(set.ko)}</p>`).join('')}</section>`
        : ''
    }`;
  bindVqButtons();
  bindGoButtons();
  bindStartButtons();
  bindConceptButtons();
  bindLevelNotice(lv);
}

function speedResult(v, correct, answered) {
  const n = v.items.length + (v.timedOut || 0);
  const ms = Math.min(Vocab.SPEED.ms, Math.round(performance.now() - v.startedAt));
  const prevBest = state.settings.speedBest;
  const better = !prevBest || correct > prevBest.correct || (correct === prevBest.correct && ms < prevBest.ms);
  const record = better && answered === n;
  if (record) {
    state.settings.speedBest = { correct, n, ms, date: srs.today() };
    persist();
  }
  return { n, left: v.timedOut || 0, sec: Math.round(ms / 1000), record, prev: !record && prevBest ? `${prevBest.correct}/${prevBest.n} · ${Math.round(prevBest.ms / 1000)}초` : '' };
}

// 수준 자동 조정: 올리기는 바로 적용(되돌리기 가능), 내리기는 제안만
function applyLevelCheck() {
  const lv = Vocab.levelCheck(state, state.settings);
  if (!lv) return null;
  if (lv.dir === 'up') {
    state.settings.prevStartLevel = lv.from;
    state.settings.startLevel = lv.to;
    state.settings.levelChangedAt = Date.now();
    persist();
  }
  return lv;
}

function levelNotice(lv) {
  const pct = Math.round(lv.rate * 100);
  return lv.dir === 'up'
    ? `<div class="level-notice up"><b>${srs.LEVEL_NAMES[lv.to]} 수준으로 올렸어요</b><small>${srs.LEVEL_NAMES[lv.from]} 문제 최근 ${lv.n}개 정답률 ${pct}%. 이제 ${srs.LEVEL_NAMES[lv.to]} 문제와 단어부터 나와요.</small><button class="link-btn small" id="level-undo">되돌리기</button></div>`
    : `<div class="level-notice down"><b>${srs.LEVEL_NAMES[lv.to]} 수준으로 내릴까요?</b><small>${srs.LEVEL_NAMES[lv.from]} 문제 최근 ${lv.n}개 정답률 ${pct}%예요. 기초를 다지면 점수가 더 빨리 올라요.</small><div class="btn-row"><button class="btn ghost small" id="level-keep">그대로</button><button class="btn primary small" id="level-down">내리기</button></div></div>`;
}

function bindLevelNotice(lv) {
  if (!lv) return;
  const box = $view.querySelector('.level-notice');
  const done = (msg) => {
    state.settings.levelChangedAt = Date.now();
    persist();
    box.remove();
    if (msg) toast(msg);
  };
  $view.querySelector('#level-undo')?.addEventListener('click', () => {
    state.settings.startLevel = lv.from;
    done('원래 수준으로 되돌렸어요');
  });
  $view.querySelector('#level-keep')?.addEventListener('click', () => done(''));
  $view.querySelector('#level-down')?.addEventListener('click', () => {
    state.settings.startLevel = lv.to;
    done(`${srs.LEVEL_NAMES[lv.to]} 수준으로 내렸어요`);
  });
}

function renderTestResult() {
  const { rate, rec } = Vocab.testResult(vqs.results);
  const lv = LEVELS.find((l) => l.id === rec);
  const fromWelcome = vqs.fromWelcome;
  const byArea = (area) => {
    const l = vqs.results.filter((x) => Vocab.areaOf(x.q) === area);
    return `${l.filter((x) => x.ok).length}/${l.length}`;
  };
  const areaLine = `어휘 ${byArea('vocab')} · 문법 ${byArea('grammar')}`;
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
      <p class="hint">${areaLine}</p>
      <p class="rec">추천: <b>${esc(lv.label)}</b> 수준<br><small>${srs.LEVEL_NAMES[lv.start]} 단어부터 · 하루 새 단어 ${lv.daily}개</small></p>
      <button class="btn primary big" id="apply">${fromWelcome ? '이 수준으로 시작하기' : '이 수준으로 설정 바꾸기'}</button>
      <button class="btn ghost wide home-btn" id="skip">${fromWelcome ? '직접 고를게요' : '그대로 둘게요'}</button>
    </section>
    <p class="hint center">진단은 연습에 나오지 않는 전용 15문제(어휘 9 · 문법 6)로 봐요. 다시 봐도 같은 기준으로 비교할 수 있어요.</p>`;
  $view.querySelector('#apply').addEventListener('click', () => {
    Object.assign(state.settings, {
      level: lv.id,
      dailyNewWords: lv.daily,
      startLevel: lv.start,
      levelChangedAt: Date.now(),
      clozeHint: lv.hint,
      ...(fromWelcome ? { targetScore: lv.target, onboarded: true, dailyMinutes: 25 } : {}),
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
            </label>
            <p class="field-label">하루에 공부할 시간</p>
            <div class="seg minutes-seg">${MINUTE_OPTIONS.map(([v]) => `<button class="${(ui.minutes ?? 25) === v ? 'on' : ''}" data-min="${v}">${v}분</button>`).join('')}</div>`
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
  $view.querySelectorAll('[data-min]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.minutes = Number(b.dataset.min);
      renderWelcome();
    }),
  );
  $view.querySelector('#begin').addEventListener('click', () => {
    if (!sel) return;
    const target = Math.min(990, Math.max(10, Math.round(Number(ui.target ?? sel.target)) || sel.target));
    Object.assign(state.settings, {
      level: sel.id,
      dailyNewWords: sel.daily,
      startLevel: sel.start,
      clozeHint: sel.hint,
      targetScore: target,
      dailyMinutes: ui.minutes ?? 25,
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

// ---------- 오답노트 ----------
const REASON_TIP = {
  meaning: ['단어 뜻을 몰라서', '단어 학습량을 늘리거나 약한 단어 연습을 해 보세요'],
  grammar: ['품사·문법이 헷갈려서', '문법 개념 카드를 다시 보고 해당 유형을 연습해 보세요'],
  time: ['시간에 쫓겨서', '문제당 20초 안에 단서부터 찾는 연습을 해 보세요'],
  mistake: ['실수', '보기를 끝까지 읽고 고르는 습관이 필요해요'],
  none: ['이유 안 고름', '틀렸을 때 이유를 골라 두면 약점 분석이 정확해져요'],
};

function renderNotes() {
  const t = srs.today();
  const list = Vocab.wrongQuestions(state, bank);
  const open = list.filter((x) => !x.resolved);
  const done = list.filter((x) => x.resolved);
  const since = srs.addDays(t, -14);
  const recentWrong = new Set(state.attempts.filter((a) => a.kind === 'word' && !a.correct && a.date >= since).map((a) => a.targetId));
  const words = state.words
    .filter((w) => w.srs && w.srs.box < 3 && ((w.lapses || 0) > 0 || recentWrong.has(w.id)))
    .sort((a, b) => (b.lapses || 0) - (a.lapses || 0) || a.srs.box - b.srs.box);
  const lcAll = [...lcP2, ...lcSets.flatMap((x) => x.questions)];
  const lcList = Vocab.wrongQuestions(state, lcAll);
  const lcOpen = lcList.filter((x) => !x.resolved);
  const reasons = Vocab.reasonStats(state, t);
  const totalR = Object.values(reasons).reduce((a, b) => a + b, 0);
  const topReason = Object.entries(reasons).filter(([k]) => k !== 'none').sort((a, b) => b[1] - a[1])[0];
  const tab = ui.notesTab || 'questions';

  const qItem = (x) => {
    const q = x.q;
    const opened = ui.noteOpen === q.id;
    return `<li data-note="${esc(q.id)}" class="${opened ? 'open' : ''}">
      <div class="row">
        <div class="main"><p class="stem">${esc(q.stem.replace('____', '[' + q.choices[q.answer] + ']'))}</p>
          <small>${Vocab.ALL_TYPES[q.type].name} · ${srs.LEVEL_NAMES[q.level]} · ${x.wrong}번 틀림${x.reason ? ' · ' + REASON_TIP[x.reason][0] : ''} · ${x.lastWrongDate.slice(5).replace('-', '/')}</small></div>
      </div>
      ${opened ? `<div class="detail"><p class="clue"><b>단서</b>${esc(q.clue)}</p><p class="exp">${esc(q.explanation)}</p><p class="ko">${esc(q.ko)}</p>${reportBox('question', q.id)}</div>` : ''}
    </li>`;
  };

  $view.innerHTML = `
    <section class="hero">
      <p class="hero-title">${open.length + lcOpen.length + words.length ? `해결 안 된 오답 ${open.length + lcOpen.length + words.length}개` : '해결 안 된 오답이 없어요'}</p>
      <div class="today-grid">
        <div><strong>${open.length}</strong><span>문제</span></div>
        <div><strong>${lcOpen.length}</strong><span>듣기</span></div>
        <div><strong>${words.length}</strong><span>단어</span></div>
      </div>
      <button class="btn primary big" data-vq="wrong" ${open.length ? '' : 'disabled'}>오답만 다시 풀기${open.length ? ` (${Math.min(10, open.length)}문제)` : ''}</button>
      ${words.length ? `<button class="btn ghost wide home-btn" data-start="practice">자주 틀린 단어 연습</button>` : ''}
      <p class="hint">틀린 문제는 두 번 연속 맞히면 '해결'로 옮겨져요.</p>
    </section>

    ${
      totalR
        ? `<section class="card">
            <h2>틀린 이유 <small>최근 30일 · ${totalR}문제</small></h2>
            <ul class="reason-bars">${Object.entries(reasons)
              .filter(([, n]) => n)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => `<li><span>${REASON_TIP[k][0]}</span><div class="pbar"><i style="width:${(n / totalR) * 100}%"></i></div><b>${n}</b></li>`)
              .join('')}</ul>
            ${topReason && topReason[1] ? `<p class="hint">가장 많은 이유는 '${REASON_TIP[topReason[0]][0]}'예요. ${REASON_TIP[topReason[0]][1]}.</p>` : ''}
          </section>`
        : ''
    }

    <div class="seg notes-seg" role="tablist">
      <button class="${tab === 'questions' ? 'on' : ''}" data-ntab="questions">문제 ${open.length}</button>
      <button class="${tab === 'lc' ? 'on' : ''}" data-ntab="lc">듣기 ${lcOpen.length}</button>
      <button class="${tab === 'words' ? 'on' : ''}" data-ntab="words">단어 ${words.length}</button>
      <button class="${tab === 'done' ? 'on' : ''}" data-ntab="done">해결 ${done.length + lcList.length - lcOpen.length}</button>
    </div>
    ${
      tab === 'lc'
        ? lcOpen.length
          ? `${lcOpen.some((x) => x.q.type === 'lc2') ? `<button class="btn primary wide" data-lc="lcwrong">틀린 Part 2 다시 듣기 (${Math.min(10, lcOpen.filter((x) => x.q.type === 'lc2').length)}문제)</button>` : ''}
             <ul class="note-list lc-notes">${lcOpen
               .map((x) => {
                 const q = x.q;
                 const set = q.set ? lcSets.find((z) => z.id === q.set) : null;
                 return `<li><div class="row"><div class="main"><p class="stem">${esc(q.type === 'lc2' ? q.q : q.stem)}</p>
                   <small>${LC.TYPE_NAMES[q.type]}${set ? ` · ${esc(set.title)}` : ''} · 정답: ${esc(q.choices[q.answer])} · ${x.wrong}번 틀림</small>
                   ${set ? `<button class="link-btn small" data-lc="set:${esc(set.id)}">이 세트 다시 듣기</button>` : ''}</div></div></li>`;
               })
               .join('')}</ul>
             <p class="hint">두 번 연속 맞히면 '해결'로 옮겨져요.</p>`
          : '<section class="card soon"><p>틀린 듣기 문제가 없어요.</p></section>'
        : tab === 'words'
        ? words.length
          ? `<ul class="word-list">${words
              .map((w) => `<li><div class="row"><div class="main"><b>${esc(w.word)}</b><span>${esc(w.meaning)}</span></div><span class="status"><i class="seg${w.srs.box}"></i>${Session.isHard(w) ? '어려운 단어 · ' : ''}${srs.stageName(w.srs.box)}${w.lapses ? ` · ${w.lapses}번 떨어짐` : ''}</span></div></li>`)
              .join('')}</ul><p class="hint">'익숙함'까지 올라가면 오답에서 빠져요.</p>`
          : '<section class="card soon"><p>자주 틀린 단어가 없어요.</p></section>'
        : (tab === 'done' ? done : open).length
          ? `<ul class="note-list">${(tab === 'done' ? done : open).map(qItem).join('')}</ul>`
          : `<section class="card soon"><p>${tab === 'done' ? '아직 해결한 오답이 없어요.' : '틀린 문제가 없어요.'}</p></section>`
    }
    <p class="hint center">교재 오답 기록은 v6에서 추가돼요.</p>`;

  bindVqButtons();
  bindStartButtons();
  $view.querySelectorAll('[data-ntab]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.notesTab = b.dataset.ntab;
      renderNotes();
    }),
  );
  $view.querySelectorAll('[data-note] .row').forEach((r) =>
    r.addEventListener('click', () => {
      const id = r.parentElement.dataset.note;
      ui.noteOpen = ui.noteOpen === id ? null : id;
      renderNotes();
    }),
  );
  bindReportBox($view, renderNotes);
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
    bank = bank.concat(Vocab.buildParaBank(state.words));
    const [gres, cres] = await Promise.all([fetch('./data/grammar-questions.json'), fetch('./data/grammar-concepts.json')]);
    if (gres.ok) bank = bank.concat(await gres.json());
    if (cres.ok) concepts = await cres.json();
    const lres = await fetch('./data/listening.json');
    if (lres.ok) {
      const l = await lres.json();
      lcP2 = l.part2;
      lcSets = l.sets;
    }
    const p6res = await fetch('./data/part6.json');
    if (p6res.ok) {
      const p6 = await p6res.json();
      p6sets = p6.sets;
      bank = bank.concat(p6.questions);
    }
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
  store.setErrorHandler(() => toast('저장하지 못했어요. 백업 파일을 저장해 두세요.'));
  state = await store.load();
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
