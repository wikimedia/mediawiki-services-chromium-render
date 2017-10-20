'use strict';

const puppeteer = require('puppeteer');

/**
 * Renders content from `url` in PDF
 * @param {string} url URL to get content from
 * @param {string} format Page size, e.g. Letter or A4, passed to understands
 * @param {Object} conf app configuration
 * @return {<Promise<Buffer>>} Promise which resolves with PDF buffer
 */
exports.articleToPdf = function articleToPdf(url, format, conf) {
    let browser;
    let page;

    return puppeteer.launch({ args: conf.puppeteer_flags })
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
                {}, conf.pdf_options, { format }
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
