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
  --ns                [required]
  --host              [required]
  --domain, --prefix  [default: ""]
  -d, --saveDir       [default: ""]
  -t, --startTitle    [default: ""]
  -a, --userAgent     [default: "HTMLDumper"]
  --db, --dataBase    [default: ""]
  --verbose           [default: true]
  -c, --concurrency   [default: 50]
  -u, --url           [default: "{{host}}/{{domain}}/v1/page/html/{title}/{oldid}"]
```

Parameters:
- **`apiURL`**: The location of the Wiki's MW Action API end point.
- **`ns`**: The namespace index to dump.
- **`host`**: The host to send the dump requests to.
- **`domain`**: If the host contains multiple domains, the one to reach.
- **`saveDir`**: If saving the contents of the dump to a directory structure,
  this is the path to the root of the directory (see the following section).
- **`startTitle`**: If resuming a Wiki dump, the article title to start with.
- **`userAgent`**: The UserAgent header to use when sending requests. Default:
  `HMTLDumper`
- **`dataBase`**: If saving the contents to a SQLite3 database, the path to the
  file to save it to (see the next sections).
- **`verbose`**: Be verbose.
- **`concurrency`**: The number of parallel article fetches to do. Default:
  `50`.
- **`url`**: The [URL
  template](https://github.com/wikimedia/swagger-router#uri-templating) to use
  when making requests for each article. The available parameters are: `title`,
  `oldid` and all of the options that can be set on the command line (`host`,
  `domain`, etc.). Default: `{{host}}/{{domain}}/v1/page/html/{title}/{oldid}`

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
