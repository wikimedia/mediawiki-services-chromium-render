'use strict';

const assert = require('../utils/assert.js');
const util = require('../../lib/util');

describe('getContentDisposition', function() {
    it('return the correct content disposition', function() {
        assert.ok(
            util.getContentDisposition('Book (disambiguation)') ===
            'attachment; filename="Book%20(disambiguation).pdf"; ' +
                'filename*=UTF-8\'\'Book%20(disambiguation).pdf'
        );
        assert.ok(
            util.getContentDisposition('"To be, or not to be"') ===
            'attachment; filename="%22To%20be%2C%20or%20not%20to%20be%22.pdf"; ' +
                'filename*=UTF-8\'\'%22To%20be%2C%20or%20not%20to%20be%22.pdf'
        );
    });
});
