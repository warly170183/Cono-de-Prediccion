import path from 'path';

/** Carpeta donde se guardan diario, opciones de trading y archivo micro. Por defecto ./journal. */
export const JOURNAL_DIR = path.resolve(process.env.JOURNAL_DIR ?? path.join(process.cwd(), 'journal'));

import fs from 'fs';

/** Escritura atómica: fichero temporal + rename, para no corromper el histórico si el proceso se corta. */
export function atomicWrite(file: string, content: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, file);
}
