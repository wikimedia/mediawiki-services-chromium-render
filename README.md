# mediawiki-services-chromium-render

MediaWiki Service for rendering wiki pages in PDF using headless chromium

Install dependencies from
https://github.com/GoogleChrome/puppeteer/blob/master/docs/troubleshooting.md

Start the server:
* `node server.js`

And visit the following pages in your web browser:
* Letter size: http://localhost:3030/en.wikipedia.org/v1/pdf/Book/letter
* A4: http://localhost:3030/en.wikipedia.org/v1/pdf/Book/a4
