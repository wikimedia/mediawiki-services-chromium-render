"use strict";

const assert = require("../utils/assert.js");
const { Queue } = require("../../lib/queue");
const errors = require("../../lib/errors");
const { QueueItem } = require("../../lib/queueItem");
const logger = { log: (level, data) => {} };
const BBPromise = require("bluebird");
BBPromise.config({
    cancellation: true
});
let id = 1;


class BulkTestJob extends QueueItem {
    constructor(name, processTime, succesful) {
        super({});
        this.name = name;
        this.time = processTime;
        this.succesful = typeof succesful === "undefined" ? true : succesful;
        this.timer = null;
    }
    get jobId() {
        return this.name;
    }
    cancel() {
        if (this.timer) { clearTimeout(this.timer); }
        return BBPromise.resolve();
    }
    process() {
        return new BBPromise((resolve, reject) => {
            if (this.time === undefined) { return; }
            this.timer = setTimeout(() => {
                if (this.succesful) {
                    resolve(this.name);
                } else {
                    reject(new Error('Failure'));
                }
            }, this.time);
        });
    }
}

const metrics = {
    increment: () => {},
    endTiming: () => {},
    gauge: () => {}
};

describe("Queue bulk test (long test)", function() {
    this.timeout(20000);

    it("passes the bulk test correctly", () => {
        const tasks = 5000;
        const maxTaskDuration = 50;
        const taskExecutionTime = 27;
        const taskTimeout = tasks * maxTaskDuration;
        this.timeout(taskTimeout);
        const concurrency = 50;
        const expected = {
            timeout: 0,
            fail: 0,
            success: 0
        };

        function makeJob(id) {
            switch (id % 17) {
                case 0:
                case 15:
                    expected.timeout++;
                    return new BulkTestJob(
                        `${id.toString()} | timeout job`,
                        undefined,
                        true);
                case 1:
                case 3:
                case 9:
                case 12:
                    expected.fail++;
                    return new BulkTestJob(
                        `${id.toString()} | failure`,
                        taskExecutionTime,
                        false
                    );
                default:
                    expected.success++;
                    return new BulkTestJob(
                        `${id.toString()} | success job`,
                        taskExecutionTime,
                        true
                    );
            }
        }

        const queue = new Queue(
            {
                maxTaskCount: tasks + 1,
                concurrency,
                executionTimeout: maxTaskDuration,
                // we need to give the queue bit more time
                queueTimeout: taskTimeout
            },
            logger,
            metrics
        );

        const stats = {
            success: 0,
            fail: 0,
            timeout: 0,
            other: 0,
            queuetimeout: 0,
            queuefull: 0,
            cancelled: 0
        };
        const promises = Array(tasks)
      .fill(null)
      .map((_, i) => {
          return  queue
          .push(makeJob(++id))
          .then(
              () => {
                  stats.success++;
              },
              (err) => {
                  if (err instanceof errors.QueueTimeout) {
                      stats.queuetimeout++;
                  } else if (err instanceof errors.QueueFull) {
                      stats.queuefull++;
                  } else if (err instanceof errors.ProcessingCancelled) {
                      stats.cancelled++;
                  } else if (err instanceof errors.JobTimeout) {
                      stats.timeout++;
                  } else if (err.message === "Failure") {
                      stats.fail++;
                  } else {
                      // Something else failed when running the job function
                      stats.other++;
                  }
                  return true;
              }
          )
          .finally(() => {
              return true;
          });
      });

        return BBPromise.all(promises).finally(() => {
            assert.deepEqual(stats.success, expected.success,
                `${stats.success} of ${expected.success} were successful`);
            assert.deepEqual(stats.fail, expected.fail,
                `${stats.fail} of ${expected.fail} were failed`);
            assert.deepEqual(stats.timeout, expected.timeout,
                `${stats.timeout} of ${expected.timeout} were timeouts`);
            assert.deepEqual(stats.queuefull, 0, 'no queue full errors');
            assert.deepEqual(stats.cancelled, 0, 'no cancelled errors');
            assert.deepEqual(stats.other, 0, 'no other errors');
            assert.deepEqual(stats.queuetimeout, 0, 'no queuetimeout errors');
        });
    });
});
