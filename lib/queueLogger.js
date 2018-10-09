'use strict';

const errors = require('./errors');

/**
 * A helper method to bind logger and metrics to queue actions
 * @param {Queue} queue
 * @param {Object} logger
 * @param {Object} metrics
 */
function bindQueueLoggerAndMetrics(queue, logger, metrics) {
    queue.on('queue.new', ({ id, waitingCount, inProgressCount }) => {
        metrics.increment('queue.new');
        metrics.gauge('queue.jobs_count', waitingCount);
        logger.log(
            'debug/queue',
            {
                msg: 'New task is being added to the queue.',
                id,
                inProgressCount,
                waitingCount,
            }
        );
    })
        .on('queue.full', ({ id, waitingCount, inProgressCount }) => {
            logger.log(
                'warn/queue',
                {
                    msg: 'Queue is full, rejecting the request.',
                    id,
                    waitingCount,
                    inProgressCount
                }
            );
            metrics.increment('queue.full');
        })
        .on('queue.timeout', ({ id, addedToTheQueueAt }) => {
            logger.log(
                'warn/queue',
                {
                    msg: 'Queue is still busy.',
                    id,
                    waitTime: Date.now() - addedToTheQueueAt
                }
            );
            metrics.increment('queue.timeout');
        })
        .on('queue.abort', ({ id, addedToTheQueueAt }) => {
            logger.log(
                'debug/queue',
                {
                    msg: 'Removing task from the queue.',
                    id,
                    waitTime: Date.now() - addedToTheQueueAt
                }
            );
            metrics.increment('queue.abort.count');
            metrics.endTiming('queue.abort.time', addedToTheQueueAt);
        })
        .on('process.started', ({ id, addedToTheQueueAt }) => {
            logger.log(
                'debug/queue',
                {
                    msg: 'Starting to render a task.',
                    id,
                    waitTime: Date.now() - addedToTheQueueAt
                }
            );
            metrics.endTiming('job.wait_time', addedToTheQueueAt);
            metrics.increment('job.started');

        })
        .on('process.success', ({ id, processStartedAt }) => {
            logger.log(
                'debug/queue',
                {
                    msg: 'Render succeeded.',
                    id,
                    renderTime: Date.now() - processStartedAt
                }
            );
            metrics.increment('job.successful');
            metrics.endTiming('job.render_time', processStartedAt);
        })
        .on('process.failure', ({ id, err, startedProcessingAt }) => {
            if (err instanceof errors.ProcessingCancelled) {
                // skip cancelled job errors, we don't need to log those
                return;
            }
            // we don't have to log the errors here as handleError is going to catch all errors
            // both the queue/restbase/and everything else. Logging here would leave into
            // duplicat eerror messages.
            logger.log(
                'warning/render',
                {
                    msg: 'Aborting render because of render failure.',
                    id,
                    renderTime: Date.now() - startedProcessingAt
                }
            );
            metrics.increment('job.failed');
        })
        .on('process.abort', ({ id, addedToTheQueueAt }) => {
            logger.log(
                'debug/render',
                {
                    msg: 'Aborting render.',
                    id,
                    renderTime: Date.now() - addedToTheQueueAt
                }
            );
            metrics.increment('job.abort.count');
            metrics.endTiming('job.abort.time', addedToTheQueueAt);
        })
        .on('process.timeout', (id, processStartedAt) => {
            logger.log(
                'error/render',
                {
                    msg: 'Timeout. Render has not finished in time',
                    id,
                    processStartedAt
                }
            );
            // do not track timings as jobs always end up this._options.executionTimeout
            metrics.increment('job.timeout');
        });
}

module.exports = {
    bindQueueLoggerAndMetrics
};

