"use strict";
var P = require('bluebird');
var fs = P.promisifyAll(require('fs'));
var sqlite3 = P.promisifyAll(require('sqlite3'));

var pragmas = [
    'PRAGMA main.page_size = 4096',
    'PRAGMA main.cache_size=10000',
    'PRAGMA main.locking_mode=EXCLUSIVE',
    'PRAGMA main.synchronous=OFF', // more dangerous, but fast
    'PRAGMA mmap_size=1099511627776',  // use fast mmap for entire db
    'PRAGMA journal_mode=MEMORY',  // live risky but fast
    //'PRAGMA main.synchronous=NORMAL',
    //'PRAGMA main.journal_mode=WAL', // WAL is annoying for distributed files
];

var createTableQuery = 'CREATE TABLE IF NOT EXISTS data('
        + 'title TEXT,'
        + 'revision INTEGER,'
        + 'tid TEXT,' // etag header, reordered
        + 'body TEXT,'
        // Metadata that we'll have to extract from the revision or HTML head.
        + 'page_id INTEGER,' // missing from revision metadata
        + 'namespace INTEGER,'
        + 'timestamp TEXT,' // missing from revision metadata
        + 'comment TEXT,'
        + 'user_name TEXT,'
        + 'user_id INTEGER,'
        + 'PRIMARY KEY(title ASC, revision DESC)'
        + ')';

var checkQuery = 'select revision from data where title = ? and revision = ? limit 1';
var purgeTitleQuery = 'delete from data where title = ?';
var saveQuery = 'insert into data (title, revision, body, namespace) values (?,?,?,?)';

function SQLiteStore(options) {
    this.options = options;
    this.db = new sqlite3.Database(options.dataBase);
}

SQLiteStore.prototype.setup = function() {
    var self = this;
    return this.db.execAsync(createTableQuery)
        .then(function() {
            return P.all(pragmas.map(function(pragma) {
                return self.db.execAsync(pragma);
            }));
        })
        .then(function() {
            self.queries = {
                check: self.db.prepare(checkQuery),
                purgeTitle: self.db.prepare(purgeTitleQuery),
                save: self.db.prepare(saveQuery),
            };
            return self;
        });
};

SQLiteStore.prototype.checkArticle = function checkArticle (title, oldid) {
    return this.queries.check.getAsync(title, oldid);
};

SQLiteStore.prototype.saveArticle = function saveArticle (body, title, oldid) {
    var self = this;
    return this.queries.purgeTitle.runAsync(title)
    .then(function() {
        return self.queries.save.runAsync(title, oldid, body);
    });
};

SQLiteStore.prototype.close = function () {
    var self = this;
    return P.delay(1000)
        .then(function() { return self.db.closeAsync(); });
};

module.exports = function makeSQLiteStore(options) {
    return new SQLiteStore(options).setup();
};
