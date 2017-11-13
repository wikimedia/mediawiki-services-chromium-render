'use strict';

const asyncQueue = require('async/queue');
const renderer = require('./renderer');
const uuid = require('cassandra-uuid');
const EventEmitter = require('events');

// Errors used as the first argument of the callback passed to the queue
const callbackErrors = {
    queueBusy: 0,
    renderFailed: 1
};

/**
 * Wrapper around `async/queue`
 * The class only exposes what's needed and takes care of rejecting
 * requests upon timeout.
 */
class Queue extends EventEmitter {
    /**
      * @param {number} concurrency number of concurrent render instances
      * @param {number} timeout number of seconds after which the
      *   yet-to-start renders are aborted
      * @param {Object} puppeteerFlags flags used to in starting puppeteer
      * @param {Object} pdfOptions pdf options passed to Chromium
      * @param {Object} logger app logger
      */
    constructor(concurrency, timeout, puppeteerFlags, pdfOptions, logger) {
        super();
        this._queueObject = asyncQueue(this._worker.bind(this), concurrency);
        this._puppeteerFlags = puppeteerFlags;
        this._pdfOptions = pdfOptions;
        this._timeout = timeout;
        this._logger = logger;
        this.on('onBeforePush', this._onBeforePush);
        this.on('onBeforeRender', this._onBeforeRender);
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
    _onBeforePush(data, callback) {
        const that = this;
        data._id = `${uuid.TimeUuid.now().toString()}|${data.uri}`;
        data._timeoutID = setTimeout(() => {
            that._queueObject.remove((worker) => {
                if (worker.data._id === data._id) {
                    that._logger.log('warn/queue', {
                        msg: `Queue is still busy after waiting ` +
                            `for ${that._timeout} secs. Data ID: ${data._id}.`
                    });
                    callback(callbackErrors.queueBusy, null);
                    return true;
                }
                return false;
            });
        }, this._timeout * 1000);
    }

    /**
      * Clears timeout associated with data that was set using `_setTimeout`
      * @param {Object} data that has a `_timeoutID` property
      */
    _onBeforeRender(data) {
        clearTimeout(data._timeoutID);
    }

    /**
      * Pushes `data` to the queue
      * If the task doesn't start after a predefined time, it will be aborted.
      * @param {Object} data that the worker needs
      * @param {Function} callback called when the worker finishes. The
      * first argument to callback will be one of the error codes from
      * `callbackErrors` or `null` if there's no error. The second
      * argument will be a promise that resolves with a PDF buffer. In case of
      * error, the second argument will be `null`.
      */
    push(data, callback) {
        this.emit('onBeforePush', data, callback);
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
        this.emit('onBeforeRender', data);

        renderer
            .articleToPdf(data.uri, data.format, this._puppeteerFlags,
                          this._pdfOptions)
            .then((pdf) => {
                callback(null, pdf);
            })
            .catch((error) => {
                this._logger.log('error/render', {
                    msg: `Cannot convert page ${data.uri} to PDF.`,
                    error
                });
                callback(callbackErrors.renderFailed, null);
            });
    }
}

module.exports = {
    callbackErrors,
    Queue
};
