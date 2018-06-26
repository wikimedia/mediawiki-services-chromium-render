'use strict';

const preq = require('preq');

const Template = require('swagger-router').Template;

/**
 * Sets up the request template for MW requests
 * @param {!Application} app the application object
 */
function setupApiTemplates(app) {
    const templateGlobals = {
        if(statement, then, otherwise) {
            return statement ? then : otherwise;
        }
    };

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

/**
 * Calls the REST API with the supplied domain, path and request parameters
 * @param {!Object} app the application object
 * @param {string} domain the domain to issue the request for
 * @param {!string} path the REST API path to contact without the leading slash
 * @param {?Object} [restReq={}] the object containing the REST request details
 * @param {?string} [restReq.method=get] the request method
 * @param {?Object} [restReq.query={}] the query string to send, if any
 * @param {?Object} [restReq.headers={}] the request headers to send
 * @param {?Object} [restReq.body=null] the body of the request, if any
 * @return {!Promise} a promise resolving as the response object from the REST API
 *
 */
function restApiGet(app, domain, path, restReq) {

    restReq = restReq || {};
    path = path[0] === '/' ? path.slice(1) : path;

    const request = app.restbase_tpl.expand({
        request: {
            method: restReq.method,
            params: { domain, path },
            query: restReq.query,
            headers: Object.assign({ 'user-agent': app.conf.user_agent }, restReq.headers),
            body: restReq.body
        }
    });

    return preq(request);

}


module.exports = {
    setupApiTemplates,
    restApiGet
};

