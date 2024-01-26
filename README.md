# mediawiki-services-chromium-render
MediaWiki Service for rendering wiki pages in PDF using headless chromium

## Local set up and development
### Docker compose
Dependencies:
* docker
* docker-compose

To prepare your local env:

1. Configure local uid/gid in `.pipeline/blubber.yaml`
   * You can see your user/group id by running `id -u` and `id -g` in a local bash shell
   * This allows using local files for development that are mounted on docker instance as a volume
2. Build the service image with `docker compose build`
3. Install dependencies with `docker compose run proton npm install`
4. Run the tests with `docker compose run proton npm test`
5. Start the dev server with `docker compose up`

With dev server running, endpoints should be exposed in localhost: `curl localhost:3030`

Local files are mounted as volumes to the docker instance of proton so changes are applied directly.

To get a shell to the docker instance you can run: `docker compose run -it proton bash`

### Native nodejs
1. Install dependencies with `npm install`
2. Start the service with `npm start`.
3. Use the service by visiting the following pages in a web browser:
    * Legal size, easy to read on mobile devices: http://localhost:3030/en.wikipedia.org/v1/pdf/Book/legal/mobile
    * A4: http://localhost:3030/en.wikipedia.org/v1/pdf/Book/a4/desktop
4. Perform tests with `npm test`
5. Identify test coverage with `npm run coverage`

You should use the following checklist to make sure you have a proper development environment

1. Check if chromium version matches puppeteer version
2. If you are not using Debian, you might not be using the proper chromium version
3. If the application fails on tests and you are not sure if this is related to your development environment, execute `./server.js docker-test` in the root directory, this will ensure the app is running with the proper requirements

## Requests
[server.js](server.js) is the service entry point. It immediately invokes
service-runner which executes the module specified in the configuration file,
[app.js](app.js). app.js globs all the files under routes/ and loads them into
the Express router as API endpoints. Each URL request is handled by the router
which matches it to a route by testing each path-to-regexp expression specified
by each route. Finally, the route responds.

The PDF route is contained in [html2pdf-v1.js](routes/html2pdf-v1.js). Every PDF
request verifies that the requested article exists and then it inserted to the queue.
When the request completes either successfully because a PDF was rendered, or
unsuccessfully because the queue was full, a timeout occurred, or an error was
encountered, the promise is rejected and a response is returned to Express and
then served to the client.

The queue itself is a bespoke solution that:
 - returns a promise for every job
 - allows queued jobs to timeout
 - allows in-progress jobs to timeout
 - allows to cancel jobs
There is no promise library that provides all those features, because of that
the library has to implement it's own queue system.

The renderer is the interface into a literal Chromium browser instance. It
launches Chromium, navigates to the webpage like a desktop user would, requests
a PDF for the visited page, and finally terminates the browser. Pages are rendered
in non-javascript mode to disable features like lazy-lading images.

Service can render mobile-friendly PDFs. To enable mobile friendly mode pass
`mobile` as last parameter. Chromium-renderer will fetch the article page
using mobile url which applies MobileFrontend formatting and uses MinervaNeue
as default skin.

## Responses
Responses are documented in the [swagger spec](spec.yaml).

## Server-side configuration
Development configuration is specified in [config.dev.yaml](config.dev.yaml),
respectively with some defaults inlined in [html2pdf-v1.js](routes/html2pdf-v1.js).
The following options are supported.

### Request processing
- `render_concurrency`: The maximum number of Puppeteer instances that can be
  launched at a time.
- `render_queue_timeout`: The maximum number of **seconds** to wait for a PDF
  request to exit the work queue and start rendering.
- `render_execution_timeout`: The maximum number of **seconds** to wait for a
  PDF render to complete. The total timeout for a request to complete from
  beginning to end is `render_queue_timeout + render_execution_timeout`.
- `max_render_queue_size`: The maximum number of PDF requests permitted to
  queue. This number includes requests currently being rendered. The
  maximum number of simultaneous requests the server can render successfully is
  `max_render_queue_size + render_concurrency`.
- `queue_health_logging_interval`: The number of seconds between queue status
  reports.

### Puppeteer
- `timeout`: The maximum number of **milliseconds** to wait for Chromium to
  launch. Durations exceeding `render_execution_timeout` are limited. Defaults
  to `30000`.
- `executablePath`: The Chromium executable path to use. This config variable can be overridden by the
  `PUPPETEER_EXECUTABLE_PATH` environment variable

Additional documentation is available in the [Puppeteer docs].

[Puppeteer environment variable]: https://github.com/GoogleChrome/puppeteer/blob/v0.13.0/docs/api.md#environment-variables
[Puppeteer docs]: https://github.com/GoogleChrome/puppeteer/blob/v0.13.0/docs/api.md#puppeteerlaunchoptions

### Formatting
- `scale`: the proportional multiplier applied.
- `displayHeaderFooter`: If `true`, the page header and footers are rendered.
  Otherwise, headers and footers are omitted. Defaults to `false`.
- `printBackground`: If `true`, background graphics are rendered. Otherwise, the
  background is omitted. Defaults to `false`.
- `landscape`: If `true`, pages are rendered in landscape orientation. Portrait
  otherwise. Defaults to `false`.
- `pageRanges`: The pages inclusive ranges of pages to render. Ranges are
  specified with a starting page number followed by an optional hyphen and
  terminating page number. e.g., '1-5, 8, 11-13'. Defaults to the empty string,
  which is a special value meaning "print all pages."
- `format`: The format to use when unspecified by the client (note: not
  currently supported by the API). Defaults to `Letter`.
- `margin: { top, right, bottom, left }`: The cardinal paper margins specified
  in CSS units.

Additional documentation is available in the
[Puppeteer docs](https://github.com/GoogleChrome/puppeteer/blob/v0.13.0/docs/api.md#pagepdfoptions).

### Service

Service options are documented in the [RESTBase Node.js service template].

[RESTBase Node.js service template]: https://www.mediawiki.org/wiki/Documentation/Services#Service_Template

## Production set up and deployment

Install dependencies from
https://github.com/GoogleChrome/puppeteer/blob/master/docs/troubleshooting.md

Start the server with logging:
* `node server.js | bunyan`
