'use strict';

const { Renderer } = require('../../lib/renderer');
const assert = require('../utils/assert.js');
const logger = { log: (level, data) => {} };

describe('Renderer', function() {
    this.timeout(1000);

    it('kills hung browser', () => {
        let killed = false;
        const renderer = new Renderer({}, {}, /(?!)/, '', false, logger);
        renderer._browser = {
            // return a promise that never resolves
            close: () => new Promise(() => null),

            process: () => ({
                pid: 123,
                kill() {
                    killed = true;
                },
                on() {},
            }),
        };
        renderer.CLOSE_TIMEOUT = 10;

        return renderer._closeBrowser().finally(() => {
            assert.ok(killed, 'Renderer has to kill hung browser');
        });
    });
});
