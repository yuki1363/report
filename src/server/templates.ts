/** テンプレートの読み込み。P1 は同梱の既定テンプレートのみ（ユーザーテンプレートの保存は P3）。 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TemplateSchema, type Template } from '../shared/schema.ts';

const TEMPLATE_DIR = fileURLToPath(new URL('../../templates/', import.meta.url));

let cache: Template[] | undefined;

export function builtinTemplates(): Template[] {
  cache ??= [TemplateSchema.parse(JSON.parse(readFileSync(TEMPLATE_DIR + 'default.json', 'utf8')))];
  return cache;
}
