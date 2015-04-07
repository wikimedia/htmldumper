"use strict";
var Bluebird = require('bluebird');
var fs = Bluebird.promisifyAll(require('fs'));

function FileStore(options) {
    this.options = options;
}

FileStore.prototype.checkArticle = function checkArticle (title, oldid) {
    var options = this.options;
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
};

FileStore.prototype.saveArticle = function saveArticle (body, title, oldid) {
    var options = this.options;
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
};

module.exports = FileStore;
