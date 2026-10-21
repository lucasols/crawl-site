import { typedFetch, TypedFetchError } from '@ls-stack/typed-fetch';
import { createAsyncQueueWithMeta } from '@ls-stack/utils/asyncQueue';
import { serializeXML, type XMLNode } from '@ls-stack/utils/serializeXML';
import { isProbablyReaderable, Readability } from '@mozilla/readability';
import { Result, resultify } from 't-result';
import Turndown from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const turndown = new Turndown({ codeBlockStyle: 'fenced' });
turndown.use(gfm);

export type SiteFetcher = (
  url: URL,
  options: { signal: AbortSignal },
) => Promise<Result<{ url: string; content: string }, Error>>;

export type CrawlSiteOptions = {
  includeSubLinks?: boolean;
  maxSizeMb?: number;
  maxPageSizeMb?: number;
  concurrency?: number;
  abortController?: AbortController;
  maxFailureRate?: (totalPages: number) => number;
  maxPages?: number;
  showLogs?: boolean;
  /**
   * Fallback used when a direct fetch fails, e.g. because of CORS. Once a page
   * needs it, the following pages skip the direct fetch. Return a
   * `TypedFetchError` with status 404 to skip the page
   */
  siteFetcher?: SiteFetcher;
};

export type CrawlSiteResult = Result<
  { file: File; failures: string[]; successCount: number },
  {
    id:
      'maxFailureRate' | 'maxSize' | 'invalidUrl' | 'noContent' | 'maxPageSize';
  }
>;

