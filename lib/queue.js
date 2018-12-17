'use strict';

const BBPromise = require('bluebird');
const errors = require('./errors');
const EventEmitter = require('events');

/**
 * @typedef {Object} PromisifiedQueueItem
 * @prop {QueueItem} job Queued job to execute
 * @prop {Function} resolve Function to call when job is resolved
 * @prop {Function} reject Function to call when job is rejected/failed
 */
/**
 * Queue object
 */
class Queue extends EventEmitter {
    /**
     * @param {Object} queueOptions
     * @param {number} queueOptions.concurrency number of concurrent
     * render instances
     * @param {number} queueOptions.queueTimeout number of milliseconds after
     * which the yet-to-start renders are aborted
     * @param {number} queueOptions.executionTimeout number of milliseconds after
     * which puppeteer is asked to abort the render
     * @param {number} queueOptions.maxTaskCount number of tasks the queue
     * should hold. New tasks will be rejected once the sum of the
     * number of running tasks and the tasks in the queue is equal to
     * this number.
     */
    constructor(queueOptions) {
        super();
        /**
         * Keeps the track of current queue, each job has defined resolve, reject and data.
         * @type {Array<PromisifiedQueueItem>}
         * @private
         */
        this._waitingJobs = [];
        /**
         * Keeps the track of jobs in progress, each job has defined resolve, reject and data
         * @type {Array<PromisifiedQueueItem>}
         * @private
         */
        this._inProgressJobs = [];

        /**
         * Keeps the track of all setTimeout handlers
         * @type {Map}
         * @private
         */
        this._timeouts = new Map();
        this._options = queueOptions;

        /**
         * A lock to mark queue processing in progress.
         * @type {boolean}
         * @private
         */
        this._processing = false;
    }

    /**
     * Returns the number of waiting and in progress jobs
     * @return {number}
     */
    countJobsInQueue() {
        return this._waitingJobs.length + this._inProgressJobs.length;
    }

    /**
     * Return the number of waiting jobs
     * @return {number} the number of waiting jobs
     */
    countJobsWaiting() {
        return this._waitingJobs.length;
    }
    /**
     * Return the number of in progress jobs
     * @return {number}
     */
    countJobsInProcessing() {
        return this._inProgressJobs.length;
    }

    /**
     * Whether the queue is full
     * @return {boolean} whether the number of waiting tasks
     * is equal to a predefined maximum task count
     */
    isQueueFull() {
        return this.countJobsInQueue() >= this._options.maxTaskCount;
    }

    /**
     * Helper method to clear the timeout and remove it from
     * timeouts Map
     */
    _clearTimeout(id) {
        if (this._timeouts.has(id)) {
            clearTimeout(this._timeouts.get(id));
            this._timeouts.delete(id);
        }
    }
    /**
     * SetUp timeout listener, When `options.queueTimeout` passes, and
     * job is still waiting in the queue, reject it.
     * @private
     * @param {QueueItem} job
     * @param {Function} reject Function to reject the promise
     */
    _setUpQueueTimeout(job, reject) {
        this._timeouts.set(job.jobId, setTimeout(() => {
            this._clearTimeout(job.jobId);
            this.emit('queue.timeout', {
                id: job.jobId,
                addedToTheQueueAt: job.addedToTheQueueAt
            });
            reject(new errors.QueueTimeout());
        }, this._options.queueTimeout));
    }

    /**
     * Cleanup the queue after job
     * @param {QueueItem} job
     * @private
     */
    _cleanup(job) {
        this._clearTimeout(job.jobId);
        if (job.processStartedAt) {
            this._removeJobFromInProcessState(job);
        } else {
            this._removeJobFromInQueueState(job);
        }
    }
    /**
     * Adds new QueueItem to the queue
     *
     * TODO: Most probably we can pass the promiseBuilder (function that
     * returns a promise) and create the QueueItem by ourselves
     * @param {QueueItem} job new job
     * @return {Promise}
     */
    push(job) {
        return new BBPromise((resolve, reject, onCancel) => {
            if (this.isQueueFull()) {
                this.emit('queue.full', {
                    id: job.jobId,
                    waitingCount: this._waitingJobs.length,
                    inProgressCount: this._inProgressJobs.length
                });
                return reject(new errors.QueueFull());
            }
            job.notifyQueueAdd(Date.now());
            this._setUpQueueTimeout(job, reject);
            this._waitingJobs.push({
                job,
                reject,
                resolve
            });
            this.emit('queue.new', {
                id: job.jobId,
                inProgressCount: this._inProgressJobs.length,
                waitingCount: this._waitingJobs.length
            });
            this._processQueue();
            onCancel(() => {
                this._clearTimeout(job.jobId);
                const found = this._tryToCancelWaitingJob(job, reject);
                if (!found) {
                    // task is not in the waitingJobs,
                    this._tryToCancelInProgressJob(job, reject);
                }
            });
        })
        .finally(() => {
            this._cleanup(job);
            this._processQueue();
        });
    }

