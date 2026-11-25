# 테스트

## 단위 테스트 (Node 20 이상)
```
npm test
```
- `unit/engine.test.js` 점수 엔진: 가상 사용자 실력 복원, 단조 증가, 점수 튐 방지, 교재·공식 성적 반영, 신고 제외, 범위
- `unit/srs.test.js` 날짜·연속 학습일·간격 반복·복습 상한·새 단어 순서
- `unit/learning.test.js` 새 단어 등급, 느린 정답, 오답 해결 조건, 신고 제외

## 화면 테스트 (Python + Playwright)
```
pip install playwright && python -m playwright install chromium
npm run serve          # 다른 창에서
npm run e2e
```
- 주소는 `BASE`, 브라우저 경로는 `CHROME` 환경변수로 바꿀 수 있어요.
- `e2e/test_v23.py` 오답노트, 오답만 다시 풀기(두 번 연속 정답 → 해결), 복습 상한, 문제 신고·취소, 백업 안내
