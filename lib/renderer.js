'use strict';

const puppeteer = require('puppeteer');

/**
 * PDF renderer from a URL.
 * In order to keep debugging simple and performance predictable each
 * request should create a new instance of the class.
 */
module.exports = class Renderer {
    constructor() {
        this._browser = null;
        this._renderAborted = false;
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
                return page.goto(url, { waitUntil: 'networkidle2' });
            })
            .then(() => {
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
};
