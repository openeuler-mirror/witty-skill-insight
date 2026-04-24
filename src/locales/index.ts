import { zh } from './zh';
import { en } from './en';

export type Locale = 'zh' | 'en';
export type TranslationDict = typeof zh;

export const locales: Record<Locale, TranslationDict> = {
  zh,
  en,
};

export { zh, en };