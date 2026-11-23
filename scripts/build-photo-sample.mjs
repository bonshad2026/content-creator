// A clearly synthetic bottle fixture; no customer photo or paid image generation.
import fs from 'node:fs';
import path from 'node:path';
import {ffmpeg} from '../src/media.js';
import {renderPhotoScene} from '../src/photo-motion.js';
export async function buildPhotoSample(){
  const target=path.resolve('public/samples/photo-motion-v1.mp4');if(fs.existsSync(target))return;
  const dir=path.resolve('data/test-out/photo-motion-sample');fs.mkdirSync(dir,{recursive:true});
  const source=path.join(dir,'fixture.png');
  await ffmpeg(['-f','lavfi','-i','color=c=0xe6d9c2:s=600x800','-vf','drawbox=x=210:y=190:w=180:h=420:color=0x29495b:t=fill,drawbox=x=235:y=140:w=130:h=50:color=0xd4ac62:t=fill,drawbox=x=230:y=350:w=140:h=100:color=white:t=fill','-frames:v','1','-update','1',source]);
  await renderPhotoScene(source,dir);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(dir,'out.mp4'),target);
}
