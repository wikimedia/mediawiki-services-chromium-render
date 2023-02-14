'use strict';

const errors = require('./errors');

/**
 * A helper method to bind logger and metrics to queue actions
 * @param {Queue} queue
 * @param {Object} logger
 * @param {Object} metrics
 */
function bindQueueLoggerAndMetrics(queue, logger, metrics) {
    const queueEventMetric = metrics.makeMetric({
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
    const queueDurationMetric = metrics.makeMetric({
        type: 'Histogram',
        name: 'queue.duration',
        prometheus: {
            name: 'proton_queue_duration_seconds',
            help: 'queue event duration',
            buckets: [0.1, 0.5, 1, 5, 10, 30, 60]
        },
        labels: {
            names: ['type'],
            omitLabelNames: true
        }
    });
    const jobEventMetric = metrics.makeMetric({
        type: 'Counter',
        name: 'job.events',
        prometheus: {
            name: 'proton_job_events_total',
            help: 'job events'
        },
        labels: {
            names: ['type'],
            omitLabelNames: true
        }
    });
    const jobDurationMetric = metrics.makeMetric({
        type: 'Histogram',
        name: 'job.duration',
        prometheus: {
            name: 'proton_job_duration_seconds',
            help: 'job event duration',
            buckets: [0.1, 0.5, 1, 5, 10, 30, 60]
        },
        labels: {
            names: ['type'],
            omitLabelNames: true
        }
    });

    queue.on('queue.new', ({ id, waitingCount, inProgressCount }) => {
        queueEventMetric.increment(1, ['new']);
        metrics.makeMetric({
            type: 'Gauge',
            name: 'queue.jobs_count',
            prometheus: {
                name: 'proton_queue_depth',
                help: 'queue depth'
            }
        }).gauge(waitingCount);
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
            queueEventMetric.increment(1, ['full']);
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
            queueEventMetric.increment(1, ['timeout']);
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
            queueEventMetric.increment(1, ['abort']);
            queueDurationMetric.observe(Date.now() - addedToTheQueueAt, ['abort']);
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
            jobEventMetric.increment(1, ['started']);
            jobDurationMetric.observe(Date.now() - addedToTheQueueAt, ['wait']);
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
            jobEventMetric.increment(1, ['successful']);
            jobDurationMetric.observe(Date.now() - processStartedAt, ['render']);
        })
        .on('process.failure', ({ id, err, startedProcessingAt }) => {
            if (err instanceof errors.ProcessingCancelled) {
                // skip cancelled job errors, we don't need to log those
                return;
            }
            // we don't have to log the errors here as handleError is going to catch all errors
            // both the queue and everything else. Logging here would leave into
            // duplicate error messages.
            logger.log(
                'warning/render',
                {
                    msg: 'Aborting render because of render failure.',
                    id,
                    renderTime: Date.now() - startedProcessingAt
                }
            );
            jobEventMetric.increment(1, ['failed']);
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
            jobEventMetric.increment(1, ['abort']);
            jobDurationMetric.observe(Date.now() - addedToTheQueueAt, ['abort']);
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
            jobEventMetric.increment(1, ['timeout']);
        });
}

module.exports = {
    bindQueueLoggerAndMetrics
};

