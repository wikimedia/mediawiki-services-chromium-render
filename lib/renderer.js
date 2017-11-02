'use strict';

const puppeteer = require('puppeteer');

/**
 * Renders content from `url` in PDF
 * @param {string} url URL to get content from
 * @param {string} format Page size, e.g. Letter or A4, passed to understands
 * @param {Object} puppeteerFlags
 * @param {Object} pdfOptions
 * @return {<Promise<Buffer>>} Promise which resolves with PDF buffer
 */
exports.articleToPdf = function articleToPdf(url, format, puppeteerFlags, pdfOptions) {
    let browser;
    let page;

    return puppeteer.launch({ args: puppeteerFlags })
        .then((browser_) => {
            browser = browser_;
            return browser.newPage();
        })
        .then((page_) => {
            page = page_;
            return page.goto(url, { waitUntil: 'networkidle' });
        })
        .then(() => {
            return page.pdf(Object.assign(
                {}, pdfOptions, { format }
            ));
        })
        .catch((error) => {
            if (browser) {
                browser.close();
            }
            throw error;
        })
        .then((pdf) => {
            browser.close();
            return pdf;
        });
};
