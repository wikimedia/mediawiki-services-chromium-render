'use strict';

/**
 * Error thrown when job gets cancelled. The promise returned by the
 * queue gets rejected with ProcessingCancelled
 */
class ProcessingCancelled extends Error {
    constructor() {
        super();
        Error.captureStackTrace(this, ProcessingCancelled);
    }
}

/**
 * Error thrown when Puppeteer returns bad/malformed/incorrect response.
 * This shouldn't happen but because we do not use bundled chromium version
 * we need to protect ourselves from that
 */
class PuppeteerMalformedResponseError extends Error {
    constructor() {
        super();
        Error.captureStackTrace(this, PuppeteerMalformedResponseError);
    }
}

/**
 * Thrown when task timeouts in the queue
 */
class QueueTimeout extends Error {
    constructor() {
        super();
        Error.captureStackTrace(this, QueueTimeout);
    }
}

/**
 * Thrown when there is no space for new task
 */
class QueueFull extends Error {
    constructor() {
        super();
        Error.captureStackTrace(this, QueueFull);
    }
}

/**
 * Thrown when task processing takes too much time
 */
class JobTimeout extends Error {
    constructor() {
        super();
        Error.captureStackTrace(this, JobTimeout);
    }
}

/**
 * Thrown when we want to cancel not existing job
 */
class JobNotFound extends Error {
    constructor() {
        super();
        Error.captureStackTrace(this, JobNotFound);
    }
}

/**
 * Thrown when Puppeteer returns HTTP response code other than 2xx
 */
class NavigationError extends Error {
    constructor(httpCode, message, jobId, httpParams) {
        super();
        Error.captureStackTrace(this, NavigationError);
        this.httpCode = httpCode;
        this.message = message;
        this.jobId = jobId;
        this.httpParams = httpParams;
    }
}

/**
 * Thrown when someone tries to render a blacklisted URL.
 */
class ForbiddenError extends Error {
    constructor(msg) {
        super(msg);
        Error.captureStackTrace(this, ForbiddenError);
    }
}

module.exports = {
    JobNotFound,
    NavigationError,
    QueueTimeout,
    JobTimeout,
    QueueFull,
    ProcessingCancelled,
    PuppeteerMalformedResponseError,
    ForbiddenError,
};
