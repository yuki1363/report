/**
 * Claude API による資料の読み取り（CLAUDE.md §4）。API キーはサーバー側だけで使う。
 *
 * 出力形式の強制: 仕様では「ツール定義（JSON スキーマ）で強制」としているが、既定モデル
 * （Sonnet 系 = claude-sonnet-5-5）は tool_choice による強制呼び出しを受け付けない（400）。
 * 同じ目的（JSON スキーマどおりの出力の保証）を、構造化出力 output_config.format で実現する。
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExtractionSchema, mergeExtractions, type Extraction, type ImportPage } from '../../shared/extraction.ts';
import { SELECTABLE_SYSTEMS } from '../../shared/schema.ts';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
/** 1回のリクエストで送るページ数の上限（これを超える場合は分割して結果をまとめる） */
export const PAGES_PER_REQUEST = 20;

/** サーバー側フォールバック（fallbacks: "default"）に対応しているモデル */
const FALLBACK_DEFAULT_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1'];

export function claudeModel(): string {
  return process.env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL;
}

export class ExtractionError extends Error {}

/**
 * 利用者が追加できる指示（data/extract-notes.txt）。アプリを作り直さずに、読み取りの癖を直すために使う。
 * 例: 「電圧が 210 と書かれていたら 200V の意味です」「AT 欄が空欄の行は breakerA を null にする」
 */
export function systemPromptWithNotes(dataDir: string): string {
  try {
    const notes = readFileSync(join(dataDir, 'extract-notes.txt'), 'utf8').trim().slice(0, 4000);
    return notes ? `${SYSTEM_PROMPT}\n\n# 利用者からの追加の指示（上の指示と矛盾する場合は、こちらを優先してください）\n${notes}` : SYSTEM_PROMPT;
  } catch {
    return SYSTEM_PROMPT;
  }
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

/** output_config.format に渡す JSON スキーマ（ExtractionSchema と同じ形） */
export const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['panels', 'uncertain'],
  properties: {
    panels: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'location', 'circuits'],
        properties: {
          name: nullable({ type: 'string' }),
          location: nullable({ type: 'string' }),
          circuits: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['no', 'name', 'deviceType', 'system', 'useVoltage', 'voltageText', 'breakerA'],
              properties: {
                no: nullable({ type: 'string' }),
                name: nullable({ type: 'string' }),
                deviceType: nullable({ type: 'string' }),
                system: nullable({ type: 'string', enum: [...SELECTABLE_SYSTEMS] }),
                useVoltage: nullable({ type: 'number' }),
                voltageText: nullable({ type: 'string' }),
                breakerA: nullable({ type: 'number' }),
              },
            },
          },
        },
      },
    },
    uncertain: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'reason'],
        properties: { field: { type: 'string' }, reason: { type: 'string' } },
      },
    },
  },
} as const;

export const SYSTEM_PROMPT = `あなたは配電盤の資料（単線結線図・盤図面・負荷表・銘板や回路名称表示の写真）から、絶縁抵抗測定報告書の作成に必要な情報を書き写す担当です。
抜き出した内容は、利用者が元資料と見比べて確認・修正してから報告書に使います。そのため、正確さと「自信のなさを正直に示すこと」を何より重視してください。

# 出力の構造
panels: 盤ごとに1要素。1つの資料に盤が複数並んでいる場合（盤ごとの表が並ぶ負荷表など）は、盤の数だけ要素を作ります。
- name: 盤名（例: 「低圧動力盤 No.4」「電灯盤 L-1」）。表の近くや欄外に書かれていることが多い
- location: 設置場所（資料に書かれている場合のみ）
- circuits: 回路ごとに no（回路No は使わないので、常に null）、name（回路名称）、system（電気方式）、useVoltage（使用電圧 [V]）、breakerA（ブレーカ容量 [A]）

# 資料の読み方
- 資料や表は、90度・180度回転していることがあります。読める向きに直して読んでください（縦書きに見える文字は、実際は横向きの文字のことがあります）。
- 表の見出しと項目の対応:
  - 「負荷名称」「回路名称」→ name。名称が複数行にわたる場合は1つの名称にまとめます（例: 「1FP-2-1, 1FP-2-2, 1FP-2-3」）
  - 「ELB No.」「ブレーカNo.」「回路No.」「MCB No.」の番号は no に入れない（常に null）。見出しの ELB / MCB / Mg（電磁開閉器）などは deviceType に入れる（「ELB No.」の表なら各回路が ELB、下段の「MCB No.」の区画なら MCB）。見出しに無ければ null
  - 「AT」（トリップ電流）→ breakerA（容量）。「AF」（フレーム）や「P」（極数）は使いません。AT が空欄なら breakerA は null
- 電気方式と電圧（例: 「3φ3W 210V」「3φ3W 440V」）が、表の端に1回だけ書かれて複数の回路に共通している場合は、その範囲のすべての回路に system と useVoltage を入れてください。表の途中で区画が変わり別の方式・電圧が書かれている場合は、区画ごとに適用します。
- useVoltage は数値 [V] にします。「105/210V」のように2つ書かれている場合は大きい方です（210）。voltageText には、資料に書かれた電圧の表記を、V を除いてそのまま入れます（例: 「105/210」「210」「440」「105」）。このアプリが扱う電圧は 105 / 105/210 / 210 / 440 の4種類で、3φ4W は扱いません。資料の電圧がこれらと違う場合（例: 100/200V）は、そのまま書き写し、uncertain に「パターン外」と記録してください。
- 電気方式は 1φ2W / 1φ3W / 3φ3W のどれかに直してください（例: 1Φ3W、1ファイ3、単相3線、1P3W → 1φ3W、三相3線 → 3φ3W）。判断できなければ null です。電気方式と電圧は連動します（1φ2W=105 ／ 1φ3W=105/210 ／ 3φ3W=210 か 440）。資料がこの組み合わせでないときは、書かれたまま写して uncertain に記録してください。
- 表の下段などに別の区画（MCB など、見出しが「MCB No.」「MCB AF/AT」になっているブロック）がある場合も、その行を回路として含めます。区画に別の電気方式・電圧が書かれていればそれを、書かれていなければ null にして uncertain に記録してください。
- このアプリは低圧（使用電圧 600V 以下）の測定だけが対象です。高圧（6.6kV など 600V を超える）の機器・回路は、回路に含めないでください。判断に迷う場合は含めたうえで、uncertain に「高圧の可能性」と記録してください。
- 「予備」「スペース」の行も1回路として含めます（名称は資料の表記のまま）。回路は資料に現れる順に並べ、重複して書かないでください。
- テキスト層が付いているページは、画像とテキスト層の両方を見てください。文字はテキスト層の方が正確ですが、表の行・列の対応は画像で確かめてください。

# 守ること
- 資料に書かれていることだけを書き写してください。推測で埋めてはいけません。
- 読めない・書かれていない項目は null にし、uncertain に記録してください。
- 値は入れたが自信がない項目（かすれ、解像度が低い、手書き、重なり、数字の読み違いの恐れなど）も、uncertain に理由を付けて記録してください。数字（AT、電圧）は特に慎重に。
- uncertain の field は、番号を 0 から数えて "panels.{盤}.name"、"panels.{盤}.location"、"panels.{盤}.circuits.{行}.{no|name|system|useVoltage|breakerA}" の形で書いてください。reason は日本語で短く書いてください。
- 盤が複数あるとき、盤の並び順は資料の左から右、上から下の順にしてください。`;

