"use strict";
var suspend = require('suspend'),
	resume = suspend.resume,
	request = require('request'),
	async = require('async'),
	http = require('http'),
	fs = require('fs');

// Higher per-host parallelism
var maxConcurrency = 15;
http.globalAgent.maxSockets = 50;

// retrying URL get helper
function* getURL (url) {
	var resp,
		wait = 0.1; // 10 retries, 0.1 * 2^10 = 102.4
	while (wait < 110) {
		if (resp && resp.statusCode === 200) {
			return resp.body;
		} else if (resp && resp.statusCode !== 503) {
			throw new Error(resp.statusCode);
		} else {
			// retry after waiting for a bit
			if (resp !== undefined) {
				yield setTimeout(resume(), wait);
			}
			try {
				resp = yield request.get(url, { timeout: 40*1000 }, resume());
			} catch (e) {
				console.error(e);
				resp = null;
			}
			wait = wait * 2;
		}
	}
	throw new Error('getURL failed:', url);
}

function* getArticles (apiURL, namespace) {
	var articles = [],
		next = '';

	while (next !== 'finished') {
		var url = apiURL + '?action=query&generator=allpages&gapfilterredir=nonredirects'
			+ '&gaplimit=500&prop=revisions&gapnamespace='
			+ namespace + '&format=json&gapcontinue=' + encodeURIComponent( next );
		console.log(url);
		try {
			var res = JSON.parse(yield* getURL(url)),
				articleChunk = res.query.pages;
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
		} catch(e) {
			console.error('Error in getArticles:', e);
		}
	}
	return articles;
}

function* dumpArticle (prefix, title, oldid) {
	console.log('Dumping', title, oldid);
	var body = yield* getURL('http://parsoid-lb.eqiad.wikimedia.org/'
			+ prefix + '/' + encodeURIComponent(title) + '?oldid=' + oldid);
	var dirName = prefix + '/' + encodeURIComponent(title),
		fileName = dirName + '/' + oldid;
	try {
		yield fs.mkdir(dirName, resume());
	} catch (e) {}
	// strip data-parsoid
	body = body.replace(/ ?data-parsoid=(?:'[^']+'|"[^"]+"|\\".*?\\"|&#39;.*?&#39;)/g, '');
	return yield fs.writeFile(fileName, body, resume());
}

function* makeDump (apiURL, prefix, ns) {
	// Set up directories
	try {
		fs.mkdirSync(prefix);
	} catch (e) {}
	var articles = yield* getArticles(apiURL, ns);
	//console.log(articles);
	var dumpArticleFn = suspend.async(function* (article) {
		var title = article[0],
			oldid = article[1];
		try {
			return yield* dumpArticle(prefix, title, oldid);
		} catch (e) {
			console.error('Error in makeDump:', title, oldid, e);
		}
	});
	yield async.eachLimit(articles, maxConcurrency, dumpArticleFn, resume());
}

if (module.parent === null) {
	var argv = require('yargs')
		.default('apiURL', 'http://en.wikipedia.org/w/api.php')
		.default('prefix', 'enwiki')
		.default('ns', '0')
		.argv;

	suspend.async(makeDump)(
			argv.apiURL,
			argv.prefix,
			Number(argv.ns),
			function(err, res) {
				if (err) {
					console.error('Error in main;', err);
				} else {
					console.log('Dump done.');
				}
			});
}

module.exports = makeDump;
