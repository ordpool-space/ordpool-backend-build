"use strict";
/**
 * Pure-type interface module for OTS data.
 *
 * Importing from `repositories/OrdpoolOtsRepository.ts` directly would drag
 * the whole DB graph (mysql2, fs, path, ...) into the frontend's TypeScript
 * compile, breaking `ng build`. Same pattern as `ordpool-statistics-interface.ts`.
 *
 * Both backend (repositories) and frontend (api service) re-export from here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
