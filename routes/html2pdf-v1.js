'use strict';

const { callbackErrors, Queue } = require('../lib/queue');
const sUtil = require('../lib/util');

/**
 * The main router object
 */
const router = sUtil.router();

/**
 * The main application object reported when this module is require()d
 */
let app;

/**
 * Returns PDF representation of the article
 */
router.get('/:title/:format(letter|a4)', (req, res) => {
    const restbaseRequest = app.restbase_tpl.expand({
        request: {
            params: {
                domain: req.params.domain,
                path: `page/html/${encodeURIComponent(req.params.title)}`
            }
        }
    });

    app.queue.push({
        uri: restbaseRequest.uri,
        format: req.params.format
    }, ((error, pdf) => {
        if (error) {
            let status;

            if (error === callbackErrors.queueBusy) {
                status = 503;
            } else if (error === callbackErrors.renderFailed) {
                status = 500;
            }

            const errorObject = new sUtil.HTTPError({ status });
            res.status(errorObject.status).send(errorObject);

            return;
        }

        const headers = {
            'Content-Type': 'application/pdf',
            'Content-Disposition': sUtil.getContentDisposition(
                req.params.title)
        };
        res.writeHead(200, headers);
        res.end(pdf, 'binary');
    }));
});

module.exports = function(appObj) {
    app = appObj;

    const conf = app.conf;
    app.queue = new Queue(
        conf.render_concurrency,
        conf.render_queue_timeout,
        conf.puppeteer_flags,
        conf.pdf_options,
        app.logger
    );

    // the returned object mounts the routes on
    // /{domain}/vX/mount/path
    return {
        path: '/pdf',
        api_version: 1,      // must be a number!
        router
    };

};
