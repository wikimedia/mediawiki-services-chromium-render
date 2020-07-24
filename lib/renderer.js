'use strict';

const urlParser = require('url');
const puppeteer = require('puppeteer-core');
const devices = require('puppeteer-core/DeviceDescriptors');
const BBPromise = require('bluebird');
const errors = require('./errors');


/**
 * Mobile device viewport. Will use Samsung Galaxy S III as a default device
 * Note: Device width has to be smaller than @width-breakpoint-tablet defined in MinervaNeue Skin
 * Otherwise Mobile print styles won't be applied.
 * @type {Object}
 */
const MOBILE_DEVICE_VIEWPORT = devices['Galaxy S III'].viewport;
/**
 * Desktop device viewport. Using HD resolution
 * @type {Object}
 */
const DESKTOP_DEVICE_VIEWPORT = {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
};

/**
 * PDF renderer from a URL.
 * In order to keep debugging simple and performance predictable each
 * request should create a new instance of the class.
 */
class Renderer {
    /**
     * Creates a new Renderer instance
     * @param {Object} puppeteerOptions options used to in starting puppeteer, as defined in
     * puppeteer documentation. See
     * https://github.com/GoogleChrome/puppeteer/blob/v0.15.0/docs/api.md#puppeteerlaunchoptions
     * @param {Object} pdfOptions pdf options passed to puppeteer, as defined by puppeteer in
     * documentation. See
     * https://github.com/GoogleChrome/puppeteer/blob/v0.13.0/docs/api.md#pagepdfoptions
     * @param {RegExp} hostBlacklist Blacklist regexp of hosts (domain or domain:non-default-port)
     *   the browser is not allowed to access.
     * @param {string} userAgent User agent to use when requesting the URL
     * @param {boolean} isMobile Render mobile pages
     * @param {Object} logger The logger object (for debugging purposes)
     */
    constructor(puppeteerOptions, pdfOptions, hostBlacklist, userAgent, isMobile, logger) {
        this.CLOSE_TIMEOUT = 3000;
        this._puppeteerOptions = puppeteerOptions;
        this._pdfOptions = pdfOptions;
        this._hostBlacklist = hostBlacklist;
        this._browser = null;
        this._renderAborted = false;
        this._userAgent = userAgent;
        this._isMobile = isMobile;
        this._logger = logger;
    }

    /**
     * Closes any open browser instance. Additionally to prevent resources leak
     * script will wait 3 seconds, and if Chromium Process is still present, it will be killed
     * @return {Promise<Buffer>} Promise which resolves when browser exited or has been killed
     */
    _closeBrowser() {
        return new BBPromise((resolve, reject) => {
            if (this._browser) {
                const browser = this._browser;
                const childProcess = browser.process();
                let closePromise = null;

                this._browser = undefined;
                closePromise = BBPromise.resolve(browser.close())
                .timeout(this.CLOSE_TIMEOUT)
                .then(null, () => {
                    this._logger.log('error/render', {
                        msg: 'Killing chromium process',
                        childId: childProcess.pid
                    });
                    try {
                        childProcess.kill('SIGKILL');
                    } catch (err) {
                        // ignore the exception
                    }
                })
                .finally(resolve);

                childProcess.on('exit', () => {
                    // Process left by itself, there is no need to kill it.
                    // bluebird cancellation does not affect finally handlers
                    // so no need to resolve here.
                    closePromise.cancel();
                });
            } else {
                // browser is already closed
                resolve();
            }
        });
    }

    /**
     * Checks an URL against the configured blacklist.
     * Also rejects requests which look strange, to be on the paranoid side.
     * @param {string} url
     * @return {bool}
     * @private
     */
    _isAllowed(url) {
        const parsedUrl = urlParser.parse(url);
        return parsedUrl.protocol.match(/(^https?:$|^data:$)/) && !parsedUrl.auth
            && !parsedUrl.host.match(this._hostBlacklist);
    }

