'use strict';

const { QueueItem } = require('../../lib/queueItem');
const assert = require('../utils/assert.js');
const BBPromise = require('bluebird');

describe('Queue', function() {
    this.timeout(5000);

    it('queue and process times are stored correctly', (done) => {
        const queueItem = new QueueItem({});
        queueItem.notifyQueueAdd(10);
        queueItem.notifyQueueStart(42);
        assert.ok(queueItem.addedToTheQueueAt === 10);
        assert.ok(queueItem.processStartedAt === 42);
        done();
    });

    it('fetches the ID from data', (done) => {
        const queueItem = new QueueItem({ id: 'test' });
        assert.ok(queueItem.jobId === 'test');
        done();
    });

    it('on cancel calls renderer to abort render', (done) => {
        let cancelled = false;
        const queueItem = new QueueItem({
            renderer: {
                abortRender: () => {
                    return new BBPromise((resolve) => {
                        cancelled = true;
                        resolve();
                    });
                }
            }
        });
        queueItem.cancel().then(() => {
            assert.ok(cancelled === true, 'QueueItem has to call the abortRender');
            done();
        });
    });
});
