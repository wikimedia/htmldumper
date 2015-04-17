#!/usr/bin/env node
"use strict";
var P = require('bluebird');

var fs = P.promisifyAll(require('fs'));
var proc = P.promisifyAll(require('child_process'));
var preq = require('preq');
var makeDump = require('./htmldump');


//var dumpDir = '/srv/www/htmldumps';
//var workDir = '/srv/www/htmldumps';
var dumpDir = '/tmp';
var workDir = '/tmp';

function dumpDBName (domain) {
    return domain + '.articles.ns0.sqlite3';
}

function dumpWiki(options) {
    var domain = options.domain;
    var dumpName = dumpDBName(domain);
    var workDB = options.workDir + '/' + dumpName;
    var dumpDB = options.dumpDir + '/' + dumpName + '.xz';
    // If a dump exists, uncompress it & use it as a starting point
    var dumpPromise = P.resolve();
    if (fs.existsSync(dumpDB)) {
        dumpPromise = proc.execFileAsync('pixz', ['-d', dumpDB, workDB]);
    }
    return dumpPromise
    .then(function() {
        var dumpOptions = {
            dataBase: workDB,
            apiURL: 'http://' + domain + '/w/api.php',
            prefix: domain,
            ns: 0,
            host: 'http://rest.wikimedia.org',
            verbose: options.verbose
        };
        return makeDump(dumpOptions);
    })
    .then(function() {
        console.log('xz compressing');
        proc.execFileAsync('pixz', ['-2', workDB, dumpDB]);
    })
    .catch(console.log)
    .then(function() {
        return fs.unlinkAsync(workDB);
    })
    .catch(function(e) {
        console.error(e);
    });
}


function dumpAllWikis (options) {
    return preq.get({
        uri: 'http://rest.wikimedia.org/',
        headers: {
            accept: 'application/json'
        }
    })
    .then(function(res) {
        return P.each(res.body.items, function(domain) {
            options.domain = domain;
            return dumpWiki(options);
        });
    })
    .then(function() {
        console.log('All dumps done.');
    });
}

module.exports = dumpAllWikis;
