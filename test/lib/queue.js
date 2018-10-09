'use strict';

const assert = require('../utils/assert.js');
const { Queue } = require('../../lib/queue');
const errors = require('../../lib/errors');
const { QueueItem } = require('../../lib/queueItem');
const logger = { log: (level, data) => {} };
const BBPromise = require('bluebird');
const defaultQueueOptions = {
    queueTimeout: 500,
    executionTimeout: 250,
    concurrency: 1,
    maxTaskCount: 1
};

class TestJob extends QueueItem {
    constructor(name, processTime, succesful) {
        super({});
        this.name = name;
        this.time = processTime;
        this.succesful = typeof succesful === 'undefined' ? true : succesful;
    }
    get jobId() {
        return this.name;
    }
    cancel() {
        return BBPromise.resolve();
    }
    process() {
        return new BBPromise((resolve, reject) => {
            setTimeout(() => {
                if (this.succesful) {
                    resolve(this.name);
                } else {
                    reject(this.name);
                }
            }, this.time);
        });
    }
}
class FailedJob extends QueueItem {
    get jobId() {
        return 'failed';
    }
    process() {
        throw new Error('test');
    }
}

const metrics = {
    increment: () => {},
    endTiming: () => {},
    gauge: () => {}
};

describe('Queue', function() {
    this.timeout(1000);

    it('registers and processes task correctly', (done) => {
        const q = new Queue(defaultQueueOptions, logger, metrics);
        assert.ok(q.countJobsInQueue() === 0);
        q.push(new TestJob('one', 10)).then((result) => {
            assert.ok(result === 'one');
        }).finally(() => {
            assert.ok(q.countJobsInQueue() === 0);
            done();

        });
        assert.ok(q.countJobsInQueue() === 1);
    });

    it('rejects new job when queue is busy', (done) => {
        let rejected = false;
        const q = new Queue(defaultQueueOptions, logger, metrics);
        assert.ok(q.isQueueFull() === false);
        q.push(new TestJob('one', 50)).then((result) => {
            assert.ok(result === 'one');
        }).finally(() => {
            assert.ok(q.isQueueFull() === false);
            assert.ok(rejected, 'Task should be rejected');
            done();
        });
        assert.ok(q.isQueueFull() === true);
        q.push(new TestJob('two', 1)).catch((error) => {
            rejected = true;
            assert.ok(error instanceof errors.QueueFull, 'Timeout error has to be passed');
        });
    });

    it('resolves promises in correct order', function(done) {
        const q = new Queue({
            concurrency: 1,
            maxTaskCount: 5,
            queueTimeout: 500,
            executionTimeout: 500
        }, logger, metrics);
        let tests = 0;

        // first worker must finish after 0.25 sec
        q.push(new TestJob('one', 250)).then((result) => {
            assert.ok(result === 'one');
            assert.ok(tests === 0);
            tests++;
        });
        assert.ok(q.countJobsInQueue() === 1);
        assert.ok(q.countJobsInProcessing() === 1);
        // second worker must finish 0.1 sec after the first one
        q.push(new TestJob('two', 100)).then((result) => {
            assert.ok(result === 'two');
            assert.ok(tests === 1);
            tests++;
        });
        assert.ok(q.countJobsInQueue() === 2);
        assert.ok(q.countJobsInProcessing() === 1);
        // the last worker must finish last, regardless of the timeout
        q.push(new TestJob('three', 20)).then((result) => {
            assert.ok(result === 'three');
            assert.ok(tests === 2);
            done();
        });
        assert.ok(q.countJobsInQueue() === 3);
        assert.ok(q.countJobsInProcessing() === 1);
    });


    it('resolves concurrent promises in correct order', function(done) {
        const q = new Queue({
            concurrency: 2,
            maxTaskCount: 5,
            queueTimeout: 500,
            executionTimeout: 500
        }, logger, metrics);
        let finishedTests = 0;

        // first worker must finish after 0.25 sec
        q.push(new TestJob('one', 250)).then((result) => {
            assert.ok(result === 'one', 'Task once returned incorrect result');
            finishedTests++;
        }).finally(() => {
            assert.ok(finishedTests === 3, 'Some tasks failed');
            assert.ok(q.countJobsInQueue() === 0, 'Queue has to be empty now');
            done();
        });
        // job is immediately picked up
        assert.ok(q.countJobsInQueue() === 1);
        assert.ok(q.countJobsInProcessing() === 1);
        // second worker must finish 0.1 sec after adding, first one should be still processing
        q.push(new TestJob('two', 100)).then((result) => {
            assert.ok(result === 'two', 'Task two returned incorrect result');
            assert.ok(finishedTests === 0, 'Task two should finish first');
            finishedTests++;
        }).finally(() => {
            assert.ok(q.countJobsInQueue() === 2, 'Task two wasn\'t correctly removed');
            assert.ok(q.countJobsInProcessing() === 2, 'Task three wasn\'t immediately picked up');
        });
        assert.ok(q.countJobsInQueue() === 2);
        assert.ok(q.countJobsInProcessing() === 2);
        // the last worker must finish before the first one
        q.push(new TestJob('three', 20)).then((result) => {
            assert.ok(result === 'three', 'Task three returned incorrect result');
            assert.ok(finishedTests === 1, 'Task three didn\'t finish second');
            finishedTests++;
        }).finally(() => {
            assert.ok(q.countJobsInQueue() === 1, 'Only first task is remaining');
            assert.ok(q.countJobsInProcessing() === 1, 'Only first task is in progress');
        });
        assert.ok(q.countJobsInQueue() === 3, 'Queue didn\'t accept all three tasks');
        assert.ok(q.countJobsInProcessing() === 2, 'Queue didn\'t start two concurrent jobs');
    });

    it('handles failed promise properly', (done) => {
        let rejected = false;
        let resolved = false;
        const q = new Queue(defaultQueueOptions, logger, metrics);
        q.push(new TestJob('one', 100, false)).then(() => {
            resolved = true;
        }, (rejectMsg) => {
            assert.ok(rejectMsg === 'one', 'Rejection value is incorrect');
            rejected = true;
        }).finally(() => {
            assert.ok(resolved === false, 'Queue resolved the promise');
            assert.ok(rejected, 'Queue didn\'t handle promise rejection properly');
            done();
        });
    });

    it('handles errors in the promise', (done) => {
        let rejected = false;
        let resolved = false;
        const q = new Queue(defaultQueueOptions, logger, metrics);
        q.push(new FailedJob()).then(() => {
            resolved = true;
        }, (err) => {
            assert.ok(err, 'Error is not passed');
            rejected = true;
        }).finally(() => {
            assert.ok(resolved === false, 'Promise was resolved when it shouldn\'t');
            assert.ok(rejected === true, 'Promise wasn\'t rejected when it should');
            done();
        });
    });

    it('catches errors', (done) => {
        let rejected = false;
        let resolved = false;
        const q = new Queue(defaultQueueOptions, logger, metrics);
        q.push(new FailedJob()).then(() => {
            resolved = true;
        }).catch((err) => {
            assert.ok(err, 'Error is not passed');
            rejected = true;
        }).finally(() => {
            assert.ok(resolved === false, 'Promise was resolved when it shouldn\'t');
            assert.ok(rejected === true, 'Error didn\'t get into catch()');
            done();
        });
    });

    it('handles queue timeout', (done) => {
        let gotTimeout = false;
        const q = new Queue({
            queueTimeout: 1,
            executionTimeout: 1000,
            // this is hack, concurrency 0 disables the queue which mean that queue
            // will not pick up jobs
            concurrency: 0,
            maxTaskCount: 1
        }, logger, metrics);
        q.push(new TestJob('queue_timeout', 1)).then(() => {
            assert.ok(false, 'Task didn\'t timeout.');
        }, (err) => {
            gotTimeout = true;
            assert.ok(err instanceof errors.QueueTimeout, 'It should fail with QueueTimeout error');
        }).finally(() => {
            assert.ok(gotTimeout, 'It should fail with error');
            done();
        });
    });

    it('handles job timeout', (done) => {
        let gotTimeout = false;
        const q = new Queue({
            queueTimeout: 50,
            executionTimeout: 100,
            concurrency: 1,
            maxTaskCount: 1
        }, logger, metrics);

        q.push(new TestJob('job_timeout', 1500)).then(() => {
            assert.ok(true, 'This task shouldn\'t succeed');
        }, (err) => {
            gotTimeout = true;
            assert.ok(err instanceof errors.JobTimeout, 'It should fail with JobTimeout error');
        }).finally(() => {
            assert.ok(gotTimeout, 'It should fail with error');
            done();
        });
    });

    it('handles job cancel when in queue state', (done) => {
        let wasCancelled = true;
        let runningJobSuccesful = false;
        let waitingJobSuccesful = false;
        const q = new Queue({
            queueTimeout: 250,
            executionTimeout: 250,
            concurrency: 1,
            maxTaskCount: 5
        }, logger, metrics);

        q.push(new TestJob('running', 50)).then((value) => {
            assert.ok(value === 'running');
            runningJobSuccesful = true;
        });
        q.push(new TestJob('waiting', 50)).then((value) => {
            assert.ok(value === 'waiting');
            waitingJobSuccesful = true;
        }).finally(() => {
            assert.ok(wasCancelled, 'Job should be canceled');
            assert.ok(runningJobSuccesful, 'Running cancelled job should success');
            assert.ok(waitingJobSuccesful, 'Waiting job should success');
            done();
        });

        const promise = q.push(new TestJob('cancel', 10, true))
            .then(() => {
                assert.ok(false, 'Job shouldn\'t succeed as it was cancelled');
            }, (cancelError) => {
                assert.ok(cancelError, 'Job should fail with cancel error');
                wasCancelled = true;
                assert.ok(q.countJobsInProcessing() === 1, 'Only one job is processing');
                assert.ok(q.countJobsInQueue() === 1, 'Only one job is waiting');
            });

        setTimeout(() => {
            promise.cancel();
        }, 1);
    });

    it('handles job cancel when in processing state', (done) => {
        let wasCancelled = true;
        const q = new Queue({
            queueTimeout: 250,
            executionTimeout: 250,
            concurrency: 2,
            maxTaskCount: 2
        }, logger, metrics);

        q.push(new TestJob('running', 100)).then((value) => {
            assert.ok(value === 'running');
        }).finally(() => {
            assert.ok(wasCancelled, 'Job should be cancelled');
            done();
        });

        const promise = q.push(new TestJob('cancel', 50, true))
        .then(() => {
            assert.ok(false, 'Job shouldn\'t succeed as it was cancelled');
        }, (cancelError) => {
            wasCancelled = true;
            assert.ok(cancelError, 'Job should fail with cancel error');
        });
        setTimeout(() => {
            promise.cancel();
        }, 1);
    });

    it('cancel does nothing when unknown job done', (done) => {
        let finished = 0;
        const q = new Queue({
            queueTimeout: 50,
            executionTimeout: 100,
            concurrency: 1,
            maxTaskCount: 5
        }, logger, metrics);


        const promise = q.push(new TestJob('first', 10));

        promise.then(() => {
            finished++;
            return q.push(new TestJob('second', 10));
        }).then(() => {
            finished++;
            promise.cancel();
            return q.push(new TestJob('third', 10));
        }).then(() => {
            finished++;
            assert.ok(finished === 3, '3 jobs has to be processed');
            done();
        }).catch((e) => {
            assert.ok(false, 'All jobs have to success');
        });
    });

});
