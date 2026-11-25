"""e2e 공통: 주소·브라우저 경로는 환경변수로 바꿀 수 있어요.
BASE   (기본 http://localhost:8765/)
CHROME (기본: Playwright 내장 Chromium, 없으면 /usr/bin/google-chrome)"""
import os, asyncio, datetime, json
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE", "http://localhost:8765/")
CHROME = os.environ.get("CHROME")


def today(offset=0):
    return (datetime.date.today() - datetime.timedelta(days=offset)).isoformat()


async def open_app(p, query="e2e"):
    opts = {"executable_path": CHROME} if CHROME else {}
    b = await p.chromium.launch(**opts)
    ctx = await b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg = await ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    await pg.goto(BASE + "?" + query)
    return b, pg, errs


class Check:
    def __init__(self):
        self.fails = []

    def __call__(self, ok, label):
        print(("  ok   " if ok else "  FAIL ") + label)
        if not ok:
            self.fails.append(label)
