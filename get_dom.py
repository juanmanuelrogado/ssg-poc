import asyncio
import argparse
from playwright.async_api import async_playwright

async def get_full_dom(url, output_file):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(url)
        # Wait for the domcontentloaded event, which is sufficient for most SPAs
        # If the page loads content after this, a more specific wait might be needed (e.g., wait_for_selector)
        await page.wait_for_load_state('domcontentloaded')
        content = await page.content()
        await browser.close()

        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Full DOM saved to {output_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch the full, JavaScript-rendered DOM of a web page.")
    parser.add_argument("url", help="The URL of the web page to fetch.")
    parser.add_argument("--output", default="rendered_dom.html", help="The output file name for the DOM. Defaults to rendered_dom.html")
    args = parser.parse_args()

    asyncio.run(get_full_dom(args.url, args.output))
