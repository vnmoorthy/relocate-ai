"""Capture a screenshot of the live swarm dashboard for the README hero.

Usage:
  uv run --with playwright python scripts/capture_screenshot.py

Output: docs/swarm.png
"""
from __future__ import annotations
import asyncio
import pathlib
from playwright.async_api import async_playwright


URL = "https://vnmoorthy.github.io/relocate-ai/"
OUTPUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "swarm.png"


async def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 1600, "height": 1000},
            device_scale_factor=2,
        )
        page = await ctx.new_page()
        await page.goto(URL, wait_until="networkidle")
        await page.evaluate("document.querySelector('#live').scrollIntoView({block: 'start'})")
        await page.wait_for_timeout(17000)
        section = await page.query_selector("#live")
        if section:
            await section.screenshot(path=str(OUTPUT), type="png")
        else:
            await page.screenshot(path=str(OUTPUT), type="png", full_page=False)
        await browser.close()
    print(f"saved: {OUTPUT}  ({OUTPUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    asyncio.run(main())
