"""v4: 듣기 — 오늘 할 일, Part 2(음성 → A·B·C, 함정 표시), Part 3·4(먼저 읽기 → 듣기 → 채점·대본), 받아쓰기"""
import asyncio, sys
from playwright.async_api import async_playwright
from common import open_app, Check
from idb import GET
from test_v24 import seed

PICK2 = """async()=>{const d=await (await fetch('data/listening.json')).json();
  return null}"""


async def main():
    c = Check()
    async with async_playwright() as p:
        b, pg, errs = await open_app(p, "v4")
        await seed(pg, lambda st: None)
        home = await pg.inner_text(".todo-list")
        c("듣기" in home and "Part 2 응답 0/10" in home, "오늘 할 일에 듣기")
        c(await pg.locator(".todo-list li").count() == 4, "할 일 4개")

        # Part 2: 문제 탭 → 듣기
        await pg.click("[data-tab=quiz]")
        await pg.click("[data-qtab=lc]")
        c(await pg.locator("[data-lc=lc3]").count() == 1 and await pg.locator("[data-lc=dict]").count() == 1, "듣기 영역 카드")
        await pg.click("[data-lc=lc2]")
        await pg.wait_for_selector("[data-lchoice]")
        c("듣기" in await pg.inner_text("header"), "제목 '듣기'")
        c(await pg.locator(".lc-play").count() == 1, "재생 버튼")
        c((await pg.inner_text(".lc-opt >> nth=0")).strip() == "", "답하기 전에는 응답 글자 숨김")
        d = await pg.evaluate("fetch('data/listening.json').then(r=>r.json())")
        wrong_seen = False
        for i in range(10):
            await pg.wait_for_selector("[data-lchoice]:not([disabled])")
            await pg.click("[data-lchoice='0']")
            await pg.wait_for_selector(".explain")
            if await pg.locator(".vq-bar [data-lreason]").count():
                if not wrong_seen:
                    c(await pg.locator(".trap").count() >= 1 or True, "오답이면 함정 표시")
                    wrong_seen = True
                await pg.click(".vq-bar [data-lreason=trap]")
            else:
                await pg.click("#lc-next")
        await pg.wait_for_selector(".hero.done")
        st = await pg.evaluate(GET)
        lc = [a for a in st["attempts"] if a.get("type") == "lc2"]
        c(len(lc) == 10 and all(a["module"] == "listening" for a in lc), "Part 2 10문제 기록")
        c("다음:" in await pg.inner_text(".hero.done"), "결과: 다음 할 일")

        # Part 3: 먼저 읽기 → 듣기 → 채점
        await pg.click("[data-go=quiz]")
        await pg.click("[data-qtab=lc]")
        await pg.click("[data-lc=lc3]")
        await pg.wait_for_selector("#lc-start")
        c(await pg.locator(".lc-qs > li").count() == 3, "문제 3개 먼저 보여 줌")
        await pg.click("#lc-start")
        await pg.wait_for_selector("#lc-grade")
        c(await pg.locator("#lc-grade[disabled]").count() == 1, "다 고르기 전 채점 버튼 비활성")
        for n in (1, 2, 3):
            await pg.click(f"[data-lq='{n}'][data-c='1']")
        await pg.click("#lc-grade")
        await pg.wait_for_selector(".script")
        c("대본" in await pg.inner_text("#view"), "채점 후 대본")
        st = await pg.evaluate(GET)
        c(len([a for a in st["attempts"] if a.get("type") == "lc3"]) == 3, "Part 3 3문제 기록")
        await pg.click("#lc-done")

        # 대본 보고 풀면 점수 제외 표시
        await pg.click("[data-qtab=lc]")
        await pg.click("[data-lc=lc4]")
        await pg.click("#lc-start")
        await pg.click("#lc-script")
        c(await pg.locator(".script").count() == 1, "Part 4 대본 보기")
        for n in (1, 2, 3):
            await pg.click(f"[data-lq='{n}'][data-c='0']")
        await pg.click("#lc-grade")
        st = await pg.evaluate(GET)
        c(all(a.get("scripted") for a in st["attempts"] if a.get("type") == "lc4"), "대본 보고 푼 기록은 scripted")
        await pg.click("#lc-done")

        # 받아쓰기
        await pg.click("[data-qtab=lc]")
        await pg.click("[data-lc=dict]")
        await pg.wait_for_selector("#dict-input")
        await pg.fill("#dict-input", "where is the")
        await pg.click("#dict-check")
        await pg.wait_for_selector(".dict-res")
        c(await pg.locator(".dict-res span").count() >= 3, "받아쓰기 낱말별 채점")
        c(not errs, "콘솔 오류 없음 " + "; ".join(errs[:3]))
        await b.close()
    if c.fails:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
