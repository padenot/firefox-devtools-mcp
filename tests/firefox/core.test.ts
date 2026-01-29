/**
 * Unit tests for FirefoxCore module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FirefoxCore } from '@/firefox/core.js';
import type { FirefoxLaunchOptions } from '@/firefox/types.js';

describe('FirefoxCore', () => {
  describe('constructor', () => {
    it('should create instance with options', () => {
      const options: FirefoxLaunchOptions = {
        headless: true,
        width: 1920,
        height: 1080,
      };

      const core = new FirefoxCore(options);
      expect(core).toBeInstanceOf(FirefoxCore);
    });
  });

  describe('getCurrentContextId', () => {
    it('should return null when not connected', () => {
      const core = new FirefoxCore({ headless: true });
      expect(core.getCurrentContextId()).toBe(null);
    });
  });

  describe('setCurrentContextId', () => {
    it('should set context ID', () => {
      const core = new FirefoxCore({ headless: true });
      const contextId = 'test-context-123';

      core.setCurrentContextId(contextId);
      expect(core.getCurrentContextId()).toBe(contextId);
    });

    it('should update context ID', () => {
      const core = new FirefoxCore({ headless: true });

      core.setCurrentContextId('context-1');
      expect(core.getCurrentContextId()).toBe('context-1');

      core.setCurrentContextId('context-2');
      expect(core.getCurrentContextId()).toBe('context-2');
    });
  });

  describe('getDriver', () => {
    it('should throw error when not connected', () => {
      const core = new FirefoxCore({ headless: true });
      expect(() => core.getDriver()).toThrow('Driver not connected');
    });
  });

  describe('isConnected', () => {
    it('should return false when driver is null', async () => {
      const core = new FirefoxCore({ headless: true });
      const connected = await core.isConnected();
      expect(connected).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset driver and context to null', () => {
      const core = new FirefoxCore({ headless: true });
      core.setCurrentContextId('test-context');

      core.reset();

      expect(core.getCurrentContextId()).toBe(null);
      expect(() => core.getDriver()).toThrow('Driver not connected');
    });
  });
});

// Tests for connect() behavior with mocked Selenium
describe('FirefoxCore connect() profile handling', () => {
  // Mock selenium-webdriver/firefox.js at module level
  const mockAddArguments = vi.fn();
  const mockSetProfile = vi.fn();
  const mockEnableBidi = vi.fn();
  const mockSetBinary = vi.fn();
  const mockWindowSize = vi.fn();
  const mockSetAcceptInsecureCerts = vi.fn();
  const mockSetStdio = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    vi.doMock('selenium-webdriver/firefox.js', () => ({
      default: {
        Options: vi.fn(() => ({
          enableBidi: mockEnableBidi,
          addArguments: mockAddArguments,
          setProfile: mockSetProfile,
          setBinary: mockSetBinary,
          windowSize: mockWindowSize,
          setAcceptInsecureCerts: mockSetAcceptInsecureCerts,
        })),
        ServiceBuilder: vi.fn(() => ({
          setStdio: mockSetStdio,
        })),
      },
    }));

    vi.doMock('selenium-webdriver', () => ({
      Builder: vi.fn(() => ({
        forBrowser: vi.fn().mockReturnThis(),
        setFirefoxOptions: vi.fn().mockReturnThis(),
        setFirefoxService: vi.fn().mockReturnThis(),
        build: vi.fn().mockResolvedValue({
          getWindowHandle: vi.fn().mockResolvedValue('mock-context-id'),
          get: vi.fn().mockResolvedValue(undefined),
        }),
      })),
      Browser: { FIREFOX: 'firefox' },
    }));
  });

  it('should pass profile path via --profile argument instead of setProfile', async () => {
    const { FirefoxCore } = await import('@/firefox/core.js');

    const profilePath = '/path/to/test/profile';
    const core = new FirefoxCore({
      headless: true,
      profilePath,
    });

    await core.connect();

    // Assert: setProfile should NOT be called (it copies to temp dir)
    expect(mockSetProfile).not.toHaveBeenCalled();

    expect(mockAddArguments).toHaveBeenCalledWith('--profile', profilePath);
  });
});
