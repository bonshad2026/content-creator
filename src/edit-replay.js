// Deterministic replay only. Never imports the AI client, HTTP routes or the job queue.
import {isDeepStrictEqual} from 'node:util';
import {analysisSchema, validateEvidence, templateTimeline} from './templates.js';
import {assessDialogue} from './conversation.js';
import {templateCaptions} from './template-render.js';
import {normalizeAdjustments} from './adjustments.js';
import {resolveEditTurn} from './edit-turn.js';
import {executeCaptionChanges} from './template-changes.js';

export function replayEditTrace(events) {
  const checks = [];
  const find = type => events.findLast(e => e.type === type)?.data;
  const compare = (name, run, expected) => {
    try { checks.push({name, passed:isDeepStrictEqual(run(), expected)}); }
    catch (error) { checks.push({name, passed:false, error:error.name}); }
  };
  const raw = find('analysis.cache_hit')?.data ?? find('model.parsed')?.data;
  const normalized = find('analysis.normalized');
  if (raw && normalized) compare('response normalization', () => analysisSchema.parse(raw), normalized.data);

  const input = find('analysis.input'), result = find('analysis.result'), candidate = find('analysis.candidate');
  if (input && result && candidate) compare('evidence validation', () => validateEvidence(result.data, result.assets, input.edit.analysis?.adjustments), candidate.data);

  const validation = find('dialogue.validation_input'), outcome = find('dialogue.validation_result');
  if (validation && outcome) compare('dialogue validation', () => assessDialogue(validation.decision, validation.context), outcome);
  const transition=find('turn.input'),resolved=find('turn.result');
  if(transition&&resolved)compare('complete edit transition',()=>resolveEditTurn(transition),resolved);
  const caption=find('caption.input'),savedCaption=find('caption.completed');
  if(caption?.assets&&savedCaption){
    compare('manual caption transaction',()=>executeCaptionChanges(caption.before,caption.assets,caption.edits),savedCaption.execution);
    compare('saved caption state',()=>executeCaptionChanges(caption.before,caption.assets,caption.edits).state,savedCaption.analysis);
  }

  const render = find('render.input'), plan = find('render.plan');
  if (render && plan) {
    const {analysis} = render.templateData,assets=find('render.evidence')?.assets||render.templateData.assets;
    compare('render timeline', () => templateTimeline(analysis, assets), plan.timeline);
    compare('render settings', () => normalizeAdjustments(analysis.adjustments, assets).value, plan.settings);
    compare('render captions', () => templateCaptions(templateTimeline(analysis, assets), plan.settings), plan.captions);
  }
  return {
    traceId:events[0]?.traceId || null, kind:events[0]?.data.kind || null,
    terminalEvent:events.findLast(e => /^(analysis|render|action|caption)\.(completed|error|rejected|interrupted)$/.test(e.type))?.type || null,
    captured:{modelRequests:events.filter(e => e.type === 'model.request').length,modelResponses:events.filter(e => e.type === 'model.response').length,cacheHits:events.filter(e => e.type === 'analysis.cache_hit').length,speechRequests:events.filter(e => e.type === 'speech.request').length},
    checks, verdict:checks.length ? (checks.every(c => c.passed) ? 'matched' : 'different') : 'not-replayable',
  };
}
