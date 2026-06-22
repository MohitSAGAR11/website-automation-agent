const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });



const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || './screenshots';
const BROWSER_TIMEOUT = parseInt(process.env.BROWSER_TIMEOUT || '30000');
const VIEWPORT_WIDTH = parseInt(process.env.VIEWPORT_WIDTH || '1280');
const VIEWPORT_HEIGHT = parseInt(process.env.VIEWPORT_HEIGHT || '800');
const HEADLESS = process.env.HEADLESS !== 'false';

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// ─── Browser State (module-level singleton) ───────────────────────────────────

let browserInstance = null;
let pageInstance = null;
let screenshotCounter = 0;

// ─── Tool: open_browser ───────────────────────────────────────────────────────

async function open_browser() {
  logger.agentAction('open_browser', { headless: HEADLESS });

  try {
    const executablePath = process.env.CHROME_PATH || '/opt/google/chrome/chrome';
    const launchOptions = {
      headless: HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=' + VIEWPORT_WIDTH + ',' + VIEWPORT_HEIGHT
      ]
    };

    // Try system Chrome first, fall back to Playwright bundled
    if (fs.existsSync(executablePath)) {
      launchOptions.executablePath = executablePath;
    } else if (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')) {
      launchOptions.executablePath = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    }

    browserInstance = await chromium.launch(launchOptions);

    const context = await browserInstance.newContext({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    pageInstance = await context.newPage();
    pageInstance.setDefaultTimeout(BROWSER_TIMEOUT);

    logger.agentSuccess('Browser opened successfully');
    return { browser: browserInstance, page: pageInstance };
  } catch (err) {
    logger.agentError('Failed to open browser', err);
    throw err;
  }
}

async function navigate_to_url(url) {
  logger.agentAction('navigate_to_url', { url });

  if (!pageInstance) throw new Error('Browser not open. Call open_browser() first.');

  try {
    await pageInstance.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: BROWSER_TIMEOUT
    });
    
    await pageInstance.waitForTimeout(2000);

    const finalUrl = pageInstance.url();
    logger.agentSuccess(`Navigated to: ${finalUrl}`);
    return finalUrl;
  } catch (err) {
    logger.agentError('Navigation failed', err);
    throw err;
  }
}

/**
 * Take a viewport screenshot.
 * @param {string} label      - Human-readable label used in the filename.
 * @param {string|null} selector - If provided, the element will be scrolled to
 *                                 the CENTER of the viewport before the shot is
 *                                 taken, so it is never cropped to an edge.
 */
