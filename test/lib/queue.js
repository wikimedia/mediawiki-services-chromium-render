'use strict';

const assert = require('../utils/assert.js');
const { callbackErrors, Queue } = require('../../lib/queue');
const logger = { log: () => {} };
const puppeteerFlags = [
    '--no-sandbox',
    '--disable-setuid-sandbox'
];
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

describe('concurrency', function() {
    this.timeout(5000);

    it('should run only one worker at a time', function(done) {
        let status,
            testsCompleted = 0;

        class QueueTest extends Queue {
            _worker (data, callback) {
                this.emit('onBeforeRender', data);
                status = `done ${data.id}`;
                // simulate render
                setTimeout(() => {
                    callback();
                }, data.timeout);
            };
        }
        const q = new QueueTest(1, 90, puppeteerFlags, pdfOptions, logger);

        // first worker must finish after 1 sec
        q.push({
            id: 1,
            timeout: 1000
        }, () => {
            assert.ok(status === 'done 1');
            testsCompleted += 1;
        });

        // second worker must finish 0.5 sec after the first one
        q.push({
            id: 2,
            timeout: 500
        }, () => {
            assert.ok(status === 'done 2');
            testsCompleted += 1;
        });

        // the last worker must finish last, regardless of the timeout
        q.push({
            id: 3,
            timeout: 10
        }, () => {
            assert.ok(testsCompleted === 2);
            assert.ok(status === 'done 3');
            done();
        });
    });

    it('should reject timed out tasks', function(done) {
        let tasksCompleted = 0,
            tasksRejected = 0;

        class QueueTest extends Queue {
            _worker (data, callback) {
                this.emit('onBeforeRender', data);
                // simulate render
                setTimeout(() => {
                    callback(null, {});
                }, data.timeout);
            };
        }
        const q = new QueueTest(1, 1, puppeteerFlags, pdfOptions, logger);

        // first worker completes in 3 seconds
        q.push({
            id: 1,
            timeout: 3000
        }, (error, data) => {
            assert.ok(error === null);
            tasksCompleted += 1;
        });

        // the following two requests should be rejected
        q.push({
            id: 2,
            timeout: 10
        }, (error, data) => {
            assert.ok(tasksCompleted === 0);
            assert.ok(error === callbackErrors.queueBusy);
            tasksRejected += 1;
        });
        q.push({
            id: 3,
            timeout: 20
        }, (error, data) => {
            assert.ok(tasksCompleted === 0);
            assert.ok(tasksRejected === 1);
            assert.ok(error === callbackErrors.queueBusy);
            done();
        });
    });
});
