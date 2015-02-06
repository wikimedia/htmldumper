# htmldumper
HTML dump script for Parsoid HTML

## Installation

`npm install`

## Usage

```
Usage: node ./htmldumper
Example: node htmldumper.js --prefix en.wikipedia.org \
  --ns 0 --apiURL http://en.wikipedia.org/w/api.php \
  --host https://rest.wikimedia.org/ --saveDir /tmp

Options:
  --apiURL       [required]
  --prefix       [required]
  --ns           [required]
  --host         [required]
  -d, --saveDir  [default: no saving]
```

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