export async function crawlSite(
  siteUrl: string,
  {
    includeSubLinks = false,
    maxSizeMb = 1,
    maxPageSizeMb = 1,
    concurrency = 8,
    abortController: abortControllerProp,
    maxFailureRate = (totalPages) => (totalPages <= 20 ? 0.5 : 0.25),
    maxPages = 500,
    showLogs,
    siteFetcher,
  }: CrawlSiteOptions,
): Promise<CrawlSiteResult> {
  const fetched = new Set<string>();
  let language: string | null = null;

  const initialUrlResult = safeURLCreator(siteUrl);

  if (!initialUrlResult.ok) {
    return Result.errId('invalidUrl');
  }

  const initialUrl = initialUrlResult.value;

  const startTime = Date.now();

  const abortController = abortControllerProp ?? new AbortController();

  type CrawlOkValue = true | 'skipped';
  type CrawlError =
    | { id: 'maxPages' | 'maxSize' | 'maxPageSize' | 'noContent' }
    | { id: 'unknownError'; error: Error };

  type CrawlResult = Result<CrawlOkValue, CrawlError>;

  const queue = createAsyncQueueWithMeta<
    CrawlOkValue,
    { url: string },
    CrawlError
  >({ signal: abortController.signal, concurrency, timeout: 60_000 * 5 });

  const extractedPages: Map<
    string,
    { title: string | null; content: string; size: number; url: string }
  > = new Map();

  let bypassCors = false;

  async function crawl(url: URL, initialPage = false): Promise<CrawlResult> {
    const { host, pathname } = url;

    if (extractedPages.size >= maxPages) return Result.errId('maxPages');

    if (fetched.has(pathname)) return Result.ok('skipped');

    fetched.add(pathname);

    const htmlResult = await getLinkContent(
      url,
      abortController,
      initialPage ? null : bypassCors,
      siteFetcher,
    );

    if (htmlResult.error && htmlResult.error instanceof TypedFetchError) {
      if (htmlResult.error.status === 404) return Result.ok('skipped');
    }

    if (!htmlResult.ok) {
      return Result.err({ id: 'unknownError', error: htmlResult.error });
    }

    if (!htmlResult.value.directCall) {
      bypassCors = true;
    }

    const responseUrl = new URL(htmlResult.value.url);

    fetched.add(responseUrl.pathname);

    const html = htmlResult.value.content;

    if (html.length > maxPageSizeMb * 1024 * 1024) {
      return Result.errId('maxPageSize');
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');

    const pageLanguage = doc.documentElement.getAttribute('lang') ?? null;

    if (initialPage) {
      language = pageLanguage;
    } else if (language && language !== pageLanguage) {
      return Result.ok('skipped');
    }

    // remove script,style,link,svg tags
    const elementsToRemove = doc.querySelectorAll('script,style,link,svg');

    for (const el of elementsToRemove) {
      el.remove();
    }

    const imgTags = doc.querySelectorAll('img');

    for (const img of imgTags) {
      // adjust src of img tags to produce a smaller output
      img.src = '#img.png';
    }

    const codeBlocks = doc.querySelectorAll('code');

    const classesToPreserve: string[] = [];

    for (const code of codeBlocks) {
      // adjust lang class if has data-lang attribute
      const langAttr = code.dataset.lang;

      if (langAttr) {
        code.classList.add(`language-${langAttr}`);
        classesToPreserve.push(`language-${langAttr}`);
      }
    }

    const pageLinks = doc.querySelectorAll('a');

    const extractedLinks = includeSubLinks ? new Set<URL>() : null;

    for (const link of pageLinks) {
      const href = link.getAttribute('href');

      if (!href) continue;

      if (href.startsWith('#')) continue;
      if (href.startsWith('mailto:')) continue;
      if (href.startsWith('javascript:')) continue;
      if (href.startsWith('data:')) continue;
      if (href.startsWith('tel:')) continue;

      const linkUrl = safeURLCreator(
        href,
        href.startsWith('/') ? url.toString() : undefined,
      ).unwrapOrNull();

      if (!linkUrl) continue;

      if (linkUrl.host !== host) continue;

      if (!linkUrl.pathname.startsWith(initialUrl.pathname)) continue;

      if (fetched.has(linkUrl.pathname)) continue;

      extractedLinks?.add(linkUrl);

      link.innerText = link.innerText.trim();
      link.setAttribute('href', linkUrl.toString());
    }

    if (extractedLinks && extractedLinks.size > 0) {
      for (const link of extractedLinks) {
        void queue.add(() => crawl(link), { meta: { url: link.toString() } });
      }
    }

    const title = doc.querySelector('title')?.textContent.trim() ?? null;

    if (!isProbablyReaderable(doc, { minScore: 10 })) {
      return Result.errId('noContent');
    }

    const article = new Readability(doc, { classesToPreserve }).parse();

    if (!article?.content) return Result.errId('noContent');

    const content = turndown.turndown(article.content);

    extractedPages.set(pathname, {
      title,
      content,
      size: content.length,
      url: url.toString(),
    });

    const allPages = Array.from(extractedPages.values());

    if (allPages.some((page) => page.content === content)) {
      return Result.ok('skipped');
    }

    const totalSize = allPages.reduce((acc, page) => acc + page.size, 0);

    if (totalSize > maxSizeMb * 1024 * 1024) {
      extractedPages.delete(pathname);
      queue.clear();
      abortController.abort();
      return Result.errId('maxSize');
    }

    return Result.ok(true);
  }

  void queue.add(() => crawl(initialUrl, true), {
    meta: { url: initialUrl.toString() },
  });

  if (showLogs) {
    queue.events.on('complete', ({ payload }) => {
      if (payload.value === 'skipped') return;

      console.info(`[crawlSite: ${siteUrl}] completed`, payload.meta.url);
    });
    queue.events.on('error', ({ payload }) => {
      console.info(
        `[crawlSite: ${siteUrl}] failed`,
        payload.meta.url,
        payload.error,
      );
    });
  }

  await queue.onIdle();

  const totalPages = extractedPages.size + queue.failed;

  if (showLogs) {
    console.info(`[crawlSite: ${siteUrl}] finished`, {
      totalPages,
      extractedPages,
      failures: queue.failures,
      time: Date.now() - startTime,
    });
  }

  for (const { error } of queue.failures) {
    if (error instanceof Error) continue;

    if (error.id === 'maxSize') {
      return Result.errId('maxSize');
    }
  }

  if (extractedPages.size === 0) {
    return Result.errId('noContent');
  }

  if (queue.failed / totalPages > maxFailureRate(totalPages)) {
    return Result.errId('maxFailureRate');
  }

  const serializedPages = serializePages(extractedPages);

  return Result.ok({
    file: new File([serializedPages], 'site.html', { type: 'text/html' }),
    failures: queue.failures.map(({ meta }) =>
      meta.url.replace('https://', '').replace('http://', ''),
    ),
    successCount: extractedPages.size,
  });
}

function safeURLCreator(url: string, baseUrl?: string): Result<URL> {
  return resultify(() => new URL(url, baseUrl));
}

function serializePages(
  pages: Map<string, { title: string | null; content: string; url: string }>,
): string {
  return serializeXML(
    Array.from(pages.values()).map((page): XMLNode => ({
      name: 'page',
      children: [
        { name: 'url', children: ` ${page.url} ` },
        !!page.title && { name: 'title', children: page.title },
        {
          name: 'content',
          attrs: { format: 'markdown' },
          children: page.content,
          escapeText: false,
        },
      ],
    })),
    { indent: 2 },
  );
}

async function getLinkContent(
  link: URL,
  abortController: AbortController,
  bypassCors: boolean | null,
  siteFetcher: SiteFetcher | undefined,
): Promise<Result<{ url: string; content: string; directCall?: true }, Error>> {
  if (!bypassCors) {
    let responseUrl = link;

    const result = await typedFetch(link, {
      jsonResponse: false,
      timeoutMs: 60_000,
      signal: abortController.signal,
      responseIsValid({ headers, url }) {
        const contentType = headers.get('content-type');

        if (!contentType?.includes('text/html')) {
          return new Error(`Invalid content type: ${contentType ?? '?'}`);
        }

        responseUrl = new URL(url);

        const responseHost = responseUrl.host;

        if (link.host !== responseHost) {
          return new Error(`Redirected from ${link.host} to ${responseHost}`);
        }

        return true;
      },
    });

    if (result.ok) {
      return Result.ok({
        url: responseUrl.toString(),
        content: result.value,
        directCall: true,
      });
    }

    if (bypassCors === false || !siteFetcher) return result.errorResult();
  }

  if (!siteFetcher) return Result.err(new Error('No site fetcher'));

  const result = await siteFetcher(link, { signal: abortController.signal });

  if (!result.ok) return result.errorResult();

  const responseUrl = safeURLCreator(result.value.url).unwrapOrNull();

  if (!responseUrl) return Result.err(new Error('Invalid site fetcher url'));

  return Result.ok({
    url: responseUrl.toString(),
    content: result.value.content,
  });
}
