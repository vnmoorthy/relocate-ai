"""Capture the swarm-section screenshot for the README hero.

Usage:
  uv run --with playwright python scripts/capture_screenshot.py [URL]

Defaults to the deployed GitHub Pages site; pass a local URL (e.g.
http://127.0.0.1:4173/ serving `web/out`) to capture an unreleased build.

Output: docs/swarm.png
"""
from __future__ import annotations

import asyncio
import pathlib
import sys

from playwright.async_api import async_playwright


URL = sys.argv[1] if len(sys.argv) > 1 else "https://vnmoorthy.github.io/relocate-ai/"
OUTPUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "swarm.png"
# The simulation's richest moment: fan-out complete, LIVE/SUBMITTED/FAILED all
# on screen, router panel populated, artifact events reported.
CAPTURE_AT_MS = 36000


async def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 1760, "height": 1100},
            device_scale_factor=2,
        )
        page = await ctx.new_page()
        await page.goto(URL, wait_until="networkidle")
        # Fixed chrome would overlay the element screenshot.
        await page.evaluate(
            "for (const sel of ['.site-nav', '.skip-link']) {"
            "  const el = document.querySelector(sel); if (el) el.style.display = 'none';"
            "}"
        )
        await page.wait_for_timeout(CAPTURE_AT_MS)
        section = await page.query_selector("#dashboard")
        if section:
            await section.screenshot(path=str(OUTPUT), type="png")
        else:
            await page.screenshot(path=str(OUTPUT), type="png", full_page=False)
        await browser.close()
    print(f"saved: {OUTPUT}  ({OUTPUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    asyncio.run(main())
