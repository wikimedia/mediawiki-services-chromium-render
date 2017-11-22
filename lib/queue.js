'use strict';

const asyncQueue = require('async/queue');
const asyncTimeout = require('async/timeout');

// Errors used as the first argument of the callback passed to the queue
const callbackErrors = {
    // the queue is busy even after waiting a certain amount of time
    queueBusy: 0,
    // something went wrong in the render phase
    renderFailed: 1,
    // the queue is already full, not waiting for it to have room
    queueFull: 2,
    // when the render takes longer than allowed
    renderTimeout: 3
};

/**
 * Wrapper around `async/queue`
 * The class only exposes what's needed and takes care of rejecting
 * requests upon timeout.
 */
class Queue {
    /**
     * @param {Object} queueOptions
     * @param {number} queueOptions.concurrency number of concurrent
     * render instances
     * @param {number} queueOptions.queueTimeout number of seconds after
     * which the yet-to-start renders are aborted
     * @param {number} queueOptions.executionTimeout number of seconds after
     * which puppeteer is asked to abort the render
     * @param {number} queueOptions.maxTaskCount number of tasks the queue
     * should hold. New tasks will be rejected once the sum of the
     * number of running tasks and the tasks in the queue is equal to
     * this number.
     * @param {Object} puppeteerOptions options used to in starting puppeteer
     * @param {Object} pdfOptions pdf options passed to Chromium
     * @param {Object} logger app logger
     */
    constructor(queueOptions, puppeteerOptions, pdfOptions, logger) {
        this._queueObject = asyncQueue(this._worker.bind(this),
                                       queueOptions.concurrency);
        this._puppeteerOptions = puppeteerOptions;
        this._pdfOptions = pdfOptions;
        this._options = queueOptions;
        this._logger = logger;
    }

    /**
     * Return number of waiting/in progress jobs
     * @return {number}
     */
    _countJobsInQueue() {
        const queue = this._queueObject;
        return queue.length() + queue.running();
    }
    /**
     * Whether the queue full
     * @return {boolean} whether the number of running and waiting tasks
     * is equal to a predefined maximum task count
     */
    _isQueueFull() {
        return this._countJobsInQueue() === this._options.maxTaskCount;
    }

    /**
     * Sets a timeout to cancel the task
     * `_timeoutID` is attached to `data` so that it can be cleared if
     * the task starts within a predefined time (see `_clearTimeout`).
     * When the task is removed from the queue after the time is up
     * `callback` is called with an error.
     * @param {Object} data that the worker needs
     * @param {Function} callback called with `callbackErrors.queueBusy`
     * as its first argument when the time is up.
     */
    _setCancelTaskTimeout(data, callback) {
        const logger = this._logger;
        const queue = this._queueObject;
        const timeout = this._options.queueTimeout;

        data._timeoutID = setTimeout(() => {
            queue.remove((worker) => {
                if (worker.data.id === data.id) {
                    logger.log(
                        'warn/queue',
                        `Queue is still busy after waiting ` +
                            `for ${timeout} secs. Data ID: ${data.id}.`
                    );
                    callback(callbackErrors.queueBusy, null);
                    return true;
                }
                return false;
            });
        }, timeout * 1000);
    }

    /**
     * Clears timeout associated with data that was set using `_setTimeout`
     * @param {Object} data that has a `_timeoutID` property
     */
    _clearCancelTaskTimeout(data) {
        clearTimeout(data._timeoutID);
    }

    /**
     * Pushes `data` to the queue if the queue has room
     * @param {Object} data that the worker needs
     * @param {Function} callback called when the worker finishes. The
     * first argument to callback will be one of the error codes from
     * `callbackErrors` or `null` if there's no error. The second
     * argument will be a promise that resolves with a PDF buffer. In case of
     * error, the second argument will be `null`.
     */
    push(data, callback) {
        // return immediately if the queue is full
        if (this._isQueueFull()) {
            this._logger.log(
                'warn/queue',
                `Queue is full, rejecting the request. Data URI: ${data.uri}.`
            );
            callback(callbackErrors.queueFull, null);
            return;
        }

        // make sure to cancel the task if it doesn't start within a timeframe
        this._setCancelTaskTimeout(data, callback);
        const queueSize = this._countJobsInQueue();
        this._logger.log(
            'debug/queue', `Job ${data.id} added to the queue. Jobs waiting: ${queueSize}`
        );
        this._queueObject.push(data, callback);
    }

    /**
     * Worker that renders a PDF
     * The timeout associated with `data` will be cleared before the
     * render starts. In case of failure during the render phase, the
     * callback is called with `callbackErrors.renderFailed` as its
     * first argument.
     * @param {Object} data that the worker needs
     * @param {Function} callback called when the worker finishes
     */
    _worker(data, callback) {
        this._clearCancelTaskTimeout(data);
        this._logger.log('info/queue', `Started rendering ${data.id}`);

        const timeout = this._options.executionTimeout;
        const timedRender = asyncTimeout(this._render.bind(this),
                                         timeout * 1000);
        timedRender(data, (error, pdf) => {
            // error returned by async timeout
            if (error && error.code === 'ETIMEDOUT') {
                this._logger.log(
                    'error/render',
                    `Aborting. Render hasn't finished within ${timeout} ` +
                        `seconds. Data ID: ${data.id}.`
                );
                data.renderer.abortRender();
                callback(callbackErrors.renderTimeout, null);
            } else {
                callback(error, pdf);
            }
        });
    }

    /**
     * Render a PDF
     * @param {Object} data used for rendering
     * @param {Function} callback called on render success/failure
     */
    _render(data, callback) {
        data.renderer
            .articleToPdf(data.uri, data.format, this._puppeteerOptions,
                          this._pdfOptions)
            .then((pdf) => {
                this._logger.log(
                    'debug/queue', `Job ${data.id} rendered successfully`
                );
                callback(null, pdf);
            })
            .catch((error) => {
                this._logger.log('error/render', {
                    msg: `Data ID: ${data.id} to PDF. ${error.toString()}`,
                    error
                });
                callback(callbackErrors.renderFailed, null);
            });
    }

    /**
     * Abort task identified by `id`
     * @param {string} id ID initially passed as part of data
     * @param {Renderer} renderer instance of Renderer
     */
    abort(id, renderer) {
        let taskStarted = true;

        // has the task started already?
        this._queueObject.remove((worker) => {
            if (worker.data.id === id) {
                this._logger.log(
                    'debug/queue',
                    `Removing task from the queue. Data ID: ${id}.`
                );
                taskStarted = false;
                return true;
            }
            return false;
        });

        if (taskStarted) {
            this._logger.log(
                'debug/render',
                `Aborting render. Data ID: ${id}.`
            );
            renderer.abortRender();
        }
    }
}

module.exports = {
    callbackErrors,
    Queue
};
