"""v2.4: 바꿔 쓰는 표현, 스피드 모드, 수준 자동 조정, 진단 전용 문제"""
import asyncio, sys, time
from playwright.async_api import async_playwright
from common import open_app, today, Check
from idb import GET, PUT

PICK = """async()=>{const bank=await (await fetch('data/vocab-questions.json')).json();
  const btns=[...document.querySelectorAll('[data-choice]')];
  const texts=btns.map(b=>b.innerText.replace(/^\\d+\\s*/,'').trim());
  const q=bank.find(x=>x.choices.length===texts.length&&x.choices.every(c=>texts.includes(c)));
  return q?btns[texts.indexOf(q.choices[q.answer])].dataset.choice:'0'}"""


async def seed(pg, mutate):
    await pg.wait_for_selector(".score-card, .welcome", timeout=8000)
    await pg.wait_for_timeout(400)
    st = await pg.evaluate(GET)
    st["settings"].update({"onboarded": True, "level": "low", "startLevel": "basic", "lastBackup": today()})
    mutate(st)
    await pg.evaluate(PUT, st)
    await pg.reload()
    await pg.wait_for_selector(".score-card")


async def main():
    c = Check()
    async with async_playwright() as p:
        b, pg, errs = await open_app(p, "v24")
        now = int(time.time() * 1000)

        def m(st):  # 기초 문제 19개 정답 → 1개 더 맞히면 중급으로
            st["attempts"] = [{"id": f"s{i}", "date": today(1), "at": now - 100000 + i, "kind": "question", "type": "form", "level": "basic",
                               "correct": True, "timeMs": 9000, "targetId": f"v-f0{(i % 9) + 1}", "mode": "daily"} for i in range(19)]
        await seed(pg, m)

        # 문제 탭: 유형 4개 + 스피드 모드
        await pg.click("[data-tab=quiz]")
        qv = await pg.inner_text("#view")
        c("바꿔 쓰는 표현" in qv, "문제 탭: 바꿔 쓰는 표현 유형")
        c("스피드 모드" in qv, "문제 탭: 스피드 모드")

        # 바꿔 쓰는 표현 연습
        await pg.click("[data-vq=type][data-type=para]")
        await pg.wait_for_selector(".para-word")
        c("뜻이 가장 가까운" in await pg.inner_text(".qcard"), "바꿔 쓰는 표현: 밑줄 문제 화면")
        await pg.click("[data-choice='0']")
        await pg.wait_for_selector(".explain")
        c("≈" in await pg.inner_text(".qcard"), "바꿔 쓰는 표현: 정답 뒤 ≈ 표시")
        await pg.click("#quit")

        # 기초 문제 1개 더 맞히기 → 결과 화면에서 수준 상승
        await pg.click("[data-tab=quiz]")
        await pg.click("[data-vq=type][data-type=form]")
        for _ in range(10):
            await pg.wait_for_selector("[data-choice]")
            await pg.click(f"[data-choice='{await pg.evaluate(PICK)}']")
            await pg.click("#vq-next")
            if await pg.locator(".hero.done").count():
                break
        c(await pg.locator(".level-notice.up").count() == 1, "수준 자동 상승 안내")
        st = await pg.evaluate(GET)
        c(st["settings"]["startLevel"] == "mid", "startLevel 기초 → 중급")
        await pg.click("#level-undo")
        st = await pg.evaluate(GET)
        c(st["settings"]["startLevel"] == "basic", "되돌리기")

        # 스피드 모드: 해설 없이 자동으로 넘어감, 기록 저장
        await pg.click("[data-go=quiz]")
        await pg.click("[data-vq=speed]")
        await pg.wait_for_selector(".timer.speed")
        c(":" in await pg.inner_text(".timer.speed"), "스피드: 남은 시간 표시")
        for i in range(10):
            await pg.wait_for_selector("[data-choice]:not([disabled])")
            c_ = await pg.evaluate(PICK)
            await pg.click(f"[data-choice='{c_}']")
            if i == 0:
                c(await pg.locator(".explain").count() == 0, "스피드: 해설 없이 진행")
            await pg.wait_for_timeout(450)
        await pg.wait_for_selector(".hero.done")
        sv = await pg.inner_text("#view")
        c("걸린 시간" in sv, "스피드 결과 화면")
        st = await pg.evaluate(GET)
        c(st["settings"].get("speedBest", {}).get("n") == 10, "최고 기록 저장")

        # 시간 초과 처리 (마감 시각을 당겨서)
        await pg.click("[data-vq=speed]")
        await pg.wait_for_selector(".timer.speed")
        await pg.click(f"[data-choice='{await pg.evaluate(PICK)}']")
        await pg.wait_for_timeout(450)
        await pg.evaluate("window.__forceSpeedEnd && window.__forceSpeedEnd()")
        await pg.wait_for_selector(".hero.done", timeout=6000)
        c("못 풀었어요" in await pg.inner_text(".hero-title"), "시간 종료 → 못 푼 문제 수")

        # 진단: 전용 문제
        await pg.click("[data-go=quiz]")
        await pg.click("[data-vq=test]")
        ids = set()
        bankq = await pg.evaluate("Promise.all([fetch('data/vocab-questions.json'),fetch('data/grammar-questions.json')]).then(rs=>Promise.all(rs.map(r=>r.json()))).then(([a,b])=>a.concat(b))")
        test_stems = {q["stem"] for q in bankq if q.get("test")}
        ok = True
        for _ in range(15):
            await pg.wait_for_selector("[data-choice]:not([disabled])")
            txt = await pg.inner_text(".cloze")
            ok = ok and any(s.split("____")[0].strip()[:20] in txt for s in test_stems)
            await pg.click("[data-choice='0']")
            await pg.wait_for_timeout(700)
        c(ok, "진단 15문제 모두 전용 문제")

        c(not errs, "콘솔 오류 없음 " + "; ".join(errs[:3]))
        await b.close()
    if c.fails:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