function pageContent(dataDir: string, importId: string, pages: ImportPage[]): Anthropic.Beta.BetaContentBlockParam[] {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const p of pages) {
    content.push({ type: 'text', text: `【資料 ${p.index + 1}: ${p.fileName}${p.kind === 'image' ? '' : ` ${p.pageNo}ページ`}】` });
    const buf = readFileSync(join(dataDir, 'imports', importId, p.image));
    const media_type = p.image.endsWith('.png') ? 'image/png' : 'image/jpeg';
    content.push({ type: 'image', source: { type: 'base64', media_type, data: buf.toString('base64') } });
    if (p.text) {
      content.push({
        type: 'text',
        text: `テキスト層（各行 "x,y: 文字列"。座標は上の画像のピクセル位置）:\n${p.text}`,
      });
    }
  }
  content.push({ type: 'text', text: '上の資料から、指示どおりに盤と回路の情報を書き写してください。' });
  return content;
}

export interface ClaudeDeps {
  client?: Anthropic;
  model?: string;
}

/** ページ群を読み取って1つの結果にまとめる。 */
export async function extractWithClaude(
  dataDir: string,
  importId: string,
  pages: ImportPage[],
  deps: ClaudeDeps = {},
): Promise<{ result: Extraction; model: string }> {
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) {
    throw new ExtractionError('API キーが設定されていません。.env の ANTHROPIC_API_KEY を設定して、アプリを再起動してください。');
  }
  const client = deps.client ?? new Anthropic();
  const model = deps.model ?? claudeModel();
  const systemPrompt = systemPromptWithNotes(dataDir);
  const parts: Extraction[] = [];
  for (let i = 0; i < pages.length; i += PAGES_PER_REQUEST) {
    parts.push(await extractBatch(client, model, systemPrompt, pageContent(dataDir, importId, pages.slice(i, i + PAGES_PER_REQUEST))));
  }
  return { result: mergeExtractions(parts), model };
}

async function extractBatch(
  client: Anthropic,
  model: string,
  systemPrompt: string,
  content: Anthropic.Beta.BetaContentBlockParam[],
): Promise<Extraction> {
  const useFallback = FALLBACK_DEFAULT_MODELS.includes(model);
  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await client.beta.messages
      .stream({
        model,
        max_tokens: 32000,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
        output_config: { format: { type: 'json_schema', schema: EXTRACTION_JSON_SCHEMA } },
        ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      })
      .finalMessage();
  } catch (e) {
    throw new ExtractionError(apiErrorMessage(e));
  }
  if (message.stop_reason === 'refusal') {
    throw new ExtractionError('AI が資料の読み取りを断りました。資料の内容を確認するか、手入力してください。');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new ExtractionError('回路が多すぎて読み取りが途中で切れました。ページ数を減らして取り込んでください。');
  }
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ExtractionError('AI の応答を解析できませんでした。もう一度実行してください。');
  }
  const parsed = ExtractionSchema.safeParse(json);
  if (!parsed.success) throw new ExtractionError('AI の応答が想定した形式ではありませんでした。もう一度実行してください。');
  return parsed.data;
}

export function apiErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'API キーが正しくありません（.env の ANTHROPIC_API_KEY を確認してください）。';
  if (e instanceof Anthropic.PermissionDeniedError) return 'この API キーでは利用できません（権限エラー）。';
  if (e instanceof Anthropic.NotFoundError) return `モデル「${claudeModel()}」が見つかりません（.env の CLAUDE_MODEL を確認してください）。`;
  if (e instanceof Anthropic.RateLimitError) return 'API の利用上限に達しました。しばらく待ってから再実行してください。';
  if (e instanceof Anthropic.BadRequestError) return `API がリクエストを受け付けませんでした: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Claude API に接続できませんでした（ネットワーク・プロキシ設定を確認してください）。';
  if (e instanceof Anthropic.APIError) return `Claude API エラー (${e.status}): ${e.message}`;
  return (e as Error).message;
}
