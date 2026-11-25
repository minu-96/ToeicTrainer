"""v2.3: 오답노트, 오답만 다시 풀기, 복습 상한, 문제 신고, 백업 안내"""
import asyncio, sys
from playwright.async_api import async_playwright
from common import open_app, today, Check
from idb import GET, PUT


def seed_state(base):
    st = dict(base)
    ws = st["words"]
    # 복습할 단어 80개 (상한 60 초과) + 한 단어는 자주 틀림
    for i, w in enumerate(ws[:80]):
        w["srs"] = {"box": 1, "due": today(1)}
    ws[0]["lapses"] = 2
    st["attempts"] = [
        {"id": "a1", "date": today(2), "kind": "question", "type": "form", "level": "basic", "correct": False, "timeMs": 15000, "targetId": "v-f01", "reasonTag": "grammar", "mode": "daily"},
        {"id": "a2", "date": today(2), "kind": "question", "type": "colloc", "level": "basic", "correct": False, "timeMs": 15000, "targetId": "v-c01", "reasonTag": "meaning", "mode": "daily"},
        {"id": "a3", "date": today(2), "kind": "question", "type": "confuse", "level": "basic", "correct": False, "timeMs": 15000, "targetId": "v-x01", "reasonTag": "meaning", "mode": "daily"},
    ]
    st["studyDays"] = [today(2)]
    st["settings"].update({"onboarded": True, "level": "low", "lastBackup": today(10)})
    return st


async def main():
    c = Check()
    async with async_playwright() as p:
        b, pg, errs = await open_app(p, "v23")
        await pg.wait_for_selector(".score-card, .welcome", timeout=8000)
        base = await pg.evaluate(GET)
        if base is None:  # 첫 실행: 저장된 상태가 아직 없으면 한 번 저장되게 기다림
            await pg.wait_for_timeout(500)
            base = await pg.evaluate(GET)
        await pg.evaluate(PUT, seed_state(base))
        await pg.reload()
        await pg.wait_for_selector(".score-card")

        home = await pg.inner_text("#view")
        c("백업 안내" in home or "백업" in home, "홈: 7일 지난 백업 안내")
        c("복습" in home and "60" in home, "홈: 복습 상한 60 표시")
        c(await pg.locator(".warn-text").count() > 0, "홈: 새 단어 줄임 안내")
        c(await pg.locator(".card.link.notice").count() >= 1, "홈: 미측정 안내 카드")

        # 오답노트
        await pg.click("[data-tab=notes]")
        await pg.wait_for_selector(".note-list")
        notes = await pg.inner_text("#view")
        c("어휘 문제 3" in notes, "오답노트: 미해결 문제 3개")
        c("뜻을 몰라서" in notes, "오답노트: 틀린 이유 통계")
        await pg.click("[data-ntab=words]")
        c("2번 떨어짐" in await pg.inner_text("#view"), "오답노트: 자주 틀린 단어")
        await pg.click("[data-ntab=questions]")

        # 문제 신고 → 목록·출제에서 빠짐
        await pg.click(".note-list li .row >> nth=0")
        await pg.click("[data-report-open]")
        await pg.click("[data-rr] >> nth=1")
        await pg.click("[data-report-send]")
        st = await pg.evaluate(GET)
        c(len(st.get("reports", [])) == 1, "신고 저장")
        c("어휘 문제 2" in await pg.inner_text("#view"), "신고한 문제는 오답에서 빠짐")

        # 오답만 다시 풀기: 두 번 연속 맞히면 해결
        for rnd in range(2):
            if rnd:
                await pg.click("[data-go=notes]")
            await pg.click("[data-vq=wrong]")
            await pg.wait_for_selector("[data-choice]")
            n = 0
            while True:
                st = await pg.evaluate(GET)
                title = await pg.inner_text("header")
                if n == 0:
                    c("오답" in title, f"{rnd + 1}회차: 제목 '오답 다시 풀기'")
                # 정답 고르기: 화면의 문제를 은행에서 찾아 정답 클릭
                ans = await pg.evaluate("""async()=>{const bank=await (await fetch('data/vocab-questions.json')).json();
                    const btns=[...document.querySelectorAll('[data-choice]')];
                    const texts=btns.map(b=>b.innerText.replace(/^\\d+\\s*/,'').trim());
                    const q=bank.find(x=>x.choices.length===texts.length&&x.choices.every(c=>texts.includes(c)));
                    return q?btns[texts.indexOf(q.choices[q.answer])].dataset.choice:'0'}""")
                await pg.click(f"[data-choice='{ans}']")
                n += 1
                await pg.click("#vq-next")
                if await pg.locator("[data-go=notes]").count():
                    break
        await pg.click("[data-go=notes]")
        await pg.click("[data-ntab=done]")
        view = await pg.inner_text("#view")
        c("해결함 2" in view, "두 번 연속 정답 → 해결함 2")

        # 밀린 복습 더 하기 버튼 (상한을 낮춰 확인)
        st = await pg.evaluate(GET)
        st["settings"]["dailyReviewMax"] = 10
        await pg.evaluate(PUT, st)
        await pg.reload()
        await pg.wait_for_selector(".score-card")
        c(await pg.locator(".more-btn").count() == 0, "복습 전에는 '밀린 복습 더 하기' 안 보임")
        st = await pg.evaluate(GET)
        await pg.goto(pg.url.split("?")[0] + "?v23b")
        await pg.wait_for_selector(".score-card")

        # 설정: 신고 목록
        await pg.click("[data-go=settings]")
        sv = await pg.inner_text("#view")
        c("신고한 문제" in sv, "설정: 신고 목록")
        c("v2." in sv, "설정: 버전 표시")
        await pg.click("[data-unreport]")
        st = await pg.evaluate(GET)
        c(len(st.get("reports", [])) == 0, "신고 취소")

        c(not errs, "콘솔 오류 없음 " + "; ".join(errs[:3]))
        await b.close()
    if c.fails:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
