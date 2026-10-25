/**
 * The plain HTML page shared by the billing and legal pages: inline styles
 * only, so it renders under a CSP that allows nothing else.
 */

import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { LEGAL } from "../config";

type Body = HtmlEscapedString | Promise<HtmlEscapedString>;

/** `indexable: false` (the default) keeps search engines off pages that carry a session or a key. */
export function htmlPage(title: string, body: Body, { indexable = false }: { indexable?: boolean } = {}) {
    return html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">${indexable ? "" : html`<meta name="robots" content="noindex">`}<title>${title} · WebLens</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:4rem auto;padding:0 1rem;line-height:1.6}
code,pre{background:#8882;border-radius:6px}pre{padding:1rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
.warn{border-left:4px solid #d97706;padding-left:1rem}footer{margin-top:3rem;font-size:0.9rem}</style></head>
<body><h1>${title}</h1>${body}<footer><a href="/">WebLens</a> · <a href="/docs">API docs</a> · <a href="${LEGAL.paths.terms}">Terms</a> · <a href="${LEGAL.paths.refunds}">Refunds</a> · <a href="${LEGAL.paths.privacy}">Privacy</a></footer></body></html>`;
}
