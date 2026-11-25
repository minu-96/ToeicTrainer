"""v3.4: UX 개편 — 문제 탭 영역 전환, 풀이 화면 고정 버튼, 접는 해설, 단어 목록 나눠 보기"""
import asyncio, sys
from playwright.async_api import async_playwright
from common import open_app, Check
from idb import GET
from test_v24 import seed


async def main():
    c = Check()
    async with async_playwright() as p:
        b, pg, errs = await open_app(p, "v34")
        await seed(pg, lambda st: None)
        vh = 844
        # 홈과 문제 탭이 한 화면 남짓
        h = await pg.evaluate("document.documentElement.scrollHeight")
        c(h <= vh * 1.3, f"홈 높이 {h}px ≤ 1.3화면")
        await pg.click("[data-tab=quiz]")
        h = await pg.evaluate("document.documentElement.scrollHeight")
        c(h <= vh * 1.3, f"문제 탭(어휘) 높이 {h}px ≤ 1.3화면")
        for k, n in [("grammar", 10), ("part6", 0)]:
            await pg.click(f"[data-qtab={k}]")
            if n:
                c(await pg.locator(".type-tile").count() == n, f"{k} 유형 {n}개")
        c(await pg.locator("[data-vq=p6]").count() == 1, "장문 빈칸 탭")
        c(await pg.locator(".tool-row .tool").count() == 2, "스피드·진단은 아래 한 줄")

        # 풀이: 답하면 화면 아래 고정 버튼
        await pg.click("[data-qtab=vocab]")
        await pg.click("[data-vq=daily]")
        await pg.wait_for_selector("[data-choice]")
        c(await pg.locator(".vq-bar").count() == 0, "답하기 전에는 고정 버튼 없음")
        await pg.click("[data-act=dontknow]")
        await pg.wait_for_selector(".vq-bar")
        box = await pg.locator(".vq-bar").bounding_box()
        c(box and box["y"] + box["height"] <= vh + 1 and box["y"] > vh / 2, "틀리면 이유 버튼이 화면 아래에 고정")
        c(await pg.locator(".vq-bar [data-reason]").count() == 4, "이유 4개")
        c(await pg.locator("details.more[open]").count() == 1, "틀리면 보기별 뜻 펼침")
        await pg.click(".vq-bar [data-reason=time]")
        await pg.wait_for_selector("[data-choice]:not([disabled])")
        c(await pg.locator(".vq-bar").count() == 0, "이유 고르면 다음 문제")
        st = await pg.evaluate(GET)
        c(any(a.get("reasonTag") == "time" for a in st["attempts"]), "이유 기록")
        await pg.click("#quit")

        # 단어 탭: 40개씩
        await pg.click("[data-tab=words]")
        c(await pg.locator("#word-list > li[data-id]").count() == 40, "단어 40개만 먼저")
        await pg.click("#word-more")
        c(await pg.locator("#word-list > li[data-id]").count() == 80, "더 보기로 40개 추가")
        c(await pg.locator(".card.prog").count() == 1, "단어 진행 상황은 단어 탭으로")
        await pg.click("[data-tab=home]")
        c("단어 진행 상황" not in await pg.inner_text("#view"), "홈에서는 빠짐")
        c(not errs, "콘솔 오류 없음 " + "; ".join(errs[:3]))
        await b.close()
    if c.fails:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
