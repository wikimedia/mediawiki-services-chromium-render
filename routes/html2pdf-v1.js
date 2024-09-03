'use strict';

const { Queue } = require('../lib/queue');
const { QueueItem } = require('../lib/queueItem');
const { bindQueueLoggerAndMetrics } = require('../lib/queueLogger');

const errors = require('../lib/errors');
const sUtil = require('../lib/util');
const uuid = require('cassandra-uuid');
const { Renderer } = require('../lib/renderer');
const BBPromise = require('bluebird');

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
 * @param {*} error Error code, one of callbackErrors
 * @param {string} title Article title
 * @param {Object} res Express response resource
 * @param {Object} logger Logger object
 */
function handleError(error, title, res, logger) {
    let status;
    let detail;
    if (error instanceof errors.NavigationError) {
        switch (error.httpCode) {
            case 404:
                status = 404;
                detail = `Article '${title}' not found`;
                logger.log('info/render', {
                    msg: 'Render failed. Page not found.',
                    id: error.jobId
                });
                break;
            default:
                status = 500;
                detail = 'Internal Server Error';
                if (error.httpCode >= 500) {
                    app.logger.log(
                        'error/request',
                        {
                            msg: error.message || error.msg,
                            code: error.httpCode,
                            params: error.httpParams,
                            id: error.jobId
                        });
                }

        }

    } else if (error instanceof errors.ProcessingCancelled) {
        // client aborted request, we don't need to process that
        return res.end();
    } else if (error instanceof errors.QueueFull || error instanceof errors.QueueTimeout) {
        status = 503;
        // queue is busy, the waiting task just got rejected (didn't get to rendering phase)
        // we need to allow this queue to finish processing all tasks first before handling new job
        // Pool manager will depool the service once it receives 5xx error
        // 503 is an expected state, and we should re-pool this server after
        // render_queue_timeout seconds  which means queue should be empty now
        // (or picked to render, or rejected because of the timeout)
        res.set('Retry-After', app.conf.render_queue_timeout || 60);
        detail = 'Queue full. Please try again later';
    } else if (error instanceof errors.JobTimeout) {
        status = 503;
        // Very similar situation as previously, started task timed out, it could be a big
        // render or just a service overload, We don't need to stop processing queue as there is
        // already one spot in the queue rendering queue.
        detail = 'Queue full. Please try again later';
    } else {
        // Any other error - log and fail
        app.logger.log(
            'error/request',
            {
                msg: `Error: ${typeof error === 'object' ? error.message : error}`,
                trace: error.stack
            });
        status = 500;
        detail = 'Internal Server Error';
    }

    const errorObject = new sUtil.HTTPError({ status, detail });
    res.status(errorObject.status).send(errorObject);
}

/**
 * Assembles the MW request object to be used later to retrieve the HTML
 * @param {Object} reqParams the request parameters passed in to the service
 * @return {Object} the assembled request object
 */
function assembleRequest(reqParams) {
    const extraParams = {
        mobile: reqParams.type === 'mobile',
        extdomain: reqParams.domain
    };

    if (extraParams.mobile) {
        // TODO: find a way not to use this ugly ugly hack
        if (/^(?:www\.)?(?:mediawiki|wikisource|wikidata)\.org$/.test(reqParams.domain)) {
            extraParams.extdomain = reqParams.domain.replace(
                /(www\.)?(mediawiki|wikisource|wikidata)/, 'm.$2'
            );
        } else {
            extraParams.extdomain = reqParams.domain.replace(/^([^.]+)/, '$1.m');
        }
    }

    const request = app.mw_tpl.expand({
        request: { params: Object.assign(extraParams, reqParams) }
    });

    if (request.query) {
        // puppeteer does not support setting the query object,
        // so we need to add it manually to the URI
        const query = Object.keys(request.query)
            .map(item => `${item}=${encodeURIComponent(request.query[item])}`)
            .join('&');
        if (/\?/.test(request.uri)) {
            request.uri = `${request.uri}&${query}`;
        } else {
            request.uri = `${request.uri}?${query}`;
        }
    }

    return request;
}

/**
 * Utility function to build data object passed to the queue
 * @param {Object} req Express Request object
 * @param {Object} logger The Logger object
 * @return {QueueItem}
 */
