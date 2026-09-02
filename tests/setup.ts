// Vitest setup file
// This file runs before all tests

import { beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';

// Track if we're in cleanup mode
let isCleaningUp = false;

beforeAll(() => {
  // Setup code runs before all tests
});

afterAll(() => {
  // Global cleanup: kill Firefox/geckodriver processes THIS test run spawned
  cleanup();
});

/** One `ps` snapshot as pid -> children. Null when the table cannot be read. */
function processTree(): Map<number, number[]> | null {
  let table: string;
  try {
    table = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf-8' });
  } catch {
    return null;
  }
  const children = new Map<number, number[]>();
  for (const line of table.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || Number.isNaN(ppid)) {
      continue;
    }
    const siblings = children.get(ppid);
    if (siblings) {
      siblings.push(pid);
    } else {
      children.set(ppid, [pid]);
    }
  }
  return children;
}

/** Every process that descends from `rootPid` in `tree`. */
function descendantsOf(rootPid: number, tree: Map<number, number[]>): Set<number> {
  const seen = new Set<number>();
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    for (const child of tree.get(pid) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        stack.push(child);
      }
    }
  }
  return seen;
}

/** PIDs whose command line matches `pattern`, restricted to `allowed`. */
function matchingPids(pattern: string, allowed: Set<number>): number[] {
  let out: string;
  try {
    out = execFileSync('pgrep', ['-f', pattern], { encoding: 'utf-8' });
  } catch {
    return []; // pgrep exits 1 on no match
  }
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(Number)
    .filter((pid) => allowed.has(pid));
}

function killQuietly(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Ignore errors - process might already be dead
  }
}

/**
 * Cleanup function to kill the Firefox and geckodriver processes this test
 * run started, so no zombie processes are left behind.
 *
 * Only processes that DESCEND from this test process are touched. Selenium
 * spawns geckodriver from the test process and geckodriver spawns Firefox,
 * so everything the tests launched is in that subtree - while a developer's
 * own WebDriver-driven Firefox (an MCP client's browser, another tool's
 * automation session) is not. The previous machine-wide
 * `pgrep -f "firefox.*marionette"` + `pkill -9 -f geckodriver` killed every
 * such browser on the host each time the unit suite ran.
 */
function cleanup() {
  if (isCleaningUp) {
    return; // Prevent recursive cleanup
  }
  isCleaningUp = true;

  try {
    const tree = processTree();
    if (tree === null) {
      return; // Cannot scope the kill - do nothing rather than kill everything
    }
    const mine = descendantsOf(process.pid, tree);

    // Firefox test instances (started with --marionette) in our subtree:
    // kill each one's children first, then the parent
    for (const pid of matchingPids('firefox.*marionette', mine)) {
      for (const child of descendantsOf(pid, tree)) {
        killQuietly(child);
      }
      killQuietly(pid);
    }

    // geckodriver processes in our subtree
    for (const pid of matchingPids('geckodriver', mine)) {
      killQuietly(pid);
    }

    console.log('✅ Global cleanup: All test Firefox processes terminated');
  } catch (error) {
    // Ignore errors - processes might already be dead
  } finally {
    isCleaningUp = false;
  }
}

// Handle process termination signals
process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received, cleaning up Firefox processes...');
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, cleaning up Firefox processes...');
  cleanup();
  process.exit(0);
});

// Handle unhandled errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  cleanup();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
  cleanup();
  process.exit(1);
});
