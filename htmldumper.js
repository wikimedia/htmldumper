"use strict";

if (!global.Promise || !global.promise.promisify) {
    global.Promise = require('bluebird');
}

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
var fs = Promise.promisifyAll(require('fs'));
var PromiseStream = require('./PromiseStream');

// Article dump parallelism
var maxConcurrency = 30;

function getArticles (options, res) {
    var next = res.next || '';
    if (next === 'finished') {
        // nothing more to do.
        return Promise.reject('Articles done');
    }

    var url = options.apiURL + '?action=query&generator=allpages&gapfilterredir=nonredirects'
        + '&gaplimit=500&prop=revisions&gapnamespace='
        + options.ns + '&format=json&gapcontinue=' + encodeURIComponent( next );
    //console.log(url);

    return preq.get(url, {
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

function saveArticle (options, body, title, oldid) {
    var dirName = options.saveDir + '/' + options.prefix
        + '/' + encodeURIComponent(title);
    var fileName = dirName + '/' + oldid;
    return fs.readdirAsync(dirName)
    .catch(function(e) {
        return fs.mkdirAsync(dirName)
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
        console.log('Dumping', title, oldid);
	var url = 'http://' + options.host + '/' + options.prefix
                + '/v1/page/' + encodeURIComponent(title) + '/html/' + oldid;
        return preq.get({
            uri: url,
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
    var argv = require('yargs')
        .usage('Create a HTML dump in a subdir\nUsage: $0'
                + '\nExample: node htmldumper.js --prefix en.wikipedia.org --ns 0 --apiURL http://en.wikipedia.org/w/api.php')
        .demand(['apiURL', 'prefix', 'ns', 'host'])
        .options('d', {
            alias : 'saveDir',
            default : ''
        })
        //.default('apiURL', 'http://en.wikipedia.org/w/api.php')
        //.default('prefix', 'en.wikipedia.org')
        //.default('ns', '0')
        //.default('host', 'https://rest.wikimedia.org')
        .argv;

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
