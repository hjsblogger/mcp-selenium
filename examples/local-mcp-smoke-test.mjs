import { readFile } from 'node:fs/promises';
import pkg from 'selenium-webdriver';
const { Builder, By, until } = pkg;
import { Options as ChromeOptions } from 'selenium-webdriver/chrome.js';
import { Options as FirefoxOptions } from 'selenium-webdriver/firefox.js';

const SITE_URL = 'https://ecommerce-playground.lambdatest.io/';
const SEARCH_TERM = 'iPhone';
const FIRST_PRODUCT_SELECTOR = '.product-thumb';
const ADD_TO_CART_SELECTOR = '.product-thumb .btn-cart';
const CART_ICON_SELECTOR = 'a.cart';
const CHECKOUT_BUTTON_SELECTOR = '#cart-total-drawer a[href*="route=checkout/checkout"]';

async function setTestStatus(driver, status, remark) {
    const script = `lambda-hook: ${JSON.stringify({
        action: 'setTestStatus',
        arguments: { status, remark }
    })}`;
    await driver.executeScript(script);
}

async function runCapability(remoteUrl, username, accessKey, capability) {
    const { browser, platform, browserVersion, build, name } = capability;

    let builder = new Builder().usingServer(remoteUrl);
    builder.getCapabilities().set('LT:Options', {
        user: username,
        accessKey,
        platformName: platform,
        browserVersion,
        build,
        name,
        console: true,
        network: true,
        video: true
    });

    builder = builder.forBrowser(browser);
    if (browser === 'chrome') {
        builder = builder.setChromeOptions(new ChromeOptions());
    } else if (browser === 'firefox') {
        builder = builder.setFirefoxOptions(new FirefoxOptions());
    }

    const driver = await builder.build();

    let remark = 'All smoke test steps completed successfully';
    let dashboardUrl;
    try {
        const session = await driver.getSession();
        dashboardUrl = `https://automation.lambdatest.com/logs?sessionID=${session.getId()}`;
        console.log(`[${name}] TestMu AI dashboard: ${dashboardUrl}`);

        // 1. Maximize the window
        await driver.manage().window().maximize();
        console.log(`[${name}] Window maximized`);

        // 2. Navigate to the ecommerce playground demo site
        await driver.get(SITE_URL);
        console.log(`[${name}] Navigated to ${SITE_URL}`);

        // 3. Search for the term and click Search
        const searchBox = await driver.wait(until.elementLocated(By.name('search')), 10000);
        await searchBox.sendKeys(SEARCH_TERM);
        const searchButton = await driver.wait(
            until.elementLocated(By.xpath("//button[text()='Search']")),
            10000
        );
        await searchButton.click();
        console.log(`[${name}] Searched for "${SEARCH_TERM}"`);

        // 4. Wait for the results page and assert the title contains the search term
        await driver.wait(async () => {
            const title = await driver.getTitle();
            return title.toLowerCase().includes(SEARCH_TERM.toLowerCase());
        }, 20000);
        const title = await driver.getTitle();
        console.log(`[${name}] Results page loaded, title: "${title}"`);

        if (!title.toLowerCase().includes(SEARCH_TERM.toLowerCase())) {
            throw new Error(`assertion failed: title "${title}" does not contain "${SEARCH_TERM}"`);
        }

        // 5. Hover on the first item and click its Cart button. The product
        // grid's action buttons overlap a sibling element on this site
        // unless the card is hovered first, so a plain click without
        // hovering can be intercepted.
        const firstProduct = await driver.wait(until.elementLocated(By.css(FIRST_PRODUCT_SELECTOR)), 10000);
        await driver.actions().move({ origin: firstProduct }).perform();
        const addToCartButton = await driver.wait(until.elementLocated(By.css(ADD_TO_CART_SELECTOR)), 10000);
        await addToCartButton.click();
        console.log(`[${name}] Hovered on the first result and clicked its Cart button`);

        // 6. Open the mini-cart and press Checkout; assert the URL contains "checkout"
        const cartIcon = await driver.wait(until.elementLocated(By.css(CART_ICON_SELECTOR)), 10000);
        await cartIcon.click();
        const checkoutButton = await driver.wait(until.elementLocated(By.css(CHECKOUT_BUTTON_SELECTOR)), 10000);
        await checkoutButton.click();
        console.log(`[${name}] Clicked Checkout`);

        await driver.wait(async () => (await driver.getCurrentUrl()).toLowerCase().includes('checkout'), 15000);
        const checkoutUrl = await driver.getCurrentUrl();
        console.log(`[${name}] Landed on: "${checkoutUrl}"`);

        if (!checkoutUrl.toLowerCase().includes('checkout')) {
            throw new Error(`assertion failed: URL "${checkoutUrl}" does not contain "checkout"`);
        }

        remark = `Search results title "${title}" contains "${SEARCH_TERM}"; added first item to cart; checkout URL "${checkoutUrl}" contains "checkout"`;
        await setTestStatus(driver, 'passed', remark);
        console.log(`[${name}] Marked test as PASSED via TestMu AI hook`);
        return { name, browser, platform, dashboardUrl, status: 'passed', reason: remark };
    } catch (e) {
        remark = `Smoke test failed: ${e.message}`;
        try {
            await setTestStatus(driver, 'failed', remark);
            console.log(`[${name}] Marked test as FAILED via TestMu AI hook`);
        } catch (_) { /* ignore secondary failure */ }
        return { name, browser, platform, dashboardUrl, status: 'failed', reason: remark };
    } finally {
        await driver.quit();
    }
}

async function main() {
    const remoteUrl = process.env.SELENIUM_REMOTE_URL;
    const username = process.env.LT_USERNAME;
    const accessKey = process.env.LT_ACCESS_KEY;
    if (!remoteUrl || !username || !accessKey) {
        throw new Error('SELENIUM_REMOTE_URL, LT_USERNAME, and LT_ACCESS_KEY must be set');
    }

    const capabilitiesPath = new URL('../capabilities/lt-web-capabilities.example.json', import.meta.url);
    const capabilities = JSON.parse(await readFile(capabilitiesPath, 'utf8'));

    const results = await Promise.all(
        capabilities.map((capability) =>
            runCapability(remoteUrl, username, accessKey, capability)
        )
    );

    console.log('\n=== Summary ===');
    for (const r of results) {
        const icon = r.status === 'passed' ? '✅' : '❌';
        console.log(`${icon} ${r.name} (${r.browser}/${r.platform}): ${r.status.toUpperCase()} - ${r.reason}`);
        if (r.dashboardUrl) console.log(`  dashboard: ${r.dashboardUrl}`);
    }

    if (results.some((r) => r.status !== 'passed')) {
        process.exitCode = 1;
    }
}

main().catch((e) => {
    console.error('Smoke test error:', e);
    process.exit(1);
});
