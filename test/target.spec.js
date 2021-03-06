/**
 * Copyright 2018 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const {waitEvent} = require('./utils');

module.exports.addTests = function({testRunner, expect, puppeteer}) {
  const {describe, xdescribe, fdescribe} = testRunner;
  const {it, fit, xit} = testRunner;
  const {beforeAll, beforeEach, afterAll, afterEach} = testRunner;

  describe('Target', function() {
    it('Browser.targets should return all of the targets', async({page, server, browser}) => {
      // The pages will be the testing page and the original newtab page
      const targets = browser.targets();
      expect(targets.some(target => target.type() === 'page' &&
        target.url() === 'about:blank')).toBeTruthy('Missing blank page');
      expect(targets.some(target => target.type() === 'browser')).toBeTruthy('Missing browser target');
    });
    it('Browser.pages should return all of the pages', async({page, server, browser}) => {
      // The pages will be the testing page and the original newtab page
      const allPages = await browser.pages();
      expect(allPages.length).toBe(2);
      expect(allPages).toContain(page);
      expect(allPages[0]).not.toBe(allPages[1]);
    });
    it('should contain browser target', async({browser}) => {
      const targets = browser.targets();
      const browserTarget = targets.find(target => target.type() === 'browser');
      expect(browserTarget).toBeTruthy();
    });
    it('should be able to use the default page in the browser', async({page, server, browser}) => {
      // The pages will be the testing page and the original newtab page
      const allPages = await browser.pages();
      const originalPage = allPages.find(p => p !== page);
      expect(await originalPage.evaluate(() => ['Hello', 'world'].join(' '))).toBe('Hello world');
      expect(await originalPage.$('body')).toBeTruthy();
    });
    it('should report when a new page is created and closed', async({page, server, browser}) => {
      const otherPagePromise = new Promise(fulfill => browser.once('targetcreated', target => fulfill(target.page())));
      await page.evaluate(url => window.open(url), server.CROSS_PROCESS_PREFIX);
      const otherPage = await otherPagePromise;
      expect(otherPage.url()).toContain(server.CROSS_PROCESS_PREFIX);

      expect(await otherPage.evaluate(() => ['Hello', 'world'].join(' '))).toBe('Hello world');
      expect(await otherPage.$('body')).toBeTruthy();

      let allPages = await browser.pages();
      expect(allPages).toContain(page);
      expect(allPages).toContain(otherPage);

      const closePagePromise = new Promise(fulfill => browser.once('targetdestroyed', target => fulfill(target.page())));
      await otherPage.close();
      expect(await closePagePromise).toBe(otherPage);

      allPages = await Promise.all(browser.targets().map(target => target.page()));
      expect(allPages).toContain(page);
      expect(allPages).not.toContain(otherPage);
    });
    it('should report when a service worker is created and destroyed', async({page, server, browser}) => {
      await page.goto(server.EMPTY_PAGE);
      const createdTarget = new Promise(fulfill => browser.once('targetcreated', target => fulfill(target)));

      await page.goto(server.PREFIX + '/serviceworkers/empty/sw.html');

      expect((await createdTarget).type()).toBe('service_worker');
      expect((await createdTarget).url()).toBe(server.PREFIX + '/serviceworkers/empty/sw.js');

      const destroyedTarget = new Promise(fulfill => browser.once('targetdestroyed', target => fulfill(target)));
      await page.evaluate(() => window.registrationPromise.then(registration => registration.unregister()));
      expect(await destroyedTarget).toBe(await createdTarget);
    });
    it('should report when a target url changes', async({page, server, browser}) => {
      await page.goto(server.EMPTY_PAGE);
      let changedTarget = new Promise(fulfill => browser.once('targetchanged', target => fulfill(target)));
      await page.goto(server.CROSS_PROCESS_PREFIX + '/');
      expect((await changedTarget).url()).toBe(server.CROSS_PROCESS_PREFIX + '/');

      changedTarget = new Promise(fulfill => browser.once('targetchanged', target => fulfill(target)));
      await page.goto(server.EMPTY_PAGE);
      expect((await changedTarget).url()).toBe(server.EMPTY_PAGE);
    });
    it('should not report uninitialized pages', async({page, server, browser}) => {
      let targetChanged = false;
      const listener = () => targetChanged = true;
      browser.on('targetchanged', listener);
      const targetPromise = new Promise(fulfill => browser.once('targetcreated', target => fulfill(target)));
      const newPagePromise = browser.newPage();
      const target = await targetPromise;
      expect(target.url()).toBe('about:blank');

      const newPage = await newPagePromise;
      const targetPromise2 = new Promise(fulfill => browser.once('targetcreated', target => fulfill(target)));
      const evaluatePromise = newPage.evaluate(() => window.open('about:blank'));
      const target2 = await targetPromise2;
      expect(target2.url()).toBe('about:blank');
      await evaluatePromise;
      await newPage.close();
      expect(targetChanged).toBe(false, 'target should not be reported as changed');
      browser.removeListener('targetchanged', listener);
    });
    it('should not crash while redirecting if original request was missed', async({page, server, browser}) => {
      let serverResponse = null;
      server.setRoute('/one-style.css', (req, res) => serverResponse = res);
      // Open a new page. Use window.open to connect to the page later.
      await Promise.all([
        page.evaluate(url => window.open(url), server.PREFIX + '/one-style.html'),
        server.waitForRequest('/one-style.css')
      ]);
      // Connect to the opened page.
      const target = browser.targets().find(target => target.url().includes('one-style.html'));
      const newPage = await target.page();
      // Issue a redirect.
      serverResponse.writeHead(302, { location: '/injectedstyle.css' });
      serverResponse.end();
      // Wait for the new page to load.
      await waitEvent(newPage, 'load');
      // Cleanup.
      await newPage.close();
    });
    it('should have an opener', async({page, server, browser}) => {
      await page.goto(server.EMPTY_PAGE);
      const [createdTarget] = await Promise.all([
        new Promise(fulfill => browser.once('targetcreated', target => fulfill(target))),
        page.goto(server.PREFIX + '/popup/window-open.html')
      ]);
      expect((await createdTarget.page()).url()).toBe(server.PREFIX + '/popup/popup.html');
      expect(createdTarget.opener()).toBe(page.target());
      expect(page.target().opener()).toBe(null);
    });
  });
};
