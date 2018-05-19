'use strict';

const assert = require('../utils/assert.js');
const { callbackErrors, Queue } = require('../../lib/queue');
const logger = { log: () => {} };
const renderer = { abortRender: () => {} };
const puppeteerFlags = [
    '--no-sandbox',
    '--disable-setuid-sandbox'
];
const metrics = {
    increment: () => {},
    timing: () => {},
    gauge: () => {}
};

const pdfOptions = {
    scale: 1,
    displayHeaderFooter: false,
    printBackground: false,
    landscape: false,
    pageRanges: '',
    format: 'Letter',
    margin: {
        top: '0.5in',
        right: '0.5in',
        // some room for page numbers
        bottom: '0.75in',
        left: '0.5in'
    }
};

describe('Queue', function() {
    this.timeout(5000);

    it('should run only one worker at a time', function(done) {
        let status;
        let testsCompleted = 0;

        class QueueTest extends Queue {
            _worker(data, callback) {
                this._clearCancelTaskTimeout(data);
                status = `done ${data.id}`;
                // simulate render
                setTimeout(() => {
                    callback();
                }, data.timeout);
            }
        }
        const q = new QueueTest({
            concurrency: 1,
            queueTimeout: 90,
            executionTimeout: 90,
            maxTaskCount: 3,
            healthLoggingInterval: 300
        }, puppeteerFlags, pdfOptions, logger, metrics);

        // first worker must finish after 1 sec
        q.push({
            id: 1,
            renderer,
            timeout: 1000
        }, () => {
            assert.ok(status === 'done 1');
            testsCompleted += 1;
        });

        // second worker must finish 0.5 sec after the first one
        q.push({
            id: 2,
            renderer,
            timeout: 500
        }, () => {
            assert.ok(status === 'done 2');
            testsCompleted += 1;
        });

        // the last worker must finish last, regardless of the timeout
        q.push({
            id: 3,
            renderer,
            timeout: 10
        }, () => {
            assert.ok(testsCompleted === 2);
            assert.ok(status === 'done 3');
            done();
        });
    });

    it('should reject tasks over the task count limit', function(done) {
        let testsCompleted = 0;

        class QueueTest extends Queue {
            _worker(data, callback) {
                this._clearCancelTaskTimeout(data);
                setTimeout(() => {
                    callback(null, {});
                }, data.timeout);
            }
        }
        const q = new QueueTest({
            concurrency: 1,
            queueTimeout: 5,
            executionTimeout: 90,
            maxTaskCount: 1,
            healthLoggingInterval: 300
        }, puppeteerFlags, pdfOptions, logger, metrics);

        // first worker completes in 3 seconds
        q.push({
            id: 1,
            renderer,
            timeout: 3000
        }, (error, data) => {
            assert.ok(error === null);
            testsCompleted += 1;
        });

        // The following request should be rejected immediately
        // even though it's allowed to wait 5 seconds.
        q.push({
            id: 2,
            renderer,
            timeout: 0
        }, (error, data) => {
            assert.ok(testsCompleted === 0);
            assert.ok(error === callbackErrors.queueFull);
            done();
        });
    });


    it('should reject timed out tasks', function(done) {
        let tasksCompleted = 0;
        let tasksRejected = 0;

        class QueueTest extends Queue {
            _worker(data, callback) {
                this._clearCancelTaskTimeout(data);
                // simulate render
                setTimeout(() => {
                    callback(null, {});
                }, data.timeout);
            }
        }
        const q = new QueueTest({
            concurrency: 1,
            queueTimeout: 1,
            executionTimeout: 90,
            maxTaskCount: 3,
            healthLoggingInterval: 300
        }, puppeteerFlags, pdfOptions, logger, metrics);

        // first worker completes in 3 seconds
        q.push({
            id: 1,
            renderer,
            timeout: 3000
        }, (error, data) => {
            assert.ok(error === null);
            tasksCompleted += 1;
        });

        // the following two requests should be rejected
        q.push({
            id: 2,
            renderer,
            timeout: 10
        }, (error, data) => {
            assert.ok(tasksCompleted === 0);
            assert.ok(error === callbackErrors.queueBusy);
            tasksRejected += 1;
        });
        q.push({
            id: 3,
            renderer,
            timeout: 20
        }, (error, data) => {
            assert.ok(tasksCompleted === 0);
            assert.ok(tasksRejected === 1);
            assert.ok(error === callbackErrors.queueBusy);
            done();
        });
    });

    it('should reject tasks when render takes long', function(done) {
        class QueueTest extends Queue {
            _render(data, callback) {
                // simulate render
                setTimeout(() => {
                    callback(null, {});
                }, data.timeout);
            }
        }
        const q = new QueueTest({
            concurrency: 10,
            queueTimeout: 30,
            executionTimeout: 1,
            maxTaskCount: 10,
            healthLoggingInterval: 300
        }, puppeteerFlags, pdfOptions, logger, metrics);

        q.push({
            id: 1,
            renderer,
            timeout: 3000
        }, (error, data) => {
            assert.ok(error === callbackErrors.renderTimeout,
                'Render took more than a second.');
            done();
        });
    });

    it('should remove task from queue when task is aborted', function(done) {
        class QueueTest extends Queue {
            _render(data, callback) {
                // simulate render
                setTimeout(() => {
                    callback(null, {});
                }, data.timeout);
            }
        }
        const q = new QueueTest({
            concurrency: 1,
            queueTimeout: 30,
            executionTimeout: 10,
            maxTaskCount: 10,
            healthLoggingInterval: 300
        }, puppeteerFlags, pdfOptions, logger, metrics);

        q.push({
            id: 1,
            renderer,
            timeout: 1000
        }, (error, data) => {
            assert.ok(error === null,
                'Render finished.');
            assert.ok(q._countJobsInQueue() === 0,
                'Queue is empty.');
            done();
        });
        const data = {
            id: 2,
            renderer,
            timeout: 500
        };

        q.push(data, (error, data) => {
            assert(false, 'Callback should never be called as the job has ' +
                   'been removed from the queue.');
        });
        q.abort(data);
    });

    it('should abort render when task is aborted', function(done) {
        class QueueTest extends Queue {
            _render(data, callback) {
                // simulate render
                setTimeout(() => {
                    callback(null, {});
                }, data.timeout);
            }
        }
        const q = new QueueTest({
            concurrency: 1,
            queueTimeout: 30,
            executionTimeout: 10,
            maxTaskCount: 10,
            healthLoggingInterval: 300
        }, puppeteerFlags, pdfOptions, logger, metrics);
        const renderer = {
            abortRender: () => {
                assert.ok(true, 'Renderer abort is called.');
                done();
            }
        };
        const data = {
            id: 1,
            renderer,
            timeout: 5000
        };

        q.push(data, (error, data) => {});

        // wait a little for the task to start
        setTimeout(() => {
            q.abort(data);
        }, 20);
    });
});
