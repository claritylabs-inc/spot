import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// One source-closure invocation. Run only in an explicitly dispatched diagnostic.
const checkout = resolve(process.env.QA_ROUTER_CHECKOUT);
const prior = resolve(process.env.QA_PRIOR_ARTIFACTS);
const output = resolve(process.env.QA_PRIVATE_OUTPUT);
const candidate = 'a055d14d7bf565946e5e547117781e89c81777e3';
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim(), candidate);
const hash = value => createHash('sha256').update(value).digest('hex');
const save = (name, value) => {
  const path = join(output, name);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
};
const { PNG } = await import(pathToFileURL(join(checkout, 'node_modules/pngjs/lib/png.js')));
const trace = JSON.parse(readFileSync(join(prior, 'runtime-trace.json')));
const entry = seq => trace.find(value => value.seq === seq);
const native = entry(52), original = entry(72);
assert.equal(native.answers.target.confidence, 0.93);
assert.equal(native.target, original.target);
assert.deepEqual(native.answers.target.box, { top: 0.46, bottom: 0.51, left: 0.3, right: 0.33 });
assert.deepEqual(entry(49).result.model.content, entry(69).result.model.content);
const quad = entry(49).result.model.content;
const xs = [0, 2, 4, 6].map(i => quad[i]), ys = [1, 3, 5, 7].map(i => quad[i]);
const visible = { x: Math.round(Math.min(...xs)), y: Math.round(Math.min(...ys)), width: Math.round(Math.max(...xs) - Math.min(...xs)), height: Math.round(Math.max(...ys) - Math.min(...ys)) };
const images = original.images.map(meta => {
  const bytes = readFileSync(join(prior, meta.file));
  assert.equal(hash(bytes), meta.sha256);
  const decoded = PNG.sync.read(bytes);
  assert.equal(decoded.width, 304); assert.equal(decoded.height, 78);
  return { meta, decoded };
});
const fullBytes = readFileSync(join(prior, native.images[0].file));
assert.equal(hash(fullBytes), native.images[0].sha256);
const full = PNG.sync.read(fullBytes);
assert.equal(full.width, 1024); assert.equal(full.height, 768);
for (let y = 0; y < visible.height; y++) for (let x = 0; x < visible.width; x++) {
  assert.equal(full.data.readUInt32BE(((visible.y + y) * full.width + visible.x + x) * 4), images[0].decoded.data.readUInt32BE((y * visible.width + x) * 4));
}
const sourcePath = 'packages/server/src/browse/primitives.ts';
const source = readFileSync(join(checkout, sourcePath), 'utf8');
const start = source.indexOf('  const cosmeticHover = async (');
const end = source.indexOf('\n  // Sandbox clicks', start);
assert(start > 0 && end > start);
const closure = source.slice(start, end);
const constants = ['CAPTCHA_HOVER_MIN', 'HOVER_MARGIN', 'MAX_HOVER_SCALE'].map(name => {
  const value = source.match(new RegExp(`const ${name} = ([0-9.]+);`));
  assert(value); return value[0];
}).join('\n');
const rectStart = source.indexOf('        const located = {', source.indexOf('    captchaClick:'));
const rectEnd = source.indexOf('\n        };', rectStart) + '\n        };'.length;
assert(rectStart > 0 && rectEnd > rectStart);
const rectSource = source.slice(rectStart, rectEnd);
const viewport = { width: 1024, height: 768 };
// Execute the candidate's exact Box-to-Rect construction; do not substitute DOM bounds.
const located = new Function('answer', 'SANDBOX_VIEWPORT', `${rectSource}\nreturn located;`)(native.answers.target, viewport);
const margin = Number(constants.match(/const HOVER_MARGIN = ([0-9.]+);/)[1]);
const region = { x: Math.max(0, Math.floor(located.x - visible.x) - margin), y: Math.max(0, Math.floor(located.y - visible.y) - margin), right: Math.min(visible.width, Math.ceil(located.x + located.width - visible.x) + margin), bottom: Math.min(visible.height, Math.ceil(located.y + located.height - visible.y) + margin) };
let left = visible.width, top = visible.height, right = -1, bottom = -1, changedPixels = 0, outsidePixels = 0;
for (let y = 0; y < visible.height; y++) for (let x = 0; x < visible.width; x++) {
  const i = (y * visible.width + x) * 4;
  if (images[0].decoded.data.readUInt32BE(i) === images[1].decoded.data.readUInt32BE(i)) continue;
  changedPixels++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  if (x < region.x || x >= region.right || y < region.y || y >= region.bottom) outsidePixels++;
}
const extraction = { candidate, sourcePath, sourceFileSha256: hash(source), closureSha256: hash(closure), closureStartLine: source.slice(0, start).split('\n').length, closureEndLine: source.slice(0, end).split('\n').length - 1, constants, rectSource, method: 'Verbatim closure plus exact source constants; TSX erases types. Only executeDecision is observed before delegation to the actual candidate function.' };
save('source-extraction.json', extraction);
save('cosmetic-closure.ts.txt', closure);
const modulePath = join(output, 'bound-closure.mts');
const module = `import {PNG} from ${JSON.stringify(pathToFileURL(join(checkout, 'node_modules/pngjs/lib/png.js')).href)};
import {executeDecision as actualExecuteDecision} from ${JSON.stringify(pathToFileURL(join(checkout, 'packages/server/src/providers/decisions.ts')).href)};
import {SANDBOX_VIEWPORT} from ${JSON.stringify(pathToFileURL(join(checkout, 'packages/server/src/browse/policy.ts')).href)};
export function bind(options, signal, capture) {
const executeDecision = async (request, settings) => { capture(request); return actualExecuteDecision(request, settings); };
${constants}
${closure}
return cosmeticHover;
}
export function sourceQuestions() { ${closure.slice(closure.indexOf('    const questions:'), closure.indexOf('\n    try {'))} return questions; }
`;
save('bound-closure.mts', module);
const result = { candidate, recordedAt: new Date().toISOString(), scope: 'Offline source closure with preserved actual 96d pixels/Box; no browser/input.', originalProvenance: { traceSeq: { beforeGeometry: 49, nativeBox: 52, afterGeometry: 69, beforeAfterCrops: 72 }, nativeModel: native.model, nativeBox: native.answers.target, nativeBoxImage: native.images[0], nativeBoxScreenshotCropMatchesBefore: true, target: native.target, viewport, contentQuad: quad, visible, originalImages: original.images }, located, region, delta: { changedPixels, inclusiveBounds: { left, top, right, bottom }, outsideRegionPixels: outsidePixels }, sourceExtraction: extraction, closureInvocations: 0, executeDecisionCalls: 0, providerAttempts: 0, actualLogicalRequest: null, actualRequestState: null, actualAnswers: null, transportImages: [], threshold: 0.9 };
// The request is retained privately, unchanged and before real inference, if reachable.
const capture = request => { result.executeDecisionCalls++; assert.equal(result.executeDecisionCalls, 1); save('actual-logical-request.json', request); };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => { result.providerAttempts++; assert.equal(result.providerAttempts, 1, 'No repeated provider request allowed'); return originalFetch(...args); };
const { bind, sourceQuestions } = await import(pathToFileURL(modulePath));
result.sourceQuestionsNotReached = sourceQuestions();
const cosmeticHover = bind({ tenantId: 'spot-authorized-live-qa', environment: process.env }, AbortSignal.timeout(30_000), capture);
result.closureInvocations++;
result.cosmeticHoverApproved = await cosmeticHover(...images.map(image => ({ visible, pixels: image.decoded.data })), native.target, located);
assert.equal(result.cosmeticHoverApproved, false);
assert.equal(result.executeDecisionCalls, 0);
assert.equal(result.providerAttempts, 0);
result.blocker = 'Deterministic changed-pixel containment returns false before canvas construction, questions, or executeDecision: left=13 < region.x=20.';
result.finishedAt = new Date().toISOString();
save('result.json', result);
console.log(JSON.stringify({ cosmeticHoverApproved: result.cosmeticHoverApproved, closureInvocations: result.closureInvocations, executeDecisionCalls: result.executeDecisionCalls, providerAttempts: result.providerAttempts, located, region, delta: result.delta, closureSha256: extraction.closureSha256 }));
