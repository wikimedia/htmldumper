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

PromiseStream.prototype.next = function () {
    var self = this;
    function startRequest () {
        self._concurrency++;
        console.log('start', self._concurrency);
        var arg;
        if (Array.isArray(self._args) && self._args.length) {
            arg = self._args.shift();
        } else {
            arg = self._args;
            self._args = undefined;
        }
        return self._fn(arg).then(handleResult);
    }

    function handleResult (res) {
        console.log('end', self._concurrency);
        self._concurrency--;
        if (self._waiters.length) {
            self._waiters.shift().resolve(res);
        } else {
            self._buf.push(res);
        }
        if (!self._args) {
            self._args = res;
        }
        if (self._buf.length < self._size) {
            while (self._concurrency < self._maxConcurrency) {
                startRequest();
            }
        }

    }

    while (self._concurrency < self._maxConcurrency) {
        startRequest();
    }

    if (self._buf.length) {
        return Promise.resolve(self._buf.shift());
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
