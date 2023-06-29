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

    it('should return a PDF in default format',() => {
        return preq.get(
            `${server.config.uri}en.wikipedia.org/v1/pdf/CP%2FM-86`
        )
        .then((res) => {
            assert.status(res, 200);
            assert.contentType(res, 'application/pdf');
            // This page has some content, so shouldn't be zero.
            assert.contentLengthIsNot(res, 0);
            assert.cacheControl(res, 's-maxage=600, max-age=600');

            // For example: 81efa310-c17a-11ed-b000-77943ff432ae
            const regex = new RegExp(
                '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'
            );
            assert.xRequestId(res, regex);
            assert.contentDisposition(
                res,
                'attachment; filename="CP%2FM-86.pdf"; filename*=UTF-8\'\'CP%2FM-86.pdf'
            );
            assert.deepEqual(
                Buffer.isBuffer(res.body), true, 'Unexpected body!');
        });
    });

});