    /**
     * Helper method to find and remove job
     * @param {QueueItem} job Job to remove
     * @param {Function} reject Reject method to call when waiting job is found
     * @return {boolean} Returns true when job is found
     * @private
     */
    _tryToCancelWaitingJob(job, reject) {
        let removed = false;
        this._waitingJobs = this._waitingJobs.filter((waiting) => {
            if (job.jobId === waiting.job.jobId) {
                removed = true;
                this._removeJobFromInQueueState(job);
                this._cancelJob(job, 'queue', reject);
                return false;
            }
            return true;
        });
        return removed;
    }

    /**
     * Helper method to find and remove job
     * @param {QueueItem} job Job to remove
     * @param {Function} reject Reject method to call when waiting job is found
     * @private
     */
    _tryToCancelInProgressJob(job, reject) {
        this._inProgressJobs = this._inProgressJobs.filter((inProgress) => {
            if (job.jobId === inProgress.job.jobId) {
                this._removeJobFromInProcessState(job);
                this._cancelJob(job, 'process', reject);
                return false;
            }
            return true;
        });
    }

    /**
     * Helper method to cancel job
     * @param {QueueItem} job
     * @param {string} state
     * @param {Function} reject
     * @private
     */
    _cancelJob(job, state, reject) {
        job.cancel().then(() => {
            this.emit(`${state}.abort`, {
                id: job.jobId,
                addedToTheQueueAt: job.addedToTheQueueAt
            });
            reject(new errors.ProcessingCancelled());
        });
    }

    /**
     * Helper method to register the process timeout
     * @param {QueueItem} job
     * @param {Function} reject
     * @private
     */
    _registerProcessTimeout(job, reject) {
        this._timeouts.set(job.jobId, setTimeout(() => {
            this._clearTimeout(job.jobId);
            this.emit('process.timeout');
            job.cancel().then(() => {
                this._removeJobFromInProcessState(job);
                reject(new errors.JobTimeout());
            });
        }, this._options.executionTimeout));
    }
    /**
     * Try to take next element from the queue and process it
     * @private
     */
    _processQueue() {
        if (this._inProgressJobs.length >= this._options.concurrency) {
            return;
        }
        if (this._waitingJobs.length === 0) {
            return;
        }
        if (this._processing) {
            return;
        }
        this._processing = true;
        const { job, reject, resolve } = this._waitingJobs.shift();
        this._clearTimeout(job.jobId);
        this._inProgressJobs.push({ job, reject, resolve });
        this._registerProcessTimeout(job, reject);
        try {
            job.notifyQueueStart(Date.now());
            this.emit('process.started', {
                id: job.jobId,
                addedToTheQueueAt: job.addedToTheQueueAt
            });
            this._processJob(job, resolve, reject);
        } catch (err) {
            this.emit('process.failure', {
                id: job.jobId,
                addedToTheQueueAt: job.addedToTheQueueAt,
                err
            });
            reject(err);
            this._removeJobFromInProcessState(job);
        }
        this._processing = false;
    }

    /**
     * Helper method to remove the job from inProcess queue
     * @param {QueueItem} job
     * @private
     */
    _removeJobFromInProcessState(job) {
        this._inProgressJobs = this._removeJobFromArray(job, this._inProgressJobs);
    }

    /**
     * Helper method to remove the job from waiting queue
     * @param {QueueItem} job
     * @private
     */
    _removeJobFromInQueueState(job) {
        this._waitingJobs = this._removeJobFromArray(job, this._waitingJobs);
        /**
        this._waitingJobs.filter((waiting) => {
            return waiting.job.jobId !== job.jobId;
        });
         */
    }

    /**
     * Helper method that removes a job from list of jobs
     * @param {QueueItem} search
     * @param {Array<PromisifiedQueueItem>} list list of jobs
     * @private
     */
    _removeJobFromArray(search, list) {
        return list.filter(({ job }) =>  job.jobId !== search.jobId);
    }

    /**
     * Single job handler, called when Queue can process job
     * @param {QueueItem} job
     * @param {Function} resolve
     * @param {Function} reject
     * @private
     */
    _processJob(job, resolve, reject) {
        job.process()
            .then((result) => {
                this.emit('process.success', {
                    id: job.jobId,
                    addedToTheQueueAt: job.addedToTheQueueAt,
                    processStartedAt: job.processStartedAt
                });
                resolve(result);
            }, (err) => {
                this.emit('process.failure', {
                    id: job.jobId,
                    addedToTheQueueAt: job.addedToTheQueueAt,
                    processStartedAt: job.processStartedAt,
                    err
                });
                reject(err);
            })
            .finally(() => {
                this._clearTimeout(job.jobId);
                this._removeJobFromInProcessState(job);
            });
    }
}

module.exports = {
    Queue
};
