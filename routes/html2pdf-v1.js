'use strict';

const { callbackErrors, Queue } = require('../lib/queue');
const sUtil = require('../lib/util');
const uuid = require('cassandra-uuid');
const { Renderer } = require('../lib/renderer');

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
router.get('/:title/:format(letter|a4|legal)/:type(mobile|desktop)?', (req, res) => {
    // this code blindly assumes that domain is in '{lang}.wikipedia.org` format
    const parts = req.params.domain.split('.');
    const isMobileRender = req.params.type && req.params.type === 'mobile';
    const language = parts.shift();

    const requestUrl = app.mw_tpl.expand({
        request: {
            params: {
                language,
                mobile: isMobileRender,
                domain: parts.join('.'),
                article: encodeURIComponent(req.params.title)
            }
        }
    });

    const id = `${uuid.TimeUuid.now().toString()}|${requestUrl.uri}`;
    const renderer = new Renderer(app.conf.user_agent, isMobileRender);
    const data = {
        id,
        renderer,
        uri: requestUrl.uri,
        format: req.params.format
    };
    app.queue.push(data, ((error, pdf) => {
        if (error) {
            let status;
            let details;
            const e = callbackErrors;

            switch (error) {
                // FIX: e.queueBusy === 0 and Boolean(0) === false so the outer
                // conditional prohibits this state.
                case e.queueBusy:
                case e.queueFull:
                    status = 503;
                    details = 'Queue full. Please try again later';
                    break;
                case e.pageNotFound:
                    status = 404;
                    details = `Article '${req.params.title}' not found`;
                    break;
                default:
                    status = 500;
                    details = 'Internal Server Error';
            }

            const errorObject = new sUtil.HTTPError({ status, details });
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
                `Will try and cancel the task ${id}.`
        );
        app.queue.abort(data);
    });
});

module.exports = function(appObj) {
    app = appObj;

    const conf = app.conf;
    app.queue = new Queue(
        {
            concurrency: conf.render_concurrency || 1,
            queueTimeout: conf.render_queue_timeout || 60,
            executionTimeout: conf.render_execution_timeout || 90,
            maxTaskCount: conf.max_render_queue_size || 3,
            healthLoggingInterval: conf.queue_health_logging_interval || 3600
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
