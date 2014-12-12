"use strict";

if (!global.Promise || !global.promise.promisify) {
    global.Promise = require('bluebird');
}

var preq = require('preq');
var fs = Promise.promisifyAll(require('fs'));
var PromiseStream = require('./PromiseStream');

// Article dump parallelism
var maxConcurrency = 200;

function getArticles (apiURL, namespace, res) {
    var next = res.next || '';
    if (next === 'finished') {
        // nothing more to do.
        return Promise.reject('Articles done');
    }

    var url = apiURL + '?action=query&generator=allpages&gapfilterredir=nonredirects'
        + '&gaplimit=500&prop=revisions&gapnamespace='
        + namespace + '&format=json&gapcontinue=' + encodeURIComponent( next );
    //console.log(url);

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
        return {
            articles: articles,
            next: next
        };
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

    var articleArgs = {
        apiURL: apiURL,
        namespace: ns,
        next: ''
    };

    var articleStream = new PromiseStream(getArticles.bind(null, apiURL, ns),
            {next: ''}, 10);
    var articles = [];
    var waiters = [];

    function processArticles (newArticles) {
        articles = newArticles.articles;
        while(waiters.length && articles.length) {
            waiters.pop().resolve(articles.shift());
        }
        if (waiters.length) {
            articleStream.next().then(processArticles);
        }
    }

    function getArticle() {
        if (articles.length) {
            return Promise.resolve(articles.shift());
        } else {
            if (!waiters.length) {
                articleStream.next().then(processArticles);
            }
            return new Promise(function(resolve, reject) {
                waiters.push({resolve: resolve, reject: reject});
            });
        }
    }

    function dumpOne () {
        return getArticle()
        .then(function(article) {
            var title = article[0];
            var oldid = article[1];
            return dumpArticle(prefix, title, oldid)
            .catch(function(e) {
                console.error('Error in makeDump:', title, oldid, e.stack);
            });
        });
    }

    var dumpStream = new PromiseStream(dumpOne, undefined, 10, maxConcurrency);

    function loop () {
        return dumpStream.next()
        .then(loop)
        .catch(function(e) {
            console.log(e);
        });
    }

    return loop();
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
