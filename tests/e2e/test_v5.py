"""v5: 독해(Part 7), 실전형 Part 3·4(시각 자료 표), 수준 진단에 듣기"""
import asyncio, sys
from playwright.async_api import async_playwright
from common import open_app, Check
from idb import GET
from test_v24 import seed, today


async def pick_correct(pg, q):
    # 화면 보기 중 정답 글자와 같은 버튼 누르기 (보기 순서는 섞임)
    ans = q["choices"][q["answer"]]
    texts = await opt_texts(pg)
    if ans not in texts:
        return False
    await pg.click(f"[data-choice='{texts.index(ans)}']")
    return True


async def opt_texts(pg):
    # 번호(.num)를 뺀 보기 글자
    return await pg.evaluate("""[...document.querySelectorAll('[data-choice]')].map(b=>{const c=b.cloneNode(true);c.querySelector('.num')?.remove();return c.textContent.trim()})""")


async def main():
    c = Check()
    async with async_playwright() as p:
        b, pg, errs = await open_app(p, "v5")
        lc = await pg.evaluate("fetch('data/listening.json').then(r=>r.json())")

        def m(st):
            st["settings"]["startLevel"] = "adv"
            # Part 3은 c13(시각 자료) 하나만 안 푼 세트로 남김
            for s in lc["sets"]:
                if s["part"] == 3 and s["id"] != "l3-c13":
                    for q in s["questions"]:
                        st["qprog"][q["id"]] = {"seen": 1, "wrong": 0, "srs": None, "last": today()}
        await seed(pg, m)
        p7 = await pg.evaluate("fetch('data/part7.json').then(r=>r.json())")
        byid = {q["id"]: q for q in p7["questions"]}

        # 문제 탭: 독해 탭, 예전 '다음 버전' 안내 없음
        await pg.click("[data-tab=quiz]")
        qv = await pg.inner_text("#view")
        c("다음 버전" not in qv, "'독해는 다음 버전' 안내 사라짐")
        c("듣기 3" in qv, "진단 버튼: 어휘 9 · 문법 6 · 듣기 3")
        await pg.click("[data-qtab=part7]")
        qv = await pg.inner_text("#view")
        c("Part 7" in qv and "주제·목적" in qv and "연계" in qv, "독해 카드: 8개 유형 정답률")

        saw_double = saw_insert = saw_ev = False
        for round_ in range(4):
            await pg.click("[data-vq=p7]")
            while True:
                await pg.wait_for_selector(".p7-passage, .hero.done")
                if await pg.locator(".hero.done").count():
                    break
                stem = await pg.inner_text(".p7-q")
                texts = await opt_texts(pg)
                q = next(x for x in p7["questions"] if x["stem"] == stem and sorted(x["choices"]) == sorted(texts))
                if await pg.locator("[data-p7doc]").count() == 2:
                    saw_double = True
                    await pg.click("[data-p7doc='1']")
                    if not saw_ev:
                        c(await pg.locator("[data-p7doc='1'].on").count() == 1, "이중 지문: 두 번째 문서 탭으로 전환")
                if q["qtype"] == "insert":
                    c(await opt_texts(pg) == ["[1]", "[2]", "[3]", "[4]"], "문장 위치: 보기 순서 그대로")
                    await pg.click(f"[data-choice='{q['answer']}']")
                    await pg.wait_for_selector(".explain")
                    c(await pg.locator("mark.p7-ins").count() == 1, "문장 위치: 정답 자리에 문장 넣어 보여 줌")
                    saw_insert = True
                else:
                    c(await pick_correct(pg, q), f"정답 보기 찾기 {q['id']}")
                    await pg.wait_for_selector(".explain")
                if await pg.locator(".p7-ev").count() >= 1:
                    saw_ev = True
                await pg.click("#vq-next")
            if saw_double and saw_insert:
                break
            await pg.click("[data-go=quiz]")
            await pg.click("[data-qtab=part7]")
        c(saw_ev, "답한 뒤 근거 문장 강조")
        c(saw_double, "이중 지문 세트 풀이")
        c(saw_insert, "문장 위치 문제 풀이")
        st = await pg.evaluate(GET)
        p7a = [a for a in st["attempts"] if a.get("module") == "part7"]
        c(len(p7a) >= 4 and all(a["part"] == 7 and a["targetMs"] == 60000 for a in p7a), f"독해 기록 {len(p7a)}개 (Part 7 · 목표 60초)")

        # 시각 자료: Part 3 세트에 표
        await pg.click("[data-go=quiz]") if await pg.locator("[data-go=quiz]").count() else None
        await pg.click("[data-tab=quiz]")
        await pg.click("[data-qtab=lc]")
        await pg.click("[data-lc=lc3]")
        await pg.wait_for_selector(".lc-qs")
        c(await pg.locator(".lc-graphic table tr").count() == 5, "시각 자료 문제: 표(머리줄 + 4줄)")
        c("Look at the graphic" in await pg.inner_text(".lc-qs"), "시각 자료 문제 문장")
        await pg.click("#quit")

        # 수준 진단: 듣기 3문제 포함 18문제
        await pg.click("[data-tab=quiz]")
        await pg.click("[data-vq=test]")
        await pg.wait_for_selector("[data-choice]")
        total = int((await pg.inner_text(".progress-text")).split("/")[1])
        c(total == 18, f"진단 {total}문제 (어휘 9 · 문법 6 · 듣기 3)")
        lc_seen = 0
        for i in range(total):
            await pg.wait_for_selector(".progress-text")
            await pg.wait_for_function(f"document.querySelector('.progress-text')?.textContent.startsWith('{i + 1}/')")
            if await pg.locator("#vq-play").count():
                lc_seen += 1
                opts = await opt_texts(pg)
                c(len(opts) == 3 and all(o == "" for o in opts), "진단 듣기: 보기 A·B·C, 글자는 숨김")
            await pg.click("[data-choice='0']")
            await pg.wait_for_timeout(700)
        await pg.wait_for_selector(".level-bars")
        rv = await pg.inner_text("#view")
        c(lc_seen == 3, f"진단 중 듣기 문제 {lc_seen}개")
        c("듣기 " in rv and "/3" in rv, "진단 결과: 듣기 영역 맞힌 수")
        c(not errs, "콘솔 오류 없음 " + "; ".join(errs[:3]))
        await b.close()
    if c.fails:
        sys.exit(1)


asyncio.run(main())