function buildQueueItem(req, logger) {
    const request = assembleRequest(req.params);
    const id = `${uuid.TimeUuid.now().toString()}|${req.params.domain}|${req.params.title}`;
    const renderer = new Renderer(
        app.conf.puppeteer_options,
        app.conf.pdf_options,
        new RegExp(app.conf.host_blacklist ? `^(?:${app.conf.host_blacklist})$` : '(?!)', 'i'),
        app.conf.user_agent,
        req.params.type === 'mobile',
        logger
    );
    const data = {
        id,
        renderer,
        uri: request.uri,
        headers: req.headers,
        format: req.params.format
    };
    return new QueueItem(data);
}

/**
 * Returns PDF representation of the article
 */
router.get('/:title/:format(letter|a4|legal)?/:type(mobile|desktop)?', (req, res) => {
    const title = req.params.title;

    const requestsTypeMetric = app.metrics.makeMetric({
        type: 'Counter',
        name: 'requests.type',
        prometheus: {
            name: 'proton_requests_type',
            help: 'proton requests by type',
        },
        labels: {
            names: ['type'],
            omitLabelNames: true,
        },
    });

    const requestsFormatMetric = app.metrics.makeMetric({
        type: 'Counter',
        name: 'requests.format',
        prometheus: {
            name: 'proton_requests_format',
            help: 'proton requests by PDF layout format',
        },
        labels: {
            names: ['format'],
            omitLabelNames: true,
        },
    });

    const queueEventMetric = app.metrics.makeMetric({
        type: 'Counter',
        name: 'queue.events',
        prometheus: {
            name: 'proton_queue_events_total',
            help: 'queue events'
        },
        labels: {
            names: ['type'],
            omitLabelNames: true
        }
    });

    const pdfSizeMetric = app.metrics.makeMetric({
        type: 'Gauge',
        name: 'request.pdf.size',
        prometheus: {
            name: 'proton_pdf_size',
            help: 'proton responses pdf size',
        },
    });

    requestsTypeMetric.increment(1, [req.params.type]);
    requestsFormatMetric.increment(1, [req.params.format || 'default']);

    const queueItem = buildQueueItem(req, app.logger);

    if (app.queue.isQueueFull()) {
        handleError(new errors.QueueFull(), title, res, app.logger);
        app.logger.log(
            'warn/queue',
            {
                msg: 'Queue is full, rejecting the request.',
                id: queueItem.jobId,
                waitingCount: app.queue.countJobsWaiting(),
                inProgressCount: app.queue.countJobsInProcessing()
            }
        );
        queueEventMetric.increment(1, ['full']);
        return BBPromise.resolve();
    }

    const promise = app.queue.push(queueItem);
    req.on('close', () => {
        app.logger.log(
            'debug/request',
            {
                msg: `Connection closed by the client. `,
                id: queueItem.jobId
            }

        );
        promise.cancel();
    });
    return promise.then((pdfDetails) => {
        if (!pdfDetails.buffer) {
            throw new errors.PuppeteerMalformedResponseError();
        }
        const headers = {
            'content-type': 'application/pdf',
            'content-disposition': sUtil.getContentDisposition(title),
            'content-length': pdfDetails.buffer.length,
            'last-modified': pdfDetails.lastModified
        };
        pdfSizeMetric.set(pdfDetails.buffer.length);
        res.writeHead(200, headers);
        res.end(pdfDetails.buffer, 'binary');
    }).catch((error) => {
        if (error instanceof errors.NavigationError) {
            // NavigationErrors from renderer will not have jobId nor params, inject those
            error = new errors.NavigationError(
                error.httpCode,
                error.message,
                queueItem.jobId,
                req.params
            );
        }
        handleError(error, title, res, app.logger);
    });
});

module.exports = function(appObj) {
    app = appObj;

    const conf = app.conf;
    app.queue = new Queue(
        {
            concurrency: conf.render_concurrency || 1,
            queueTimeout: (conf.render_queue_timeout || 60) * 1000,
            executionTimeout: (conf.render_execution_timeout || 90) * 1000,
            maxTaskCount: conf.max_render_queue_size || 3
        }
    );
    bindQueueLoggerAndMetrics(app.queue, app.logger, app.metrics);
    // the returned object mounts the routes on
    // /{domain}/vX/mount/path
    return {
        path: '/pdf',
        api_version: 1,      // must be a number!
        router
    };

};