async function take_screenshot(label = 'step', selector = null) {
  screenshotCounter++;
  const filename = `${String(screenshotCounter).padStart(3, '0')}_${label.replace(/\s+/g, '_')}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);

  logger.agentAction('take_screenshot', { filename, selector });

  if (!pageInstance) throw new Error('Browser not open. Call open_browser() first.');

  try {
    // If a selector is given, center it in the viewport before capturing
    if (selector) {
      try {
        await pageInstance.$eval(selector, node =>
          node.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' })
        );
        await pageInstance.waitForTimeout(400);
      } catch (_) {
        // If centering fails, proceed with current scroll position
      }
    }
    await pageInstance.screenshot({ path: filepath, fullPage: false });
    logger.agentSuccess(`Screenshot saved: ${filepath}`);
    return filepath;
  } catch (err) {
    logger.agentError('Screenshot failed', err);
    throw err;
  }
}


async function click_on_screen(x, y) {
  logger.agentAction('click_on_screen', { x, y });

  if (!pageInstance) throw new Error('Browser not open. Call open_browser() first.');

  try {
    await pageInstance.mouse.click(x, y);
    await pageInstance.waitForTimeout(300); // Small debounce
    logger.agentSuccess(`Clicked at (${x}, ${y})`);
  } catch (err) {
    logger.agentError(`Click at (${x}, ${y}) failed`, err);
    throw err;
  }
}


async function click_element(selector) {
  logger.agentAction('click_element', { selector });

  if (!pageInstance) throw new Error('Browser not open. Call open_browser() first.');

  try {
    await pageInstance.waitForSelector(selector, { timeout: 10000 });
    await pageInstance.click(selector);
    await pageInstance.waitForTimeout(300);
    logger.agentSuccess(`Clicked element: ${selector}`);
  } catch (err) {
    logger.agentError(`Failed to click element: ${selector}`, err);
    throw err;
  }
}

async function send_keys(text, selector = null) {
  logger.agentAction('send_keys', { text, selector });

  if (!pageInstance) throw new Error('Browser not open. Call open_browser() first.');

  try {
    if (selector) {
      await pageInstance.waitForSelector(selector, { timeout: 10000 });
      await pageInstance.fill(selector, text);
    } else {
      await pageInstance.keyboard.type(text, { delay: 50 });
    }
    logger.agentSuccess(`Typed text into: ${selector || 'focused element'}`);
  } catch (err) {
    logger.agentError('send_keys failed', err);
    throw err;
  }
}


async function scroll(deltaY = 400, selector = null) {
  logger.agentAction('scroll', { deltaY, selector });

  if (!pageInstance) throw new Error('Browser not open. Call open_browser() first.');

  try {
    if (selector) {
      // Scroll element to the CENTER of the viewport for a clear view
      const el = await pageInstance.$(selector);
      if (el) {
        await el.evaluate(node =>
          node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
        );
        await pageInstance.waitForTimeout(600); // let smooth scroll settle
        logger.agentSuccess(`Scrolled element to center of viewport: ${selector}`);
      } else {
        throw new Error(`Selector not found: ${selector}`);
      }
    } else {
      await pageInstance.mouse.wheel(0, deltaY);
      await pageInstance.waitForTimeout(500);
      logger.agentSuccess(`Scrolled by ${deltaY}px`);
    }
  } catch (err) {
    logger.agentError('Scroll failed', err);
    throw err;
  }
}


/**
 * Scroll any element to the vertical/horizontal center of the viewport.
 * Always use this before taking a screenshot of a specific element.
 */
async function scroll_to_center(selector) {
  logger.agentAction('scroll_to_center', { selector });

  if (!pageInstance) throw new Error('Browser not open. Call open_browser() first.');

  try {
    await pageInstance.waitForSelector(selector, { timeout: 10000 });
    await pageInstance.$eval(selector, node =>
      node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    );
    await pageInstance.waitForTimeout(600); // let scroll animation settle
    logger.agentSuccess(`Element centered in viewport: ${selector}`);
    return true;
  } catch (err) {
    logger.agentError(`scroll_to_center failed for: ${selector}`, err);
    throw err;
  }
}


async function double_click(x = null, y = null, selector = null) {
  logger.agentAction('double_click', { x, y, selector });

  if (!pageInstance) throw new Error('Browser not open. Call open_browser() first.');

  try {
    if (selector) {
      await pageInstance.dblclick(selector);
      logger.agentSuccess(`Double-clicked element: ${selector}`);
    } else {
      await pageInstance.mouse.dblclick(x, y);
      logger.agentSuccess(`Double-clicked at (${x}, ${y})`);
    }
  } catch (err) {
    logger.agentError('double_click failed', err);
    throw err;
  }
}


async function get_page_content() {
  logger.agentAction('get_page_content');

  if (!pageInstance) throw new Error('Browser not open. Call open_browser() first.');

  try {
    const info = await pageInstance.evaluate(() => {
      // Collect all interactive elements
      const inputs = Array.from(document.querySelectorAll('input, textarea, select, button')).map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        id: el.id || null,
        name: el.name || null,
        placeholder: el.placeholder || null,
        className: el.className?.substring(0, 80) || null,
        visible: el.offsetParent !== null,
        textContent: el.textContent?.trim().substring(0, 60) || null,
        ariaLabel: el.getAttribute('aria-label') || null
      }));

      // Collect form element labels
      const labels = Array.from(document.querySelectorAll('label')).map(l => ({
        for: l.htmlFor,
        text: l.textContent?.trim().substring(0, 60)
      }));

      return {
        title: document.title,
        url: window.location.href,
        bodyText: document.body.innerText?.substring(0, 2000),
        inputs,
        labels
      };
    });

    logger.agentSuccess(`Page content fetched: "${info.title}"`);
    return info;
  } catch (err) {
    logger.agentError('get_page_content failed', err);
    throw err;
  }
}


async function wait_for_element(selector, timeout = 10000) {
  logger.agentAction('wait_for_element', { selector, timeout });

  if (!pageInstance) throw new Error('Browser not open. Call open_browser() first.');

  try {
    await pageInstance.waitForSelector(selector, { timeout });
    logger.agentSuccess(`Element appeared: ${selector}`);
    return true;
  } catch (err) {
    logger.agentError(`Element not found within ${timeout}ms: ${selector}`, err);
    return false;
  }
}


async function close_browser() {
  logger.agentAction('close_browser');

  try {
    if (browserInstance) {
      await browserInstance.close();
      browserInstance = null;
      pageInstance = null;
      logger.agentSuccess('Browser closed');
    }
  } catch (err) {
    logger.agentError('Error closing browser', err);
  }
}

function getPage() {
  return pageInstance;
}

module.exports = {
  open_browser,
  navigate_to_url,
  take_screenshot,
  click_on_screen,
  click_element,
  send_keys,
  scroll,
  scroll_to_center,
  double_click,
  get_page_content,
  wait_for_element,
  close_browser,
  getPage
};
