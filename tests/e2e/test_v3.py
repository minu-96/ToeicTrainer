"""v3: 문법 — 기초 카드, 유형 첫 연습 전 개념 카드, 오늘의 문법 문제, 점수 반영"""
import asyncio, sys
from playwright.async_api import async_playwright
from common import open_app, today, Check
from idb import GET, PUT
from test_v24 import seed

PICK = """async()=>{const bank=await (await fetch('data/grammar-questions.json')).json();
  const btns=[...document.querySelectorAll('[data-choice]')];
  const texts=btns.map(b=>b.innerText.replace(/^\\d+\\s*/,'').trim());
  const stem=document.querySelector('.cloze')?.innerText||'';
  const q=bank.find(x=>x.choices.every(c=>texts.includes(c))&&stem.startsWith(x.stem.split('____')[0].trim()));
  return q?btns[texts.indexOf(q.choices[q.answer])].dataset.choice:'0'}"""


async def main():
    c = Check()
    async with async_playwright() as p:
        b, pg, errs = await open_app(p, "v3")
        await seed(pg, lambda st: None)

        home = await pg.inner_text("#view")
        c("오늘의 문법 문제" in home, "홈: 오늘의 문법 문제 카드")

        # 기초 3장 넘기기
        await pg.click("[data-concept=basic-structure]")
        await pg.wait_for_selector(".concept")
        c("문법 기초 1/3" in await pg.inner_text(".concept"), "기초 카드 1/3")
        await pg.click(".btn.primary.big")
        await pg.click(".btn.primary.big")
        c("3/3" in await pg.inner_text(".concept"), "기초 카드 3/3")
        await pg.click("[data-go]")

        # 문제 탭 → 시제 유형: 개념 카드 먼저
        await pg.click("[data-tab=quiz]")
        qv = await pg.inner_text("#view")
        c("문법 유형별 연습" in qv and "가정법" in qv, "문제 탭: 문법 유형 10개")
        await pg.click("[data-vq=type][data-type=tense]")
        await pg.wait_for_selector(".concept")
        c("시제" in await pg.inner_text(".concept-title"), "처음 푸는 유형은 개념 카드부터")
        await pg.click("[data-vq=type][data-type=tense]")
        await pg.wait_for_selector("[data-choice]")
        await pg.click("[data-choice='0']")
        await pg.wait_for_selector(".explain")
        c(await pg.locator(".concept-link").count() == 1, "해설에 개념 다시 보기")
        await pg.click(".concept-link")
        await pg.wait_for_selector(".concept")
        await pg.click("[data-go=vq]")
        await pg.wait_for_selector(".explain")
        c(True, "개념 → 문제로 돌아오기")
        await pg.click("#quit")

        # 두 번째는 개념 없이 바로
        await pg.click("[data-tab=quiz]")
        await pg.click("[data-vq=type][data-type=tense]")
        c(await pg.locator("[data-choice]").count() == 4, "본 개념은 다시 안 띄움")
        await pg.click("#quit")

        # 오늘의 문법 문제 10개
        before = (await pg.evaluate(GET))
        await pg.click("[data-tab=home]")
        await pg.click("[data-vq=gdaily]")
        c("문법 문제" in await pg.inner_text("header"), "제목 '문법 문제'")
        for _ in range(10):
            await pg.wait_for_selector("[data-choice]:not([disabled])")
            await pg.click(f"[data-choice='{await pg.evaluate(PICK)}']")
            await pg.click("#vq-next")
        await pg.wait_for_selector(".hero.done")
        st = await pg.evaluate(GET)
        g = [a for a in st["attempts"] if a.get("module") == "grammar" and a.get("mode") == "gdaily"]
        c(len(g) == 10 and all(a["correct"] for a in g), "문법 10문제 기록 (module=grammar)")
        c(len(st["words"]) == len(before["words"]), "문법 오답은 단어장에 안 들어감")
        await pg.click("[data-go]")
        home = await pg.inner_text("#view")
        c("10/10" in home, "홈 문법 카드 10/10")

        c(not errs, "콘솔 오류 없음 " + "; ".join(errs[:3]))
        await b.close()
    if c.fails:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
