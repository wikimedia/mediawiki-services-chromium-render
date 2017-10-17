'use strict';

const sUtil = require('../lib/util');

/**
 * The main router object
 */
const router = sUtil.router();

/**
 * The main application object reported when this module is require()d
 */
let app;


const puppeteer = require('puppeteer');

/**
 * Renders content from `url` in PDF
 * @param {string} url URL to get content from
 * @param {string} format Page size, e.g. Letter or A4, passed to understands
 * @return {<Promise<Buffer>>} Promise which resolves with PDF buffer
 */
function articleToPdf(url, format) {
    let browser;
    let page;

    return puppeteer.launch({ args: app.conf.puppeteer_flags })
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
                {}, app.conf.pdf_options, { format }
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
}

function getContentDisposition(title) {
    const encodedName = `${encodeURIComponent(title)}.pdf`;
    const quotedName = `"${encodedName.replace(/"/g, '\\"')}"`;
    return `download; filename=${quotedName}; filename*=UTF-8''${encodedName}`;
}

/**
 * Returns PDF representation of the article
 */
router.get('/:title/:format(letter|a4)', (req, res) => {
    const restbaseRequest = app.restbase_tpl.expand({
        request: {
            params: {
                domain: req.params.domain,
                path: `page/html/${req.params.title}`
            }
        }
    });

    return articleToPdf(restbaseRequest.uri, req.params.format)
        .then((pdf) => {
            const headers = {
                'Content-Type': 'application/pdf',
                'Content-Disposition': getContentDisposition(req.params.title)
            };
            res.writeHead(200, headers);
            res.end(pdf, 'binary');
        })
        .catch((error) => {
            app.logger.log('trace/error', {
                msg: `Cannot convert page ${restbaseRequest.uri} to PDF.`,
                error
            });
            res.status(500).send();
        });
});


module.exports = function(appObj) {


    app = appObj;

    // the returned object mounts the routes on
    // /{domain}/vX/mount/path
    return {
        path: '/pdf',
        api_version: 1,      // must be a number!
        router
    };

};
