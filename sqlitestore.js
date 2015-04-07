"use strict";
var P = require('bluebird');
var fs = P.promisifyAll(require('fs'));
var sqlite3 = P.promisifyAll(require('sqlite3'));

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
    this.db.exec(createTableQuery);
    this.queries = {
        check: this.db.prepare(checkQuery),
        purgeTitle: this.db.prepare(purgeTitleQuery),
        save: this.db.prepare(saveQuery),
    };
}

SQLiteStore.prototype.checkArticle = function checkArticle (title, oldid) {
    return this.queries.check.getAsync(title, oldid)
};

SQLiteStore.prototype.saveArticle = function saveArticle (body, title, oldid) {
    var self = this;
    return this.queries.purgeTitle.runAsync(title)
    .then(function() {
        return self.queries.save.runAsync(title, oldid, body);
    });
};

module.exports = SQLiteStore;
