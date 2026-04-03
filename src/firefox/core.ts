/**
 * Core WebDriver + BiDi connection management
 */

import { Builder, Browser, WebDriver } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { mkdirSync, openSync, closeSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import type { FirefoxLaunchOptions } from './types.js';
import { log, logDebug } from '../utils/logger.js';
import { generatePrefScript } from './pref-utils.js';

export class FirefoxCore {
  private driver: WebDriver | null = null;
  private currentContextId: string | null = null;
  private originalEnv: Record<string, string | undefined> = {};
  private logFilePath: string | undefined;
  private logFileFd: number | undefined;

  constructor(private options: FirefoxLaunchOptions) {}

  /**
   * Check if a Firefox/browser process is already running, and whether the
   * target profile is locked. Returns a diagnostic object.
   *
   * UPSTREAM: This diagnostic is a workaround for geckodriver's lack of
   * profile-lock detection. When Firefox exits with status 0 because an
   * existing instance owns the profile, geckodriver only reports "Process
   * unexpectedly closed with status 0" (see geckodriver source:
   * testing/geckodriver/src/marionette.rs, MarionetteConnection::connect()).
   * Ideally geckodriver or mozrunner should detect .parentlock files and
   * immediate process exit, then return a specific error like "Firefox profile
   * is already in use by another instance". No upstream issue exists for this
   * as of 2025-04. Related issues:
   *   - https://github.com/mozilla/geckodriver/issues/2179 (connecting to
   *     existing Firefox, different scenario, closed)
   *   - https://github.com/SeleniumHQ/selenium/issues/15327 (Chrome/Edge
   *     profile lock detection, closed as chromedriver's responsibility)
   * A geckodriver issue should be filed proposing that LocalBrowser::new() in
   * testing/geckodriver/src/browser.rs check for .parentlock after
   * runner.start() and provide a descriptive error when the process exits
   * immediately with status 0.
   */
  private diagnoseExistingBrowser(): {
    browserRunning: boolean;
    profileLocked: boolean;
    runningProcesses: string[];
    binaryName: string;
  } {
    const binaryPath = this.options.firefoxPath || 'firefox';
    const binaryName = basename(binaryPath);

    // Check for running browser processes
    let runningProcesses: string[] = [];
    try {
      const psOutput = execSync(
        `ps aux | grep -i "${binaryName}" | grep -v grep | grep -v firefox-devtools-mcp`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      if (psOutput) {
        runningProcesses = psOutput.split('\n').filter(Boolean);
      }
    } catch {
      // grep returns exit code 1 when no matches found — that's fine
    }

    // Check if the profile directory has a .parentlock file
    let profileLocked = false;
    if (this.options.profilePath) {
      const parentLock = join(this.options.profilePath, '.parentlock');
      const lockFile = join(this.options.profilePath, 'lock');
      profileLocked = existsSync(parentLock) || existsSync(lockFile);
    }

    return {
      browserRunning: runningProcesses.length > 0,
      profileLocked,
      runningProcesses,
      binaryName,
    };
  }

  /**
   * Launch Firefox and establish BiDi connection
   */
  async connect(): Promise<void> {
    log('🚀 Launching Firefox via Selenium WebDriver BiDi...');

    // Set up output file for capturing Firefox stdout/stderr
    if (this.options.logFile) {
      this.logFilePath = this.options.logFile;
    } else if (this.options.env && Object.keys(this.options.env).length > 0) {
      const outputDir = join(homedir(), '.firefox-devtools-mcp', 'output');
      mkdirSync(outputDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.logFilePath = join(outputDir, `firefox-${timestamp}.log`);
    }

    // Set environment variables (will be inherited by geckodriver -> Firefox)
    if (this.options.env) {
      for (const [key, value] of Object.entries(this.options.env)) {
        this.originalEnv[key] = process.env[key];
        process.env[key] = value;
        logDebug(`Set env ${key}=${value}`);
      }

      // Important: Do NOT set MOZ_LOG_FILE - MOZ_LOG writes to stderr by default
      // We capture stderr directly through file descriptor redirection
      if (this.options.env.MOZ_LOG_FILE) {
        logDebug('Note: MOZ_LOG_FILE in env will be used, but may be blocked by sandbox');
      }
    }

    // Configure Firefox options
    const firefoxOptions = new firefox.Options();
    firefoxOptions.enableBidi();

    if (this.options.headless) {
      firefoxOptions.addArguments('-headless');
    }

    if (this.options.viewport) {
      firefoxOptions.windowSize({
        width: this.options.viewport.width,
        height: this.options.viewport.height,
      });
    }

    if (this.options.firefoxPath) {
      firefoxOptions.setBinary(this.options.firefoxPath);
    }

    if (this.options.args && this.options.args.length > 0) {
      firefoxOptions.addArguments(...this.options.args);
    }

    if (this.options.profilePath) {
      // Use Firefox's native --profile argument for reliable profile loading
      // (Selenium's setProfile() copies to temp dir which can be unreliable)
      firefoxOptions.addArguments('--profile', this.options.profilePath);
      log(`📁 Using Firefox profile: ${this.options.profilePath}`);
    }

    if (this.options.acceptInsecureCerts) {
      firefoxOptions.setAcceptInsecureCerts(true);
    }

    // Configure geckodriver service to capture output
    const serviceBuilder = new firefox.ServiceBuilder();

    // If we have a log file, open it and redirect geckodriver output there
    // This captures both geckodriver logs and Firefox stderr (including MOZ_LOG)
    if (this.logFilePath) {
      // Open file for appending, create if doesn't exist
      this.logFileFd = openSync(this.logFilePath, 'a');

      // Configure stdio: stdin=ignore, stdout=logfile, stderr=logfile
      // This redirects all output from geckodriver and Firefox to the log file
      serviceBuilder.setStdio(['ignore', this.logFileFd, this.logFileFd]);

      log(`📝 Capturing Firefox output to: ${this.logFilePath}`);
    }

    // Build WebDriver instance
    // UPSTREAM: The catch block below works around geckodriver's unhelpful error
    // message when Firefox exits immediately due to profile locking. See the
    // upstream comment on diagnoseExistingBrowser() above.
    try {
      this.driver = await new Builder()
        .forBrowser(Browser.FIREFOX)
        .setFirefoxOptions(firefoxOptions)
        .setFirefoxService(serviceBuilder)
        .build();
    } catch (launchError: unknown) {
      const errorMessage = launchError instanceof Error ? launchError.message : String(launchError);

      // Detect the "process exited immediately" scenario
      if (
        errorMessage.includes('Process unexpectedly closed with status 0') ||
        errorMessage.includes('Process unexpectedly closed with status') ||
        errorMessage.includes('Unable to obtain browser driver')
      ) {
        const diag = this.diagnoseExistingBrowser();
        const hints: string[] = [];

        if (diag.browserRunning) {
          hints.push(
            `DIAGNOSIS: Found ${diag.runningProcesses.length} running "${diag.binaryName}" process(es). ` +
              `Firefox-based browsers can only run one instance per profile at a time. ` +
              `The launched process exited immediately because it handed off to the already-running instance, ` +
              `and the WebDriver lost its connection.`
          );
          hints.push(
            `FIX: Quit all instances of "${diag.binaryName}" (including all profiles/windows) before retrying. ` +
              `On macOS: Cmd+Q or "pkill -f ${diag.binaryName}". Then call restart_firefox to let this server launch its own instance.`
          );
        }

        if (diag.profileLocked && this.options.profilePath) {
          hints.push(
            `DIAGNOSIS: The profile at "${this.options.profilePath}" has a lock file (.parentlock), ` +
              `indicating another browser instance is using it or was not shut down cleanly.`
          );
          if (!diag.browserRunning) {
            hints.push(
              `FIX: No running browser was detected, so the lock file may be stale from a crash. ` +
                `Try deleting the lock file: rm "${join(this.options.profilePath, '.parentlock')}" ` +
                `and then retry.`
            );
          }
        }

        if (hints.length === 0) {
          hints.push(
            `DIAGNOSIS: The browser process exited immediately after launch (status 0) but no running ` +
              `browser instance was detected. This could be a geckodriver or binary compatibility issue. ` +
              `Check that the Firefox binary path is correct and that geckodriver is compatible.`
          );
        }

        const diagnosticMessage = [`Failed to launch browser: ${errorMessage}`, '', ...hints].join(
          '\n'
        );

        log(diagnosticMessage);
        throw new Error(diagnosticMessage);
      }

      // For other errors, re-throw as-is
      throw launchError;
    }

    log('✅ Firefox launched with BiDi');

    // Remember current window handle (browsing context)
    this.currentContextId = await this.driver.getWindowHandle();
    logDebug(`Browsing context ID: ${this.currentContextId}`);

    // Navigate if startUrl provided
    if (this.options.startUrl) {
      await this.driver.get(this.options.startUrl);
      logDebug(`Navigated to: ${this.options.startUrl}`);
    }

    // Apply preferences if configured
    if (this.options.prefs && Object.keys(this.options.prefs).length > 0) {
      await this.applyPreferences();
    }

    log('✅ Firefox DevTools ready');
  }

  /**
   * Get WebDriver instance (throw if not connected)
   */
  getDriver(): WebDriver {
    if (!this.driver) {
      throw new Error('Driver not connected');
    }
    return this.driver;
  }

  /**
   * Check if Firefox is still connected and responsive
   * Returns false if Firefox was closed or connection is broken
   */
  async isConnected(): Promise<boolean> {
    if (!this.driver) {
      return false;
    }

    try {
      // Try a simple command to check if Firefox is responsive
      await this.driver.getWindowHandle();
      return true;
    } catch (error) {
      // Any error means connection is broken
      logDebug('Connection check failed: Firefox is not responsive');
      return false;
    }
  }

  /**
   * Reset driver state (used when Firefox is detected as closed)
   */
  reset(): void {
    this.driver = null;
    this.currentContextId = null;
    logDebug('Driver state reset');
  }

  /**
   * Get current browsing context ID
   */
  getCurrentContextId(): string | null {
    return this.currentContextId;
  }

  /**
   * Update current context ID (used by page management)
   */
  setCurrentContextId(contextId: string): void {
    this.currentContextId = contextId;
  }

  /**
   * Get log file path
   */
  getLogFilePath(): string | undefined {
    return this.logFilePath;
  }

  /**
   * Get current launch options
   */
  getOptions(): FirefoxLaunchOptions {
    return this.options;
  }

  /**
   * Apply Firefox preferences via Services.prefs API
   * Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 environment variable
   */
  async applyPreferences(): Promise<void> {
    const prefs = this.options.prefs;

    // Return early if no prefs to set
    if (!prefs || Object.keys(prefs).length === 0) {
      return;
    }

    // Check for MOZ_REMOTE_ALLOW_SYSTEM_ACCESS
    if (!process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS) {
      throw new Error(
        'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 environment variable is required to set Firefox preferences at startup. ' +
          'Add --env MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 to your command line.'
      );
    }

    if (!this.driver) {
      throw new Error('Driver not connected');
    }

    // Get chrome contexts
    const result = await this.sendBiDiCommand('browsingContext.getTree', {
      'moz:scope': 'chrome',
    });

    const contexts = result.contexts || [];
    if (contexts.length === 0) {
      throw new Error(
        'No chrome contexts available. Ensure MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 is set.'
      );
    }

    const chromeContextId = contexts[0].context;
    const originalContextId = this.currentContextId;

    const successes: string[] = [];
    const failures: string[] = [];

    try {
      // Switch to chrome context
      await this.driver.switchTo().window(chromeContextId);
      await (this.driver as any).setContext('chrome');

      // Set each preference
      for (const [name, value] of Object.entries(prefs)) {
        try {
          const script = generatePrefScript(name, value);
          await this.driver.executeScript(script);
          successes.push(`${name} = ${JSON.stringify(value)}`);
        } catch (error) {
          failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Log results
      if (successes.length > 0) {
        log(`✅ Applied ${successes.length} Firefox preference(s)`);
        for (const msg of successes) {
          logDebug(`  ${msg}`);
        }
      }
      if (failures.length > 0) {
        log(`⚠️ Failed to set ${failures.length} preference(s)`);
        for (const msg of failures) {
          logDebug(`  ${msg}`);
        }
      }
    } finally {
      // Restore content context
      try {
        await (this.driver as any).setContext('content');
        if (originalContextId) {
          await this.driver.switchTo().window(originalContextId);
        }
      } catch {
        // Ignore errors restoring context
      }
    }
  }

  /**
   * Wait for WebSocket to be in OPEN state
   */
  private async waitForWebSocketOpen(ws: any, timeout: number = 5000): Promise<void> {
    // Already open
    if (ws.readyState === 1) {
      return;
    }

    // Still connecting - wait for open event with timeout
    if (ws.readyState === 0) {
      return new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          ws.off('open', onOpen);
          reject(new Error('Timeout waiting for WebSocket to open'));
        }, timeout);

        const onOpen = () => {
          clearTimeout(timeoutId);
          ws.off('open', onOpen);
          resolve();
        };
        ws.on('open', onOpen);
      });
    }

    throw new Error(`WebSocket is not open: readyState ${ws.readyState}`);
  }

  /**
   * Send raw BiDi command and get response
   */
  async sendBiDiCommand(method: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.driver) {
      throw new Error('Driver not connected');
    }

    const bidi = await this.driver.getBidi();
    const ws: any = bidi.socket;

    // Wait for WebSocket to be ready before sending
    await this.waitForWebSocketOpen(ws);

    const id = Math.floor(Math.random() * 1000000);

    return new Promise((resolve, reject) => {
      const messageHandler = (data: any) => {
        try {
          const payload = JSON.parse(data.toString());
          if (payload.id === id) {
            ws.off('message', messageHandler);
            if (payload.error) {
              reject(new Error(`BiDi error: ${JSON.stringify(payload.error)}`));
            } else {
              resolve(payload.result);
            }
          }
        } catch (err) {
          // ignore parse errors
        }
      };

      ws.on('message', messageHandler);

      const command = {
        id,
        method,
        params,
      };

      ws.send(JSON.stringify(command));

      setTimeout(() => {
        ws.off('message', messageHandler);
        reject(new Error(`BiDi command timeout: ${method}`));
      }, 10000);
    });
  }

  /**
   * Close driver and cleanup
   */
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.quit();
      this.driver = null;
    }

    // Close log file descriptor if open
    if (this.logFileFd !== undefined) {
      try {
        closeSync(this.logFileFd);
        logDebug('Log file closed');
      } catch (error) {
        logDebug(
          `Error closing log file: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      this.logFileFd = undefined;
    }

    // Restore original environment variables
    for (const [key, value] of Object.entries(this.originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    this.originalEnv = {};

    log('✅ Firefox DevTools closed');
  }
}
