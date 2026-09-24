import { describe, expect, it } from 'vitest';
import { isLikelySameLanguage } from './textLanguage';

describe('isLikelySameLanguage', () => {
  it('treats empty / whitespace-only text as same language', () => {
    expect(isLikelySameLanguage('', 'zh')).toBe(true);
    expect(isLikelySameLanguage('   ', 'en')).toBe(true);
  });

  it('skips translation for Chinese text against Chinese targets', () => {
    expect(isLikelySameLanguage('一个基于 React 的状态管理库', 'zh')).toBe(true);
    expect(isLikelySameLanguage('輕量級的網頁框架，支援元件化開發', 'zh-TW')).toBe(true);
  });

  it('translates Chinese text against non-Chinese targets', () => {
    expect(isLikelySameLanguage('一个基于 React 的状态管理库', 'en')).toBe(false);
    expect(isLikelySameLanguage('一个基于 React 的状态管理库', 'ja')).toBe(false);
    expect(isLikelySameLanguage('一个基于 React 的状态管理库', 'ko')).toBe(false);
  });

  it('distinguishes Japanese (kana) from Chinese targets', () => {
    expect(isLikelySameLanguage('高速なバンドルツールです', 'ja')).toBe(true);
    expect(isLikelySameLanguage('高速なバンドルツールです', 'zh')).toBe(false);
  });

  it('detects Korean and Russian by their scripts', () => {
    expect(isLikelySameLanguage('빠른 웹 프레임워크입니다', 'ko')).toBe(true);
    expect(isLikelySameLanguage('빠른 웹 프레임워크입니다', 'en')).toBe(false);
    expect(isLikelySameLanguage('Быстрая библиотека для сборки', 'ru')).toBe(true);
    expect(isLikelySameLanguage('Быстрая библиотека для сборки', 'en')).toBe(false);
  });

  it('skips English descriptions against the English target', () => {
    expect(isLikelySameLanguage('A blazing fast build tool for modern web apps', 'en')).toBe(true);
    expect(isLikelySameLanguage('The fastest way to build and deploy your apps', 'en')).toBe(true);
  });

  it('treats stopword-free latin text as English (skip for en, translate for others)', () => {
    expect(isLikelySameLanguage('Fast JSON schema validation library', 'en')).toBe(true);
    expect(isLikelySameLanguage('Fast JSON schema validation library', 'fr')).toBe(false);
  });

  it('detects romance / german languages from stopwords', () => {
    expect(isLikelySameLanguage('Une bibliothèque pour construire des interfaces', 'fr')).toBe(true);
    expect(isLikelySameLanguage('Eine schnelle Lösung für die Datenvalidierung', 'de')).toBe(true);
    expect(isLikelySameLanguage('Una biblioteca para validar formularios', 'es')).toBe(true);
    expect(isLikelySameLanguage('Uma ferramenta para gerenciar suas tarefas diárias', 'pt-BR')).toBe(true);
  });

  it('translates same-script texts across latin languages', () => {
    expect(isLikelySameLanguage('The most popular framework for building apps', 'fr')).toBe(false);
    expect(isLikelySameLanguage('Une bibliothèque pour construire des interfaces', 'en')).toBe(false);
  });

  it('translates non-latin text against latin targets', () => {
    expect(isLikelySameLanguage('一个基于 React 的状态管理库', 'fr')).toBe(false);
    expect(isLikelySameLanguage('🚀⚡️🎉', 'en')).toBe(false);
  });

  it('translates latin-extended languages (pl / tr / vi) against latin targets', () => {
    expect(isLikelySameLanguage('Biblioteka do zarządzania stanem aplikacji', 'en')).toBe(false);
    expect(isLikelySameLanguage('Hızlı ve kullanışlı bir araç', 'en')).toBe(false);
    expect(isLikelySameLanguage('Thư viện quản lý trạng thái', 'en')).toBe(false);
  });

  it('translates accented text without stopwords against the English target', () => {
    expect(isLikelySameLanguage('Naïve JSON schema validation', 'en')).toBe(false);
    expect(isLikelySameLanguage('Générer des documents facilement', 'fr')).toBe(true);
    expect(isLikelySameLanguage('Eine Lösung zur Datenverarbeitung', 'en')).toBe(false);
  });
});
