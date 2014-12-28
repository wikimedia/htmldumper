"use strict";

if (!global.Promise || !global.promise.promisify) {
    global.Promise = require('bluebird');
}

var preq = require('preq');
var fs = Promise.promisifyAll(require('fs'));
var PromiseStream = require('./PromiseStream');

// Article dump parallelism
var maxConcurrency = 10;

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

    return preq.get(url, { timeout: 60* 1000, retries: 5 })
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
        var next2 = res2['query-continue'].allpages.gapcontinue;
        // XXX
        //next = 'finished';
        return {
            articles: articles,
            next: next2
        };
    })
    .catch(function(e) {
        console.error('Error in getArticles:', e);
        throw e;
    });
}


function dumpArticle (prefix, title, oldid, host) {
        console.log('Dumping', title, oldid);
	var url = 'http://' + host + '/v1/'
                + prefix + '/pages/' + encodeURIComponent(title) + '/html/' + oldid;
        return preq.get({uri: url, retries: 5, timeout: 60000 })
        .then(function(res) {
            //console.log('done', title);
            return;
        });
}

// Processes chunks of articles one by one
function Dumper (articleChunkStream, prefix, host) {
    this.articleChunkStream = articleChunkStream;
    this.prefix = prefix;
    this.host = host;
    this.articles = [];
    this.waiters = [];
}

Dumper.prototype.processArticles = function (newArticles) {
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
        return Promise.resolve(this.articles.shift());
    } else {
        if (!this.waiters.length) {
            this.articleChunkStream.next().then(this.processArticles.bind(this));
        }
        return new Promise(function(resolve, reject) {
            self.waiters.push({resolve: resolve, reject: reject});
        });
    }
};

Dumper.prototype.next = function () {
    var self = this;
    return this.getArticle()
    .then(function(article) {
        var title = article[0];
        var oldid = article[1];
        return dumpArticle(self.prefix, title, oldid, self.host)
        .catch(function(e) {
            console.error('Error in makeDump:', title, oldid, e);
        });
    });
};


function makeDump (apiURL, prefix, ns, host) {
    var articleArgs = {
        apiURL: apiURL,
        namespace: ns,
        next: ''
    };

    // XXX: abstract this into some kind of buffered 'spread' utility
    var articleChunkStream = new PromiseStream(getArticles.bind(null, apiURL, ns),
            {next: ''}, 6);
    var dumper = new Dumper(articleChunkStream, prefix, host);
    var dumpStream = new PromiseStream(dumper.next.bind(dumper),
            undefined, 1, maxConcurrency);

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
        .demand(['apiURL', 'prefix', 'ns', 'host'])
        //.default('apiURL', 'http://en.wikipedia.org/w/api.php')
        //.default('prefix', 'enwiki')
        //.default('ns', '0')
        .argv;

    return makeDump(argv.apiURL, argv.prefix, Number(argv.ns), argv.host)
    .then(function(res) {
        console.log('Dump done.');
    })
    .catch(function(err) {
        console.error('Error in main;', err);
    });
}

module.exports = makeDump;
