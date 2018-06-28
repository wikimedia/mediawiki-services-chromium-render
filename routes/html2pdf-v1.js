'use strict';

const { callbackErrors, Queue } = require('../lib/queue');
const sUtil = require('../lib/util');
const uuid = require('cassandra-uuid');
const apiUtil = require('../lib/api-util');
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
 * Handle the PDF rendering error.
 * @param {Integer} error Error code, one of callbackErrors
 * @param {string} title Article title
 * @param {Object} res Express response resource
 */
function handleError(error, title, res) {
    let status;
    let details;
    switch (error) {
        // FIX: e.queueBusy === 0 and Boolean(0) === false so the outer
        // conditional prohibits this state.
        case callbackErrors.queueBusy:
        case callbackErrors.queueFull:
            status = 503;
            details = 'Queue full. Please try again later';
            // Pool manager will depool the service once it receives 5xx error
            // 503 is an expected state, and we should re-pool this server after
            // render_queue_timeout seconds  which means queue should be empty now
            // (or picked to render, or rejected because of the timeout)
            res.set('Retry-After', app.conf.render_queue_timeout || 60);
            details = 'Queue full. Please try again later';
            break;
        case callbackErrors.pageNotFound:
            status = 404;
            details = `Article '${title}' not found`;
            break;
        default:
            status = 500;
            details = 'Internal Server Error';
    }

    const errorObject = new sUtil.HTTPError({ status, details });
    res.status(errorObject.status).send(errorObject);
}

/**
 * Handle the PDF rendering job, registers new job in the queue and handles output
 * @param {Object} data result of buildRequestData() function call
 * @param {string} title Article title
 * @param {Object} res Express response object
 */
function handlePDFJob(data, title, res) {
    app.queue.push(data, ((error, pdf) => {
        if (error) {
            handleError(error, title, res);
            return;
        }

        // Async Queue doesn't handle aborting jobs well. `pdf` can be undefined
        // when user aborted the request that already started to render.
        if (pdf) {
            const headers = {
                'Content-Type': 'application/pdf',
                'Content-Disposition': sUtil.getContentDisposition(title)
            };
            app.metrics.gauge(`request.pdf.size`, pdf.length);
            res.writeHead(200, headers);
            res.end(pdf, 'binary');
        } else {
            // no output just close the resource if it's not already closed (aborted)
            try {
                res.end();
            } catch (err) {
                // do nothing
            }
        }

    }));
}

/**
 * Utility function to build data object passed to the queue
 * @param {Object} req Express Request object
 * @return {{id: string, renderer: Object, uri: string, format: string}}
 */
function buildRequestData(req) {
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
    return {
        id,
        renderer,
        uri: requestUrl.uri,
        format: req.params.format
    };
}

/**
 * Returns PDF representation of the article
 */
router.get('/:title/:format(letter|a4|legal)/:type(mobile|desktop)?', (req, res) => {
    const data = buildRequestData(req);
    const title = req.params.title;
    const encodedTitle = encodeURIComponent(title);

    app.metrics.increment(`request.type.${req.params.type}`);
    app.metrics.increment(`request.format.${req.params.format}`);

    // this code blindly assumes that domain is in '{lang}.wikipedia.org` format
    apiUtil.restApiGet(app, req.params.domain, `page/title/${encodedTitle}`).then(() => {
        // we don't need to process the response, we're just expecting that article exists
        req.on('close', () => {
            app.logger.log(
                'debug/request',
                `Connection closed by the client. ` +
                `Will try and cancel the task ${data.id}.`
            );
            app.queue.abort(data);
        });
        handlePDFJob(data, title, res);
    }, (err) => {
        if (err.status === 404) {
            app.logger.log(
                'info/request',
                `Restbase page/title/${encodedTitle} request returned ${err.status} code`
            );
            handleError(callbackErrors.pageNotFound, title, res);
        } else {
            app.logger.log(
                'error/request',
                `Restbase page/title/${encodedTitle} request returned ${err.status} code`
            );

            handleError(callbackErrors.renderFailed, title, res);
        }
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
        app.logger,
        app.metrics
    );

    // the returned object mounts the routes on
    // /{domain}/vX/mount/path
    return {
        path: '/pdf',
        api_version: 1,      // must be a number!
        router
    };

};
