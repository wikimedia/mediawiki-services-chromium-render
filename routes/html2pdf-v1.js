'use strict';

const Queue = require('../lib/queue');
const sUtil = require('../lib/util');
const renderer = require('../lib/renderer');

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
        format: req.params.format,
        conf: app.conf
    }, ((error, pdf) => {
        if (error) {
            const error_ = new sUtil.HTTPError(
                `Cannot convert page ${restbaseRequest.uri} to PDF.`
            );
            res.status(error_.status).send(error_);
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

    const worker = (data, callback) => {
        renderer
            .articleToPdf(data.uri, data.format, data.conf)
            .then((pdf) => {
                callback(null, pdf);
            })
            .catch((error) => {
                app.logger.log('trace/error', {
                    msg: `Cannot convert page ${data.uri} to PDF.`,
                    error
                });
                callback(error, null);
            });
    };

    app.queue = new Queue(worker, app.conf.render_concurrency);

    // the returned object mounts the routes on
    // /{domain}/vX/mount/path
    return {
        path: '/pdf',
        api_version: 1,      // must be a number!
        router
    };

};
