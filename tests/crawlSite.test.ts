import { typedFetch } from '@ls-stack/typed-fetch';
import fetchMock from 'fetch-mock';
import fs from 'node:fs';
import path from 'node:path';
import { Result } from 't-result';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { crawlSite, type SiteFetcher } from '../src/main';

const siteFetcherUrl = 'https://site-fetcher.test';

const siteFetcher: SiteFetcher = async (url, { signal }) => {
  const fetchUrl = new URL(siteFetcherUrl);

  fetchUrl.searchParams.set('url', url.toString());

  const result = await typedFetch(fetchUrl, {
    jsonResponse: false,
    timeoutMs: 60_000,
    signal,
  });

  if (!result.ok) return result.errorResult();

  const [responseUrl, content] = result.value.split('\n---\n', 2);

  if (!responseUrl || !content) {
    return Result.err(new Error('Invalid response'));
  }

  return Result.ok({ url: responseUrl, content });
};

beforeEach(() => {
  fetchMock.mockGlobal();
});

afterEach(() => {
  fetchMock.hardReset();
});

function getFixture(name: string) {
  return fs.readFileSync(
    path.join(import.meta.dirname, 'fixtures', name),
    'utf8',
  );
}

test('correctly convert page to markdown', async () => {
  const html = getFixture('mock-1.html');

  fetchMock.get('https://docs.jestor.com', {
    body: html,
    headers: { 'Content-Type': 'text/html' },
  });

  const result = await crawlSite('https://docs.jestor.com', {
    includeSubLinks: false,
  });

  expect(await result.unwrap().file.text()).toMatchInlineSnapshot(`
    "<page>
      <url> https://docs.jestor.com/ </url>
      <title>Custom Low-Code Pages and Apps</title>
      <content format="markdown">
        In jestor, you can create custom pages in which everything is created by you, even the interface. This tab will only use jestor's overall structure (menus and settings), but the content of the page itself will be defined by your own back-end and front-end customizations.

        This allows users to create fully personalized parts of jestor, and even create internal apps for specific functions.

        To create a page, access the Developer Area and click on **Pages**, then **+Create new page**. Name your new page and press Create.

        > 📘
        > 
        > The page's URL
        > 
        > 
        > --------------------
        > 
        > This new page will be accessible through jestor's menu, and it's URL will be:  
        > your-org.jestor.com/custom-app/name-of-the-page

        After the page is created, you'll be able to customize back-end and front-end on their designated consoles. On the example below, we fetch the first record of the table Leads and print their name and status on the page.

        ![1867](#img.png "Screenshot 2023-01-24 at 15.11.03.png")

        Here's the back-end part:

        \`\`\`php
        $searchLeads = Jestor.loadData('leads','id_leads asc');
        $searchLeads = $searchLeads[0];
        \`\`\`

        And here's the front-end part:

        \`\`\`javascript
        {{ $searchLeads['name'] }}
        <br>{{ $searchLeads['status'] }}
        \`\`\`

        In the example above, you can see that we use jestor's native method Jestor.loadData to fetch data on the back-end console, and then use it on the front-end console to display information to the user. In jestor, you can run PHP functions directly on the front-end console by using the format {% %}, as we can see on the example below:

        \`\`\`javascript
        {% $jestor = "Gestão do seu jeito!" %}
        \`\`\`

        So we could, for example, run the Jestor.loadData directly on the code above. In the Leads example, we run this search on the back-end and then access the resulting value on the front-end by calling on the variable that received the data on the back-end ($searchLeads).

        Then, if we wish to show this result to our user, we can use the format {{ }} to print a value on the page. This is what we did on the Leads example:

        \`\`\`javascript
        {{ $searchLeads['name'] }}
        <br>{{ $searchLeads['status'] }}
        \`\`\`

        By using this structure, you can run things like If conditions or loops and show a dynamic result on the page.

        You can also create specific functions and styles to be called on the page, allowing you a great deal of personalization both structurally and on the user interface.

        Updated over 1 year ago

        * * *

        *   [Components and functions](https://docs.jestor.com/docs/components-and-functions)
        *   [Front-end functions (Javascript)](https://docs.jestor.com/docs/front-end-functions-javascript)
        *   [Objects and Record types](https://docs.jestor.com/docs/objects-and-record-types)

        *   [Table of Contents](#)
        *   *   [Custom Pages](#custom-pages)
            *   [Creating a Page](#creating-a-page)
            *   [Using PHP on the Front-End](#using-php-on-the-front-end)
      </content>
    </page>"
  `);
});

test('returns error when html is not structured', async () => {
  const html = getFixture('unstructured.html');

  fetchMock.get('https://docs.jestor.com', {
    body: html,
    headers: { 'Content-Type': 'text/html' },
  });

  const result = await crawlSite('https://docs.jestor.com', {
    includeSubLinks: false,
  });

  expect(result.error && result.error.id).toEqual('noContent');
});

