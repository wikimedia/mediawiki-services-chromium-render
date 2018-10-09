#!/usr/bin/env node

'use strict';

// Service entry point. Try node server --help for commandline options.

// enable promise cancellation feature.
// Promise config can be set by the APP_ENABLE_CANCELLABLE_PROMISES env
// variable, but we already know we need promise cancellation. let's set
// it anyway to be safe.
const Promise = require('bluebird');
Promise.config({
    cancellation: true,
});

// Start the service by running service-runner, which in turn loads the config
// (config.yaml by default, specify other path with -c). It requires the
// module(s) specified in the config 'services' section (app.js in this
// example).
const ServiceRunner = require('service-runner');
new ServiceRunner().start();
