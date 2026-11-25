"""v3.2: 장문 빈칸 — 지문 보기, 빈칸 순서, 푼 빈칸 채우기, 해석, 오답노트"""
import asyncio, sys
from playwright.async_api import async_playwright
from common import open_app, Check
from idb import GET
from test_v24 import seed

PICK = """async()=>{const d=await (await fetch('data/part6.json')).json();
  const btns=[...document.querySelectorAll('[data-choice]')];
  const texts=btns.map(b=>b.innerText.replace(/^\\d+\\s*/,'').trim());
  const cur=document.querySelector('.p6-blank.cur')?.innerText||'';
  const n=Number(cur.replace(/\\D/g,''));
  const q=d.questions.find(x=>x.n===n&&x.choices.every(c=>texts.includes(c)));
  return q?btns[texts.indexOf(q.choices[q.answer])].dataset.choice:'0'}"""


async def main():
    c = Check()
    async with async_playwright() as p:
        b, pg, errs = await open_app(p, "v32")
        await seed(pg, lambda st: None)
        await pg.click("[data-tab=quiz]")
        qv = await pg.inner_text("#view")
        c("장문 빈칸" in qv and "지문 0/12" in qv, "문제 탭: 장문 빈칸 카드")
        await pg.click("[data-vq=p6]")
        await pg.wait_for_selector(".p6-passage")
        c("장문 빈칸" in await pg.inner_text("header"), "제목 '장문 빈칸'")
        c(await pg.locator(".p6-blank").count() == 4 and await pg.locator(".p6-blank.cur").count() == 1, "빈칸 4개, 현재 빈칸 강조")
        for i in range(4):
            await pg.wait_for_selector("[data-choice]:not([disabled])")
            cur = await pg.inner_text(".p6-blank.cur")
            c(f"({i + 1})" in cur, f"빈칸 ({i + 1}) 차례")
            if i == 1:
                await pg.click("[data-act=dontknow]")
                await pg.wait_for_selector(".reason-pick")
                await pg.click("[data-reason=grammar]")
            else:
                await pg.click(f"[data-choice='{await pg.evaluate(PICK)}']")
                await pg.wait_for_selector(".explain")
                if i == 2:
                    c(await pg.locator(".p6-done").count() == 2, "앞서 푼 빈칸은 정답으로 채움")
                await pg.click("#vq-next")
        await pg.wait_for_selector(".hero.done")
        sv = await pg.inner_text("#view")
        c("3/4" in sv, "결과 3/4")
        c("지문 해석" in sv, "결과에 지문 해석")
        c("다음 지문 풀기" in sv, "다음 지문 버튼")
        st = await pg.evaluate(GET)
        p6 = [a for a in st["attempts"] if a.get("part") == 6]
        c(len(p6) == 4 and all(a["targetMs"] == 30000 for a in p6), "기록 part 6 · 목표 30초")
        # 오답노트에서 지문과 함께 다시 풀기
        await pg.click("[data-go=quiz]")
        await pg.click("[data-tab=notes]")
        nv = await pg.inner_text("#view")
        c("문법" in nv and "1" in nv, "오답노트에 장문 빈칸 오답")
        await pg.click("[data-vq=wrong]")
        await pg.wait_for_selector(".p6-passage")
        c(await pg.locator(".p6-blank.cur").count() == 1, "오답 다시 풀기도 지문과 함께")
        c(not errs, "콘솔 오류 없음 " + "; ".join(errs[:3]))
        await b.close()
    if c.fails:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
