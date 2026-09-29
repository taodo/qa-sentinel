const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONTEXT_DIR = path.join(ROOT, 'reports', 'query-context');
const CONTEXT_TTL_MS = 2 * 60 * 60 * 1000;

function ensureDirectory() {
  fs.mkdirSync(CONTEXT_DIR, { recursive: true });
}

function getScopeKey({ channelId, threadTs }) {
  const channel = String(channelId || '').trim();
  const thread = String(threadTs || '').trim();
  if (!channel || !thread) return null;
  return `${channel}__${thread}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function getFilePath(scopeKey) {
  return path.join(CONTEXT_DIR, `${scopeKey}.json`);
}

function loadContext({ channelId, threadTs }) {
  const scopeKey = getScopeKey({ channelId, threadTs });
  if (!scopeKey) return null;

  const filePath = getFilePath(scopeKey);
  if (!fs.existsSync(filePath)) return null;

  try {
    const context = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!context || typeof context !== 'object') return null;

    if (
      context.updatedAt &&
      Date.now() - new Date(context.updatedAt).getTime() > CONTEXT_TTL_MS
    ) {
      return null;
    }

    return context;
  } catch (error) {
    console.warn(`⚠️ Could not read query context: ${error.message}`);
    return null;
  }
}

function saveContext({ channelId, threadTs, context }) {
  const scopeKey = getScopeKey({ channelId, threadTs });
  if (!scopeKey) return null;

  ensureDirectory();

  const nextContext = {
    version: 1,
    scope: {
      channelId: String(channelId),
      threadTs: String(threadTs)
    },
    ...context,
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    getFilePath(scopeKey),
    JSON.stringify(nextContext, null, 2),
    'utf8'
  );

  return nextContext;
}

function mergeConversationContext(previous, resolvedIntent) {
  const previousScope = previous?.scope || {};
  const previousSubject = previous?.subject || {};
  const previousScopeData = previous?.queryScope || {};
  const previousTimeRange = previous?.timeRange || null;

  const nextSubject = {
    ...previousSubject,
    ...(resolvedIntent.subject || {})
  };

  const nextScope = {
    ...previousScopeData,
    ...(resolvedIntent.scope || {})
  };

  const nextTimeRange =
    resolvedIntent.time_range !== undefined &&
    resolvedIntent.time_range !== null
      ? resolvedIntent.time_range
      : previousTimeRange;

  return {
    version: 1,
    scope: previous?.scope || previousScope,
    subject: nextSubject,
    queryScope: nextScope,
    action:
      resolvedIntent.action ||
      previous?.action ||
      null,
    lastQuery: {
      requested_fields:
        Array.isArray(resolvedIntent.requested_fields)
          ? resolvedIntent.requested_fields
          : previous?.lastQuery?.requested_fields || [],
      filters:
        resolvedIntent.filters ||
        previous?.lastQuery?.filters || {}
    },
    timeRange: nextTimeRange
  };
}

function buildParserContext(previous) {
  if (!previous) {
    return {
      subject: {},
      scope: {},
      action: null,
      time_range: null,
      last_query: {
        filters: {},
        requested_fields: []
      }
    };
  }

  return {
    subject: previous.subject || {},
    scope: previous.queryScope || {},
    action: previous.action || null,
    time_range: previous.timeRange || null,
    last_query: previous.lastQuery || {
      filters: {},
      requested_fields: []
    }
  };
}

module.exports = {
  loadContext,
  saveContext,
  mergeConversationContext,
  buildParserContext,
  getScopeKey
};
