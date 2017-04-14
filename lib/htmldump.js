"use strict";
// Upgrade to es6
require('core-js/shim');

var P = require('bluebird');
var Template = require('swagger-router').Template;

var makeFileStore = require('./filestore');
var makeSQLiteStore = require('./sqlitestore');

// Enable heap dumps in /tmp on kill -USR2.
// See https://github.com/bnoordhuis/node-heapdump/
// For node 0.6/0.8: npm install heapdump@0.1.0
// For 0.10: npm install heapdump
process.on('SIGUSR2', function() {
    var heapdump = require('heapdump');
    console.log( "warning", "SIGUSR2 received! Writing snapshot." );
    process.chdir('/tmp');
    heapdump.writeSnapshot();
});

var preq = require('preq');
var PromiseStream = require('./PromiseStream');

// the request template used for fetching each individual article
var articleReqTpl;

function getArticles (options, res) {
    if (!res || res.next === 'finished') {
        // nothing more to do.
        return P.resolve(null);
    }
    var next = res.next || '';

    var query = {
        action: 'query',
        generator: 'allpages',
        gaplimit: '500',
        gapfrom: options.startTitle,
        prop: 'revisions',
        gapnamespace: options.ns,
        format: 'json',
        'continue': '',
    }
    // merge in the paging parameters
    if (next) {
        Object.assign(query, next);
    }
    return preq.get({
        uri: options.apiURL,
        query: query,
        headers: {
            'user-agent': options.userAgent,
            host: options.prefix
        },
        timeout: 60* 1000,
        retries: 5
    })
    .then(function(res2) {
        res2 = res2.body;
        var articles = [];
        var articleChunk = res2.query.pages;
        Object.keys(articleChunk).forEach( function(key) {
            var article = articleChunk[key];
            if ( article.revisions !== undefined ) {
                var title = article.title.replace( / /g, '_' );
                articles.push([title, article.revisions[0].revid]);
            }
        });
        var next2 = res2['continue'] || 'finished';
        // XXX
        //next = 'finished';
        return {
            articles: articles,
            next: next2,
            encoding: null
        };
    })
    .catch(function(e) {
        console.error('Error in getArticles:', e);
        throw e;
    });
}

function dumpArticle (options, title, oldid) {
    var checkRevision;
    if (options.store) {
        checkRevision = options.store.checkArticle(title, oldid);
    } else {
        checkRevision = P.resolve(false);
    }

    return checkRevision
    .then(function(checkResult) {
        if (!checkResult) {
            if (options.verbose) {
                console.log('Dumping', title, oldid);
            }
            return preq.get(articleReqTpl.expand({
                request: {
                    params: Object.assign({title: title, oldid: oldid}, options)
                }
            }))
            .then(function(res) {
                if (options.store) {
                    return options.store.saveArticle(res.body, title, oldid);
                }
            });
        } else if (options.verbose) {
            console.log('Exists:', title, oldid);
        }
    });
}

// Processes chunks of articles one by one
function Dumper (articleChunkStream, options) {
    this.articleChunkStream = articleChunkStream;
    this.options = options;
    this.articles = [];
    this.waiters = [];
    this.done = false;
}

Dumper.prototype.processArticles = function (newArticles) {
    if (newArticles === null) {
        this.done = true;
        while(this.waiters.length) {
            this.waiters.pop().resolve(null);
        }
        return;
    }
    this.articles = newArticles.articles;
    while(this.waiters.length && this.articles.length) {
        this.waiters.pop().resolve(this.articles.shift());
    }
    if (this.waiters.length) {
        this.articleChunkStream.next().then(this.processArticles.bind(this));
    }
};

Dumper.prototype.getArticle = function () {
    var self = this;
    if (this.articles.length) {
        return P.resolve(this.articles.shift());
    } else {
        if (!this.waiters.length) {
            this.articleChunkStream.next().then(this.processArticles.bind(this));
        }
        return new P(function(resolve, reject) {
            self.waiters.push({resolve: resolve, reject: reject});
        });
    }
};

Dumper.prototype.next = function () {
    var self = this;
    return this.getArticle()
    .then(function(article) {
        if (article === null) {
            return null;
        }
        var title = article[0];
        var oldid = article[1];
        return dumpArticle(self.options, title, oldid)
        .catch(function(e) {
            console.error('Error in htmldumper:', title, oldid, e);
        });
    });
};


function dumpLoop (options) {
    var articleChunkStream = new PromiseStream(getArticles.bind(null, options),
            {next: ''}, 6);
    var dumper = new Dumper(articleChunkStream, options);
    var dumpStream = new PromiseStream(dumper.next.bind(dumper),
            undefined, 1, options.concurrency);

    var i = 0;
    return new P(function(resolve, reject) {
        function loop () {
            return dumpStream.next()
            .then(function (res) {
                if (res === null) {
                    return resolve();
                }
                if (i++ === 10000) {
                    i = 0;
                    process.nextTick(loop);
                } else {
                    return loop();
                }
            })
            .catch(function(e) {
                if (e instanceof String) {
                    resolve(e);
                } else {
                    reject(e);
                }
            });
        }

        return loop();
    });
}

function makeDump (options) {
    var storeSetup = P.resolve();
    if (options.saveDir) {
        storeSetup = makeFileStore(options);
    } else if (options.dataBase) {
        storeSetup = makeSQLiteStore(options);
    }

    // set up the article request template once on start-up
    articleReqTpl = new Template({
        method: 'get',
        uri: options.url,
        headers: {
            'user-agent': options.userAgent,
            'accept-encoding': 'gzip'
        },
        retries: 5,
        timeout: 60000,
        // Request a Buffer by default, don't decode to a String. This
        // saves CPU cycles, but also a lot of memory as large strings are
        // stored in the old space of the JS heap while Buffers are stored
        // outside the JS heap.
        encoding: null
    });

    return storeSetup
    .then(function(store) {
        options.store = store;
        return dumpLoop(options);
    })
    .then(function() {
        if (options.store && options.store.close) {
            return options.store.close();
        }
    });
}

module.exports = makeDump;
