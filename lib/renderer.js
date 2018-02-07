'use strict';

const puppeteer = require('puppeteer');

// Errors used to communicate incorrect renderer behaviour
const rendererErrors = {
    // Page not found
    NOT_FOUND: 1,
    // any other server error, any code 4xx or 5xx but not 404
    SERVER_ERROR: 2,
};

/**
 * PDF renderer from a URL.
 * In order to keep debugging simple and performance predictable each
 * request should create a new instance of the class.
 */
class Renderer {
    /**
     * Creates a new Renderer instance
     * @param {String} userAgent User agent to use when requesting the URL
     */
    constructor(userAgent) {
        this._browser = null;
        this._renderAborted = false;
        this._userAgent = userAgent;
    }

    /**
     * Closes any open browser instance
     */
    _closeBrowser() {
        if (this._browser) {
            this._browser.close();
            this._browser = null;
        }
    }

    /**
     * Renders content from `url` in PDF
     * @param {string} url URL to get content from
     * @param {Object} puppeteerOptions as defined by the puppeteer
     * documentation. See
     * https://github.com/GoogleChrome/puppeteer/blob/v0.13.0/docs/api.md#puppeteerlaunchoptions
     * @param {Object} pdfOptions as defined by the puppeteer
     * documentation. See
     * https://github.com/GoogleChrome/puppeteer/blob/v0.13.0/docs/api.md#pagepdfoptions
     * @return {<Promise<Buffer>>} Promise which resolves with PDF buffer
     */
    articleToPdf(url, puppeteerOptions, pdfOptions) {
        let page;
        const that = this;

        return puppeteer.launch(puppeteerOptions)
            .then((browser) => {
                that._browser = browser;
                return browser.newPage();
            })
            .then((page_) => {
                page = page_;
                return page.setUserAgent(that._userAgent);
            })
            .then(() => {
                // MobileFrontend lazy loads images by Javascript. The
                // easiest approach to load all images is to disable the JS
                return page.setJavaScriptEnabled(false);
            })
            .then(() => {
                return page.goto(url, { waitUntil: 'networkidle2' });
            })
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
     * Should be called after calling articleToPdf
     */
    abortRender() {
        this._closeBrowser();
        this._renderAborted = true;
    }
}

module.exports = {
    rendererErrors,
    Renderer
};
