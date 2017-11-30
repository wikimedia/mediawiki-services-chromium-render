'use strict';

const puppeteer = require('puppeteer');

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
     * TODO: merge format with pdfOptions
     * @param {string} format Page size, e.g. Letter or A4, passed to understands
     * @param {Object} puppeteerOptions
     * @param {Object} pdfOptions
     * @return {<Promise<Buffer>>} Promise which resolves with PDF buffer
     */
    articleToPdf(url, format, puppeteerOptions, pdfOptions) {
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
                return page.pdf(Object.assign(
                    {}, pdfOptions, { format }
                ));
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
