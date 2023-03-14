'use strict';

const Template = require('swagger-router').Template;

/**
 * Sets up the request template for MW requests
 * @param {!Application} app the application object
 */
function setupRequestTemplate(app) {
    const templateGlobals = {
        if(statement, then, otherwise) {
            return statement ? then : otherwise;
        }
    };

    // set up the MediaWiki request template. There is no need to override the global config.
    // definitions above should also be fixed as app config should be read-only.
    let mwRequestConfig = app.conf.mw_req;
    if (!mwRequestConfig) {
        mwRequestConfig = {
            method: '{{request.method}}',
            uri: 'http://{{language}}{{if(mobile, \'.m\', \'\')}}.{{domain}}/w/index.php?title={+article}',
            query: '{{ default(request.query, {}) }}',
            headers: {},
            body: '{{request.body}}'
        };
    }

    app.mw_tpl = new Template(mwRequestConfig, templateGlobals);
}

module.exports = {
    setupRequestTemplate
};

