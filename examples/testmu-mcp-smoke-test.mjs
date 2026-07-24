/**
 * Smoke test for the Selenium MCP implementation, run against a real
 * TestMu AI (LambdaTest) cloud Chrome session.
 *
 * Unlike examples/smoke-test.mjs (which drives selenium-webdriver directly),
 * this script talks to the MCP server over the actual MCP tool-call protocol
 * (via the McpClient test helper), so a pass here verifies the MCP tools
 * themselves — not just Selenium/TestMu AI in isolation.
 *
 * Flow:
 *   1. start_browser (chrome) on TestMu AI, then maximize the window
 *   2. navigate to the ecommerce-playground demo site
 *   3. type "iPhone" into the search box and click Search
 *   4. wait for the results page and assert the title contains "iPhone"
 *   5. hover over the first result and click its Cart button (the product
 *      grid's action buttons overlap a sibling element on this site unless
 *      the card is hovered first, so a plain click without hovering can be
 *      intercepted)
 *   6. open the mini-cart and press Checkout; assert the URL contains
 *      "checkout"
 *   7. close the session regardless of pass/fail
 *
 * Requires SELENIUM_REMOTE_URL, LT_USERNAME, LT_ACCESS_KEY in the
 * environment (see README.md).
 */

import { McpClient, getResponseText } from '../test/mcp-client.mjs';

const SITE_URL = 'https://ecommerce-playground.lambdatest.io/';
const SEARCH_TERM = 'iPhone';
const FIRST_PRODUCT_SELECTOR = '.product-thumb';
const ADD_TO_CART_SELECTOR = '.product-thumb .btn-cart';
const CART_ICON_SELECTOR = 'a.cart';
const CHECKOUT_BUTTON_SELECTOR = '#cart-total-drawer a[href*="route=checkout/checkout"]';

