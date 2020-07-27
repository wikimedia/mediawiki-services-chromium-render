#!/usr/bin/env node

'use strict';

// Service entry point. Try node server --help for commandline options.

const Promise = require('bluebird');

// enable promise cancellation feature.
Promise.config({ cancellation: true });

// Start the service by running service-runner, which in turn loads the config
// (config.yaml by default, specify other path with -c). It requires the
// module(s) specified in the config 'services' section (app.js in this
// example).
const ServiceRunner = require('service-runner');
new ServiceRunner().start();
