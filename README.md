# 토익 트레이너

약점만 골라 반복하는 개인용 토익 학습 도구 (PWA). 목표: 400 → 800

## 기능 로드맵

| 단계 | 기능 | 상태 |
|---|---|---|
| 1 | 단어: 간격 반복 카드, 직접 추가, 백업 | ✅ week1 |
| 2 | 어휘: Part 5·6 어휘 문제 | |
| 3 | 문법: Part 5 유형별 문제 | |
| 4 | 독해: Part 7 + 시간 제한 | |
| 5 | 듣기: TTS로 Part 2, 받아쓰기 | |
| 6 | 오답노트: 앱 오답 + 교재 오답 기록 | |
| 7 | 약점 분석: 유형별 정답률, 실수 유형 TOP 3 | |

## 간격 반복 규칙

- 박스 5칸, 복습 간격 1일 → 3일 → 7일 → 14일 → 30일
- 알았어요: 다음 칸 / 몰랐어요: 1칸으로, 이번 학습 끝에 한 번 더
- 이번 학습에서 틀렸던 단어는 다시 맞혀도 1칸에 남고 내일 복습
- 하루 새 단어 수(기본 20개)는 내장 단어에만 적용. 직접 추가한 단어는 바로 나옴

## 파일 구조

```
index.html          화면 뼈대
css/style.css       스타일 (다크 모드, 아이폰 safe-area 대응)
js/app.js           화면과 동작
js/srs.js           간격 반복 계산
js/storage.js       저장소 접근 (여기만 바꾸면 Capacitor/IndexedDB로 교체 가능)
js/tts.js           발음 듣기 (브라우저 TTS)
data/words-basic.json  내장 기초 단어
manifest.json, sw.js   PWA 설치·오프라인
icons/              앱 아이콘 (tools/make_icons.py로 생성)
```

## 로컬에서 실행

```bash
python3 -m http.server 8000
# http://localhost:8000
```

`index.html`을 파일로 바로 열면 모듈과 서비스 워커가 동작하지 않으니 꼭 서버로 여세요.

## 배포 (GitHub Pages)

1. 레포 Settings → Pages → Branch: `main` / `(root)` → Save
2. 주소: `https://<아이디>.github.io/ToeicTrainer/`
3. 아이폰 Safari에서 열고 공유 → **홈 화면에 추가**

## 업데이트할 때

앱 파일을 고친 뒤에는 `sw.js`의 `CACHE` 버전을 올리세요 (`toeic-trainer-v1` → `v2`).
휴대폰에서는 앱을 한 번 열었다 닫고 다시 열면 새 버전이 적용돼요.

## 데이터

- 학습 기록은 기기 브라우저(localStorage)에만 저장돼요. 주소가 바뀌면 기록이 안 보이니 설정 → **백업 파일 저장**을 가끔 해 두세요.
- 풀이 기록(`attempts`)은 1단계부터 쌓이며, 7단계 약점 분석에 사용돼요.