test('returns error when html has no content', async () => {
  const html = getFixture('no-content.html');

  fetchMock.get('https://docs.jestor.com', {
    body: html,
    headers: { 'Content-Type': 'text/html' },
  });

  const result = await crawlSite('https://docs.jestor.com', {
    includeSubLinks: false,
  });

  expect(result.error && result.error.id).toEqual('noContent');
});

test('returns html when content is small', async () => {
  const html = getFixture('valid-small-content.html');

  fetchMock.get('https://docs.jestor.com', {
    body: html,
    headers: { 'Content-Type': 'text/html' },
  });

  const result = await crawlSite('https://docs.jestor.com', {
    includeSubLinks: false,
  });

  expect(result.ok).toBe(true);
  expect(await result.unwrap().file.text()).toMatchInlineSnapshot(`
    "<page>
      <url> https://docs.jestor.com/ </url>
      <title>Car Plate</title>
      <content format="markdown">
        ![](#img.png)

        What is the Car Plate field?

        [](#what-is-the-car-plate-field)
        ----------------------------------------------------------------

        Code representing a vehicle limiting it to a 7-digit id.

        ![](#img.png)

        How to create

        [](#how-to-create)
        -----------------------------------

        To create a Car Plate field:

        *   On table mode, go to the last table header with a **"+"** or press (F).
        *   Just look for the **"Car Plate"** option and click on it

        Updated over 1 year ago

        * * *

        *   [Table of Contents](#)
        *   *   [What is the Car Plate field?](#what-is-the-car-plate-field)
            *   [How to create](#how-to-create)
      </content>
    </page>"
  `);
});

test('returns html when content is small 2', { timeout: 10_000 }, async () => {
  const html = getFixture('valid-small-content-2.html');

  fetchMock.get('https://docs.jestor.com', {
    body: html,
    headers: { 'Content-Type': 'text/html' },
  });

  const result = await crawlSite('https://docs.jestor.com', {
    includeSubLinks: false,
  });

  expect(result.ok).toBe(true);
  expect(await result.unwrap().file.text()).toMatchInlineSnapshot(`
    "<page>
      <url> https://docs.jestor.com/ </url>
      <title>Favorite</title>
      <content format="markdown">
        ![](#img.png)

        What is the Favorite field?

        [](#what-is-the-favorite-field)
        --------------------------------------------------------------

        Bookmark records and cards.

        ![](#img.png)

        How to create

        [](#how-to-create)
        -----------------------------------

        To create a Favorite field:

        *   On table mode, go to the last table header with a **"+"**
        *   Just look for the **"Favorite"** option and click on it

        Updated over 1 year ago

        * * *

        *   [Table of Contents](#)
        *   *   [What is the Favorite field?](#what-is-the-favorite-field)
            *   [How to create](#how-to-create)
      </content>
    </page>"
  `);
});

test('response from site-fetcher', async () => {
  const html = getFixture('proxy-response.html');

  // Simulate CORS error on direct fetch
  fetchMock.get('https://docs.jestor.com', {
    throws: new TypeError('Failed to fetch'),
  });

  // Mock the site-fetcher proxy to succeed
  fetchMock.get(`begin:${siteFetcherUrl}`, {
    body: html,
    headers: { 'Content-Type': 'text/plain' },
  });

  const result = await crawlSite('https://docs.jestor.com', {
    includeSubLinks: false,
    siteFetcher,
  });

  expect(result.ok).toBe(true);
  expect(await result.unwrap().file.text()).toMatchInlineSnapshot(`
    "<page>
      <url> https://docs.jestor.com/ </url>
      <title>Tab Documentation</title>
      <content format="markdown">
        Add how-to-use guides to your internal tool

        Add how-to-use guides to your internal tool. If people don't understand what to do, they won't do it.

        1.  Format text adding titles, bold, topics, lines of code, and more.
        2.  Know when and who did the last edition.
        3.  Get notified when the documentation changes.

        Make it easier for all users to do more with your creation :)

        ![800](#img.png "ezgif.com-gif-maker-8.gif")

        Updated over 1 year ago

        * * *
      </content>
    </page>"
  `);
});

test('fails without a site fetcher when the direct fetch fails', async () => {
  fetchMock.get('https://docs.jestor.com', {
    throws: new TypeError('Failed to fetch'),
  });

  const result = await crawlSite('https://docs.jestor.com', {
    includeSubLinks: false,
  });

  expect(result.error && result.error.id).toEqual('noContent');
  expect(fetchMock.callHistory.calls()).toHaveLength(1);
});

test('returns error for invalid urls', async () => {
  const result = await crawlSite('not a url', {});

  expect(result.error && result.error.id).toEqual('invalidUrl');
});
