/**
 * Core WebDriver + BiDi connection management
 */

import { Builder, Browser, WebDriver } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FirefoxLaunchOptions } from './types.js';
import { log, logDebug } from '../utils/logger.js';

export class FirefoxCore {
  private driver: WebDriver | null = null;
  private currentContextId: string | null = null;
  private originalEnv: Record<string, string | undefined> = {};
  private logFilePath: string | undefined;
  private logFileFd: number | undefined;

  constructor(private options: FirefoxLaunchOptions) {}

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
      firefoxOptions.setProfile(this.options.profilePath);
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
    this.driver = await new Builder()
      .forBrowser(Browser.FIREFOX)
      .setFirefoxOptions(firefoxOptions)
      .setFirefoxService(serviceBuilder)
      .build();

    log('✅ Firefox launched with BiDi');

    // Remember current window handle (browsing context)
    this.currentContextId = await this.driver.getWindowHandle();
    logDebug(`Browsing context ID: ${this.currentContextId}`);

    // Navigate if startUrl provided
    if (this.options.startUrl) {
      await this.driver.get(this.options.startUrl);
      logDebug(`Navigated to: ${this.options.startUrl}`);
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
   * Send raw BiDi command and get response
   */
  async sendBiDiCommand(method: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.driver) {
      throw new Error('Driver not connected');
    }

    const bidi = await this.driver.getBidi();
    const id = Math.floor(Math.random() * 1000000);

    return new Promise((resolve, reject) => {
      const ws: any = bidi.socket;

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
