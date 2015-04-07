"use strict";
var P = require('bluebird');
var fs = P.promisifyAll(require('fs'));
var sqlite3 = P.promisifyAll(require('sqlite3'));

var pragmas = [
    'PRAGMA main.page_size = 4096',
    'PRAGMA main.cache_size=10000',
    'PRAGMA main.locking_mode=EXCLUSIVE',
    'PRAGMA main.synchronous=NORMAL',
    'PRAGMA main.journal_mode=WAL',
    'PRAGMA main.cache_size=5000'
];
var createTableQuery = 'CREATE TABLE IF NOT EXISTS data('
        + 'title TEXT, revision INTEGER, body BLOB, namespace INTEGER'
        + ', PRIMARY KEY(title ASC, revision DESC)'
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

module.exports = function makeSQLiteStore(options) {
    return new SQLiteStore(options).setup();
};
