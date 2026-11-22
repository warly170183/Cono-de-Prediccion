import fs from 'fs';
import path from 'path';

/** true cuando la app corre como ejecutable empaquetado (.exe). */
export const IS_PACKAGED = Boolean((process as unknown as { pkg?: unknown }).pkg);
/** Carpeta base: junto al .exe cuando está empaquetado; el directorio de trabajo en desarrollo. */
export const APP_DIR = IS_PACKAGED ? path.dirname(process.execPath) : process.cwd();

/** Carpeta de datos del usuario (ignorada por git): diario, opciones, micro, copias y ajustes. */
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(APP_DIR, 'data'));
/** Diario, opciones de trading y archivo micro. */
export const JOURNAL_DIR = path.resolve(process.env.JOURNAL_DIR || path.join(DATA_DIR, 'journal'));
/** Ubicación antigua (versiones previas guardaban dentro de ./journal, que está en git). */
export const LEGACY_JOURNAL_DIR = path.resolve(APP_DIR, 'journal');

/** Escritura atómica: fichero temporal + rename, para no corromper el histórico si el proceso se corta. */
export function atomicWrite(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, file);
}
