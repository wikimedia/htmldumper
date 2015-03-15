"use strict";

var Bluebird = require('bluebird');

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
var fs = Bluebird.promisifyAll(require('fs'));
var PromiseStream = require('./PromiseStream');

// Article dump parallelism
var maxConcurrency = 50;

function getArticles (options, res) {
    var next = res.next || '';
    if (next === 'finished') {
        // nothing more to do.
        return Bluebird.reject('Articles done');
    }

    var url = options.apiURL + '?action=query&generator=allpages&gapfilterredir=nonredirects'
        + '&gaplimit=500&prop=revisions&gapnamespace='
        + options.ns + '&format=json&gapcontinue=' + encodeURIComponent( next );
    //console.log(url);

    return preq.get({
        uri: url,
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
        var next2 = res2['query-continue'].allpages.gapcontinue;
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

function checkArticle (options, title, oldid) {
    var dumpDir = options.saveDir + '/' + options.prefix;
    var dirName = dumpDir + '/' + encodeURIComponent(title);
    var fileName = dirName + '/' + oldid;
    return fs.statAsync(fileName)
    .catch(function(e) {
        return false;
    })
    .then(function(fileStats) {
        // Check if we already have this article revision
        if (fileStats && fileStats.isFile()) {
            // We already have the article, nothing to do.
            // XXX: Also track / check last-modified time for template
            // re-expansions without revisions change
            console.log('Exists:', title, oldid);
            return true;
        } else {
            return false;
        }
    });
}

function saveArticle (options, body, title, oldid) {
    var dumpDir = options.saveDir + '/' + options.prefix;
    var dirName = dumpDir + '/' + encodeURIComponent(title);
    var fileName = dirName + '/' + oldid;
    return fs.readdirAsync(dirName)
    .catch(function(e) {
        return fs.mkdirAsync(dumpDir)
        .catch(function(){})
        .then(function() {
            return fs.mkdirAsync(dirName);
        })
        .then(function() {
            return fs.readdirAsync(dirName);
        });
    })
    .then(function(files) {
        // Asynchronously unlink other files
        files.forEach(function(file) {
            fs.unlinkAsync(dirName + '/' + file);
        });
        return fs.writeFileAsync(fileName, body);
    });
}

function dumpArticle (options, title, oldid) {
    var checkRevision;
    if (options.saveDir) {
        checkRevision = checkArticle(options, title, oldid);
    } else {
        checkRevision = Bluebird.resolve(false);
    }

    return checkRevision
    .then(function(checkResult) {
        if (!checkResult) {
            console.log('Dumping', title, oldid);
            var url = options.host + '/' + options.prefix
                        + '/v1/page/html/' + encodeURIComponent(title) + '/' + oldid;
            return preq.get({
                uri: url,
                headers: {
                    'accept-encoding': 'gzip'
                },
                retries: 5,
                timeout: 60000,
                // Request a Buffer by default, don't decode to a String. This
                // saves CPU cycles, but also a lot of memory as large strings are
                // stored in the old space of the JS heap while Buffers are stored
                // outside the JS heap.
                encoding: null
            })
            .then(function(res) {
                //console.log('done', title);
                if (options.saveDir) {
                    return saveArticle(options, res.body, title, oldid);
                }
            });
        }
    });
}

// Processes chunks of articles one by one
function Dumper (articleChunkStream, options) {
    this.articleChunkStream = articleChunkStream;
    this.options = options;
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
        return Bluebird.resolve(this.articles.shift());
    } else {
        if (!this.waiters.length) {
            this.articleChunkStream.next().then(this.processArticles.bind(this));
        }
        return new Bluebird(function(resolve, reject) {
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
        return dumpArticle(self.options, title, oldid)
        .catch(function(e) {
            console.error('Error in makeDump:', title, oldid, e);
        });
    });
};


function makeDump (options) {
    // XXX: abstract this into some kind of buffered 'spread' utility
    var articleChunkStream = new PromiseStream(getArticles.bind(null, options),
            {next: ''}, 6);
    var dumper = new Dumper(articleChunkStream, options);
    var dumpStream = new PromiseStream(dumper.next.bind(dumper),
            undefined, 1, maxConcurrency);

    var i = 0;
    function loop () {
        return dumpStream.next()
        .then(function () {
            if (i++ === 10000) {
                i = 0;
                process.nextTick(loop);
            } else {
                return loop();
            }
        })
        .catch(function(e) {
            console.log(e);
        });
    }

    return loop();
}

if (module.parent === null) {
    var argParser = require('yargs')
        .usage('Create a HTML dump in a subdir\nUsage: $0'
                + '\nExample:\nnode htmldumper.js --domain en.wikipedia.org --ns 0 --apiURL http://en.wikipedia.org/w/api.php')
        .demand(['apiURL', 'domain', 'ns', 'host'])
        .options('h', {
            alias: 'help'
        })
        .alias('domain', 'prefix')
        .options('d', {
            alias : 'saveDir',
            default : ''
        })
        //.default('apiURL', 'http://en.wikipedia.org/w/api.php')
        //.default('prefix', 'en.wikipedia.org')
        //.default('ns', '0')
        .default('host', 'http://rest.wikimedia.org');

    var argv = argParser.argv;
    if (argv.h) {
        argParser.showHelp();
        process.exit(1);
    }

    // Strip a trailing slash
    argv.host = argv.host.replace(/\/$/, '');

    argv.ns = Number(argv.ns);
    return makeDump(argv)
    .then(function(res) {
        console.log('Dump done.');
    })
    .catch(function(err) {
        console.error('Error in main;', err);
    });
}

module.exports = makeDump;
