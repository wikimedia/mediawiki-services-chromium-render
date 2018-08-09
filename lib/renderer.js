'use strict';

const puppeteer = require('puppeteer-core');
const devices = require('puppeteer-core/DeviceDescriptors');

// Errors used to communicate incorrect renderer behaviour
const rendererErrors = {
    // Page not found
    NOT_FOUND: 1,
    // any other server error, any code 4xx or 5xx but not 404
    SERVER_ERROR: 2,
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
     */
    _closeBrowser() {
        if (this._browser) {
            const childProcess = this._browser.process();
            const postponedSIGKILL = setTimeout(() => {
                this._logger.log(
                    'warning/render', {
                        msg: 'Killing chromium process',
                        childId: childProcess.pid
                    });
                try {
                    childProcess.kill('SIGKILL');
                } catch (err) {
                    // ignore the exception
                }
            }, 3000);
            childProcess.on('exit', () => {
                // process left by itself, there is no need to kill it
                clearTimeout(postponedSIGKILL);
            });
            this._browser.close();
            this._browser = null;
        }
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
     * @return {<Promise<Buffer>>} Promise which resolves with PDF buffer
     */
    articleToPdf(url, headers, puppeteerOptions, pdfOptions) {
        let page;
        const that = this;
        return puppeteer.launch(puppeteerOptions)
            .then((browser) => {
                that._browser = browser;
                that._logger.log(
                    'debug/render', {
                        msg: 'Spawned new Chromium instance',
                        childId: browser.process().pid
                    });
                return browser.newPage();
            })
            .then((page_) => {
                page = page_;
                return page.emulate({
                    viewport: that._isMobile ? MOBILE_DEVICE_VIEWPORT : DESKTOP_DEVICE_VIEWPORT,
                    userAgent: that._userAgent
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
                // Only thrown an error if we didn't close the browser ourselves
                if (!this._renderAborted) {
                    that._closeBrowser();
                    throw error;
                }
            })
            .then((pdf) => {
                that._closeBrowser();
                return pdf;
            });
    }

    /**
     * Aborts the request to create a PDF.
     *
     * Should be called after calling articleToPdf
     */
    abortRender() {
        this._renderAborted = true;
        if (this._browser) {
            this._closeBrowser();
        }
    }
}

module.exports = {
    rendererErrors,
    Renderer
};