    /**
     * Renders content from `url` in PDF
     * @param {string} url URL to get content from
     * @param {string} format Page format
     * @param {Object} headers List of headers to set for the request
     * @return {<BBPromise<Buffer>>} Promise which resolves with PDF buffer
     */
    articleToPdf(url, format, headers) {
        let page;

        // If the main URL is blacklisted, Chromium will throw an net::ERR_ACCESS_DENIED error,
        // and it will be hard to figure out reliably what's going on. Better to check here.
        if (!this._isAllowed(url)) {
            throw new errors.ForbiddenError('URL is blacklisted');
        }

        return new BBPromise((resolve, reject) => {
            puppeteer.launch(this._puppeteerOptions).then((browser) => {
                this._browser = browser;
                this._logger.log(
                    'debug/render', {
                        msg: 'Spawned new Chromium instance',
                        childId: browser.process().pid
                    });
                browser.on('disconnected', () => {
                    if (this._renderAborted) {
                        reject(new errors.ProcessingCancelled());
                    }
                });
                return browser.newPage();
            })
            .then((page_) => {
                page = page_;
                return page.emulate({
                    viewport: this._isMobile ? MOBILE_DEVICE_VIEWPORT : DESKTOP_DEVICE_VIEWPORT,
                    userAgent: this._userAgent
                });
            })
            .then(() =>
                // MobileFrontend lazy loads images by Javascript. The
                // easiest approach to load all images is to disable the JS.
                // This also limits what an attacker can do if the succeed in
                // injecting malicious HTML content into the page.
                page.setJavaScriptEnabled(false)
            )
            .then(() =>
                // The requests made by a puppeteered browser for page assets, preloading etc.
                // are probably sent from the demilitarized zone of the network. Ensure an
                // attacker who can trigger such requests by manipulating the page does not
                // have access to anything they otherwise couldn't access.
                page.setRequestInterception(true).then(() =>
                    page.on('request', (interceptedRequest) => {
                        if (this._isAllowed(interceptedRequest.url())) {
                            return interceptedRequest.continue();
                        } else {
                            this._logger.log(
                                'warn/render', {
                                    msg: 'Aborted blacklisted request',
                                    url: interceptedRequest.url(),
                                });
                            return interceptedRequest.abort('accessdenied');
                        }
                    })
                )
            )
            .then(() => {
                // Remove the Host header, which is now forbidden by Chromium, if set.
                // https://github.com/puppeteer/puppeteer/issues/4575#issuecomment-511259872
                delete headers.host;
                page.setExtraHTTPHeaders(headers);
            })
            .then(() => page.goto(url, { waitUntil: 'networkidle2' }))
            .then((response) => {
                const pdfOptions = Object.assign({}, this._pdfOptions, { format });
                // sometimes we get an undefined response, which shouldn't happen but because
                // we do not use bundled chromium we need to handle such situations
                if (!response) {
                    throw new errors.PuppeteerMalformedResponseError();
                } else if (!response.ok()) {
                    throw new errors.NavigationError(response.status(), response.statusText());
                }
                return page.pdf(pdfOptions);
            })
            .then((pdf) => {
                this._closeBrowser().finally(() => {
                    resolve(pdf);
                });
            })
            .catch((error) => {
                // When jobs get aborted and the browser is closed puppeteer fails with
                // with an exception `Error: Protocol error (Page.printToPDF): Target closed.`
                // Also there is NavigatorWatcher object that has a defined timeout (uses
                // Promise.race()) if the Page does not respond within the 30s timeout (because for
                // example abort action closed the browser) it fails with exception:
                // `Error: Navigation Timeout Exceeded: 30000ms exceeded`
                // Because there is no other way to tell puppeteer to stop processing and
                // close the browser - the easiest trick for now, is just to close the
                // browser and silently ignore all exceptions, exit the queue anb pretend
                // nothing happened. The event listener [browser.on('disconnected') located couple
                // lines above will exit the queue. If `this._renderAborted` is true, we can
                // safely ignore all exceptions.
                this._closeBrowser().finally(() => {
                    if (!this._renderAborted) {
                        reject(error);
                    }
                });
            });
        });
    }

    /**
     * Aborts the request to create a PDF.
     *
     * Should be called after calling articleToPdf
     * @return {<BBPromise<>>} Promise which resolves when browser exited or has been killed
     */
    abortRender() {
        this._renderAborted = true;
        return this._closeBrowser();
    }

    /**
     * Returns true if render was aborted
     * @return {boolean}
     */
    isAborted() {
        return this._renderAborted;
    }
}

module.exports = {
    Renderer
};
