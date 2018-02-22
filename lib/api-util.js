'use strict';

const Template = require('swagger-router').Template;

/**
 * Sets up the request templates for MW and RESTBase API requests
 * @param {!Application} app the application object
 */
function setupApiTemplates(app) {
    const templateGlobals = {
        if(statement, then, otherwise) {
            return statement ? then : otherwise;
        }
    };
    // set up the MW API request template
    if (!app.conf.mwapi_req) {
        app.conf.mwapi_req = {
            uri: 'http://{{domain}}/w/api.php',
            headers: {
                'user-agent': '{{user-agent}}'
            },
            body: '{{ default(request.query, {}) }}'
        };
    }
    app.mwapi_tpl = new Template(app.conf.mwapi_req);

    // set up the RESTBase request template
    if (!app.conf.restbase_req) {
        app.conf.restbase_req = {
            method: '{{request.method}}',
            uri: 'http://{{domain}}/api/rest_v1/{+path}',
            query: '{{ default(request.query, {}) }}',
            headers: '{{request.headers}}',
            body: '{{request.body}}'
        };
    }
    app.restbase_tpl = new Template(app.conf.restbase_req);

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
    setupApiTemplates
};

