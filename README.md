# htmldumper
HTML dump script for Parsoid HTML, using ES6 generators

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

