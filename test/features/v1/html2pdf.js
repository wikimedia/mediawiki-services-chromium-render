'use strict';

const preq = require('preq');
const assert = require('../../utils/assert.js');
const server = require('../../utils/server.js');

if (!server.stopHookAdded) {
    server.stopHookAdded = true;
    after(() => server.stop());
}

describe('html2pdf', function() {
    this.timeout(20000);
    before(() => server.start());

    it('should return a letter-sized PDF',() => {
        return preq.get(
            `${server.config.uri}en.wikipedia.org/v1/pdf/CP%2FM-86/letter`
        )
        .then((res) => {
            assert.status(res, 200);
            assert.contentType(res, 'application/pdf');
            assert.deepEqual(
                Buffer.isBuffer(res.body), true, 'Unexpected body!');
        });
    });
});
