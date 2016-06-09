# htmldumper
HTML dump script for RESTBase APIs like https://rest.wikimedia.org/.

## Installation

`npm install`

## Usage: Dumping a single wiki

```
$ node bin/dump_wiki --help
Create a HTML dump in a subdir

Example:
/usr/bin/nodejs ./bin/dump_wiki --domain en.wikipedia.org --ns 0 --apiURL http://en.wikipedia.org/w/api.php

Options:
  --apiURL            [required]
  --domain, --prefix  [required]
  --ns                [required]
  --host              [required]  [default: "http://rest.wikimedia.org"]
  -d, --saveDir       [default: ""]
  -t, --startTitle    [default: ""]
  --db, --dataBase    [default: ""]
  --verbose           [default: true]
```

### Filesystem output

With `--saveDir` as specified in the example above, a directory structure like
this will be created:

```
/tmp/
  en.wikikpedia.org/
    Aaa/
      123456
    Bbbb/
      456768
```

The directory names for articles are percent-encoded using JavaScript's
`encodeURIComponent()`. On a repeat run with the same `--saveDir` path, only
updated articles are downloaded. Outdated revisions are deleted. These
incremental dumps speed up the process significantly, and reduce the load on
the servers.

### SQLite database output

With `--dataBase` set to `someSQLiteDB.db`, a database will be created /
updated. The schema currently looks like this:

```sql
REATE TABLE data(
    title TEXT,
    revision INTEGER,
    tid TEXT,
    body TEXT,
    page_id INTEGER,
    namespace INTEGER,
    timestamp TEXT,
    comment TEXT,
    user_name TEXT,
    user_id INTEGER,
    PRIMARY KEY(title ASC, revision DESC)
);
```

## Usage: dumping all RESTBase wikis

You need to install `pixz`, which is used for parallel lzma / xz compression:

`apt-get install pixz`

With this in place, follow the instructions:

```bash
# node bin/dump_restbase --help

Create HTML dumps in a directoy

Example usage:
node ./bin/dump_restbase --workDir /tmp --dumpDir /tmp

Options:
  -h, --help     Show help and exit.
  -v, --verbose  Verbose logging
  --workDir      Directory to use for in-progress dump files  [default: "/tmp"]
  --dumpDir      Directory to use for finished dump files     [default: "/tmp"]
```
