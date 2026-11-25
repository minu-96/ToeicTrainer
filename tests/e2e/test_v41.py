"""v4.1: 하루 학습 시간 → 분량 자동 나눔, 듣기 오답, 음성 실패 안내, 영역별 정답률"""
import asyncio, sys
from playwright.async_api import async_playwright
from common import open_app, Check
from idb import GET, PUT
from test_v24 import seed


async def main():
    c = Check()
    async with async_playwright() as p:
        b, pg, errs = await open_app(p, "v41")
        await pg.wait_for_selector(".welcome")
        await pg.click("[data-level=low]")
        c(await pg.locator("[data-min]").count() == 4, "시작 화면: 하루 학습 시간 고르기")
        await pg.click("[data-min='15']")
        await pg.click("#begin")
        await pg.wait_for_selector(".todo-list")
        st = await pg.evaluate(GET)
        c(st["settings"]["dailyMinutes"] == 15, "15분 저장")
        meta = await pg.inner_text(".today-meta")
        mins = int("".join(ch for ch in meta.split("분")[0] if ch.isdigit()))
        c(mins <= 17, f"오늘 할 일 약 {mins}분 (15분 선택)")
        todo = await pg.inner_text(".todo-list")
        c("Part 2 응답 0/10" in todo and "0/5" in todo, "듣기 10 · 어휘/문법 5로 줄어듦")
        # 설정에서 60분으로
        await pg.click("[data-go=settings]") if await pg.locator("[data-go=settings]").count() else await pg.click(".icon-btn")
        await pg.wait_for_selector("#dailyMinutes")
        await pg.select_option("#dailyMinutes", "60")
        await pg.wait_for_timeout(200)
        c("오늘: 새 단어" in await pg.inner_text("#view"), "설정: 시간별 분량 안내")
        await pg.click("[data-tab=home]")
        meta = await pg.inner_text(".today-meta")
        mins60 = int("".join(ch for ch in meta.split("분")[0] if ch.isdigit()))
        c(mins60 > mins, f"60분이면 분량 늘어남 ({mins60}분)")

        # 듣기: 음성이 안 나오는 환경 → 안내
        await pg.click(".todo-list [data-lc=lc2]")
        await pg.wait_for_selector("[data-lchoice]")
        await pg.wait_for_timeout(4000)
        c(await pg.locator(".novoice").count() == 1, "소리가 안 나면 '소리가 안 들리나요?' 안내")
        # 일부러 틀리기
        d = await pg.evaluate("fetch('data/listening.json').then(r=>r.json())")
        for i in range(3):
            await pg.wait_for_selector("[data-lchoice]:not([disabled])")
            # 정답이 아닌 보기 고르기: 대본 보기 없이, 응답 글자가 없으니 첫 보기
            await pg.click("[data-lchoice='0']")
            await pg.wait_for_selector(".explain")
            if await pg.locator(".vq-bar [data-lreason]").count():
                await pg.click(".vq-bar [data-lreason=listen]")
            else:
                await pg.click("#lc-next")
        await pg.click("#quit")
        st = await pg.evaluate(GET)
        wrong = [a for a in st["attempts"] if a.get("type") == "lc2" and not a["correct"]]
        await pg.click("[data-tab=notes]")
        await pg.click("[data-ntab=lc]")
        nv = await pg.inner_text("#view")
        if wrong:
            c("Part 2 응답" in nv and await pg.locator("[data-lc=lcwrong]").count() == 1, "오답 탭: 듣기 오답과 다시 듣기")
            await pg.click("[data-lc=lcwrong]")
            await pg.wait_for_selector("[data-lchoice]")
            c(await pg.locator(".study-top .count").inner_text() == f"1/{len(wrong)}", "틀린 문제만 다시")
            await pg.click("#quit")
        else:
            c(True, "(3문제 모두 맞혀서 듣기 오답 없음)")

        # 분석: 영역별 정답률 + 그래프 접기
        await pg.click("[data-tab=stats]")
        await pg.wait_for_selector(".area-acc")
        sv = await pg.inner_text("#view")
        c("영역별 정답률" in sv and "듣기" in sv, "영역별 정답률 카드")
        c("어휘 정답률" not in sv and "문제 정답률" in sv, "'문제 정답률'로 이름 변경")
        c(await pg.locator("details.more-charts:not([open])").count() == 1, "나머지 그래프는 접어 둠")
        c(not errs, "콘솔 오류 없음 " + "; ".join(errs[:3]))
        await b.close()
    if c.fails:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
