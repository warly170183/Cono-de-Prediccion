import fs from 'fs';
import path from 'path';

/** Carpeta de datos del usuario (ignorada por git): diario, opciones, micro, copias y ajustes. */
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
/** Diario, opciones de trading y archivo micro. */
export const JOURNAL_DIR = path.resolve(process.env.JOURNAL_DIR || path.join(DATA_DIR, 'journal'));
/** Ubicación antigua (versiones previas guardaban dentro de ./journal, que está en git). */
export const LEGACY_JOURNAL_DIR = path.resolve(process.cwd(), 'journal');

/** Escritura atómica: fichero temporal + rename, para no corromper el histórico si el proceso se corta. */
export function atomicWrite(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, file);
}