async function waitForTitleContains(client, substring, timeoutMs = 20000, intervalMs = 500) {
    const deadline = Date.now() + timeoutMs;
    let lastTitle = '';
    while (Date.now() < deadline) {
        const result = await client.callTool('execute_script', { script: 'return document.title;' });
        lastTitle = getResponseText(result);
        if (lastTitle.toLowerCase().includes(substring.toLowerCase())) {
            return lastTitle;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Timed out waiting for title to contain "${substring}" (last title: "${lastTitle}")`);
}

async function getCurrentUrl(client) {
    const result = await client.callTool('execute_script', { script: 'return window.location.href;' });
    return getResponseText(result);
}

async function waitForUrlContains(client, substring, timeoutMs = 15000, intervalMs = 500) {
    const deadline = Date.now() + timeoutMs;
    let lastUrl = '';
    while (Date.now() < deadline) {
        lastUrl = await getCurrentUrl(client);
        if (lastUrl.toLowerCase().includes(substring.toLowerCase())) {
            return lastUrl;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Timed out waiting for URL to contain "${substring}" (last URL: "${lastUrl}")`);
}

async function setTestStatus(client, status, remark) {
    const script = `lambda-hook: ${JSON.stringify({
        action: 'setTestStatus',
        arguments: { status, remark }
    })}`;
    await client.callTool('execute_script', { script });
}

async function main() {
    const remoteUrl = process.env.SELENIUM_REMOTE_URL;
    const username = process.env.LT_USERNAME;
    const accessKey = process.env.LT_ACCESS_KEY;
    if (!remoteUrl || !username || !accessKey) {
        throw new Error('SELENIUM_REMOTE_URL, LT_USERNAME, and LT_ACCESS_KEY must be set to run this smoke test on TestMu AI');
    }

    const client = new McpClient();
    await client.start();

    let dashboardUrl;
    let status = 'failed';
    let remark = '';

    try {
        const startResult = await client.callTool('start_browser', {
            browser: 'chrome',
            options: {
                platform: 'Windows 11',
                browserVersion: 'latest',
                build: 'MCP Selenium Smoke Tests',
                name: 'ecommerce-playground iPhone search'
            }
        });
        const startText = getResponseText(startResult);
        if (startResult.isError) throw new Error(`start_browser failed: ${startText}`);
        console.log(startText);
        dashboardUrl = startText.match(/TestMu AI dashboard: (\S+)/)?.[1];

        const maximizeResult = await client.callTool('window', { action: 'maximize' });
        if (maximizeResult.isError) throw new Error(`window maximize failed: ${getResponseText(maximizeResult)}`);
        console.log('Window maximized');

        const navigateResult = await client.callTool('navigate', { url: SITE_URL });
        if (navigateResult.isError) throw new Error(`navigate failed: ${getResponseText(navigateResult)}`);
        console.log(`Navigated to ${SITE_URL}`);

        const sendKeysResult = await client.callTool('send_keys', {
            by: 'name',
            value: 'search',
            text: SEARCH_TERM
        });
        if (sendKeysResult.isError) throw new Error(`send_keys failed: ${getResponseText(sendKeysResult)}`);
        console.log(`Typed "${SEARCH_TERM}" into the search box`);

        const clickResult = await client.callTool('interact', {
            action: 'click',
            by: 'xpath',
            value: "//button[text()='Search']"
        });
        if (clickResult.isError) throw new Error(`click Search failed: ${getResponseText(clickResult)}`);
        console.log('Clicked the Search button');

        const title = await waitForTitleContains(client, SEARCH_TERM);
        console.log(`Results page loaded, title: "${title}"`);

        const hoverResult = await client.callTool('interact', {
            action: 'hover',
            by: 'css',
            value: FIRST_PRODUCT_SELECTOR
        });
        if (hoverResult.isError) throw new Error(`Hover on first item failed: ${getResponseText(hoverResult)}`);
        console.log('Hovered over the first result');

        const addToCartResult = await client.callTool('interact', {
            action: 'click',
            by: 'css',
            value: ADD_TO_CART_SELECTOR
        });
        if (addToCartResult.isError) throw new Error(`Cart button click failed: ${getResponseText(addToCartResult)}`);
        console.log('Clicked the Cart button on the first result');

        const cartIconResult = await client.callTool('interact', {
            action: 'click',
            by: 'css',
            value: CART_ICON_SELECTOR
        });
        if (cartIconResult.isError) throw new Error(`Cart icon click failed: ${getResponseText(cartIconResult)}`);
        console.log('Opened the mini-cart');

        const checkoutResult = await client.callTool('interact', {
            action: 'click',
            by: 'css',
            value: CHECKOUT_BUTTON_SELECTOR
        });
        if (checkoutResult.isError) throw new Error(`Checkout click failed: ${getResponseText(checkoutResult)}`);
        console.log('Clicked Checkout');

        const checkoutUrl = await waitForUrlContains(client, 'checkout');
        console.log(`Landed on: "${checkoutUrl}"`);

        status = 'passed';
        remark = `Search results title "${title}" contains "${SEARCH_TERM}"; added first item to cart; checkout URL "${checkoutUrl}" contains "checkout"`;
        console.log(`PASSED: ${remark}`);
    } catch (e) {
        status = 'failed';
        remark = e.message;
        console.error(`FAILED: ${remark}`);
    } finally {
        try {
            await setTestStatus(client, status, remark);
        } catch (_) {
            // no active session (e.g. start_browser itself failed) — nothing to mark
        }
        try {
            const closeResult = await client.callTool('close_session');
            console.log(getResponseText(closeResult));
        } catch (e) {
            console.error(`close_session failed: ${e.message}`);
        }
        await client.stop();
    }

    if (dashboardUrl) console.log(`TestMu AI dashboard: ${dashboardUrl}`);
    if (status !== 'passed') process.exitCode = 1;
}

main().catch((e) => {
    console.error('Smoke test error:', e);
    process.exit(1);
});
