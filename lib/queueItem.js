'use strict';

/**
 * Queue job. This class represents a single job handled by queue.
 *
 * process() -> called when job started processing, has to return promise
 * cancel() -> called when job is cancelled/aborted
 */
class QueueItem {

    /**
     * Creates a new job instance
     */
    constructor(data) {
        /**
         * Time when task was added to the queue
         * @type {int}
         * @private
         */
        this._addedToTheQueueAt = null;
        /**
         * Time int task started processing
         * @type {null}
         * @private
         */
        this._startedProcessingAt = null;
        /**
         * Job data, will be a promise builder in the future
         */
        this._data = data;

    }

    get jobId() {
        return this._data.id;
    }

    get addedToTheQueueAt() {
        return this._addedToTheQueueAt;
    }

    get processStartedAt() {
        return this._startedProcessingAt;
    }

    /**
     * Mark item as added to the queue
     * @param {Integer} startedAt
     */
    notifyQueueAdd(startedAt) {
        this._addedToTheQueueAt = startedAt;
    }

    /**
     * Mark item as started processing
     * @param {Integer} startedAt
     */
    notifyQueueStart(startedAt) {
        this._startedProcessingAt = startedAt;
    }

    /**
     * Cancel the job
     * Note: Cancelling the job has to call one of resolve/reject
     */
    cancel() {
        return this._data.renderer.abortRender();
    }

    /**
     * Render a PDF
     *
     * This is a separate function for now as I'm thinking about pulling that logic into some
     * promise generator. I want to keep that function as clean as possible, without any
     * side effects.
     * @return {Promise<Object>}
     */
    process() {
        return this._data.renderer.articleToPdf(
            this._data.uri,
            this._data.format,
            this._data.headers
        );
    }
}


module.exports = {
    QueueItem
};
