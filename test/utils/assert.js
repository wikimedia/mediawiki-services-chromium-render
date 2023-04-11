'use strict';

const assert = require('assert');

function deepEqual(result, expected, message) {

    try {
        if (typeof expected === 'string') {
            assert.ok(result === expected || (new RegExp(expected).test(result)));
        } else {
            assert.deepEqual(result, expected, message);
        }
    } catch (e) {
        /* eslint-disable no-console */
        console.log(`Expected:\n${JSON.stringify(expected, null, 2)}`);
        console.log(`Result:\n${JSON.stringify(result, null, 2)}`);
        /* eslint-enable no-console */
        throw e;
    }

}

/**
 * Asserts whether the return status was as expected
 */
function status(res, expected) {

    deepEqual(res.status, expected,
        `Expected status to be ${expected}, but was ${res.status}`);

}


/**
 * Asserts whether content type was as expected
 */
function contentType(res, expected) {

    const actual = res.headers['content-type'];
    deepEqual(actual, expected,
        `Expected content-type to be ${expected}, but was ${actual}`);

}


/**
 * Assert whether the content length is not what was expected.
 */
function contentLengthIsNot(res, expected) {

    const actual = res.headers['content-length'];
    assert.notStrictEqual(actual, expected,
        `Expected content-length: ${actual} to not be ${expected}`);
}


/**
 * Assert whether cache control was as expected
 */
function cacheControl(res, expected) {

    const actual = res.headers['cache-control'];
    deepEqual(actual, expected,
        `Expected cache-control to be ${expected}, but was ${actual}`);
}


/**
 * Assert that the x-request-id header matches a specific pattern
 */
function xRequestId(res, expectedMatch) {

    const actual = res.headers['x-request-id'];
    assert.match(actual, expectedMatch,
        `Expected x-request-id ${actual} to match ${expectedMatch}`);
}


/*
 * Assert whether content disposition was as expected
 */
function contentDisposition(res, expected) {

    const actual = res.headers['content-disposition'];
    deepEqual(actual, expected,
        `Expected content-disposition to be ${expected}, but was ${actual}`);
}


function isDeepEqual(result, expected, message) {

    try {
        if (typeof expected === 'string') {
            assert.ok(result === expected || (new RegExp(expected).test(result)), message);
        } else {
            assert.deepEqual(result, expected, message);
        }
        return true;
    } catch (e) {
        return false;
    }

}

function notDeepEqual(result, expected, message) {

    try {
        assert.notDeepEqual(result, expected, message);
    } catch (e) {
        /* eslint-disable no-console */
        console.log(`Not expected:\n${JSON.stringify(expected, null, 2)}`);
        console.log(`Result:\n${JSON.stringify(result, null, 2)}`);
        /* eslint-enable no-console */
        throw e;
    }

}


function fails(promise, onRejected) {

    let failed = false;

    function trackFailure(e) {
        failed = true;
        return onRejected(e);
    }

    function check() {
        if (!failed) {
            throw new Error('expected error was not thrown');
        }
    }

    return promise.catch(trackFailure).then(check);

}


module.exports.ok                 = assert.ok;
module.exports.fails              = fails;
module.exports.deepEqual          = deepEqual;
module.exports.isDeepEqual        = isDeepEqual;
module.exports.notDeepEqual       = notDeepEqual;
module.exports.contentType        = contentType;
module.exports.contentLengthIsNot = contentLengthIsNot;
module.exports.contentDisposition = contentDisposition;
module.exports.cacheControl       = cacheControl;
module.exports.xRequestId         = xRequestId;
module.exports.status             = status;
