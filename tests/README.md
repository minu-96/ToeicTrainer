# 테스트

## 단위 테스트 (Node 20 이상)
```
npm test
```
- `unit/engine.test.js` 점수 엔진: 가상 사용자 실력 복원, 단조 증가, 점수 튐 방지, 교재·공식 성적 반영, 신고 제외, 범위
- `unit/srs.test.js` 날짜·연속 학습일·간격 반복·복습 상한·새 단어 순서
- `unit/part6.test.js` 지문·문항 구성, 지문 고르기 순서, 기록과 점수 반영
- `unit/grammar.test.js` 문법 문제·개념 카드 구성, 영역별 오늘의 문제, 문법 점수 반영, 문항 품질(수준별 문장 길이, 가짜 보기 없음, 정답 최장 비율)
- `unit/vocab.test.js` 문제 은행 구성, 진단 전용 분리, 바꿔 쓰는 표현 생성, 스피드 모드, 수준 자동 조정
- `unit/learning.test.js` 새 단어 등급, 느린 정답, 오답 해결 조건, 신고 제외

## 화면 테스트 (Python + Playwright)
```
pip install playwright && python -m playwright install chromium
npm run serve          # 다른 창에서
npm run e2e
```
- 주소는 `BASE`, 브라우저 경로는 `CHROME` 환경변수로 바꿀 수 있어요.
- `e2e/test_v32.py` 장문 빈칸 화면(빈칸 순서·채우기), 결과 해석, 오답 다시 풀기
- `e2e/test_v31.py` 오늘 할 일 카드, 다음 할 일 버튼, 틀린 이유 바로 고르기, 진단 어휘 9 · 문법 6
- `e2e/test_v3.py` 문법 기초 카드, 첫 유형 개념 카드, 해설→개념→문제 복귀, 오늘의 문법 문제
- `e2e/test_v24.py` 바꿔 쓰는 표현 화면, 수준 자동 상승·되돌리기, 스피드 모드(기록·시간 종료), 진단 전용 문제
- `e2e/test_v23.py` 오답노트, 오답만 다시 풀기(두 번 연속 정답 → 해결), 복습 상한, 문제 신고·취소, 백업 안내
