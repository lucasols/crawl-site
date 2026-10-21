# @ls-stack/crawl-site

Crawls a site in the browser and extracts the readable content of its pages as markdown, using [Readability](https://github.com/mozilla/readability) and [Turndown](https://github.com/mixmark-io/turndown).

Browser only, it relies on `DOMParser` and `File`.

## Installation

```bash
pnpm add @ls-stack/crawl-site
```

## Usage

```ts
import { crawlSite } from '@ls-stack/crawl-site';

const result = await crawlSite('https://docs.example.com/guides', {
  includeSubLinks: true,
});

if (!result.ok) {
  // 'maxFailureRate' | 'maxSize' | 'invalidUrl' | 'noContent' | 'maxPageSize'
  throw new Error(result.error.id);
}

const { file, successCount, failures } = result.value;
```

`file` is a `site.html` file with one `<page>` per extracted page:

```xml
<page>
  <url> https://docs.example.com/guides </url>
  <title>Guides</title>
  <content format="markdown">
    ...
  </content>
</page>
```

With `includeSubLinks`, the crawler follows links on the same host whose path starts with the initial url path. Pages in a different `lang` than the initial page are skipped.

### Options

| option            | default                            | description                                                           |
| ----------------- | ---------------------------------- | --------------------------------------------------------------------- |
| `includeSubLinks` | `false`                            | follow the links of each page                                         |
| `maxSizeMb`       | `1`                                | max size of all extracted markdown                                    |
| `maxPageSizeMb`   | `1`                                | max size of a page html                                               |
| `maxPages`        | `500`                              | max pages extracted                                                   |
| `concurrency`     | `8`                                | pages fetched in parallel                                             |
| `maxFailureRate`  | `0.5` up to 20 pages, `0.25` after | returns `maxFailureRate` when the rate of failed pages is higher      |
| `abortController` |                                    | aborts the crawl                                                      |
| `siteFetcherUrl`  |                                    | fallback fetcher used when a direct fetch fails, e.g. because of CORS |
| `showLogs`        | `false`                            | logs each page                                                        |

### Site fetcher

Browsers block most cross origin fetches, so pass a `siteFetcherUrl` to fall back to a server side fetcher. It receives the page as the `url` search param and must respond with the final url after redirects, a `\n---\n` separator and the page html. Once a page needs the fetcher, the following pages skip the direct fetch.
