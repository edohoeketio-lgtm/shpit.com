const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 500 });
    await page.goto('file://' + process.cwd() + '/scripts/term.html');
    // Wait for fonts to load
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(r => setTimeout(r, 500)); // Give it an extra half second just to be sure
    await page.screenshot({ path: 'assets/terminal.png' });
    await browser.close();
})();
