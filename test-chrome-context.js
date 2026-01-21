#!/usr/bin/env node

import { FirefoxDevTools } from './dist/index.js';

async function test() {
  console.log('=== Test: Chrome Context Script Evaluation (headless) ===\n');

  const firefox = new FirefoxDevTools({
    headless: true,
    firefoxPath: process.env.HOME + '/firefox/firefox',
    env: {
      MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1',
    },
  });

  await firefox.connect();
  console.log('✓ Firefox started with MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1');

  // Test content script first
  console.log('\n--- Testing content script (default context) ---');
  await firefox.navigate('https://example.com');
  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    const title = await firefox.evaluate('return document.title');
    console.log(`✓ Content context: document.title = "${title}"`);
  } catch (err) {
    console.log(`✗ Content script failed: ${err.message}`);
  }

  // Now test chrome context via BiDi with moz:scope
  console.log('\n--- Testing chrome context listing ---');

  try {
    // Use BiDi to list chrome contexts with moz:scope
    const result = await firefox.sendBiDiCommand('browsingContext.getTree', {
      'moz:scope': 'chrome',
    });

    const contexts = result.contexts || [];
    console.log(`✓ Listed ${contexts.length} chrome context(s) via BiDi`);

    if (contexts.length > 0) {
      console.log('  Sample chrome contexts:');
      contexts.slice(0, 3).forEach(ctx => {
        console.log(`    ${ctx.context}: ${ctx.url || '(no url)'}`);
      });

      // Try to evaluate in chrome context
      console.log('\n--- Testing chrome script execution ---');

      const driver = firefox.getDriver();
      const firstContext = contexts[0];

      // Switch to chrome browsing context
      await driver.switchTo().window(firstContext.context);
      console.log(`✓ Switched to chrome context: ${firstContext.context}`);

      // Set Marionette context to chrome
      try {
        await driver.setContext('chrome');
        console.log('✓ Set Marionette context to "chrome"');

        // Now try to evaluate chrome-privileged script
        const appName = await driver.executeScript('return Services.appinfo.name;');
        console.log(`✓ Chrome script: Services.appinfo.name = "${appName}"`);

        const version = await driver.executeScript('return Services.appinfo.version;');
        console.log(`✓ Chrome script: Services.appinfo.version = "${version}"`);

        const buildID = await driver.executeScript('return Services.appinfo.appBuildID;');
        console.log(`✓ Chrome script: Services.appinfo.appBuildID = "${buildID}"`);

        console.log('\n✅ Chrome context evaluation WORKS!');

      } catch (err) {
        console.log(`✗ Failed to set chrome context: ${err.message}`);
        console.log('  Your Firefox build may not support chrome context');
      }

    } else {
      console.log('  No chrome contexts found (requires dev/nightly build)');
    }

  } catch (err) {
    if (err.message && err.message.includes('UnsupportedOperationError')) {
      console.log('✗ Chrome context not supported by this Firefox build');
      console.log('  Requires Firefox Nightly or custom build');
    } else {
      console.log(`✗ Chrome context test failed: ${err.message}`);
    }
  }

  await firefox.close();
  console.log('\n✓ Test completed');
}

test().catch(err => {
  console.error('\nTest failed:', err);
  console.error(err.stack);
  process.exit(1);
});
