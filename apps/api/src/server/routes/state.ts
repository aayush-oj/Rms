/**
 * LEGACY / TRANSITIONAL COMPATIBILITY ROUTER: /api/state/*
 *
 * ARCHITECTURAL BOUNDARY & USAGE NOTICE:
 * 1. This router exists EXCLUSIVELY to support the legacy FoodieHub single-page
 *    application frontend (`usePersistentState.ts`) during the migration period.
 * 2. This router and its underlying flat file store (`.storage/state-store.json`)
 *    MUST NOT become part of the new enterprise RMS backend architecture.
 * 3. STRICT PROHIBITION:
 *    - DO NOT use `/api/state/*` for any new RMS business functionality.
 *    - DO NOT build new RMS domain modules around `.storage/state-store.json`.
 *    - DO NOT migrate organizations, branches, users, roles, permissions, orders,
 *      inventory, purchasing, accounting, CRM, HR, or other RMS domain data into this store.
 * 4. All new RMS enterprise capabilities MUST use the versioned REST architecture
 *    under `/api/v1/*` backed by the ACID-compliant MySQL 8.0 database engine.
 * 5. This compatibility state store is NOT the source of truth for the enterprise RMS.
 */

import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { logger } from '../lib/logger';

interface StateEntry {
  value: unknown;
  updatedAt: number;
  version: number;
}

const router = Router();
const stateCache = new Map<string, StateEntry>();

const STORAGE_DIR = path.join(process.cwd(), '.storage');
const STORAGE_FILE = path.join(STORAGE_DIR, 'state-store.json');

// Attach explicit legacy compatibility headers to all /api/state responses
router.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-RMS-Compatibility-Layer', 'legacy-state-store');
  res.setHeader('X-RMS-Deprecation-Notice', 'transitional-compatibility-only; use /api/v1/* for enterprise RMS endpoints');
  next();
});

// Initialize storage file
function loadPersistentState(): void {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, StateEntry>;
      for (const [k, v] of Object.entries(parsed)) {
        stateCache.set(k, v);
      }
      logger.info(`[LegacyStateRouter] Loaded ${stateCache.size} state keys from compatibility store.`);
    }
  } catch (err) {
    logger.warn('[LegacyStateRouter] Could not read legacy state storage file, starting fresh', { error: err });
  }
}

let saveDebounceTimer: NodeJS.Timeout | null = null;
function persistStateToDisk(): void {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(STORAGE_DIR)) {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
      }
      const serializable: Record<string, StateEntry> = {};
      for (const [k, v] of stateCache.entries()) {
        serializable[k] = v;
      }
      fs.writeFileSync(STORAGE_FILE, JSON.stringify(serializable, null, 2), 'utf-8');
    } catch (err) {
      logger.error('[LegacyStateRouter] Failed to write compatibility store to disk', { error: err });
    }
  }, 300);
}

// Load existing state on module evaluation
loadPersistentState();

// GET /api/state/:key
router.get('/:key', (req: Request, res: Response) => {
  const key = decodeURIComponent(req.params.key);
  const entry = stateCache.get(key);

  if (!entry) {
    res.json({
      value: null,
      updatedAt: 0,
      version: 0,
    });
    return;
  }

  res.json({
    value: entry.value,
    updatedAt: entry.updatedAt,
    version: entry.version,
  });
});

// POST /api/state/:key
router.post('/:key', (req: Request, res: Response) => {
  const key = decodeURIComponent(req.params.key);
  const { value } = req.body;

  const current = stateCache.get(key);
  const now = Date.now();
  const nextVersion = (current?.version ?? 0) + 1;

  const entry: StateEntry = {
    value,
    updatedAt: now,
    version: nextVersion,
  };

  stateCache.set(key, entry);
  persistStateToDisk();

  res.json({
    success: true,
    value: entry.value,
    updatedAt: entry.updatedAt,
    version: entry.version,
  });
});

// PUT /api/state/:key
router.put('/:key', (req: Request, res: Response) => {
  const key = decodeURIComponent(req.params.key);
  const { value } = req.body;

  const current = stateCache.get(key);
  const now = Date.now();
  const nextVersion = (current?.version ?? 0) + 1;

  const entry: StateEntry = {
    value,
    updatedAt: now,
    version: nextVersion,
  };

  stateCache.set(key, entry);
  persistStateToDisk();

  res.json({
    success: true,
    value: entry.value,
    updatedAt: entry.updatedAt,
    version: entry.version,
  });
});

// DELETE /api/state/:key
router.delete('/:key', (req: Request, res: Response) => {
  const key = decodeURIComponent(req.params.key);
  stateCache.delete(key);
  persistStateToDisk();

  res.json({
    success: true,
    message: `State for key "${key}" cleared`,
  });
});

export { router as stateRouter };
