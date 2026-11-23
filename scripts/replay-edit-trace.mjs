// Local replay, 0 AI requests and no video rendering. Arguments are opaque IDs, never session tokens.
const args = process.argv.slice(2), flag = args.indexOf('--data-dir');
if (flag >= 0) { process.env.DATA_DIR = args[flag+1]; args.splice(flag,2); }
const [editId, traceId] = args;
if (!editId || !traceId || args.length !== 2) {
  console.error('Usage: node scripts/replay-edit-trace.mjs EDIT_ID TRACE_ID [--data-dir data/path]');
  process.exit(2);
}
const {readEditTrace} = await import('../src/edit-trace.js');
const {replayEditTrace} = await import('../src/edit-replay.js');
try {
  // Hydration checks frame hashes, too. No remote client is loaded or called.
  const result = replayEditTrace(readEditTrace(editId, traceId, {hydrate:true}));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.verdict === 'matched' ? 0 : result.verdict === 'different' ? 1 : 2;
} catch (error) {
  console.error('Trace could not be replayed:', error.message);
  process.exitCode = 1;
}
