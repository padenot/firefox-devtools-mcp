/**
 * Page navigation and management tools for MCP
 */

import { successResponse, errorResponse } from '../utils/response-helpers.js';
import type { McpToolResponse } from '../types/common.js';

// Tool definitions
export const listPagesTool = {
  name: 'list_pages',
  description: 'List open tabs. Returns stable pageId for each tab to use with other tools.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export const newPageTool = {
  name: 'new_page',
  description: 'Open new tab at URL. Returns stable pageId of the new tab.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Target URL',
      },
    },
    required: ['url'],
  },
};

export const navigatePageTool = {
  name: 'navigate_page',
  description: 'Navigate tab to URL.',
  inputSchema: {
    type: 'object',
    properties: {
      pageId: {
        type: 'string',
        description: 'Stable tab ID from list_pages',
      },
      url: {
        type: 'string',
        description: 'Target URL',
      },
    },
    required: ['pageId', 'url'],
  },
};

export const closePageTool = {
  name: 'close_page',
  description: 'Close tab by stable pageId.',
  inputSchema: {
    type: 'object',
    properties: {
      pageId: {
        type: 'string',
        description: 'Stable tab ID from list_pages',
      },
    },
    required: ['pageId'],
  },
};

/**
 * Format page list compactly, showing stable pageId for each tab.
 */
function formatPageList(
  tabs: Array<{ actor: string; title?: string; url?: string }>,
  currentHandle: string
): string {
  if (tabs.length === 0) {
    return '📄 No pages';
  }
  const lines: string[] = [`📄 ${tabs.length} pages`];
  for (const tab of tabs) {
    const marker = tab.actor === currentHandle ? '>' : ' ';
    const title = (tab.title || 'Untitled').substring(0, 40);
    lines.push(`${marker}[${tab.actor}] ${title}`);
  }
  return lines.join('\n');
}

// Handlers
export async function handleListPages(_args: unknown): Promise<McpToolResponse> {
  try {
    const { getFirefox } = await import('../index.js');
    const firefox = await getFirefox();

    await firefox.refreshTabs();
    const tabs = firefox.getTabs();
    const currentHandle = firefox.getCurrentContextId() ?? '';

    return successResponse(formatPageList(tabs, currentHandle));
  } catch (error) {
    return errorResponse(error as Error);
  }
}

export async function handleNewPage(args: unknown): Promise<McpToolResponse> {
  try {
    const { url } = args as { url: string };

    if (!url || typeof url !== 'string') {
      throw new Error('url parameter is required and must be a string');
    }

    const { getFirefox } = await import('../index.js');
    const firefox = await getFirefox();

    const newHandle = await firefox.createNewPage(url);

    return successResponse(`✅ new page [${newHandle}] → ${url}`);
  } catch (error) {
    return errorResponse(error as Error);
  }
}

export async function handleNavigatePage(args: unknown): Promise<McpToolResponse> {
  try {
    const { pageId, url } = args as { pageId: string; url: string };

    if (!pageId || typeof pageId !== 'string') {
      throw new Error('pageId parameter is required and must be a string');
    }

    if (!url || typeof url !== 'string') {
      throw new Error('url parameter is required and must be a string');
    }

    const { getFirefox } = await import('../index.js');
    const firefox = await getFirefox();

    await firefox.selectTabByHandle(pageId);
    await firefox.navigate(url);

    return successResponse(`✅ [${pageId}] → ${url}`);
  } catch (error) {
    return errorResponse(error as Error);
  }
}

export async function handleClosePage(args: unknown): Promise<McpToolResponse> {
  try {
    const { pageId } = args as { pageId: string };

    if (!pageId || typeof pageId !== 'string') {
      throw new Error('pageId parameter is required and must be a string');
    }

    const { getFirefox } = await import('../index.js');
    const firefox = await getFirefox();

    await firefox.closeTabByHandle(pageId);

    return successResponse(`✅ closed [${pageId}]`);
  } catch (error) {
    return errorResponse(error as Error);
  }
}
