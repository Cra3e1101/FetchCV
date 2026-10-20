import test from 'node:test';
import assert from 'node:assert/strict';
import {draftDifference} from '../public/workspace/draft-review.js';
test('draft comparison preserves both complete versions including Unicode and empty changes',()=>{
 for(const [old,next] of [['😀甲事实','😀乙事实'],['','new'],['gone',''],['same','same'],['<script>old</script>','<script>new</script>'],['ab','abcab']]){
  const d=draftDifference(old,next);assert.equal(d.prefix+d.removed+d.suffix,old);assert.equal(d.prefix+d.added+d.suffix,next);
 }
 assert.deepEqual(draftDifference('😀甲事实','😀乙事实'),{prefix:'😀',removed:'甲',added:'乙',suffix:'事实'});
});
