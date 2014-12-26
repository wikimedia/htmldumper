"use strict";

function PromiseStream (fn, args, size, maxConcurrency) {
    this._buf = [];
    this._fn = fn;
    this._args = args;
    this._size = size;
    this._concurrency = 0;
    this._maxConcurrency = maxConcurrency || 1;
    this._waiters = [];
}


PromiseStream.prototype._startRequest = function () {
    this._concurrency++;
    //console.log('start', self._concurrency);
    var arg;
    if (Array.isArray(this._args) && this._args.length) {
        arg = this._args.shift();
    } else {
        arg = this._args;
        this._args = undefined;
    }
    return this._fn(arg).then(this._handleResult.bind(this));
};

PromiseStream.prototype._handleResult = function (res) {
    //console.log('end', self._concurrency);
    this._concurrency--;
    if (this._waiters.length) {
        this._waiters.shift().resolve(res);
    } else {
        this._buf.push(res);
    }
    if (!this._args) {
        this._args = res;
    }
    if (this._buf.length < this._size) {
        while (this._concurrency < this._maxConcurrency) {
            this._startRequest();
        }
    }
};

PromiseStream.prototype.next = function () {
    var self = this;

    while (this._concurrency < this._maxConcurrency) {
        this._startRequest();
    }

    if (this._buf.length) {
        return Promise.resolve(this._buf.shift());
    } else {
        return new Promise(function(resolve, reject) {
            self._waiters.push({
                resolve: resolve,
                reject: reject
            });
        });
    }
};

module.exports = PromiseStream;
