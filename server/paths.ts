import path from 'path';

/** Carpeta donde se guardan diario, opciones de trading y archivo micro. Por defecto ./journal. */
export const JOURNAL_DIR = path.resolve(process.env.JOURNAL_DIR ?? path.join(process.cwd(), 'journal'));
