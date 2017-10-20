'use strict';

const asyncQueue = require('async/queue');


module.exports = class Queue {
    /**
      * @param {Function} worker
      * @param {number} concurrency
      */
    constructor(worker, concurrency) {
        this._queueObject = asyncQueue(worker, concurrency);
    }

    /**
      * Push data to the queue
      * @param {Object} data that the worker needs
      * @param {Function} callback called when the worker finishes
      */
    push(data, callback) {
        this._queueObject.push(data, callback);
    }
};
