"use strict";

// Prefer bluebird promise implementation over es6-shim pulled in by prfun
if (!global.Promise) {
    global.Promise = require('bluebird');
}
if (!global.Promise.promisify) {
    global.Promise.promisifyAll = require('bluebird').promisifyAll;
}

var preq = require('preq');
var http = require('http');
var fs = Promise.promisifyAll(require('fs'));

// Higher per-host parallelism
var maxConcurrency = 50;
http.globalAgent.maxSockets = maxConcurrency;

function getArticles (apiURL, namespace, next) {

    var url = apiURL + '?action=query&generator=allpages&gapfilterredir=nonredirects'
        + '&gaplimit=500&prop=revisions&gapnamespace='
        + namespace + '&format=json&gapcontinue=' + encodeURIComponent( next );
    console.log(url);
        return preq.get(url, { retries: 10 })
        .then(function(res) {
            res = res.body;
            var articles = [];
            var articleChunk = res.query.pages;
            Object.keys(articleChunk).forEach( function(key) {
                var article = articleChunk[key];
                if ( article.revisions !== undefined ) {
                    var title = article.title.replace( / /g, '_' );
                    articles.push([title, article.revisions[0].revid]);
                }
            });
            next = res['query-continue'].allpages.gapcontinue;
            // XXX
            //next = 'finished';
            return { articles: articles, next: next || '' };
        })
        .catch(function(e) {
            console.error('Error in getArticles:', e);
            throw e;
        });
}

function dumpArticle (prefix, title, oldid) {
    var dirName = prefix + '/' + encodeURIComponent(title),
        fileName = dirName + '/' + oldid;
    return fs.statAsync(fileName)
    .catch(function(e) {})
    .then(function(fileStats) {
        // Check if we already have this article revision
        if (fileStats && fileStats.isFile()) {
            // We already have the article, nothing to do.
            // XXX: Also track / check last-modified time for template
            // re-expansions without revisions change
            console.log('Exists:', title, oldid);
            return;
        }
        console.log('Dumping', title, oldid);
        return preq.get('http://parsoid-lb.eqiad.wikimedia.org/'
                + prefix + '/' + encodeURIComponent(title) + '?oldid=' + oldid, { retries: 10 })
        .then(function(res) {
            // strip data-parsoid
            var body = res.body.replace(/ ?data-parsoid=(?:'[^']+'|"[^"]+"|\\".*?\\"|&#39;.*?&#39;)/g, '');
            return fs.mkdirAsync(dirName)
            .catch(function(e) {
                if (!/^EEXIST/.test(e.message)) {
                    throw e;
                }
            })
            .then(function() {
                return fs.readdirAsync(dirName);
            })
            .then(function(files) {
                // Asynchronously unlink other files
                files.forEach(function(file) {
                    fs.unlinkAsync(dirName + '/' + file);
                });
                return fs.writeFileAsync(fileName, body);
            });
        });
    });
}


function makeDump (apiURL, prefix, ns) {
    // Set up directories
    try {
        fs.mkdirSync(prefix);
    } catch (e) {}

    function dumpBatch(articleResult) {
        var articles = articleResult.articles;
        var next = articleResult.next;
        Promise.all([
            // Fetch the next batch of oldids while processing the last one
            getArticles(apiURL, ns, next),

            Promise.map(articles, function(article) {
                var title = article[0];
                var oldid = article[1];
                return dumpArticle(prefix, title, oldid)
                .catch(function(e) {
                    console.error('Error in makeDump:', title, oldid, e.stack);
                });
            }, { concurrency: maxConcurrency }).then(function(){})
        ])
        .then(function(results){
            //console.log(results);
            var articleResult = results[0];
            if (articleResult.next !== 'finished') {
                return dumpBatch(articleResult);
            }
        });
    }

    return getArticles(apiURL, ns, '')
    .then(dumpBatch);
}

if (module.parent === null) {
    var argv = require('yargs')
        .usage('Create a HTML dump in a subdir\nUsage: $0'
                + '\nExample: node htmldumper.js --prefix enwiki --ns 0 --apiURL http://en.wikipedia.org/w/api.php')
        .demand(['apiURL', 'prefix', 'ns'])
        //.default('apiURL', 'http://en.wikipedia.org/w/api.php')
        //.default('prefix', 'enwiki')
        //.default('ns', '0')
        .argv;

    return makeDump(argv.apiURL, argv.prefix, Number(argv.ns))
    .then(function(res) {
        console.log('Dump done.');
    })
    .catch(function(err) {
        console.error('Error in main;', err);
    });
}

module.exports = makeDump;
