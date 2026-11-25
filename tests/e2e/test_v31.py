"""v3.1: 오늘 할 일 카드, 다음 할 일 이어가기, 틀린 이유 바로 고르기, 진단에 문법 포함"""
import asyncio, sys
from playwright.async_api import async_playwright
from common import open_app, today, Check
from idb import GET, PUT
from test_v24 import seed


async def main():
    c = Check()
    async with async_playwright() as p:
        b, pg, errs = await open_app(p, "v31")
        await seed(pg, lambda st: None)

        home = await pg.inner_text("#view")
        c("오늘 할 일" in home and "어휘 문제" in home and "문법 문제" in home, "홈: 오늘 할 일 3줄")
        c(await pg.locator(".todo-list li").count() == 3, "할 일 3개")
        c("단어 학습 시작" in await pg.inner_text(".hero.today .btn.primary"), "첫 할 일은 단어")
        c("독해은" not in home, "조사 오류 없음")

        # 단어를 끝낸 상태로 → 다음은 어휘 문제
        def done_words(st):
            st["newIntroduced"] = {"date": today(), "count": 50}
        await seed(pg, done_words)
        c(await pg.locator(".todo-list li.done").count() == 1, "단어 완료 체크")
        btn = await pg.inner_text(".hero.today .btn.primary")
        c("어휘 문제" in btn, "다음 할 일: 어휘 문제")

        # 어휘 10문제: 오답이면 이유 고르기로 바로 다음
        await pg.click(".hero.today .btn.primary")
        reasons = 0
        for i in range(10):
            await pg.wait_for_selector("[data-choice]:not([disabled])")
            await pg.click("[data-act=dontknow]")  # 일부러 틀림
            await pg.wait_for_selector(".vq-bar")
            if i < 5:
                await pg.click("[data-reason=meaning]")
                reasons += 1
            else:
                await pg.click("#vq-next")
            await pg.wait_for_timeout(300)
        await pg.wait_for_selector(".hero.done")
        st = await pg.evaluate(GET)
        tagged = [a for a in st["attempts"] if a.get("reasonTag") == "meaning"]
        c(len(tagged) == 5, f"이유 고르면 기록 + 다음 문제 ({len(tagged)}/5)")
        nxt = await pg.inner_text(".hero.done")
        c("다음: 문법 기초부터 시작" in nxt, "결과 화면: 다음 할 일 버튼")
        c("오늘 남은 것" in nxt, "결과 화면: 남은 할 일 안내")
        await pg.click("button:has-text('다음: 문법 기초부터 시작')")
        await pg.wait_for_selector(".concept")
        c("1/3" in await pg.inner_text(".concept"), "문법 기초 카드로 이동")

        # 진단: 어휘 9 + 문법 6
        await pg.click("[data-tab=quiz]")
        await pg.click("[data-vq=test]")
        g = 0
        gb = await pg.evaluate("fetch('data/grammar-questions.json').then(r=>r.json())")
        gstems = [q["stem"].split("____")[0].strip()[:18] for q in gb if q.get("test")]
        for i in range(15):
            await pg.wait_for_selector("[data-choice]:not([disabled])")
            txt = await pg.inner_text(".cloze")
            if any(s and txt.startswith(s) for s in gstems) or (await pg.inner_text(".qcard")).find("시제") >= 0 and False:
                g += 1
            await pg.click("[data-choice='0']")
            await pg.wait_for_timeout(700)
        res = await pg.inner_text("#view")
        c("어휘" in res and "/9" in res and "/6" in res, "진단 결과: 어휘 9 · 문법 6")

        c(not errs, "콘솔 오류 없음 " + "; ".join(errs[:3]))
        await b.close()
    if c.fails:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
