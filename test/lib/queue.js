'use strict';

const assert = require('../utils/assert.js');
const Queue = require('../../lib/queue');

describe('concurrency', function() {
    this.timeout(5000);

    it('should run only one worker at a time', function(done) {
        let status,
            testsCompleted = 0;

        const worker = (data, callback) => {
            status = `done ${data.id}`;
            setTimeout(() => {
                callback();
            }, data.timeout);
        };
        const q = new Queue(worker, 1);

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
});
