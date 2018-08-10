'use strict';

const puppeteer = require('puppeteer-core');
const devices = require('puppeteer-core/DeviceDescriptors');
const BBPromise = require('bluebird');

// Errors used to communicate incorrect renderer behaviour
const rendererErrors = {
    // Page not found
    NOT_FOUND: 1,
    // any other server error, any code 4xx or 5xx but not 404
    SERVER_ERROR: 2,
    // render was aborted
    ABORT: 3
};
/**
 * Mobile device viewport. Will use Samsung Galaxy S III as a default device
 * Note: Device width has to be smaller than @width-breakpoint-tablet defined in MinervaNeue Skin
 * Otherwise Mobile print styles won't be applied.
 * @type {Object}
 */
const MOBILE_DEVICE_VIEWPORT = devices['Galaxy S III'].viewport;
/**
 * Desktop device viewport. Using HD resolution
 * @type {Object}
 */
const DESKTOP_DEVICE_VIEWPORT = {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
};

/**
 * PDF renderer from a URL.
 * In order to keep debugging simple and performance predictable each
 * request should create a new instance of the class.
 */
class Renderer {
    /**
     * Creates a new Renderer instance
     * @param {string} userAgent User agent to use when requesting the URL
     * @param {boolean} isMobile Render mobile pages
     * @param {Object} logger The logger object (for debugging purposes)
     */
    constructor(userAgent, isMobile, logger) {
        this._browser = null;
        this._renderAborted = false;
        this._userAgent = userAgent;
        this._isMobile = isMobile;
        this._logger = logger;
    }

    /**
     * Closes any open browser instance. Additionally to prevent resources leak
     * script will wait 3 seconds, and if Chromium Process is still present, it will be killed
      @return {<BBPromise<>>} Promise which resolves when browser exited or has been killed
     */
    _closeBrowser() {
        return new BBPromise((resolve, reject) => {
            if (this._browser) {
                const browser = this._browser;
                const childProcess = browser.process();

                this._browser = undefined;
                browser.close().then(resolve, () => {
                    // because close promise was rejected we want to be sure
                    // that chromium process died
                    let postponedSIGKILL = null;
                    childProcess.on('exit', () => {
                        // process left by itself, there is no need to kill it
                        clearTimeout(postponedSIGKILL);
                    });
                    postponedSIGKILL = setTimeout(() => {
                        this._logger.log(
                            'error/render', {
                                msg: 'Killing chromium process',
                                childId: childProcess.pid
                            });
                        try {
                            childProcess.kill('SIGKILL');
                        } catch (err) {
                            // ignore the exception
                        }
                    }, 3000);
                    resolve();
                });
            } else {
                // browser is already closed
                resolve();
            }
        });
    }

    /**
     * Renders content from `url` in PDF
     * @param {string} url URL to get content from
     * @param {Object} headers List of headers to set for the request
     * @param {Object} puppeteerOptions as defined by the puppeteer
     * documentation. See
     * https://github.com/GoogleChrome/puppeteer/blob/v0.15.0/docs/api.md#puppeteerlaunchoptions
     * @param {Object} pdfOptions as defined by the puppeteer
     * documentation. See
     * https://github.com/GoogleChrome/puppeteer/blob/v0.13.0/docs/api.md#pagepdfoptions
     * @return {<BBPromise<Buffer>>} Promise which resolves with PDF buffer
     */
    articleToPdf(url, headers, puppeteerOptions, pdfOptions) {
        let page;
        return new BBPromise((resolve, reject) => {
            puppeteer.launch(puppeteerOptions).then((browser) => {
                this._browser = browser;
                this._logger.log(
                    'debug/render', {
                        msg: 'Spawned new Chromium instance',
                        childId: browser.process().pid
                    });
                browser.on('disconnected', () => {
                    if (this._renderAborted) {
                        const stop = new Error('Render aborted');
                        stop.code = rendererErrors.ABORT;
                        reject(stop);
                    }
                });
                return browser.newPage();
            })
            .then((page_) => {
                page = page_;
                return page.emulate({
                    viewport: this._isMobile ? MOBILE_DEVICE_VIEWPORT : DESKTOP_DEVICE_VIEWPORT,
                    userAgent: this._userAgent
                });
            })
            .then(() =>
                // MobileFrontend lazy loads images by Javascript. The
                // easiest approach to load all images is to disable the JS
                page.setJavaScriptEnabled(false)
            )
            .then(() => page.setExtraHTTPHeaders(headers))
            .then(() => page.goto(url, { waitUntil: 'networkidle2' }))
            .then((response) => {
                if (!response.ok()) {
                    const status = response.status();
                    let err;
                    switch (status) {
                        case 404:
                            err = new Error(`Page ${url} not found`);
                            err.code = rendererErrors.NOT_FOUND;
                            break;
                        default:
                            err = new Error(`Page ${url} returned ${status} error code`);
                            err.code = rendererErrors.SERVER_ERROR;
                            err.reponseCode = status;
                    }
                    throw err;
                }
                return page.pdf(pdfOptions);
            })
            .catch((error) => {
                // When jobs get aborted and the browser is closed puppeteer fails with
                // with an exception `Error: Protocol error (Page.printToPDF): Target closed.`
                // Also there is NavigatorWatcher object that has a defined timeout (uses
                // Promise.race()) if the Page does not respond within the 30s timeout (because for
                // example abort action closed the browser) it fails with exception:
                // `Error: Navigation Timeout Exceeded: 30000ms exceeded`
                // Because there is no other way to tell puppeteer to stop processing and
                // close the browser - the easiest trick for now, is just to close the
                // browser and silently ignore all exceptions, exit the queue anb pretend
                // nothing happened. The event listener [browser.on('disconnected') located couple
                // lines above will exit the queue. If `this._renderAborted` is true, we can
                // safely ignore all exceptions.
                this._closeBrowser().finally(() => {
                    if (!this._renderAborted) {
                        reject(error);
                    }
                });
            })
            .then((pdf) => {
                this._closeBrowser().finally(() => {
                    resolve(pdf);
                });
            });
        });
    }

    /**
     * Aborts the request to create a PDF.
     *
     * Should be called after calling articleToPdf
     * @return {<BBPromise<>>} Promise which resolves when browser exited or has been killed
     */
    abortRender() {
        this._renderAborted = true;
        return this._closeBrowser();
    }
}

module.exports = {
    rendererErrors,
    Renderer
};
