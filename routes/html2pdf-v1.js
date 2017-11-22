'use strict';

const { callbackErrors, Queue } = require('../lib/queue');
const sUtil = require('../lib/util');
const uuid = require('cassandra-uuid');
const Renderer = require('../lib/renderer');

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

    const id = `${uuid.TimeUuid.now().toString()}|${restbaseRequest.uri}`;
    const renderer = new Renderer();
    app.queue.push({
        id,
        renderer,
        uri: restbaseRequest.uri,
        format: req.params.format
    }, ((error, pdf) => {
        if (error) {
            let status;
            const e = callbackErrors;

            switch (error) {
                case e.queueBusy:
                case e.queueFull:
                    status = 503;
                    break;
                default:
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

    req.on('close', () => {
        app.logger.log(
            'debug/request',
            `Connection closed by the client. ` +
            `Will try and cancel the task with ID ${id}.`
        );
        app.queue.abort(id, renderer);
    });
});

module.exports = function(appObj) {
    app = appObj;

    const conf = app.conf;
    app.queue = new Queue(
        {
            concurrency: conf.render_concurrency,
            queueTimeout: conf.render_queue_timeout,
            executionTimeout: conf.render_execution_timout,
            maxTaskCount: conf.max_render_queue_size
        },
        conf.puppeteer_options,
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
